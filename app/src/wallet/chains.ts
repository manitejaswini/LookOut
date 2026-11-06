import { defineChain } from 'viem';
import { sepolia } from 'viem/chains';

/**
 * The two networks the app talks to through the person's wallet.
 *  - escrow: where the report deposit, the bounty pool and reviewer stakes live (a normal EVM chain, Sepolia for now)
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
