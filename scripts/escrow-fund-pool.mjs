// Adds ETH to the escrow's bounty pool from the Arkiv signer wallet (testnet). Usage: node scripts/escrow-fund-pool.mjs 0.01
import { existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEscrow } from '../packages/escrow/src/index.ts';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ESCROW_ADDRESS, ARKIV_PRIVATE_KEY, ESCROW_RPC_URL } = process.env;
const amount = process.argv[2];
if (!ESCROW_ADDRESS || !ARKIV_PRIVATE_KEY || !amount) { console.error('Need ESCROW_ADDRESS, ARKIV_PRIVATE_KEY in .env and an amount in ETH'); process.exit(1); }
const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account: privateKeyToAccount(ARKIV_PRIVATE_KEY), chain: sepolia, transport });
const e = createEscrow({ address: ESCROW_ADDRESS, publicClient, walletClient });
const tx = await e.fundPool(parseEther(amount));
console.log(`added ${amount} ETH to the pool (tx ${tx.hash}). Pool now ${formatEther(await e.bountyPool())} ETH`);
