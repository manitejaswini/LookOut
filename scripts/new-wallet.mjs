// Creates a throwaway TEST wallet for Lookout's Arkiv writers and stores it in the gitignored .env.
//
//   npm run wallet:new
//
// - The private key is written to .env only. It is never printed.
// - Only the public address is printed, so it can be pasted into the Arkiv faucet.
// - If .env already has ARKIV_PRIVATE_KEY, nothing is overwritten.
// Use this wallet for testnet only. Never reuse a real wallet's key here.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const envPath = new URL('../.env', import.meta.url);
const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = text.match(/^ARKIV_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);

if (existing) {
  const account = privateKeyToAccount(existing[1]);
  console.log('A test wallet already exists in .env. Nothing was changed.');
  console.log('Address:', account.address);
  process.exit(0);
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
const lead = text && !text.endsWith('\n') ? '\n' : '';
appendFileSync(envPath, `${lead}ARKIV_PRIVATE_KEY=${privateKey}\nARKIV_ADDRESS=${account.address}\n`);

console.log('Created a new test wallet and saved its private key to .env (gitignored, not shown here).');
console.log('Address:', account.address);
console.log('Next: paste this address into https://hub.arkiv.network/faucet to get tGLM.');
