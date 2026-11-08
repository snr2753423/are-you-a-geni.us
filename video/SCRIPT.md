# Demo video narration

Generated from `video/record.js` (each scene drives the live app while this narration plays). Read it yourself over a screen recording if you'd rather use your own voice.

**1. Title card**

This is are-you-a-geni.us. The domain asks the question, and the app lets you answer it. It is a prediction market where you prove you are a genius by being right before everyone else. We registered the dot U S domain through GoDaddy Registry, so the name is the pitch.

**2. Home page**

Every market has live odds. Two technologies do all of the work. Solana is the money and the proof: every bet is a real Solana transaction. For this recording we run a local Solana validator, and the same code runs on devnet. MongoDB Atlas is the market brain: odds, settlement, history, search, and the leaderboard.

**3. Atlas Search typo demo**

Discovery runs on Atlas Search. I will misspell snow, and fuzzy autocomplete still finds the Christmas market.

**4. Burner wallet faucet**

No wallet install needed. The site creates a burner keypair in my browser, and the market treasury sends me test SOL in a confirmed Solana transaction. Phantom works too.

**5. Open market + pick amount**

Let us bet that the judges laugh at our domain pun. I pick YES, and point zero five SOL. The quote comes from an L M S R market maker whose state lives in Atlas.

**6. Place the bet: 3-step tracker**

Step one: my browser signs a SOL transfer to the market treasury, plus a memo receipt. Step two: the server relays it and waits for Solana to confirm, in under a second, for a fraction of a cent. Step three: the server re-reads the confirmed transaction from the chain, verifies the transfer and the memo, and settles the trade in one multi-document ACID transaction in MongoDB Atlas. The trade I D is the Solana signature, so the same transaction can never be counted twice.

**7. On-chain receipt + Atlas document**

Every bet gets a receipt page that reads the transaction straight from the Solana RPC: the memo, the transfer to the treasury, and the program logs. Next to it is the exact MongoDB document that the transaction created.

**8. Solana Explorer**

And here is the same transaction on the public Solana Explorer, with our memo, geni dot u s, judges laugh, YES, on-chain for anyone to verify.

**9. Live update from a second trader**

Now another trader bets NO from a different device. Atlas change streams push it to every open browser instantly: the live tape, the odds, and the price chart, which is stored in a MongoDB time series collection.

**10. Genius IQ leaderboard**

Being rich does not make you a genius. Genius I Q rewards calling it early: buying cheap, and being right. It is computed live by an Atlas aggregation pipeline, with lookup, group, and set window fields to rank everyone.

**11. Oracle resolves + pays out**

When a market resolves, the oracle marks it in Atlas, aggregates the winning positions, and pays every winner in SOL on Solana in one batched transaction.

**12. My Bets: payout**

My YES shares just paid out. Here is the payout transaction on Solana, and my Genius I Q.

**13. Under the hood**

Take away Solana, and nobody can bet: there is no money, and no proof. Take away MongoDB Atlas, and there is no market: no odds, no settlement, no history, and no leaderboard. Both are load bearing.

**14. Outro card**

are-you-a-geni.us. Are you? Prove it on-chain.

