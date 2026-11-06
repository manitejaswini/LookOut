import type { WorldIdConfig } from './config.ts';
import type { EnrollOutcome, SeatStore } from './store.ts';
import { verifyWalletOwnership } from '@lookout/core';
import { WorldIdError, normalizeWallet, verifyProofOfHuman } from './verify.ts';

export interface EnrollResult {
  status: EnrollOutcome;
  /** normalised lowercase address */
  wallet: string;
  /** seats held right now, across all humans (a count, never nullifiers) */
  seats: number;
}

/**
 * The verified-human decision. Order matters: the wallet's own signature is checked FIRST (the person must hold the key), then
 * the World ID proof, and the store is touched only for something that passed every check, so a forged proof, a proof replayed for
 * another wallet, or a wallet the person does not control can never create or probe a record.
 *
 * What it means: this wallet is bound to ONE unique human, and that human has no other wallet. Lookout gives such a wallet a small
 * reputation floor and lets it earn bounties. It does not say who the person is.
 */
export async function enrollHuman(
  input: { payload: unknown; wallet: unknown; signature?: unknown },
  deps: { config: WorldIdConfig; store: SeatStore; fetchImpl?: typeof fetch; ownsWallet?: (wallet: string, signature: unknown, action: string) => boolean },
): Promise<EnrollResult> {
  const wallet = normalizeWallet(input.wallet);
  const owns = deps.ownsWallet ?? ((w, sig, action) => typeof sig === 'string' && verifyWalletOwnership(w, action, sig));
  if (!owns(wallet, input.signature, deps.config.action)) throw new WorldIdError('wallet_not_proven', 'sign the message with this wallet to show you control it');
  const human = await verifyProofOfHuman({ payload: input.payload, wallet, config: deps.config, fetchImpl: deps.fetchImpl });
  const status = deps.store.enroll(human.nullifier, wallet, deps.config.action);
  return { status, wallet, seats: deps.store.count(deps.config.action) };
}
