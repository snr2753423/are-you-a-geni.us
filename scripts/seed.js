// Seeds the prediction markets into MongoDB Atlas. Safe to re-run: existing markets are left alone.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const b = Number(process.env.LMSR_B || 0.2);
const day = 864e5;
const now = Date.now();
// starting odds p -> q offset so that price = p : qYes - qNo = b * ln(p / (1 - p))
const qFor = (p) => { const d = b * Math.log(p / (1 - p)); return d >= 0 ? { qYes: d, qNo: 0 } : { qYes: 0, qNo: -d }; };
const markets = [
  { _id: 'judges-laugh', question: 'Will the judges laugh at the are-you-a-geni.us domain pun?', category: 'Hackathon', p: 0.72, closes: 1,
    description: 'Resolves YES if at least one judge audibly laughs, groans or says "geni.us" out loud during our demo.' },
  { _id: 'pizza-runs-out', question: 'Will the hackathon pizza run out before 9pm?', category: 'Hackathon', p: 0.61, closes: 1,
    description: 'Resolves YES if the last slice is gone before 21:00 local time on day one.' },
  { _id: 'sol-250', question: 'Will SOL close above $250 on Dec 31, 2026?', category: 'Crypto', p: 0.38, closes: 53,
    description: 'Resolves YES if the CoinGecko SOL/USD daily close on 2026-12-31 is above $250.' },
  { _id: 'nyc-white-xmas', question: 'Will it snow in New York City on Christmas Day 2026?', category: 'Weather', p: 0.18, closes: 47,
    description: 'Resolves YES if Central Park records measurable snowfall (0.1in+) on Dec 25, 2026.' },
  { _id: 'gta6-2026', question: 'Will GTA VI release before the end of 2026?', category: 'Gaming', p: 0.83, closes: 53,
    description: 'Resolves YES if GTA VI is publicly purchasable on any platform before Jan 1, 2027.' },
  { _id: 'ai-imo-gold', question: 'Will an open-weights AI model win IMO gold in 2027?', category: 'AI', p: 0.44, closes: 240,
    description: 'Resolves YES if an openly downloadable model achieves a gold-medal score at IMO 2027.' },
  { _id: 'mars-2026', question: 'Will SpaceX launch an uncrewed Starship toward Mars in the 2026 window?', category: 'Science', p: 0.12, closes: 53,
    description: 'Resolves YES if a Starship departs Earth on a Mars transfer trajectory before Dec 31, 2026.' },
  { _id: 'coffee-cups', question: 'Will our team drink more than 12 cups of coffee this hackathon?', category: 'Hackathon', p: 0.55, closes: 1,
    description: 'Self-reported, recorded on the whiteboard. A Red Bull counts as one cup.' },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db(process.env.DB_NAME || 'geni_us').collection('markets');
let n = 0;
for (const { p, closes, ...m } of markets) {
  const r = await col.updateOne({ _id: m._id }, {
    $setOnInsert: { ...m, ...qFor(p), b, status: 'open', outcome: null, volumeLamports: 0, tradeCount: 0, traders: 0,
      createdAt: new Date(), closesAt: new Date(now + closes * day) },
  }, { upsert: true });
  n += r.upsertedCount;
}
console.log(`Seeded ${n} new markets (${markets.length} total defined).`);
await client.close();
