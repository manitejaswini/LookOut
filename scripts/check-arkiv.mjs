// Read-only health check for the Arkiv Rabdi testnet connection.
//
//   npm run arkiv:check
//
// Uses ARKIV_ACCESS_KEY (and ARKIV_ADDRESS if present) from the gitignored .env.
// It prints the chain id, the latest block and the wallet balance. It never prints a key,
// and it sends nothing but read calls.
import './safe-errors.mjs';

import { existsSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const key = process.env.ARKIV_ACCESS_KEY;
const address = process.env.ARKIV_ADDRESS;

if (!key) {
  console.error('ARKIV_ACCESS_KEY is missing from .env');
  process.exit(1);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const chainId = parseInt(await rpc('eth_chainId'), 16);
const block = parseInt(await rpc('eth_blockNumber'), 16);
console.log('chain id        :', chainId, chainId === 7794095 ? '(Rabdi, as expected)' : '(NOT the expected 7794095)');
console.log('latest block    :', block);

if (address) {
  const wei = BigInt(await rpc('eth_getBalance', [address, 'latest']));
  console.log('test wallet     :', address);
  console.log('balance (tGLM)  :', (Number(wei) / 1e18).toString());
  if (wei === 0n) console.log('The wallet is empty. Request tGLM at https://hub.arkiv.network/faucet');
} else {
  console.log('No ARKIV_ADDRESS in .env yet. Run: npm run wallet:new');
}
