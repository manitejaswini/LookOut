import type { WorldIdConfig } from './config.ts';
import type { EnrollOutcome, SeatStore } from './store.ts';
import { normalizeWallet, verifyProofOfHuman } from './verify.ts';

export interface EnrollResult {
  status: EnrollOutcome;
  /** normalised lowercase address */
  wallet: string;
  /** seats held right now, across all humans (a count, never nullifiers) */
  seats: number;
}

/**
 * The reviewer-seat decision. Order matters: the proof is verified FIRST, and the store is touched only for a proof
 * that passed every check, so a forged or replayed-for-another-wallet proof can never create or probe a seat.
 *
 * Not checked here yet: that the wallet has staked in the escrow. The escrow does not exist yet, so a seat today means
 * "a verified unique human with a wallet", and the panel service will additionally require stake when it draws jurors.
 */
export async function enrollReviewer(
  input: { payload: unknown; wallet: unknown },
  deps: { config: WorldIdConfig; store: SeatStore; fetchImpl?: typeof fetch },
): Promise<EnrollResult> {
  const wallet = normalizeWallet(input.wallet);
  const human = await verifyProofOfHuman({ payload: input.payload, wallet, config: deps.config, fetchImpl: deps.fetchImpl });
  const status = deps.store.enroll(human.nullifier, wallet, deps.config.action);
  return { status, wallet, seats: deps.store.count(deps.config.action) };
}
