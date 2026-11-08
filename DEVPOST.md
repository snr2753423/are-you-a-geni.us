# Devpost submission: are-you-a-geni.us

> Paste each section into the matching Devpost field. **When submitting, tick all three MLH prizes:** Best Use of MongoDB Atlas, Best Use of Solana, and Best Domain Name from GoDaddy Registry. You're only judged for prizes you select. Put `are-you-a-geni.us` in the domain question MLH asks.

**Project name:** are-you-a-geni.us

**Tagline (elevator pitch):** Are you a genius? Prove it on-chain. A prediction market where every bet is a Solana transaction and MongoDB Atlas runs the market.

**Try it out links:** https://are-you-a-geni.us · https://github.com/snr2753423/are-you-a-geni.us

**Built with:** `mongodb-atlas` `atlas-search` `mongodb` `solana` `solana-web3.js` `godaddy-registry` `node.js` `express` `javascript` `html5` `css3` `playwright` `ffmpeg`

---

## Inspiration

Everyone at a hackathon thinks they're the smartest person in the room. We wanted a way to settle it. Talk is cheap, so we made it cost money, a tiny amount. Prediction markets are the most honest test of "being smart": you have to commit before you know the answer, and the price tells you exactly how much the crowd disagreed with you.

Then we found the domain **are-you-a-geni.us**, and the whole product fell out of the name. The URL asks the question. The app makes you answer it.

## What it does

* **Browse markets** on hackathon life ("Will the judges laugh at our domain pun?", "Will the pizza run out before 9pm?"), crypto, AI, gaming, weather and science, each with live odds.
* **Bet test SOL on YES or NO.** No wallet install needed: the site creates a burner keypair in your browser and the treasury sends you test SOL in an on-chain transaction. Phantom works too.
* **Every bet is a real Solana transaction**: a SOL transfer to the market treasury plus an on-chain memo receipt. A three-step tracker shows it being signed, confirmed on Solana (usually under a second), then verified and settled in MongoDB Atlas.
* **Odds move instantly for everyone.** An Atlas change stream pushes every trade to every open browser: a live tape, odds and a price-history chart.
* **Markets resolve and winners get paid in SOL** on-chain, in batched treasury transfers linked from your positions.
* **Genius IQ leaderboard.** Being right at 20% beats being right at 90%. Genius IQ = 100 + 150 × your average edge across resolved markets. Titles range from "Needs More Coffee" to **"Certified Geni.us"**.
* An **Under the hood** page shows judges exactly what Solana and Atlas are doing live.

## How we built it

A Node/Express server, a vanilla JS front end, **MongoDB Atlas** as the market engine and **Solana** as the money layer. It targets devnet; it also runs against a local `solana-test-validator`, which is how the demo video was recorded, since the devnet faucet requires a captcha.

### ◎ How we use Solana (essential: it's the money and the proof)

1. **Bets are on-chain transactions.** The browser builds `Tx[ SystemProgram.transfer(user → treasury), Memo("geni.us:v1:<market>:<YES|NO>") ]` and signs it with a burner keypair or Phantom.
2. **The chain is the source of truth.** The server relays the signed tx, waits for `confirmed` commitment, then **re-reads the parsed transaction from the chain** with `getParsedTransaction`. It verifies that the transfer goes to the treasury, that the source is the signer, the amount, and the memo's market and side. Only then does a bet count. A client can't fake a bet.
3. **Payouts are on-chain.** On resolution, the treasury pays every winner in SOL with batched `SystemProgram.transfer`s plus a payout memo. Each payout signature links to Solana Explorer.
4. **Onboarding is on-chain.** New visitors get test SOL from a treasury faucet transaction, so judges can bet within seconds without installing anything.
5. **Why Solana specifically:** a prediction market needs many small bets that settle immediately. On Solana a 0.01 SOL bet confirms in about half a second for a fee of roughly $0.0002, so micro-bets and fast-moving odds actually work. On a slow or expensive chain, the fee would cost more than the bet.

### 🍃 How we use MongoDB Atlas (essential: it's the market brain)

1. **Market maker state.** Each market document holds the LMSR (logarithmic market scoring rule) state `qYes`, `qNo`, `b`. The odds you see are computed from it, and every quote reads it.
2. **Multi-document ACID transactions.** Each verified bet updates `trades`, `markets`, `positions` and `users` in **one transaction** (snapshot read concern, majority write concern). Two people betting at the same instant can't corrupt the odds.
3. **Replay protection.** A trade's `_id` *is* its Solana transaction signature. Submitting the same tx twice hits the unique key and aborts the transaction, so on-chain events map exactly-once to database state.
4. **Time series collection.** `price_ticks` stores implied probability after every trade. The chart is a `$dateTrunc` bucketing aggregation over it.
5. **Change streams.** One `db.watch()` on `trades` + `markets` is fanned out over server-sent events, so the live tape, odds and charts update in every browser with no polling.
6. **Atlas Search.** A `markets_search` index (autocomplete edgeGram + fuzzy text) is created by the app on boot via `createSearchIndex`. Typing "snwo" still finds the snow market.
7. **Aggregation pipelines.** Genius IQ is `$lookup` (trade → resolved market) → `$group` per wallet → `$setWindowFields` with `$rank`. Payouts are another aggregation over winning positions.
8. **TTL indexes** rate-limit the faucet.

### 🌐 GoDaddy Registry domain

**are-you-a-geni.us** reads as *"are you a genius?"* The domain is the product's question, its brand and its punchline in one. `.us` is operated by GoDaddy Registry. We built the whole identity around it: the logo is the URL with a question mark, and the top rank on the leaderboard is "Certified Geni.us".

## Challenges we ran into

* **Trusting the client.** The first version took the client's word for what it bet. We switched to the server re-reading the confirmed transaction from Solana and verifying the transfer, signer and memo itself.
* **Exactly-once settlement.** A network retry could double-count a bet. Using the Solana signature as the MongoDB `_id` inside an ACID transaction made every on-chain bet count exactly once.
* **LMSR math.** Getting a closed-form "shares for X SOL" with a numerically stable log-sum-exp so prices never hit NaN.
* **The devnet RPC faucet is closed**, so we built a treasury-funded faucet for burner wallets and made the app cluster-agnostic (devnet, testnet or localnet). On localnet the server airdrops its own treasury, and an in-app receipt page reads any tx straight from the RPC.
* Time series collections can't be written inside a multi-document transaction, so price ticks are written right after commit.

## Accomplishments that we're proud of

* Every number on screen comes from either a confirmed Solana transaction or a MongoDB Atlas query. There's no mock data.
* A bet goes from click to signed, confirmed on Solana and settled in Atlas in about a second, with a visible three-step tracker.
* Zero-install onboarding: judges can bet within ten seconds.
* The demo video was recorded end to end by a script against the running app. Every bet in it is a real Solana transaction (on a local validator), verified on-chain and settled in MongoDB.

## What we learned

* Atlas is much more than a document store: transactions, change streams, time series, search and window functions replaced what would otherwise be four separate services.
* Solana's speed changes product design. When confirmation takes half a second you can put the chain in the hot path of every click.
* Verifying parsed transactions server-side is simple and powerful, and you don't need a custom program to make a chain your source of truth.

## What's next for are-you-a-geni.us

* Move the treasury into an **Anchor program** escrow with on-chain resolution through an oracle, such as Switchboard or Pyth for price markets.
* **Sell shares** before resolution, with a signed-message auth flow.
* **Atlas Vector Search** to suggest related markets and spot duplicate questions.
* A **"Certified Geni.us" compressed NFT** for anyone with an IQ above 140.
* Launch on mainnet for hackathon-only markets where every attendee gets a few cents of SOL.

---

## Image gallery

Upload the images in [`docs/`](docs/) in order (title, markets, bet tracker, receipt + Atlas doc, Solana Explorer, live update, Genius IQ pipeline, payout, under the hood).

## Demo video (2:49)

Recorded with `video/record.js`, which drives the real app in Chrome. The full narration is in [`video/SCRIPT.md`](video/SCRIPT.md). Beats:

| Time | Scene | Sponsor highlighted |
|---|---|---|
| 0:00 | Title: the domain is the question | GoDaddy Registry |
| 0:15 | Home: Solana = money + proof, Atlas = market brain | Both |
| 0:28 | Typo search "snwo" finds the snow market | Atlas Search |
| 0:36 | Burner wallet funded by a treasury tx | Solana |
| 0:46 | Bet YES: sign → confirmed on Solana → ACID settle in Atlas | Both |
| 1:15 | On-chain receipt (from the Solana RPC) next to its Atlas document | Both |
| 1:28 | The same bet on Solana Explorer, memo visible | Solana |
| 1:25 | Another trader bets; change stream updates tape, odds, chart | Atlas |
| 1:38 | Genius IQ leaderboard and its aggregation pipeline | Atlas |
| 1:52 | Resolve: Atlas aggregates winners, SOL payouts on-chain | Both |
| 2:02 | My Bets: payout tx + Genius IQ | Solana |
| 2:08 | "Remove either one and the product stops existing" | Both |
