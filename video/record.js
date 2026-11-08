// Records the narrated demo video end-to-end: drives the real app in Chrome (Playwright), narrates with
// macOS `say`, overlays captions in-page, and muxes everything into video/out/demo.mp4 with ffmpeg.
// Every bet in the video is a live Solana transaction (devnet or a local validator) settled in MongoDB.
//   prerequisites: server running (npm start / npm run dev:local), treasury funded, `node video/prep.js` done
//   usage: node video/record.js [http://localhost:3100]
import 'dotenv/config';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3000}`;
const OUT = new URL('./out/', import.meta.url).pathname;
const AUDIO = `${OUT}audio/`;
fs.mkdirSync(AUDIO, { recursive: true });
const VOICE = process.env.VOICE || 'Samantha';
const W = 1440; const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json(); if (!r.ok) throw new Error(`${p}: ${d.error}`); return d;
};

// a second trader, betting from "another device" (this script) to show the change stream live
const bots = JSON.parse(fs.readFileSync(`${OUT}bots.json`));
const bob = Keypair.fromSecretKey(Uint8Array.from(bots['big.brain.bob']));
async function botBet(marketId, side, sol) {
  const cfg = await api('/api/config');
  const { blockhash, lastValidBlockHeight } = await api('/api/blockhash');
  const tx = new Transaction({ feePayer: bob.publicKey, blockhash, lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: bob.publicKey, toPubkey: new PublicKey(cfg.treasury), lamports: Math.round(sol * 1e9) }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(cfg.memoProgram), keys: [{ pubkey: bob.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(`${cfg.memoPrefix}:${marketId}:${side}`) }));
  tx.sign(bob);
  return api('/api/trade', { tx: tx.serialize().toString('base64'), lastValidBlockHeight, nick: 'big.brain.bob' });
}

const card = (title, sub, foot = '') => `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#2a1650,#0d0b14 60%);color:#f2eefc;font-family:'Space Grotesk',sans-serif;text-align:center}
h1{font-size:92px;margin:0;letter-spacing:-3px}h1 .g{color:#c6f432}h1 .q{color:#9945ff}p{font-size:34px;color:#b9b0d6;margin:18px 0 0}
.row{display:flex;gap:18px;justify-content:center;margin-top:44px;font-size:22px}.b{padding:12px 20px;border-radius:14px;border:1px solid #3a3256;background:#161321}
.s{color:#d5b8ff;border-color:#4a2e7a}.m{color:#7dffb0;border-color:#1d5a37}.d{color:#e6ff9a;border-color:#55551d}</style></head>
<body><div><h1>are-you-a-<span class="g">geni.us</span><span class="q">?</span></h1><p>${sub}</p>${foot}</div></body></html>`;
const badges = `<div class="row"><span class="b s">◎ Solana: money + proof</span><span class="b m">🍃 MongoDB Atlas: the market brain</span><span class="b d">🌐 .us via GoDaddy Registry</span></div>`;

// in-page caption bar (lower third)
async function cap(page, tag, text) {
  await page.evaluate(([tag, text]) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div'); el.id = '__cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:54px;transform:translateX(-50%);z-index:99999;max-width:1100px;padding:14px 22px;border-radius:16px;background:rgba(10,9,16,.94);color:#fff;font:600 22px Space Grotesk,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6);display:flex;gap:14px;align-items:center;transition:opacity .3s';
      document.body.appendChild(el);
    }
    const colors = { sol: ['#9945ff', '◎ SOLANA'], mongo: ['#00ed64', '🍃 MONGODB ATLAS'], domain: ['#c6f432', '🌐 GODADDY REGISTRY'], both: ['#c6f432', '◎ + 🍃'] };
    if (!text) { el.style.opacity = 0; return; }
    const [c, label] = colors[tag] || ['#888', ''];
    el.style.opacity = 1; el.style.border = `2px solid ${c}`;
    el.innerHTML = `${label ? `<span style="color:${c};font-size:14px;letter-spacing:1px;white-space:nowrap">${label}</span>` : ''}<span>${text}</span>`;
  }, [tag, text]);
}
async function cursorClick(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => {
      let c = document.getElementById('__cur');
      if (!c) { c = document.createElement('div'); c.id = '__cur'; c.style.cssText = 'position:fixed;z-index:100000;width:26px;height:26px;border-radius:50%;background:rgba(198,244,50,.45);border:2px solid #c6f432;pointer-events:none;transition:all .45s ease;transform:translate(-50%,-50%)'; document.body.appendChild(c); }
      c.style.left = `${x}px`; c.style.top = `${y}px`;
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    await sleep(500);
  }
  await el.click();
}

let userBetSig = null;
const scenes = [
  { say: 'This is are-you-a-geni.us. The domain asks the question, and the app lets you answer it. It’s a prediction market where you prove you’re a genius by being right before everyone else. We registered the dot U S domain through GoDaddy Registry, so the name is the pitch.',
    run: async (p) => { await p.setContent(card('', 'Are you a genius? Prove it on-chain.', badges)); } },
  { say: 'Two technologies do all of the work. Solana is the money and the proof: every bet is a real Solana transaction. For this recording we run a local Solana validator, and the same code runs on devnet. MongoDB Atlas is the market brain: odds, settlement, history, search, and the leaderboard.',
    run: async (p) => { await p.goto(BASE); await p.waitForSelector('.mcard'); await cap(p, 'both', 'Solana = money + proof · MongoDB Atlas = odds, settlement, history, search, leaderboard'); await sleep(5000); await p.mouse.wheel(0, 420); } },
  { say: 'Discovery runs on Atlas Search. I’ll misspell snow, and fuzzy autocomplete still finds the Christmas market.',
    run: async (p) => { await p.mouse.wheel(0, -1000); await cap(p, 'mongo', 'Atlas Search: $search with fuzzy autocomplete, typo "snwo" still matches'); await p.click('#q'); await p.keyboard.type('snwo', { delay: 220 }); await sleep(1500); await p.fill('#q', ''); await sleep(400); } },
  { say: 'No wallet install needed. The site creates a burner keypair in my browser, and the market treasury sends me test SOL in a confirmed Solana transaction.',
    run: async (p) => { await cap(p, 'sol', 'Burner keypair in the browser, funded by a treasury transfer on Solana'); await cursorClick(p, '#fundBtn'); await p.waitForFunction(() => !document.querySelector('#walletBal').textContent.startsWith('0.000'), null, { timeout: 30000 }).catch(() => {}); } },
  { say: 'Let’s bet that the judges laugh at our domain pun. I pick YES, and point zero five SOL. The quote comes from an L M S R market maker whose state lives in Atlas.',
    run: async (p) => { await p.goto(`${BASE}/#/m/judges-laugh`); await p.waitForSelector('#buy'); await cap(p, 'mongo', 'Odds = LMSR market maker, state stored in the markets collection'); await sleep(1200); await cursorClick(p, '.presets button[data-v="0.05"]'); } },
  { say: 'Step one: my browser signs a SOL transfer to the market treasury, plus a memo receipt. Step two: the server relays it and waits for Solana to confirm, in under a second, for a fraction of a cent. Step three: the server re-reads the confirmed transaction from the chain, verifies the transfer and the memo, and settles the trade in one multi-document ACID transaction in MongoDB Atlas. The trade I D is the Solana signature, so the same transaction can never be counted twice.',
    run: async (p) => {
      await cap(p, 'sol', '① sign SOL transfer + memo  ② confirmed on Solana  ③ settled in Atlas ACID txn');
      await cursorClick(p, '#buy');
      await p.waitForSelector('[data-step="atlas"].ok', { timeout: 60000 });
      userBetSig = await p.$eval('[data-step="chain"] a', (a) => a.href.split('/tx/')[1].split('?')[0]);
      const ms = await p.$eval('[data-step="chain"] a', (a) => a.textContent.split('·')[0].trim());
      await sleep(5500);
      await cap(p, 'sol', `Confirmed on Solana in ${ms}`);
      await sleep(7000);
      await cap(p, 'mongo', 'Atlas: market + trade + position + user updated in one ACID transaction · _id = tx signature');
    } },
  { say: 'Every bet gets a receipt page that reads the transaction straight from the Solana RPC: the memo and the transfer to the treasury. Next to it is the exact MongoDB document that the transaction created.',
    run: async (p) => {
      await p.goto(`${BASE}/#/tx/${userBetSig}`); await p.waitForSelector('.hood', { timeout: 15000 }).catch(() => {});
      await cap(p, 'both', 'Left: read live from Solana · Right: the Atlas document whose _id is that signature');
    } },
  { say: 'And here’s the same transaction on the public Solana Explorer, with our memo, geni dot u s, judges laugh, YES, on-chain for anyone to verify.',
    run: async (p) => {
      const cfg = await api('/api/config');
      await p.goto(`https://explorer.solana.com/tx/${userBetSig}${cfg.explorerQuery}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForSelector('text=Success', { timeout: 20000 }).catch(() => {});
      await cap(p, 'sol', 'Solana Explorer: SOL transfer to treasury + memo "geni.us:v1:judges-laugh:YES"');
      await sleep(3000);
      const memo = p.locator('text=geni.us:v1').first();
      await memo.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => p.mouse.wheel(0, 900));
    } },
  { say: 'Now another trader bets NO from a different device. Atlas change streams push it to every open browser instantly: the live tape, the odds, and the price chart, which is stored in a MongoDB time series collection.',
    run: async (p) => {
      await p.goto(`${BASE}/#/m/judges-laugh`); await p.waitForSelector('#buy');
      await cap(p, 'mongo', 'Change stream → server-sent events → live tape, odds and chart update with no refresh');
      await sleep(800); botBet('judges-laugh', 'NO', 0.03).catch((e) => console.log('bot bet failed', e.message));
      await sleep(4000); await cap(p, 'mongo', 'Price history: price_ticks time series collection, bucketed with $dateTrunc');
    } },
  { say: 'Being rich doesn’t make you a genius. Genius I Q rewards calling it early: buying cheap, and being right. It’s computed live by an Atlas aggregation pipeline, with lookup, group, and set window fields to rank everyone.',
    run: async (p) => { await p.goto(`${BASE}/#/leaderboard`); await p.waitForSelector('table'); await cap(p, 'mongo', 'Genius IQ: $lookup → $group → $setWindowFields($rank), live on Atlas'); await sleep(6000); await p.mouse.wheel(0, 700); await sleep(2000); await p.mouse.wheel(0, 700); } },
  { say: 'When a market resolves, the oracle marks it in Atlas, aggregates the winning positions, and pays every winner in SOL on Solana in one batched transaction.',
    run: async (p) => {
      await p.goto(`${BASE}/admin.html`); await p.fill('#key', process.env.ADMIN_KEY);
      await cap(p, 'both', 'Atlas aggregates winners → treasury pays them in SOL on Solana');
      await cursorClick(p, 'button[data-id="judges-laugh"][data-o="YES"]');
      await p.waitForFunction(() => document.getElementById('out').textContent.includes('signatures'), null, { timeout: 60000 }).catch(() => {});
      await sleep(1500);
    } },
  { say: 'My YES shares just paid out. Here’s the payout transaction on Solana, and my Genius I Q.',
    run: async (p) => { await p.goto(`${BASE}/#/me`); await p.waitForSelector('.me-hero'); await cap(p, 'sol', 'Winnings paid in SOL: payout tx linked from your position'); await sleep(2500); await p.goto(`${BASE}/#/m/judges-laugh`); await sleep(1500); } },
  { say: 'Take away Solana, and nobody can bet: there’s no money, and no proof. Take away MongoDB Atlas, and there’s no market: no odds, no settlement, no history, and no leaderboard. Both are load bearing.',
    run: async (p) => { await p.goto(`${BASE}/#/under-the-hood`); await p.waitForSelector('.hood'); await cap(p, 'both', 'Both integrations are load-bearing. Remove either and the product stops existing.'); await sleep(7000); await p.mouse.wheel(0, 500); } },
  { say: 'are-you-a-geni.us. Are you? Prove it on-chain.',
    run: async (p) => { await p.setContent(card('', 'Are you? Prove it on-chain.', `${badges}<p style="font-size:24px;margin-top:40px">github.com · Devpost · are-you-a-geni.us</p>`)); } },
];

// 1) narration audio. Per scene, use a pre-recorded clip from video/voice/ if one exists
//    (s00.wav, s01.m4a, ... from `video/tts.py` or your own voice), else fall back to macOS `say`.
//    Scene timing stretches to each clip's length, so any voice stays in sync.
const VOICE_DIR = new URL('./voice/', import.meta.url).pathname;
fs.writeFileSync(`${OUT}narration.json`, JSON.stringify(scenes.map((s, i) => ({ id: `s${String(i).padStart(2, '0')}`, text: s.say })), null, 2));
if (process.argv.includes('--export-script')) { console.log(`wrote ${OUT}narration.json`); process.exit(0); }
const clips = scenes.map((s, i) => {
  const id = `s${String(i).padStart(2, '0')}`;
  const own = ['wav', 'm4a', 'mp3', 'aiff', 'flac'].map((ext) => `${VOICE_DIR}${id}.${ext}`).find((f) => fs.existsSync(f));
  const f = own || `${AUDIO}${id}.aiff`;
  if (!own) execFileSync('say', ['-v', VOICE, '-r', '182', '-o', f, s.say]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
  return { f, dur, source: own ? 'clip' : 'say' };
});
console.log(`narration: ${clips.reduce((a, c) => a + c.dur, 0).toFixed(1)}s across ${clips.length} scenes (${clips.filter((c) => c.source === 'clip').length} pre-recorded clips, ${clips.filter((c) => c.source === 'say').length} via say)`);

// 2) drive the browser while recording
// LocalNetworkAccess checks off so the public Solana Explorer can read a local validator's RPC
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const page = await ctx.newPage();
const t0 = Date.now();
// one real navigation first: before it, headless Chrome's screencast renders setContent pages at the wrong scale
await page.goto('data:text/html,<body style="background:%230d0b14"></body>').catch(() => {});
await page.setContent('<body style="background:#0d0b14"></body>');
await sleep(300);
const marks = [];
for (let i = 0; i < scenes.length; i++) {
  const start = (Date.now() - t0) / 1000;
  marks.push(start);
  console.log(`scene ${i} @ ${start.toFixed(1)}s`);
  const minEnd = Date.now() + clips[i].dur * 1000 + 600;
  try { await scenes[i].run(page); } catch (e) { console.log(`  scene ${i} error: ${e.message.split('\n')[0]}`); }
  const left = minEnd - Date.now(); if (left > 0) await sleep(left);
}
await sleep(400);
const total = (Date.now() - t0) / 1000;
const raw = await page.video().path();
await ctx.close(); await browser.close();

// 3) mux narration onto the recording
const args = ['-y', '-i', raw];
clips.forEach((c) => args.push('-i', c.f));
const delays = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(marks[i] * 1000)}|${Math.round(marks[i] * 1000)}[a${i}]`).join(';');
const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[aout]`;
args.push('-filter_complex', `${delays};${mix}`, '-map', '0:v', '-map', '[aout]', '-t', String(total),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', `${OUT}demo.mp4`);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log(`\n✅ ${OUT}demo.mp4 (${total.toFixed(0)}s)`);
