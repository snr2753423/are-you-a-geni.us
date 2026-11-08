// Demo prep: three bot "geniuses" get devnet SOL from the faucet, place REAL Solana bets through the
// same /api/trade endpoint the browser uses, then one market is resolved so the Genius IQ leaderboard
// and on-chain payouts have data. Every step here is a real Solana transaction.
//   usage: node video/prep.js [http://localhost:3100]
import 'dotenv/config';
import fs from 'node:fs';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3000}`;
const api = async (p, body) => {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json();
  if (!r.ok) throw new Error(`${p}: ${d.error}`);
  return d;
};
const keyFile = new URL('./out/bots.json', import.meta.url);
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const saved = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile)) : {};
const bots = ['ada.lovelace', 'big.brain.bob', 'crowd.follower'].map((nick) => {
  saved[nick] ||= Array.from(Keypair.generate().secretKey);
  return { nick, kp: Keypair.fromSecretKey(Uint8Array.from(saved[nick])) };
});
fs.writeFileSync(keyFile, JSON.stringify(saved));

const cfg = await api('/api/config');
async function bet(bot, marketId, side, sol) {
  const { blockhash, lastValidBlockHeight } = await api('/api/blockhash');
  const tx = new Transaction({ feePayer: bot.kp.publicKey, blockhash, lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: bot.kp.publicKey, toPubkey: new PublicKey(cfg.treasury), lamports: Math.round(sol * 1e9) }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(cfg.memoProgram), keys: [{ pubkey: bot.kp.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(`${cfg.memoPrefix}:${marketId}:${side}`) }));
  tx.sign(bot.kp);
  const r = await api('/api/trade', { tx: tx.serialize().toString('base64'), lastValidBlockHeight, nick: bot.nick });
  console.log(`  ${bot.nick.padEnd(15)} ${side.padEnd(3)} ◎${sol} on ${marketId.padEnd(16)} ${Math.round(r.priceBefore * 100)}%→${Math.round(r.priceAfter * 100)}%  confirmed ${r.confirmMs}ms  ${r.signature.slice(0, 12)}…`);
}

console.log('Funding bots from the treasury faucet…');
for (const b of bots) {
  const r = await api('/api/fund', { wallet: b.kp.publicKey.toBase58() });
  console.log(`  ${b.nick}: ${r.skipped ? 'already funded' : r.signature.slice(0, 12) + '…'}`);
}
console.log('Placing bets (real Solana txs)…');
const [ada, bob, crowd] = bots;
await bet(ada, 'pizza-runs-out', 'NO', 0.01);       // contrarian, early, cheap
await bet(crowd, 'pizza-runs-out', 'YES', 0.015);   // follows the crowd
await bet(bob, 'pizza-runs-out', 'NO', 0.01);
await bet(ada, 'coffee-cups', 'YES', 0.01);
await bet(crowd, 'coffee-cups', 'NO', 0.01);
await bet(bob, 'sol-250', 'YES', 0.008);
await bet(crowd, 'gta6-2026', 'YES', 0.01);
await bet(ada, 'nyc-white-xmas', 'YES', 0.005);
const pause = () => new Promise((r) => setTimeout(r, 1500));
for (const [bot, side, amt] of [[crowd, 'YES', 0.03], [ada, 'NO', 0.02], [bob, 'YES', 0.015], [ada, 'NO', 0.025], [crowd, 'YES', 0.02]]) {
  await pause(); await bet(bot, 'judges-laugh', side, amt);
}

if (process.env.ADMIN_KEY) {
  console.log('Resolving markets and paying winners on Solana…');
  for (const [marketId, outcome] of [['pizza-runs-out', 'NO'], ['coffee-cups', 'YES']]) {
    try {
      const r = await api('/api/admin/resolve', { key: process.env.ADMIN_KEY, marketId, outcome });
      console.log(`  ${marketId} -> ${outcome}: ${r.winners} winner(s) paid, tx ${r.signatures.map((s) => s.slice(0, 12)).join(', ')}…`);
    } catch (e) { console.log(`  ${marketId}: ${e.message}`); }
  }
}
const lb = await api('/api/leaderboard');
console.log('Genius IQ:', lb.geniuses.map((g) => `${g.nick} ${g.iq} (${g.title})`).join(' | '));
