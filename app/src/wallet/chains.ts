import { defineChain, fallback, http } from 'viem';
import { sepolia } from 'viem/chains';

/**
 * The two networks the app talks to through the person's wallet.
 *  - escrow: where the report deposits and the bounty pool live (a normal EVM chain, Sepolia for now)
 *  - arkiv:  where reports, votes and verdicts are written (Rabdi testnet)
 */

export const ARKIV_CHAIN = defineChain({
  id: 7794095,
  name: 'Rabdi (Arkiv testnet)',
  nativeCurrency: { name: 'Golem', symbol: 'tGLM', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'] } },
  blockExplorers: { default: { name: 'Rabdi Explorer', url: 'https://rabdi.explorer.arkiv.network' } },
});

export const ESCROW_CHAIN = sepolia;

export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? '').trim() as `0x${string}` | '';
export const escrowConfigured = /^0x[0-9a-fA-F]{40}$/.test(ESCROW_ADDRESS);

export type ChainName = 'escrow' | 'arkiv';
export const chainFor = (n: ChainName) => (n === 'escrow' ? ESCROW_CHAIN : ARKIV_CHAIN);

/**
 * Where the app READS Sepolia from. viem's built-in default is a free-tier endpoint that answers 429 (rate limited) almost at once, so
 * reads go through several public endpoints in turn, with retries. NEXT_PUBLIC_SEPOLIA_RPC puts your own (for example an Alchemy or
 * Infura key) first. Writes never use these: they go through the person's own wallet.
 */
const EXTRA_RPC = (process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? '').trim();
export const sepoliaReadTransport = () =>
  fallback(
    [EXTRA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://rpc.sepolia.org']
      .filter(Boolean)
      .map((url) => http(url, { retryCount: 2, retryDelay: 800, timeout: 12_000 })),
    { rank: false, retryCount: 1 },
  );
