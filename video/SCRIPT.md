# Demo video narration

Total length 2:54. The narration is voiced by Kokoro (`af_heart`), a local neural TTS model. Each scene drives the running app while its line plays.

## Want to use your own voice? Two ways

**A. Re-record with your clips (stays in sync automatically).** Record each scene below as its own file, `video/voice/s00.m4a` … `s13.m4a` (wav/mp3/aiff also work; the QuickTime or Voice Memos default is fine). Delete the generated `.wav` files, then run `npm run demo:video`. Each scene stretches to the length of your clip, so you don't need to hit the timestamps.

**B. Talk over the finished video.** Open `video/out/demo-silent.mp4` in iMovie, CapCut or QuickTime, then record a voiceover using the timestamps below as cues.

Tips: smile while you talk (it really does sound warmer), aim for about 150 words a minute, and say the domain as "are you a geni dot U.S.".

**1. [0:00] Title card** (`s00`)

This is are-you-a-geni.us. The domain asks the question, and the app lets you answer it. It’s a prediction market where you prove you’re a genius by being right before everyone else. We registered the dot U.S. domain through GoDaddy Registry, so the name is the pitch.

**2. [0:15] Home page** (`s01`)

Two technologies do all of the work. Solana is the money and the proof: every bet is a real Solana transaction. For this recording we run a local Solana validator, and the same code runs on devnet. MongoDB Atlas is the market brain: odds, settlement, history, search, and the leaderboard.

**3. [0:34] Atlas Search typo demo** (`s02`)

Discovery runs on Atlas Search. I’ll misspell snow, and fuzzy autocomplete still finds the Christmas market.

**4. [0:42] Burner wallet faucet** (`s03`)

No wallet install needed. The site creates a burner keypair in my browser, and the market treasury sends me test SOL in a confirmed Solana transaction.

**5. [0:52] Open market + pick amount** (`s04`)

Let’s bet that the judges laugh at our domain pun. I pick YES, and point zero five SOL. The quote comes from an LMSR market maker whose state lives in Atlas.

**6. [1:03] Place the bet: 3-step tracker** (`s05`)

Step one: my browser signs a SOL transfer to the market treasury, plus a memo receipt. Step two: the server relays it and waits for Solana to confirm, in under a second, for a fraction of a cent. Step three: the server re-reads the confirmed transaction from the chain, verifies the transfer and the memo, and settles the trade in one multi-document ACID transaction in MongoDB Atlas. The trade ID is the Solana signature, so the same transaction can never be counted twice.

**7. [1:30] On-chain receipt + Atlas document** (`s06`)

Every bet gets a receipt page that reads the transaction straight from the Solana RPC: the memo and the transfer to the treasury. Next to it is the exact MongoDB document that the transaction created.

**8. [1:44] Solana Explorer** (`s07`)

And here’s the same transaction on the public Solana Explorer, with our memo, geni dot u s, judges laugh, YES, on-chain for anyone to verify.

**9. [1:54] Live update from a second trader** (`s08`)

Now another trader bets NO from a different device. Atlas change streams push it to every open browser instantly: the live tape, the odds, and the price chart, which is stored in a MongoDB time series collection.

**10. [2:07] Genius IQ leaderboard** (`s09`)

Being rich doesn’t make you a genius. Genius IQ rewards calling it early: buying cheap, and being right. It’s computed live by an Atlas aggregation pipeline, with lookup, group, and set window fields to rank everyone.

**11. [2:21] Oracle resolves + pays out** (`s10`)

When a market resolves, the oracle marks it in Atlas, aggregates the winning positions, and pays every winner in SOL on Solana in one batched transaction.

**12. [2:31] My Bets: payout** (`s11`)

My YES shares just paid out. Here’s the payout transaction on Solana, and my Genius IQ.

**13. [2:37] Under the hood** (`s12`)

Take away Solana, and nobody can bet: there’s no money, and no proof. Take away MongoDB Atlas, and there’s no market: no odds, no settlement, no history, and no leaderboard. Both are load bearing.

**14. [2:50] Outro card** (`s13`)

are-you-a-geni.us. Are you? Prove it on-chain.

