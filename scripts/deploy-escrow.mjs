// Deploys LookoutEscrow. Reads the deployer key from .env and NEVER prints it. Prints the address to put in the app config.
//   npm run escrow:deploy                 deploys to the RPC in ESCROW_RPC_URL (default: Sepolia public RPC)
// Needs in .env: ESCROW_DEPLOYER_KEY (funded), and optionally ESCROW_RESOLVER (default: the deployer), ESCROW_RPC_URL.
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { deployEscrow } from '../packages/escrow/src/index.ts';
import { CONFIG } from '../packages/core/src/config.ts';

if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { ESCROW_RESOLVER, ESCROW_RPC_URL } = process.env;
// the Arkiv signer wallet doubles as the deployer on testnet, unless a separate key is given
const ESCROW_DEPLOYER_KEY = process.env.ESCROW_DEPLOYER_KEY || process.env.ARKIV_PRIVATE_KEY;
if (!ESCROW_DEPLOYER_KEY) { console.error('Set ESCROW_DEPLOYER_KEY (or ARKIV_PRIVATE_KEY) in .env (a funded test wallet, never a real one).'); process.exit(1); }

const account = privateKeyToAccount(ESCROW_DEPLOYER_KEY);
const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const resolver = ESCROW_RESOLVER || account.address;

const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer ${account.address} has ${balance} wei on Sepolia; resolver will be ${resolver}`);
if (balance < parseEther('0.01')) { console.error('Not enough Sepolia ETH to deploy. Fund the deployer and run again.'); process.exit(1); }

// amounts come from CONFIG (one source of truth). a 30 day window after which a reporter can reclaim a deposit nobody settled
const out = await deployEscrow({
  publicClient, walletClient, resolver,
  depositWei: parseEther(String(CONFIG.DEPOSIT_ETH)), bountyWei: parseEther(String(CONFIG.BOUNTY_ETH)), resolveWindow: 30n * 86_400n,
});
console.log(`LookoutEscrow deployed at ${out.address} (tx ${out.hash}, block ${out.blockNumber})`);
console.log('Put it in .env as ESCROW_ADDRESS, and the block number as ESCROW_DEPLOY_BLOCK. The contract is not verified on Etherscan until you do that yourself.');
