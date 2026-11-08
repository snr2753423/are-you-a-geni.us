// Wipes the app database so the demo can be replayed from scratch (markets are re-seeded on next start).
// Restart the server afterwards so it recreates the time series collection and Atlas Search index.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
await client.db(process.env.DB_NAME || 'geni_us').dropDatabase();
console.log(`Dropped ${process.env.DB_NAME || 'geni_us'}. Restart the server, then run \`npm run demo:prep\`.`);
await client.close();
