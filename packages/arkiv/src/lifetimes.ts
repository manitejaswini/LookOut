import { ExpirationTime } from '@arkiv-network/sdk';
import { CONFIG } from '@lookout/core';
import type { Kind } from './kinds.ts';

/**
 * How long each kind lives. Built fresh on each call (an ExpirationTime is a small value object).
 * Arkiv counts in 2-second blocks, so 24 hours is 43,200 blocks. The maximum is 7,884,000 blocks.
 */
export const LIFETIMES: Record<Kind, () => ReturnType<typeof ExpirationTime.fromHours>> = {
  report: () => ExpirationTime.fromHours(CONFIG.REPORT_EXPIRY_HOURS),
  verdict: () => ExpirationTime.fromHours(CONFIG.VERDICT_REFRESH_HOURS),
  attestation: () => ExpirationTime.fromDays(CONFIG.ATTESTATION_DAYS),
  stake: () => ExpirationTime.fromDays(CONFIG.STAKE_DAYS),
  vote: () => ExpirationTime.fromDays(CONFIG.VOTE_DAYS),
  ruling: () => ExpirationTime.fromDays(CONFIG.RULING_DAYS),
  reputation: () => ExpirationTime.fromDays(CONFIG.REPUTATION_DAYS),
  snapshot: () => ExpirationTime.fromDays(CONFIG.SNAPSHOT_DAYS),
  bounty: () => ExpirationTime.fromDays(CONFIG.BOUNTY_DAYS),
};

/** What a verdict refresh asks `extendEntity` for: another full verdict lifetime counted from now. */
export const VERDICT_REFRESH = LIFETIMES.verdict;

/**
 * Creation flags (cannot be changed after creation).
 *  - `readonly`: nobody can patch the entity. Set everywhere except `stake` (status changes) and `vote` (reveal).
 *  - `permissionlessExtension` is never set: it would let anyone pay gas to keep any report alive.
 */
export const CREATION_FLAGS: Record<Kind, { readonly?: boolean }> = {
  report: { readonly: true },
  verdict: { readonly: true },
  attestation: { readonly: true },
  stake: {},
  vote: {},
  ruling: { readonly: true },
  reputation: { readonly: true },
  snapshot: { readonly: true },
  bounty: { readonly: true },
};
