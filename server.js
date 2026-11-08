// are-you-a-geni.us — a prediction market where every bet is a Solana transaction
// and every market, position, price tick and Genius IQ lives in MongoDB Atlas.
//
//   Solana            = money + proof. A bet is a real SOL transfer to the market treasury with an
//                       on-chain memo receipt. The server only counts a bet after the chain confirms it.
//                       Winners are paid out in SOL from the treasury, each payout is an on-chain tx.
//   MongoDB Atlas     = the market brain. LMSR market state, ACID multi-document settlement, time series
//                       price history, change streams for the live tape, Atlas Search for discovery,
//                       aggregation pipelines ($lookup, $setWindowFields) for the Genius IQ leaderboard.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- config ----------------
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'geni_us';
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const LMSR_B = Number(process.env.LMSR_B || 0.2); // SOL
const FUND_LAMPORTS = Math.round(Number(process.env.FUND_SOL || 0.05) * LAMPORTS_PER_SOL);
const MIN_BET = 0.001 * LAMPORTS_PER_SOL;
const MAX_BET = 0.5 * LAMPORTS_PER_SOL;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MEMO_PREFIX = 'geni.us:v1';

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and paste your Atlas connection string.');
  process.exit(1);
}
const treasury = process.env.TREASURY_SECRET_KEY
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET_KEY)))
  : null;
if (!treasury) {
  console.error('Missing TREASURY_SECRET_KEY. Run `npm run wallet`.');
  process.exit(1);
}
const connection = new Connection(SOLANA_RPC, 'confirmed');
// devnet in production; a local `solana-test-validator` works identically (and has an unlimited faucet)
const CLUSTER = process.env.SOLANA_CLUSTER
  || (/localhost|127\.0\.0\.1/.test(SOLANA_RPC) ? 'localnet' : /testnet/.test(SOLANA_RPC) ? 'testnet' : /mainnet/.test(SOLANA_RPC) ? 'mainnet-beta' : 'devnet');
const EXPLORER_QUERY = CLUSTER === 'localnet'
  ? `?cluster=custom&customUrl=${encodeURIComponent(SOLANA_RPC)}`
  : CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`;

// Make sure the market treasury can pay the faucet + winners. Works out of the box on localnet;
// on devnet the RPC airdrop is closed, so fund it at https://faucet.solana.com.
async function ensureTreasuryFunded() {
  const bal = await connection.getBalance(treasury.publicKey).catch(() => 0);
  if (bal >= 2 * LAMPORTS_PER_SOL) return console.log(`[solana] treasury balance ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL on ${CLUSTER}`);
  try {
    const sig = await connection.requestAirdrop(treasury.publicKey, (CLUSTER === 'localnet' ? 500 : 2) * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`[solana] airdropped SOL to the treasury on ${CLUSTER}: ${sig}`);
  } catch (e) {
    console.log(`[solana] treasury has ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL and the ${CLUSTER} airdrop failed (${e.message.split('\n')[0].slice(0, 90)}).`);
    console.log(`         Fund ${treasury.publicKey.toBase58()} at https://faucet.solana.com, or run a local validator (see README).`);
  }
}
ensureTreasuryFunded();

// ---------------- MongoDB Atlas ----------------
const mongo = new MongoClient(MONGODB_URI, { appName: 'are-you-a-geni.us' });
await mongo.connect();
const db = mongo.db(DB_NAME);
export const col = {
  markets: db.collection('markets'),       // LMSR state per market (q_yes, q_no, b), Atlas Search index
  trades: db.collection('trades'),         // _id = Solana tx signature -> a tx can never be counted twice
  positions: db.collection('positions'),   // per wallet per market share balances
  users: db.collection('users'),           // wallet profiles + running stats
  priceTicks: db.collection('price_ticks'),// TIME SERIES collection: implied probability over time
  payouts: db.collection('payouts'),       // on-chain payout receipts (tx signatures)
  fundings: db.collection('fundings'),     // burner faucet rate limits (TTL index)
};
const features = { search: false, changeStreams: false, transactions: false, timeseries: false };

async function ensureSchema() {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  if (!existing.has('price_ticks')) {
    await db.createCollection('price_ticks', {
      timeseries: { timeField: 'ts', metaField: 'marketId', granularity: 'seconds' },
    });
    console.log('[atlas] created time series collection price_ticks');
  }
  features.timeseries = true;
  await col.trades.createIndex({ marketId: 1, ts: -1 });
  await col.trades.createIndex({ wallet: 1, ts: -1 });
  await col.positions.createIndex({ marketId: 1 });
  await col.positions.createIndex({ wallet: 1 });
  await col.markets.createIndex({ status: 1, volumeLamports: -1 });
  await col.fundings.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 6 });
  await col.fundings.createIndex({ ip: 1, createdAt: -1 });
}
// Atlas Search index: created by the app itself, re-checked until it is queryable
async function ensureSearchIndex() {
  try {
    const idx = (await col.markets.listSearchIndexes().toArray()).find((i) => i.name === 'markets_search');
    features.search = true;
    if (idx && !['DELETING', 'FAILED', 'DOES_NOT_EXIST'].includes(idx.status)) {
      if (!idx.queryable) setTimeout(ensureSearchIndex, 15000);
      return;
    }
    await col.markets.createSearchIndex({
      name: 'markets_search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            question: [{ type: 'string' }, { type: 'autocomplete', tokenization: 'edgeGram', minGrams: 2, maxGrams: 15, foldDiacritics: true }],
            description: { type: 'string' },
            category: { type: 'token' },
          },
        },
      },
    }).catch((e) => { if (!/already exists/i.test(e.message)) throw e; });
    console.log('[atlas] creating Atlas Search index markets_search (queryable in ~1 min)');
    setTimeout(ensureSearchIndex, 15000);
  } catch (e) {
    features.search = false;
    console.log(`[atlas] Atlas Search unavailable on this deployment (${e.codeName || e.message.split('\n')[0]}), using regex fallback`);
  }
}
await ensureSchema();
await ensureSearchIndex();

// ---------------- LMSR market maker ----------------
// Cost function C(q) = b * ln(e^(qy/b) + e^(qn/b)). Each winning share redeems for exactly 1 SOL.
const lse = (a, b) => { const m = Math.max(a, b); return m + Math.log(Math.exp(a - m) + Math.exp(b - m)); };
const cost = (qy, qn, b) => b * lse(qy / b, qn / b);
export const priceYes = (qy, qn, b) => 1 / (1 + Math.exp((qn - qy) / b));
// shares received for spending `amount` SOL on `side`
export function sharesFor(m, side, amount) {
  const { qYes: qy, qNo: qn, b } = m;
  const target = cost(qy, qn, b) + amount;
  if (side === 'YES') {
    const nq = b * Math.log(Math.exp(target / b) - Math.exp(qn / b));
    return nq - qy;
  }
  const nq = b * Math.log(Math.exp(target / b) - Math.exp(qy / b));
  return nq - qn;
}
function quote(m, side, lamports) {
  const amount = lamports / LAMPORTS_PER_SOL;
  const shares = sharesFor(m, side, amount);
  const before = priceYes(m.qYes, m.qNo, m.b);
  const nm = { ...m, qYes: m.qYes + (side === 'YES' ? shares : 0), qNo: m.qNo + (side === 'NO' ? shares : 0) };
  const after = priceYes(nm.qYes, nm.qNo, nm.b);
  return { shares, avgPrice: amount / shares, priceBefore: before, priceAfter: after, payoutIfWin: shares };
}
const publicMarket = (m) => ({
  ...m,
  pYes: priceYes(m.qYes, m.qNo, m.b),
  volumeSol: (m.volumeLamports || 0) / LAMPORTS_PER_SOL,
});

// ---------------- Solana helpers ----------------
const memoIx = (text, signer) => new TransactionInstruction({
  programId: MEMO_PROGRAM_ID,
  keys: signer ? [{ pubkey: signer, isSigner: true, isWritable: false }] : [],
  data: Buffer.from(text, 'utf8'),
});
const isWallet = (s) => { try { return PublicKey.isOnCurve(new PublicKey(s).toBytes()); } catch { return false; } };

async function getParsedTxWithRetry(signature, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

// Verify that a confirmed Solana tx is a valid bet: SOL transfer signer -> treasury + memo "geni.us:v1:<market>:<side>"
function verifyBetTx(tx) {
  if (tx.meta?.err) throw new Error('transaction failed on-chain');
  const ixs = tx.transaction.message.instructions;
  const transfer = ixs.find((ix) => ix.program === 'system' && ix.parsed?.type === 'transfer'
    && ix.parsed.info.destination === treasury.publicKey.toBase58());
  if (!transfer) throw new Error('no SOL transfer to the market treasury in this tx');
  const memo = ixs.find((ix) => ix.programId.toBase58() === MEMO_PROGRAM_ID.toBase58());
  const text = typeof memo?.parsed === 'string' ? memo.parsed : null;
  if (!text?.startsWith(`${MEMO_PREFIX}:`)) throw new Error('missing geni.us memo receipt');
  const [, , marketId, side] = text.split(':');
  if (!['YES', 'NO'].includes(side)) throw new Error('bad side in memo');
  const wallet = transfer.parsed.info.source;
  const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
  if (signer !== wallet) throw new Error('transfer source must be the signer');
  return { marketId, side, wallet, lamports: Number(transfer.parsed.info.lamports), memo: text };
}

// ---------------- settlement (MongoDB multi-document ACID transaction) ----------------
async function settleTrade({ signature, marketId, side, wallet, lamports, nick, slot, blockTime, confirmMs, memo }) {
  const session = mongo.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const m = await col.markets.findOne({ _id: marketId }, { session });
      if (!m) throw Object.assign(new Error('unknown market'), { status: 404 });
      if (m.status !== 'open') throw Object.assign(new Error('market is closed'), { status: 409 });
      const q = quote(m, side, lamports);
      const ts = new Date();
      // _id = signature: a unique key, so replaying the same Solana tx aborts the whole transaction
      await col.trades.insertOne({
        _id: signature, marketId, wallet, nick, side, lamports, shares: q.shares, avgPrice: q.avgPrice,
        priceBefore: q.priceBefore, priceAfter: q.priceAfter, slot, blockTime, confirmMs, memo, ts,
      }, { session });
      const isNewTrader = !(await col.positions.findOne({ _id: `${marketId}:${wallet}` }, { session }));
      await col.markets.updateOne({ _id: marketId }, {
        $inc: {
          [side === 'YES' ? 'qYes' : 'qNo']: q.shares, volumeLamports: lamports, tradeCount: 1, traders: isNewTrader ? 1 : 0,
        },
        $set: { lastTradeAt: ts },
      }, { session });
      await col.positions.updateOne({ _id: `${marketId}:${wallet}` }, {
        $inc: { [side === 'YES' ? 'yesShares' : 'noShares']: q.shares, [side === 'YES' ? 'yesCost' : 'noCost']: lamports },
        $setOnInsert: { marketId, wallet, createdAt: ts, paid: false },
      }, { upsert: true, session });
      await col.users.updateOne({ _id: wallet }, {
        $inc: { trades: 1, volumeLamports: lamports },
        $set: { nick, lastSeen: ts },
        $setOnInsert: { createdAt: ts },
      }, { upsert: true, session });
      result = { ...q, ts };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
  // time series inserts can't join a transaction, so the price tick is written right after commit
  await col.priceTicks.insertOne({ ts: result.ts, marketId, pYes: result.priceAfter, lamports, side });
  return result;
}

// ---------------- Express ----------------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/web3.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/@solana/web3.js/lib/index.iife.min.js')));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (e.code === 11000) return res.status(409).json({ error: 'this Solana transaction was already counted' });
  console.error(e.message);
  res.status(e.status || 400).json({ error: e.message });
});

app.get('/api/config', (_req, res) => res.json({
  treasury: treasury.publicKey.toBase58(), rpc: SOLANA_RPC, cluster: CLUSTER, explorerQuery: EXPLORER_QUERY, memoPrefix: MEMO_PREFIX,
  memoProgram: MEMO_PROGRAM_ID.toBase58(), minBet: MIN_BET, maxBet: MAX_BET, features,
}));

app.get('/api/blockhash', wrap(async (_req, res) => res.json(await connection.getLatestBlockhash('confirmed'))));
app.get('/api/balance/:wallet', wrap(async (req, res) => res.json({ lamports: await connection.getBalance(new PublicKey(req.params.wallet)) })));

// Market discovery: Atlas Search (fuzzy + autocomplete) with a regex fallback
app.get('/api/markets', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const category = String(req.query.category || '').trim();
  let markets; let engine = 'find';
  if (q && features.search) {
    try {
      const pipeline = [
        { $search: { index: 'markets_search', compound: {
          should: [
            { autocomplete: { query: q, path: 'question', fuzzy: { maxEdits: 1, prefixLength: 1 } } },
            { text: { query: q, path: ['question', 'description'], fuzzy: { maxEdits: 1, prefixLength: 1 } } },
          ],
          minimumShouldMatch: 1,
          ...(category ? { filter: [{ equals: { path: 'category', value: category } }] } : {}),
        } } },
        { $limit: 30 },
        { $addFields: { score: { $meta: 'searchScore' } } },
      ];
      markets = await col.markets.aggregate(pipeline).toArray();
      engine = 'atlas-search';
    } catch { markets = null; }
  }
  if (!markets) {
    const filter = {};
    if (q) filter.question = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (category) filter.category = category;
    markets = await col.markets.find(filter).sort({ status: -1, volumeLamports: -1 }).limit(50).toArray();
    engine = q ? 'regex' : 'find';
  }
  res.json({ engine, markets: markets.map(publicMarket) });
}));

app.get('/api/markets/:id', wrap(async (req, res) => {
  const m = await col.markets.findOne({ _id: req.params.id });
  if (!m) return res.status(404).json({ error: 'not found' });
  const [trades, history] = await Promise.all([
    col.trades.find({ marketId: m._id }).sort({ ts: -1 }).limit(25).toArray(),
    // time series + $dateTrunc bucketing: last price per 1s bucket
    col.priceTicks.aggregate([
      { $match: { marketId: m._id } },
      { $sort: { ts: 1 } },
      { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'second', binSize: 1 } }, pYes: { $last: '$pYes' } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, t: '$_id', p: '$pYes' } },
    ]).toArray(),
  ]);
  const payouts = m.status === 'resolved' ? await col.payouts.find({ marketId: m._id }).toArray() : [];
  res.json({ market: publicMarket(m), trades, history, payouts });
}));

app.get('/api/quote', wrap(async (req, res) => {
  const m = await col.markets.findOne({ _id: String(req.query.market) });
  if (!m) return res.status(404).json({ error: 'not found' });
  const side = req.query.side === 'NO' ? 'NO' : 'YES';
  const lamports = Math.round(Number(req.query.sol) * LAMPORTS_PER_SOL);
  if (!(lamports >= MIN_BET && lamports <= MAX_BET)) throw new Error('bet must be 0.001 - 0.5 SOL');
  res.json(quote(m, side, lamports));
}));

// Place a bet: browser signs [SystemProgram.transfer -> treasury, Memo receipt]. We relay it to Solana,
// wait for confirmation, re-read the confirmed tx from the chain, verify it, then settle in Atlas.
app.post('/api/trade', wrap(async (req, res) => {
  const { tx: rawB64, signature: givenSig, nick: rawNick } = req.body || {};
  const nick = String(rawNick || '').replace(/[^\w .-]/g, '').slice(0, 20) || null;
  let signature = givenSig;
  const t0 = Date.now();
  if (rawB64) {
    const raw = Buffer.from(String(rawB64), 'base64');
    const parsed = Transaction.from(raw);
    signature = bs58.encode(parsed.signature);
    if (await col.trades.findOne({ _id: signature }, { projection: { _id: 1 } })) throw Object.assign(new Error('already counted'), { code: 11000 });
    await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
    const bh = { blockhash: parsed.recentBlockhash, lastValidBlockHeight: Number(req.body.lastValidBlockHeight) };
    const conf = await connection.confirmTransaction({ signature, ...bh }, 'confirmed');
    if (conf.value.err) throw new Error('transaction failed on-chain');
  }
  if (!signature) throw new Error('missing tx');
  const confirmMs = Date.now() - t0;
  const ptx = await getParsedTxWithRetry(signature);
  if (!ptx) throw new Error('transaction not found on-chain (yet)');
  const bet = verifyBetTx(ptx);
  if (!(bet.lamports >= MIN_BET && bet.lamports <= MAX_BET)) throw new Error('bet must be 0.001 - 0.5 SOL');
  const t1 = Date.now();
  const q = await settleTrade({ signature, ...bet, nick, slot: ptx.slot, blockTime: ptx.blockTime, confirmMs });
  res.json({ ok: true, signature, slot: ptx.slot, confirmMs, settleMs: Date.now() - t1, ...bet, ...q });
}));

// On-chain receipt: read any geni.us transaction straight from the Solana RPC
app.get('/api/tx/:sig', wrap(async (req, res) => {
  const tx = await connection.getParsedTransaction(req.params.sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx) return res.status(404).json({ error: 'transaction not found on-chain' });
  const instructions = tx.transaction.message.instructions.map((ix) => ({
    program: ix.program || ix.programId.toBase58(), type: ix.parsed?.type || (typeof ix.parsed === 'string' ? 'memo' : null),
    info: typeof ix.parsed === 'string' ? { memo: ix.parsed } : ix.parsed?.info || null,
  }));
  res.json({
    signature: req.params.sig, slot: tx.slot, blockTime: tx.blockTime, fee: tx.meta.fee, status: tx.meta.err ? 'failed' : 'success',
    signers: tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey.toBase58()),
    instructions, logs: tx.meta.logMessages, cluster: CLUSTER, rpc: SOLANA_RPC,
    dbRecord: await col.trades.findOne({ _id: req.params.sig }),
  });
}));

// Burner-wallet faucet (devnet): new visitors can bet instantly without installing a wallet
app.post('/api/fund', wrap(async (req, res) => {
  const wallet = String(req.body?.wallet || '');
  if (!isWallet(wallet)) throw new Error('bad wallet');
  const pk = new PublicKey(wallet);
  const bal = await connection.getBalance(pk);
  if (bal >= FUND_LAMPORTS / 2) return res.json({ skipped: true, lamports: bal });
  const recent = await col.fundings.countDocuments({ $or: [{ ip: req.ip }, { wallet }], createdAt: { $gt: new Date(Date.now() - 3600e3) } });
  if (recent >= 5) throw Object.assign(new Error('faucet limit reached, try again later'), { status: 429 });
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: pk, lamports: FUND_LAMPORTS }),
    memoIx(`${MEMO_PREFIX}:faucet`, treasury.publicKey),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: 'confirmed' });
  await col.fundings.insertOne({ ip: req.ip, wallet, sig, lamports: FUND_LAMPORTS, createdAt: new Date() });
  res.json({ signature: sig, lamports: bal + FUND_LAMPORTS, funded: FUND_LAMPORTS });
}));

// Genius IQ: aggregation pipeline joining every trade to its resolved market.
// edge per trade = (won ? 1 - avgPrice : -avgPrice). Buying cheap and being right = genius.
const geniusPipeline = (match = {}) => [
  { $match: match },
  { $lookup: { from: 'markets', localField: 'marketId', foreignField: '_id', as: 'm', pipeline: [{ $project: { status: 1, outcome: 1 } }] } },
  { $unwind: '$m' },
  { $match: { 'm.status': 'resolved' } },
  { $set: { won: { $eq: ['$side', '$m.outcome'] } } },
  { $set: { edge: { $cond: ['$won', { $subtract: [1, '$avgPrice'] }, { $multiply: [-1, '$avgPrice'] }] },
    pnl: { $cond: ['$won', { $subtract: [{ $multiply: ['$shares', LAMPORTS_PER_SOL] }, '$lamports'] }, { $multiply: [-1, '$lamports'] }] } } },
  { $group: { _id: '$wallet', nick: { $last: '$nick' }, calls: { $sum: 1 }, correct: { $sum: { $cond: ['$won', 1, 0] } },
    avgEdge: { $avg: '$edge' }, pnlLamports: { $sum: '$pnl' } } },
  { $set: {
    accuracy: { $divide: ['$correct', '$calls'] },
    iq: { $min: [200, { $max: [55, { $round: [{ $add: [100, { $multiply: ['$avgEdge', 150] }, { $multiply: [{ $ln: { $add: ['$calls', 1] } }, 4] }] }, 0] }] }] },
  } },
  { $setWindowFields: { sortBy: { iq: -1 }, output: { rank: { $rank: {} } } } },
  { $set: { title: { $switch: { branches: [
    { case: { $gte: ['$iq', 140] }, then: 'Certified Geni.us' },
    { case: { $gte: ['$iq', 120] }, then: 'Gifted' },
    { case: { $gte: ['$iq', 100] }, then: 'Above Average' },
  ], default: 'Needs More Coffee' } } } },
  { $sort: { rank: 1 } },
];

app.get('/api/leaderboard', wrap(async (_req, res) => {
  const [geniuses, whales] = await Promise.all([
    col.trades.aggregate([...geniusPipeline(), { $limit: 25 }]).toArray(),
    col.users.find({}).sort({ volumeLamports: -1 }).limit(10).toArray(),
  ]);
  res.json({ geniuses, whales, pipeline: geniusPipeline() });
}));

app.get('/api/me/:wallet', wrap(async (req, res) => {
  const wallet = req.params.wallet;
  const [positions, iq, payouts] = await Promise.all([
    col.positions.aggregate([
      { $match: { wallet } },
      { $lookup: { from: 'markets', localField: 'marketId', foreignField: '_id', as: 'market' } },
      { $unwind: '$market' },
      { $sort: { createdAt: -1 } },
    ]).toArray(),
    col.trades.aggregate(geniusPipeline({ wallet })).toArray(),
    col.payouts.find({ wallet }).sort({ ts: -1 }).toArray(),
  ]);
  res.json({ positions: positions.map((p) => ({ ...p, market: publicMarket(p.market) })), genius: iq[0] || null, payouts });
}));

// "Under the hood" — live stats so judges can see exactly what Atlas is doing
app.get('/api/atlas', wrap(async (_req, res) => {
  const names = Object.values(col).map((c) => c.collectionName);
  const counts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await db.collection(n).estimatedDocumentCount()])));
  let searchIndexes = [];
  try { searchIndexes = (await col.markets.listSearchIndexes().toArray()).map((i) => ({ name: i.name, status: i.status, queryable: i.queryable })); } catch { /* not atlas */ }
  const tsInfo = (await db.listCollections({ name: 'price_ticks' }).toArray())[0]?.options?.timeseries;
  const lastTrade = await col.trades.find().sort({ ts: -1 }).limit(1).toArray();
  res.json({ db: DB_NAME, counts, searchIndexes, timeseries: tsInfo, features, lastTrade: lastTrade[0] || null });
}));

// Admin: resolve a market and pay winners in SOL on Solana
app.post('/api/admin/resolve', wrap(async (req, res) => {
  if (req.body?.key !== ADMIN_KEY) return res.status(401).json({ error: 'bad admin key' });
  const outcome = req.body.outcome === 'NO' ? 'NO' : 'YES';
  const m = await col.markets.findOneAndUpdate(
    { _id: req.body.marketId, status: 'open' },
    { $set: { status: 'resolved', outcome, resolvedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!m) throw new Error('market not found or already resolved');
  const result = await payWinners(m);
  res.json({ ok: true, outcome, ...result });
}));

async function payWinners(m) {
  const shareField = m.outcome === 'YES' ? '$yesShares' : '$noShares';
  const winners = await col.positions.aggregate([
    { $match: { marketId: m._id, paid: false } },
    { $project: { wallet: 1, lamports: { $floor: { $multiply: [{ $ifNull: [shareField, 0] }, LAMPORTS_PER_SOL] } } } },
    { $match: { lamports: { $gt: 0 } } },
  ]).toArray();
  const sigs = [];
  for (let i = 0; i < winners.length; i += 8) {
    const batch = winners.slice(i, i + 8);
    const tx = new Transaction();
    batch.forEach((w) => tx.add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: new PublicKey(w.wallet), lamports: w.lamports })));
    tx.add(memoIx(`${MEMO_PREFIX}:payout:${m._id}:${m.outcome}`, treasury.publicKey));
    const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: 'confirmed' });
    sigs.push(sig);
    await col.payouts.insertMany(batch.map((w) => ({ _id: `${sig}:${w.wallet}`, signature: sig, marketId: m._id, wallet: w.wallet, lamports: w.lamports, ts: new Date() })));
    await col.positions.updateMany({ _id: { $in: batch.map((w) => w._id) } }, { $set: { paid: true, payoutSig: sig } });
  }
  await col.positions.updateMany({ marketId: m._id, paid: false }, { $set: { paid: true } });
  await col.markets.updateOne({ _id: m._id }, { $set: { payoutSigs: sigs, winners: winners.length } });
  return { winners: winners.length, signatures: sigs };
}

// Live tape: one change stream on trades + markets fanned out to every browser over SSE
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ changeStreams: features.changeStreams })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const broadcast = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; clients.forEach((c) => c.write(s)); };
setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 20000);

function startChangeStream() {
  try {
    const cs = db.watch([
      { $match: { 'ns.coll': { $in: ['trades', 'markets'] }, operationType: { $in: ['insert', 'update', 'replace'] } } },
    ], { fullDocument: 'updateLookup' });
    cs.on('change', (ch) => {
      const doc = ch.fullDocument;
      if (!doc) return;
      if (ch.ns.coll === 'trades' && ch.operationType === 'insert') broadcast('trade', doc);
      if (ch.ns.coll === 'markets') broadcast('market', publicMarket(doc));
    });
    cs.on('error', (e) => { console.log('[atlas] change stream error, retrying', e.message); features.changeStreams = false; setTimeout(startChangeStream, 3000); });
    features.changeStreams = true;
    console.log('[atlas] change stream open on trades + markets');
  } catch (e) { console.log('[atlas] change streams unavailable', e.message); }
}
startChangeStream();
features.transactions = true;

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.listen(PORT, () => {
  console.log(`are-you-a-geni.us on http://localhost:${PORT}`);
  console.log(`treasury ${treasury.publicKey.toBase58()} on ${CLUSTER} (${SOLANA_RPC})`);
});
