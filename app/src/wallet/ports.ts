import { createWalletClient as createArkivWalletClient } from '@arkiv-network/sdk';
import { createPublicClient, createWalletClient, custom, http, parseEther, type PublicClient } from 'viem';
import { createAttestation, createReport, createVote, newReportId, revealVote, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import { CONFIG, encodeReportPayload } from '@lookout/core';
import { metaAddress, sealMetaAddress } from '@lookout/stealth';
import { loadOrCreateKeys } from './stealth-keys';
import { createEscrow } from '@lookout/escrow';
import type { DisputePorts } from '../flows/dispute-flow';
import type { PaymentRecord, SendPorts } from '../flows/pay-flow';
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

/** The panel's public encryption key. Set by `npm run panel:keys`. Without it no bounty address can be attached. */
export const PAYER_ENC_KEY = (process.env.NEXT_PUBLIC_PAYER_ENC_KEY ?? '').trim();

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
      // the payload carries the plain target (so the panel can rule on it) and, if wanted, the bounty address sealed to the panel
      const sealed = input.bounty && PAYER_ENC_KEY ? sealMetaAddress(metaAddress(loadOrCreateKeys()), PAYER_ENC_KEY, input.reportId) : undefined;
      const payload = encodeReportPayload({ kind: input.kind, value: input.value, sealed });
      const out = await createReport(arkivClient(w) as unknown as EntityWriter, { kind: input.kind, value: input.value, category: input.category, reportId: input.reportId, payload });
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

/* ---------------------------------- payments ---------------------------------- */

const PAYMENTS_KEY = 'lookout.payments.v0';

export const paymentHistory = (): PaymentRecord[] => {
  try { return JSON.parse(window.localStorage.getItem(PAYMENTS_KEY) ?? '[]') as PaymentRecord[]; } catch { return []; }
};

/**
 * Records are kept per attempt: the intent first, then the same attempt again with its transaction hash.
 * An entry with the same time and recipient is replaced, so one payment shows once.
 */
export function recordPayment(entry: PaymentRecord): void {
  const rest = paymentHistory().filter((p) => !(p.at === entry.at && p.recipient === entry.recipient));
  window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify([entry, ...rest].slice(0, 20)));
}

/** Plain ETH on the escrow chain (Sepolia). The person approves it in their wallet. */
export function payPorts(w: WalletState): SendPorts {
  return {
    now: () => Date.now(),
    switchChain: () => w.switchChain('escrow'),
    sendEth: async (to, wei) => {
      const wallet = createWalletClient({ chain: ESCROW_CHAIN, transport: custom(w.provider()), account: needAddress(w) });
      return { hash: await wallet.sendTransaction({ to, value: wei }) };
    },
    record: recordPayment,
  };
}

export async function ethBalance(address: `0x${string}`): Promise<bigint> {
  return createPublicClient({ chain: ESCROW_CHAIN, transport: http() }).getBalance({ address });
}

/* ---------------------------------- disputes ---------------------------------- */

/** The owner signs with the wallet (personal_sign), then the dispute is written to Arkiv from the same wallet. */
export function disputePorts(w: WalletState): DisputePorts {
  return {
    connected: () => w.address,
    sign: (message) => createWalletClient({ chain: ESCROW_CHAIN, transport: custom(w.provider()), account: needAddress(w) }).signMessage({ message }),
    switchChain: () => w.switchChain('arkiv'),
    post: async ({ target, signature }) => {
      const bytes = Uint8Array.from((signature.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
      const out = await createAttestation(arkivClient(w) as unknown as EntityWriter, { kind: 'address', value: target, claim: 'legit', payload: bytes });
      return { entityKey: out.entityKey };
    },
  };
}
