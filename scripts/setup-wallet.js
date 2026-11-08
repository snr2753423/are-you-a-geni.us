// Creates the market treasury (escrow) wallet on Solana devnet and stores it in .env.
import fs from 'node:fs';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

const envPath = new URL('../.env', import.meta.url);
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
let kp;
const m = env.match(/^TREASURY_SECRET_KEY=(\[.*\])$/m);
if (m) {
  kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(m[1])));
  console.log('Treasury wallet already in .env');
} else {
  kp = Keypair.generate();
  const line = `TREASURY_SECRET_KEY=[${kp.secretKey.join(',')}]`;
  env = /^TREASURY_SECRET_KEY=.*$/m.test(env) ? env.replace(/^TREASURY_SECRET_KEY=.*$/m, line) : `${env.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, env);
  console.log('Generated treasury wallet and saved it to .env');
}
const address = kp.publicKey.toBase58();
const rpc = env.match(/^SOLANA_RPC=(.+)$/m)?.[1]?.trim() || 'https://api.devnet.solana.com';
const conn = new Connection(rpc, 'confirmed');
console.log(`\nTreasury address: ${address}`);
console.log(`Balance: ${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL (devnet)`);
console.log(`Fund it at https://faucet.solana.com -> paste the address -> devnet (2-5 SOL is plenty).`);
