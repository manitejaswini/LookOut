// Live round trip on the deployed escrow: read config, lock a deposit, confirm it, claim it back. Costs only gas.
// Uses ARKIV_PRIVATE_KEY from .env as both reporter and resolver (the testnet setup). Never prints a key.
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEscrow } from '../packages/escrow/src/index.ts';

if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { ESCROW_ADDRESS, ARKIV_PRIVATE_KEY, ESCROW_RPC_URL } = process.env;
if (!ESCROW_ADDRESS || !ARKIV_PRIVATE_KEY) { console.error('Need ESCROW_ADDRESS and ARKIV_PRIVATE_KEY in .env'); process.exit(1); }
const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const account = privateKeyToAccount(ARKIV_PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const e = createEscrow({ address: ESCROW_ADDRESS, publicClient, walletClient });

const c = await e.config();
console.log('config:', { resolver: c.resolver, deposit: formatEther(c.depositWei), bounty: formatEther(c.bountyWei), minStake: formatEther(c.minReviewerStake), unstakeDays: Number(c.unstakeDelay) / 86400, reclaimDays: Number(c.resolveWindow) / 86400 });

const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const dep = await e.lockDeposit(id);
console.log('deposit locked, tx', dep.hash, 'status', (await e.deposit(account.address, id)).status);
const ev = (await e.depositEvents(dep.blockNumber, dep.blockNumber)).find((x) => x.reportId === id);
console.log('Deposited event seen:', !!ev);
const conf = await e.confirm(account.address, id);
console.log('confirmed, tx', conf.hash, 'status', (await e.deposit(account.address, id)).status);
const cl = await e.claim();
console.log('claimed, tx', cl.hash);
const t = await e.totals();
console.log('escrow balance', formatEther(await e.balance()), 'owed', formatEther(t.locked + t.staked + t.claimable + t.pool));
