// Local dev. If MONGODB_URI in .env points at a real deployment (Atlas, or the Atlas Local docker image
// `mongodb/mongodb-atlas-local`, which supports Atlas Search), use it. Otherwise spin up an in-memory
// replica set (transactions + change streams work; search falls back to regex).
import 'dotenv/config';

const uri = process.env.MONGODB_URI || '';
if (!uri || uri.includes('USER:PASSWORD')) {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  process.env.MONGOMS_VERSION ||= '8.0.4';
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = rs.getUri();
  console.log(`[dev] in-memory replica set at ${process.env.MONGODB_URI}`);
} else {
  console.log(`[dev] using MONGODB_URI from .env (${uri.replace(/\/\/[^@]*@/, '//***@')})`);
}
await import('./seed.js');
await import('../server.js');
