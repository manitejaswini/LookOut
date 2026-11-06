// Deploys LookoutEscrow. Reads the deployer key from .env and NEVER prints it. Prints the address to put in the app config.
//   npm run escrow:deploy                 deploys to the RPC in ESCROW_RPC_URL (default: Sepolia public RPC)
// Needs in .env: ESCROW_DEPLOYER_KEY (funded), and optionally ESCROW_RESOLVER (default: the deployer), ESCROW_RPC_URL.
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { deployEscrow } from '../packages/escrow/src/index.ts';

if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { ESCROW_DEPLOYER_KEY, ESCROW_RESOLVER, ESCROW_RPC_URL } = process.env;
if (!ESCROW_DEPLOYER_KEY) { console.error('Set ESCROW_DEPLOYER_KEY in .env (a funded test wallet, never a real one).'); process.exit(1); }

const account = privateKeyToAccount(ESCROW_DEPLOYER_KEY);
const transport = http(ESCROW_RPC_URL || undefined);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const resolver = ESCROW_RESOLVER || account.address;

const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer ${account.address} has ${balance} wei on Sepolia; resolver will be ${resolver}`);
if (balance < parseEther('0.02')) { console.error('Not enough Sepolia ETH to deploy. Fund the deployer and run again.'); process.exit(1); }

// deposit 0.01 ETH, bounty 0.005 ETH, reviewer stake 0.1 ETH, 14 day unstake delay (longer than a 7 day case), 30 day reclaim window
const out = await deployEscrow({
  publicClient, walletClient, resolver,
  depositWei: parseEther('0.01'), bountyWei: parseEther('0.005'), minReviewerStake: parseEther('0.1'),
  unstakeDelay: 14n * 86_400n, resolveWindow: 30n * 86_400n,
});
console.log(`LookoutEscrow deployed at ${out.address} (tx ${out.hash}, block ${out.blockNumber})`);
console.log('Put it in .env as ESCROW_ADDRESS. The contract is not verified on Etherscan until you do that yourself.');
