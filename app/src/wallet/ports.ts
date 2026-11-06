import { createWalletClient as createArkivWalletClient } from '@arkiv-network/sdk';
import { createPublicClient, createWalletClient, custom, http, parseEther, type PublicClient } from 'viem';
import { createReport, createVote, newReportId, revealVote, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import { CONFIG } from '@lookout/core';
import { createEscrow } from '@lookout/escrow';
import type { ReportPorts } from '../flows/report-flow';
import type { VotePorts, VoteStorage } from '../flows/vote-flow';
import { ARKIV_CHAIN, ESCROW_ADDRESS, ESCROW_CHAIN, escrowConfigured } from './chains';
import type { WalletState } from './WalletProvider';

/**
 * Connects the flows (flows/*.ts, which are tested) to the person's real wallet. Nothing here makes a decision.
 *
 * NOT YET RUN AGAINST A REAL WALLET: the flows are tested with fakes, and the Arkiv SDK with a browser (JSON-RPC) account
 * has not been exercised end to end. Treat this file as the first thing to check in the live run.
 */

const needAddress = (w: WalletState): `0x${string}` => {
  if (!w.address) throw new Error('connect your wallet first');
  return w.address;
};

const arkivClient = (w: WalletState) =>
  createArkivWalletClient({ chain: ARKIV_CHAIN as never, transport: custom(w.provider()) as never, account: needAddress(w) as never });

export function escrowFor(w: WalletState) {
  if (!escrowConfigured) throw new Error('the escrow contract is not deployed yet (NEXT_PUBLIC_ESCROW_ADDRESS is not set)');
  const publicClient = createPublicClient({ chain: ESCROW_CHAIN, transport: http() }) as PublicClient;
  const walletClient = createWalletClient({ chain: ESCROW_CHAIN, transport: custom(w.provider()), account: needAddress(w) });
  return createEscrow({ address: ESCROW_ADDRESS as `0x${string}`, publicClient, walletClient });
}

export function reportPorts(w: WalletState): ReportPorts {
  return {
    newReportId,
    switchChain: (name) => w.switchChain(name),
    deposit: async (reportId) => ({ hash: (await escrowFor(w).lockDeposit(reportId)).hash }),
    post: async (input) => {
      const out = await createReport(arkivClient(w) as unknown as EntityWriter, input);
      return { entityKey: out.entityKey, expiresAt: String(out.expiresAt) };
    },
  };
}

export function browserStorage(): VoteStorage {
  return { get: (k) => window.localStorage.getItem(k), set: (k, v) => window.localStorage.setItem(k, v) };
}

export function votePorts(w: WalletState): VotePorts {
  return {
    storage: browserStorage(),
    createVote: async (i) => ({ entityKey: (await createVote(arkivClient(w) as unknown as EntityWriter, i)).entityKey }),
    revealVote: (i) => revealVote(arkivClient(w) as unknown as TrustWriter, i),
  };
}

/** What the deposit costs, for showing before the person confirms. Matches the contract's configured deposit. */
export const DEPOSIT_ETH_LABEL = String(CONFIG.DEPOSIT_ETH);
export const DEPOSIT_WEI = parseEther(DEPOSIT_ETH_LABEL);
