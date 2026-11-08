/* global solanaWeb3 */
// are-you-a-geni.us client: hash router, burner/Phantom wallet, Solana bet signing, live tape over SSE.
const { Keypair, Transaction, TransactionInstruction, PublicKey, SystemProgram } = solanaWeb3;
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '');
const sol = (lamports, d = 3) => (lamports / 1e9).toFixed(d);
const pct = (p) => `${Math.round(p * 100)}%`;
let explorerQ = '?cluster=devnet';
const explorer = (kind, v) => `https://explorer.solana.com/${kind}/${v}${explorerQ}`;
// our own receipt page reads the tx straight from the Solana RPC (works on any cluster, incl. localnet)
const receipt = (sig) => `#/tx/${sig}`;
const ago = (d) => { const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const toB64 = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------- wallet: in-browser burner by default, Phantom optional ----------------
let cfg;
let burner;
try {
  const saved = store.get('geni.burner');
  burner = saved ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))) : Keypair.generate();
} catch { burner = Keypair.generate(); }
store.set('geni.burner', JSON.stringify(Array.from(burner.secretKey)));
let phantom = null; // window.phantom.solana once connected
const wallet = () => (phantom ? phantom.publicKey : burner.publicKey);
const walletStr = () => wallet().toBase58();
const nick = () => store.get('geni.nick') || `genius-${walletStr().slice(0, 4)}`;

function renderWallet() {
  const a = $('#walletAddr');
  a.textContent = `${phantom ? '👻 ' : '🔥 '}${short(walletStr())}`;
  a.title = phantom ? 'Phantom wallet' : 'Burner wallet (stored in this browser)';
  a.href = explorer('address', walletStr());
  $('#phantomBtn').textContent = phantom ? 'Use burner' : 'Connect Phantom';
}
let lamports = 0;
async function refreshBalance() {
  try { lamports = (await api(`/api/balance/${walletStr()}`)).lamports; $('#walletBal').textContent = `${sol(lamports, 3)} SOL`; } catch { /* rpc hiccup */ }
}
// No free SOL left in the treasury: send people to the public faucet with their address copied
function selfFund() {
  const addr = walletStr();
  try { navigator.clipboard.writeText(addr); } catch { /* clipboard blocked */ }
  toast('Free SOL faucet is empty. Your wallet address is copied: paste it at faucet.solana.com (devnet), or connect Phantom on devnet.', 8000);
  window.open('https://faucet.solana.com', '_blank', 'noopener');
}
$('#fundBtn').onclick = async () => {
  if (!cfg.faucetAvailable) { selfFund(); return; }
  const b = $('#fundBtn'); b.disabled = true; b.textContent = 'Funding…';
  try {
    const r = await api('/api/fund', { wallet: walletStr() });
    toast(r.skipped ? 'You already have test SOL. Go be a genius.' : `+${sol(r.funded || 0, 2)} SOL from the treasury, confirmed on Solana`);
  } catch (e) { if (/empty/.test(e.message)) { cfg.faucetAvailable = false; selfFund(); } else toast(`Faucet: ${e.message}`); }
  b.disabled = false; b.textContent = 'Get test SOL';
  refreshBalance();
};
$('#phantomBtn').onclick = async () => {
  if (phantom) { phantom = null; renderWallet(); refreshBalance(); return; }
  const p = window.phantom?.solana || window.solana;
  if (!p?.isPhantom) { window.open('https://phantom.app', '_blank'); toast(`Install Phantom (set it to ${cfg.cluster}), or keep using the burner wallet`); return; }
  try { await p.connect(); phantom = p; renderWallet(); refreshBalance(); toast(`Phantom connected. Make sure it is on ${cfg.cluster}.`); } catch (e) { toast(e.message); }
};

// ---------------- the bet: a Solana transaction ----------------
async function placeBet(marketId, side, amountSol, onStep) {
  const lamportsBet = Math.round(amountSol * 1e9);
  onStep('sign', 'run');
  const { blockhash, lastValidBlockHeight } = await api('/api/blockhash');
  const tx = new Transaction({ feePayer: wallet(), blockhash, lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: wallet(), toPubkey: new PublicKey(cfg.treasury), lamports: lamportsBet }));
  tx.add(new TransactionInstruction({
    programId: new PublicKey(cfg.memoProgram),
    keys: [{ pubkey: wallet(), isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(`${cfg.memoPrefix}:${marketId}:${side}`),
  }));
  let signed;
  if (phantom) signed = await phantom.signTransaction(tx);
  else { tx.sign(burner); signed = tx; }
  onStep('sign', 'ok');
  onStep('chain', 'run');
  const t0 = performance.now();
  const r = await api('/api/trade', { tx: toB64(signed.serialize()), lastValidBlockHeight, nick: nick() });
  onStep('chain', 'ok', r);
  onStep('atlas', 'ok', r);
  r.roundTripMs = Math.round(performance.now() - t0);
  return r;
}

// ---------------- router ----------------
const routes = [
  [/^#?\/?$/, renderMarkets],
  [/^#\/m\/([\w-]+)$/, (m) => renderMarket(m[1])],
  [/^#\/leaderboard$/, renderLeaderboard],
  [/^#\/me$/, renderMe],
  [/^#\/under-the-hood$/, renderHood],
  [/^#\/tx\/(\w+)$/, (m) => renderTx(m[1])],
];
let current = null;
async function route() {
  const h = location.hash || '#/';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', h === a.getAttribute('href') || (a.dataset.nav === 'markets' && h.startsWith('#/m/'))));
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { current = h; window.scrollTo(0, 0); return fn(m); }
  }
  renderMarkets();
}
window.addEventListener('hashchange', route);

// ---------------- markets list ----------------
let category = '';
function marketCard(m) {
  return `<a class="card mcard" href="#/m/${esc(m._id)}" data-mid="${esc(m._id)}">
    <div class="cat"><span>${esc(m.category)}</span>${m.status === 'resolved' ? `<span class="resolved">RESOLVED ${esc(m.outcome)}</span>` : `<span>closes ${new Date(m.closesAt).toLocaleDateString()}</span>`}</div>
    <h3>${esc(m.question)}</h3>
    <div><div class="odds"><span class="y">YES ${pct(m.pYes)}</span><span class="n">NO ${pct(1 - m.pYes)}</span></div>
    <div class="bar" style="margin-top:7px"><i style="width:${(m.pYes * 100).toFixed(1)}%"></i></div></div>
    <div class="foot"><span>◎ ${m.volumeSol.toFixed(3)} vol</span><span>${m.traders || 0} traders · ${m.tradeCount || 0} bets</span></div>
  </a>`;
}
async function renderMarkets() {
  view.innerHTML = `
  <section class="hero">
    <div>
      <h1>Are you a <em>genius</em>?<br/>Prove it on-chain.</h1>
      <p>Bet test SOL on what happens next. Every bet is a confirmed <b>Solana</b> transaction, every market lives in <b>MongoDB Atlas</b>, and the leaderboard ranks you by <b>Genius IQ</b>: being right <i>early</i>, when the crowd disagreed.</p>
    </div>
    <div class="stack">
      <div class="card"><div class="ico sol">◎</div><div><b>Solana = the money & the proof</b>Your bet is a SOL transfer + memo receipt. It only counts once the chain confirms it (~0.5s, ~$0.0002 fee).</div></div>
      <div class="card"><div class="ico mongo">🍃</div><div><b>MongoDB Atlas = the market brain</b>LMSR odds, ACID settlement, time series charts, change-stream live tape, Atlas Search, IQ aggregations.</div></div>
    </div>
  </section>
  <div class="searchbar"><input id="q" placeholder="Search markets… try “pizza”, “coffee”, or a typo like “snwo”" autocomplete="off" /></div>
  <div class="engine" id="engine"></div>
  <div class="chips" id="chips"></div>
  <div class="grid" id="grid"></div>`;
  const cats = ['', 'Hackathon', 'Crypto', 'AI', 'Gaming', 'Weather', 'Science'];
  $('#chips').innerHTML = cats.map((c) => `<button class="chip ${c === category ? 'on' : ''}" data-c="${c}">${c || 'All'}</button>`).join('');
  $('#chips').onclick = (e) => { const c = e.target.dataset.c; if (c === undefined) return; category = c; renderMarkets(); };
  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(loadGrid, 180); };
  loadGrid();
}
async function loadGrid() {
  const q = $('#q')?.value || '';
  const r = await api(`/api/markets?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
  if (!$('#grid')) return;
  const label = { 'atlas-search': '🍃 Atlas Search: fuzzy + autocomplete ($search, compound should)', regex: '🍃 MongoDB $regex (Atlas Search index not built yet)', find: '' }[r.engine];
  $('#engine').textContent = q ? `${label} · ${r.markets.length} result${r.markets.length === 1 ? '' : 's'}` : '';
  $('#grid').innerHTML = r.markets.length ? r.markets.map(marketCard).join('') : '<div class="empty">No markets match. You might be too much of a genius.</div>';
}

// ---------------- single market ----------------
let side = 'YES';
function chartSvg(history, pNow) {
  const pts = history.length ? history.slice() : [];
  pts.push({ t: new Date().toISOString(), p: pNow });
  if (pts.length === 1) pts.unshift({ t: new Date(Date.now() - 60000).toISOString(), p: pNow });
  const W = 800; const H = 220; const t0 = new Date(pts[0].t).getTime(); const t1 = new Date(pts[pts.length - 1].t).getTime() || t0 + 1;
  const x = (t) => ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 10) + 5;
  const y = (p) => H - 10 - p * (H - 20);
  let d = ''; pts.forEach((pt, i) => { d += `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)} `; if (i < pts.length - 1) d += `L${x(pts[i + 1].t).toFixed(1)},${y(pt.p).toFixed(1)} `; });
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="#2c2640" stroke-dasharray="4 6"/><text x="${W - 4}" y="${y(g) - 4}" fill="#6f6890" font-size="11" text-anchor="end">${g * 100}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}
    <path d="${d} L${x(pts[pts.length - 1].t)},${H} L${x(pts[0].t)},${H} Z" fill="url(#gy)" opacity=".25"/>
    <path d="${d}" fill="none" stroke="#2fe39a" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(pts[pts.length - 1].t)}" cy="${y(pNow)}" r="5" fill="#2fe39a"/>
    <defs><linearGradient id="gy" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fe39a"/><stop offset="1" stop-color="#2fe39a" stop-opacity="0"/></linearGradient></defs></svg>`;
}
function tradeRows(trades) {
  if (!trades.length) return '<tr><td colspan="6" class="empty">No bets yet. Be the first genius.</td></tr>';
  return trades.map((t) => `<tr><td>${esc(t.nick || short(t.wallet))}</td><td class="${t.side}">${t.side}</td><td class="mono">◎ ${sol(t.lamports)}</td>
    <td class="mono">${pct(t.priceBefore)} → ${pct(t.priceAfter)}</td><td class="mono">${t.confirmMs ? `${t.confirmMs}ms` : ''}</td>
    <td><a href="${receipt(t._id)}">${short(t._id)}</a> <a href="${explorer('tx', t._id)}" target="_blank" rel="noopener" title="Solana Explorer">↗</a></td></tr>`).join('');
}
async function renderMarket(id) {
  const { market: m, trades, history, payouts } = await api(`/api/markets/${id}`);
  view.innerHTML = `
  <div class="market">
    <div>
      <div class="cat"><span>${esc(m.category)} · closes ${new Date(m.closesAt).toLocaleString()}</span></div>
      <h1>${esc(m.question)}</h1>
      <p class="desc">${esc(m.description)}</p>
      ${m.status === 'resolved' ? `<div class="resolved-box"><b>Resolved ${esc(m.outcome)}.</b> ${m.winners || 0} winner(s) paid in SOL on Solana.
        ${(m.payoutSigs || []).map((s) => `<a class="mono" style="color:#c9a8ff" href="${receipt(s)}">payout tx ${short(s)} ↗</a>`).join(' ')}</div>` : ''}
      <div class="big"><span class="p" id="bigP">${pct(m.pYes)}</span><small>chance of YES · ◎ <span id="vol">${m.volumeSol.toFixed(3)}</span> volume · <span id="trd">${m.tradeCount || 0}</span> bets</small></div>
      <div class="card chart"><div id="chart">${chartSvg(history, m.pYes)}</div>
        <div class="lbl"><span>implied probability · MongoDB time series (price_ticks)</span><span>LMSR b = ${m.b} SOL</span></div></div>
      <h2>Recent bets <small>each row is a confirmed Solana tx, settled in an Atlas ACID transaction</small></h2>
      <div class="card tbl"><table><thead><tr><th>Trader</th><th>Side</th><th>Amount</th><th>Odds moved</th><th>Confirm</th><th>Solana tx</th></tr></thead>
      <tbody id="trades">${tradeRows(trades)}</tbody></table></div>
      ${payouts.length ? `<h2>Payouts</h2><div class="card tbl"><table><tbody>${payouts.map((p) => `<tr><td class="mono">${short(p.wallet)}</td><td class="mono">◎ ${sol(p.lamports, 4)}</td><td><a href="${receipt(p.signature)}">${short(p.signature)} ↗</a></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="card panel">
      ${m.status === 'open' ? `
      <div class="sides"><button class="YES ${side === 'YES' ? 'on' : ''}" data-s="YES">YES <span id="pY">${pct(m.pYes)}</span></button><button class="NO ${side === 'NO' ? 'on' : ''}" data-s="NO">NO <span id="pN">${pct(1 - m.pYes)}</span></button></div>
      <div class="amt"><input id="amt" type="number" min="0.001" max="0.5" step="0.005" value="0.02" /></div>
      <div class="presets">${[0.01, 0.02, 0.05, 0.1].map((v) => `<button class="ghost" data-v="${v}">◎ ${v}</button>`).join('')}</div>
      <div class="quote" id="quote"></div>
      <button class="buy" id="buy">Bet ${side}</button>
      <div class="steps">
        <div class="step" data-step="sign"><span class="n">1</span>Sign SOL transfer + memo in browser</div>
        <div class="step" data-step="chain"><span class="n">2</span>Confirmed on Solana<span class="x"></span></div>
        <div class="step mongo" data-step="atlas"><span class="n">3</span>Verified &amp; settled in MongoDB Atlas<span class="x"></span></div>
      </div>` : `<div class="empty">This market is resolved: <b>${esc(m.outcome)}</b>.</div>`}
    </div>
  </div>`;
  if (m.status !== 'open') return;
  const panel = $('.panel');
  const updQuote = async () => {
    const v = Number($('#amt').value);
    try {
      const q = await api(`/api/quote?market=${m._id}&side=${side}&sol=${v}`);
      $('#quote').innerHTML = `<div>Shares<b>${q.shares.toFixed(4)}</b></div><div>Avg price<b>${pct(q.avgPrice)}</b></div>
        <div>Odds after<b>${pct(q.priceAfter)} YES</b></div><div>Payout if ${side}<b>◎ ${q.payoutIfWin.toFixed(4)}</b></div>`;
    } catch (e) { $('#quote').innerHTML = `<div>${esc(e.message)}</div>`; }
  };
  panel.querySelector('.sides').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; side = b.dataset.s; panel.querySelectorAll('.sides button').forEach((x) => x.classList.toggle('on', x === b)); $('#buy').textContent = `Bet ${side}`; updQuote(); };
  panel.querySelector('.presets').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $('#amt').value = b.dataset.v; updQuote(); };
  $('#amt').oninput = updQuote;
  updQuote();
  const setStep = (name, state, r) => {
    const el = panel.querySelector(`[data-step="${name}"]`); el.className = `step ${name === 'atlas' ? 'mongo ' : ''}${state}`;
    if (name === 'chain' && r) el.querySelector('.x').outerHTML = `<a href="${receipt(r.signature)}" data-sig="${r.signature}">${r.confirmMs}ms · slot ${r.slot} ↗</a>`;
    if (name === 'atlas' && r) el.querySelector('.x').outerHTML = `<span class="ms">ACID txn ${r.settleMs}ms</span>`;
  };
  $('#buy').onclick = async () => {
    const b = $('#buy'); b.disabled = true; b.textContent = 'Placing bet…';
    panel.querySelectorAll('.step').forEach((s) => { s.className = `step ${s.dataset.step === 'atlas' ? 'mongo' : ''}`; });
    panel.querySelectorAll('.step a, .step .ms').forEach((x) => { x.outerHTML = '<span class="x"></span>'; });
    try {
      const r = await placeBet(m._id, side, Number($('#amt').value), setStep);
      toast(`🧠 ${side} locked in: ${r.shares.toFixed(3)} shares. Confirmed on Solana in ${r.confirmMs}ms.`);
      refreshBalance();
    } catch (e) {
      panel.querySelectorAll('.step.run').forEach((s) => s.classList.replace('run', 'err'));
      if (/insufficient|debit|0x1|no record of a prior credit/i.test(e.message)) { if (cfg.faucetAvailable) toast('Not enough devnet SOL. Hit “Get test SOL”.', 5000); else selfFund(); } else toast(e.message, 5000);
    }
    b.disabled = false; b.textContent = `Bet ${side}`;
  };
}
// live updates to the open market page (pushed by the Atlas change stream)
async function onMarketUpdate(m) {
  const card = document.querySelector(`.mcard[data-mid="${m._id}"]`);
  if (card) card.outerHTML = marketCard(m);
  if (current === `#/m/${m._id}` && $('#bigP')) {
    $('#bigP').textContent = pct(m.pYes); $('#vol').textContent = m.volumeSol.toFixed(3); $('#trd').textContent = m.tradeCount || 0;
    if ($('#pY')) { $('#pY').textContent = pct(m.pYes); $('#pN').textContent = pct(1 - m.pYes); }
    const r = await api(`/api/markets/${m._id}`);
    $('#chart').innerHTML = chartSvg(r.history, r.market.pYes);
    $('#trades').innerHTML = tradeRows(r.trades);
  }
}

// ---------------- leaderboard ----------------
async function renderLeaderboard() {
  const r = await api('/api/leaderboard');
  view.innerHTML = `
  <h1 style="font-size:40px;letter-spacing:-1.5px;margin:0 0 6px">Genius IQ leaderboard</h1>
  <p class="desc" style="color:var(--mute);max-width:720px;line-height:1.5">Volume doesn't make you a genius. <b>Being right when the crowd was wrong does.</b> Genius IQ = 100 + 150 × your average edge (1 − price paid if right, −price if wrong) across resolved markets. Computed live by a MongoDB aggregation pipeline: <span class="mono">$lookup → $group → $setWindowFields($rank)</span>.</p>
  <div class="card tbl"><table><thead><tr><th>#</th><th>Trader</th><th>Genius IQ</th><th>Title</th><th>Calls</th><th>Accuracy</th><th>P&amp;L</th></tr></thead><tbody>
  ${r.geniuses.length ? r.geniuses.map((g) => `<tr><td class="mono">${g.rank}</td><td>${esc(g.nick || short(g._id))} <a href="${explorer('address', g._id)}" target="_blank" rel="noopener">${short(g._id)}</a></td>
    <td class="iq">${g.iq}</td><td><span class="title-badge">${esc(g.title)}</span></td><td class="mono">${g.correct}/${g.calls}</td><td class="mono">${pct(g.accuracy)}</td>
    <td class="mono" style="color:${g.pnlLamports >= 0 ? 'var(--yes)' : 'var(--no)'}">${g.pnlLamports >= 0 ? '+' : ''}${sol(g.pnlLamports)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No resolved markets yet. IQs are calculated when markets resolve.</td></tr>'}
  </tbody></table></div>
  <h2>Biggest whales <small>by volume, from the users collection</small></h2>
  <div class="card tbl"><table><tbody>${r.whales.map((w, i) => `<tr><td class="mono">${i + 1}</td><td>${esc(w.nick || short(w._id))}</td><td class="mono">◎ ${sol(w.volumeLamports)}</td><td class="mono">${w.trades} bets</td></tr>`).join('') || '<tr><td class="empty">No bets yet</td></tr>'}</tbody></table></div>
  <h2>The pipeline <small>exactly what runs on Atlas</small></h2>
  <pre>${esc(JSON.stringify(r.pipeline, null, 2))}</pre>`;
}

// ---------------- my bets ----------------
async function renderMe() {
  const r = await api(`/api/me/${walletStr()}`);
  const g = r.genius;
  view.innerHTML = `
  <div class="card me-hero">
    <div><div style="color:var(--mute);font-size:13px">YOUR GENIUS IQ</div><div class="iq">${g ? g.iq : '—'}</div></div>
    <div style="flex:1"><div style="font-size:22px;font-weight:700">${g ? esc(g.title) : 'Unranked (no resolved bets yet)'}</div>
    <div style="color:var(--mute);margin-top:6px">Nickname: <input id="nick" value="${esc(nick())}" maxlength="20" style="padding:6px 10px" /> · wallet <a class="mono" href="${explorer('address', walletStr())}" target="_blank" rel="noopener">${short(walletStr())}</a></div></div>
  </div>
  <h2>Positions</h2>
  <div class="card tbl"><table><thead><tr><th>Market</th><th>YES shares</th><th>NO shares</th><th>Cost</th><th>Status</th></tr></thead><tbody>
  ${r.positions.length ? r.positions.map((p) => `<tr><td><a href="#/m/${esc(p.marketId)}" style="font-family:inherit;font-size:14px;color:var(--text)">${esc(p.market.question)}</a></td>
    <td class="mono">${(p.yesShares || 0).toFixed(3)}</td><td class="mono">${(p.noShares || 0).toFixed(3)}</td><td class="mono">◎ ${sol((p.yesCost || 0) + (p.noCost || 0))}</td>
    <td>${p.market.status === 'resolved' ? `${esc(p.market.outcome)} ${p.payoutSig ? `<a href="${receipt(p.payoutSig)}">paid ◎ ↗</a>` : ''}` : `open · ${pct(p.market.pYes)} YES`}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No bets yet. Go pick a market.</td></tr>'}
  </tbody></table></div>`;
  $('#nick').onchange = (e) => { store.set('geni.nick', e.target.value.slice(0, 20)); toast('Nickname saved for your next bet'); };
}

// ---------------- under the hood (for judges) ----------------
async function renderHood() {
  const a = await api('/api/atlas');
  view.innerHTML = `
  <h1 style="font-size:40px;letter-spacing:-1.5px;margin:0 0 6px">Under the hood</h1>
  <p style="color:var(--mute);max-width:760px;line-height:1.5">Remove Solana and nobody can bet: there's no money and no proof. Remove MongoDB Atlas and there's no market: no odds, no settlement, no history, no leaderboard. Here's what each one is doing right now.</p>
  <div class="hood">
    <div class="card"><h3><span class="ico sol">◎</span> Solana <small style="color:var(--mute);font-weight:400">${esc(cfg.cluster)}</small></h3>
      <p>Every bet = <span class="mono">SystemProgram.transfer</span> to the treasury + a <span class="mono">Memo</span> receipt (<span class="mono">${esc(cfg.memoPrefix)}:&lt;market&gt;:&lt;side&gt;</span>), signed in your browser. The server relays it, waits for <b>confirmed</b> commitment, re-reads the parsed tx from the chain and checks the transfer, signer and memo before anything is written. Winners are paid in SOL from the treasury on resolution.</p>
      <div class="kv"><span>cluster</span><span>${esc(cfg.cluster)} · ${esc(cfg.rpc)}</span><span>treasury</span><a href="${explorer('address', cfg.treasury)}" target="_blank" rel="noopener">${short(cfg.treasury)} ↗</a>
      <span>memo program</span><span>${short(cfg.memoProgram)}</span><span>bet size</span><span>◎ ${sol(cfg.minBet)} – ${sol(cfg.maxBet, 1)}</span>
      <span>last bet</span>${a.lastTrade ? `<a href="${receipt(a.lastTrade._id)}">${short(a.lastTrade._id)} · ${a.lastTrade.confirmMs}ms ↗</a>` : '<span>—</span>'}</div></div>
    <div class="card"><h3><span class="ico mongo">🍃</span> MongoDB Atlas</h3>
      <p>Market state (LMSR <span class="mono">qYes/qNo</span>) and every trade are settled in one <b>multi-document ACID transaction</b>; the trade <span class="mono">_id</span> is the Solana signature, so a tx can never be counted twice. A <b>change stream</b> drives the live tape, a <b>time series</b> collection holds odds history, <b>Atlas Search</b> powers fuzzy discovery and <b>aggregations</b> compute Genius IQ.</p>
      <div class="kv"><span>database</span><span>${esc(a.db)}</span>
      <span>transactions</span><span class="ok">● ${a.features.transactions ? 'on' : 'off'}</span>
      <span>change stream</span><span class="ok">● ${a.features.changeStreams ? 'open' : 'off'}</span>
      <span>time series</span><span class="ok">● ${a.timeseries ? `price_ticks (${esc(a.timeseries.granularity)})` : 'off'}</span>
      <span>Atlas Search</span><span class="ok">● ${a.searchIndexes.length ? a.searchIndexes.map((i) => `${esc(i.name)}: ${esc(i.status)}`).join(', ') : 'regex fallback'}</span></div></div>
    <div class="card"><h3>Collections <small style="color:var(--mute);font-weight:400">live counts</small></h3>
      <div class="kv">${Object.entries(a.counts).map(([k, v]) => `<span>${esc(k)}</span><span>${v.toLocaleString()} docs</span>`).join('')}</div></div>
    <div class="card"><h3>Last settled trade <small style="color:var(--mute);font-weight:400">document in trades</small></h3>
      <pre>${esc(JSON.stringify(a.lastTrade, null, 2) || 'none yet')}</pre></div>
  </div>`;
}

// ---------------- on-chain receipt (read live from the Solana RPC) ----------------
async function renderTx(sig) {
  view.innerHTML = '<div class="empty">Reading transaction from Solana…</div>';
  let t;
  try { t = await api(`/api/tx/${sig}`); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const memo = t.instructions.find((i) => i.type === 'memo');
  view.innerHTML = `
  <div class="cat"><span>On-chain receipt · read live from Solana ${esc(t.cluster)} (${esc(t.rpc)})</span></div>
  <h1 style="font-size:34px;letter-spacing:-1px;margin:6px 0 14px;word-break:break-all" class="mono">${short(t.signature)} <span style="color:${t.status === 'success' ? 'var(--yes)' : 'var(--no)'};font-family:'Space Grotesk'">● ${esc(t.status.toUpperCase())}</span></h1>
  ${memo ? `<div class="card" style="padding:18px;margin-bottom:16px;border-color:#4a2e7a"><div style="color:var(--mute);font-size:12px;letter-spacing:1px">MEMO RECEIPT (on-chain)</div><div class="mono" style="font-size:24px;color:#d5b8ff;margin-top:6px">${esc(memo.info.memo)}</div></div>` : ''}
  <div class="hood">
    <div class="card"><h3>Transaction</h3><div class="kv">
      <span>signature</span><span style="word-break:break-all">${esc(t.signature)}</span><span>slot</span><span>${t.slot}</span>
      <span>block time</span><span>${t.blockTime ? new Date(t.blockTime * 1000).toLocaleString() : '—'}</span><span>fee</span><span>${t.fee.toLocaleString()} lamports (◎ ${sol(t.fee, 6)})</span>
      <span>signer</span><span>${t.signers.map(short).join(', ')}</span><span>explorer</span><a href="${explorer('tx', t.signature)}" target="_blank" rel="noopener">Solana Explorer ↗</a></div></div>
    <div class="card"><h3>Instructions</h3><div class="kv">${t.instructions.map((i, n) => `<span>#${n + 1} ${esc(i.program)}</span><span>${esc(i.type || '')} ${i.info?.lamports ? `◎ ${sol(i.info.lamports, 4)} ${short(i.info.source)} → ${short(i.info.destination)}${i.info.destination === cfg.treasury ? ' (treasury)' : ''}` : i.info?.memo ? `"${esc(i.info.memo)}"` : ''}</span>`).join('')}</div></div>
    <div class="card"><h3>Program logs</h3><pre>${esc((t.logs || []).join('\n'))}</pre></div>
    <div class="card"><h3><span class="ico mongo">🍃</span> Matching Atlas document</h3><pre>${esc(t.dbRecord ? JSON.stringify(t.dbRecord, null, 2) : 'not a bet (faucet or payout tx)')}</pre></div>
  </div>`;
}

// ---------------- live tape (SSE fed by the Atlas change stream) ----------------
function tapeRow(t) {
  return `<div class="tick">🧠 <b>${esc(t.nick || short(t.wallet))}</b> bet <b class="${t.side}">${t.side}</b> ◎${sol(t.lamports)} on <a href="#/m/${esc(t.marketId)}">${esc(t.marketId)}</a>
    <div class="meta"><span>${pct(t.priceBefore)}→${pct(t.priceAfter)}</span><span>${t.confirmMs || '?'}ms</span><a href="${receipt(t._id)}">${short(t._id)} ↗</a></div></div>`;
}
async function startTape() {
  try {
    const all = await api('/api/markets');
    const recent = (await Promise.all(all.markets.slice(0, 8).map((m) => api(`/api/markets/${m._id}`)))).flatMap((r) => r.trades)
      .sort((x, y) => new Date(y.ts) - new Date(x.ts)).slice(0, 25);
    $('#tape').innerHTML = recent.map(tapeRow).join('') || '<div class="empty">Waiting for the first genius…</div>';
  } catch { /* ignore */ }
  const es = new EventSource('/api/stream');
  es.addEventListener('hello', (e) => { $('#tapeMode').textContent = JSON.parse(e.data).changeStreams ? 'Atlas change stream' : 'polling'; });
  es.addEventListener('trade', (e) => {
    const t = JSON.parse(e.data);
    if ($('#tape .empty')) $('#tape').innerHTML = '';
    $('#tape').insertAdjacentHTML('afterbegin', tapeRow(t));
    if (t.wallet === walletStr()) refreshBalance();
  });
  es.addEventListener('market', (e) => onMarketUpdate(JSON.parse(e.data)));
}

// ---------------- boot ----------------
(async () => {
  cfg = await api('/api/config');
  explorerQ = cfg.explorerQuery;
  if (cfg.demoVideo) $('#demoLink').href = cfg.demoVideo;
  $('#clusterPill').textContent = `◎ ${cfg.cluster}`;
  renderWallet();
  refreshBalance();
  setInterval(refreshBalance, 15000);
  startTape();
  route();
})();
