import { addr, dec, u256 } from '@arkiv-network/sdk/schema';
import type { OutcomeKind } from './kinds.ts';
import type { TargetKind } from '@lookout/core';
import { CREATION_FLAGS, LIFETIMES } from './lifetimes.ts';
import { ENUMS } from './kinds.ts';
import { SCHEMAS } from './schemas.ts';
import { defined, HEX32, oneOf, result, type EntityWriter, type WriteResult } from './writers.ts';
import { normalizeTarget, targetHash } from '@lookout/core';

/**
 * Writers for the trust layer: stake, ruling, reputation and bounty.
 * Same rules as writers.ts: every input is checked BEFORE anything is sent, and none of these hold a key.
 *
 * Who may write each kind is NOT enforced here. Anyone can write to Arkiv. Indexers enforce it by checking `$creator`
 * (arkiv/schema.md, "Trusted writers"): `stake` only from the escrow writer, `ruling` only from the operator wallet, `reputation` only from a registered indexer, `bounty` only from the payer wallet.
 */

/** A `stake` status change is a patch, so these writers also need `patchEntity`. */
export interface TrustWriter extends EntityWriter {
  patchEntity(schema: unknown, entityKey: string, args: { set: Record<string, unknown> }): Promise<unknown>;
}

const REPORT_ID = /^[0-9a-f]{32}$/;
const CASE_ID = /^[0-9a-f]{16}$/;
const ENTITY_KEY = /^0x[0-9a-fA-F]{64}$/;
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_BYTES = 128 * 1024;
const U256_MAX = (1n << 256n) - 1n;

const need = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };

/* ---------- stake: the record of a deposit, mirroring the escrow contract ---------- */

export interface StakeInput {
  reportId: string;
  amountWei: bigint;
  /** the escrow `deposit` transaction, 0x + 64 hex */
  escrowTx: string;
}

/** Written by the escrow writer when a deposit is locked. The status always starts as `locked`. */
export async function createStake(client: EntityWriter, input: StakeInput): Promise<WriteResult> {
  need(REPORT_ID.test(input.reportId), 'reportId must be 32 lowercase hex digits');
  need(typeof input.amountWei === 'bigint' && input.amountWei > 0n && input.amountWei <= U256_MAX, 'amountWei must be a positive bigint');
  need(HEX32.test(input.escrowTx), 'escrowTx must be 0x followed by 64 lowercase hex digits');
  const out = await client.createEntity(
    SCHEMAS.stake,
    { reportId: input.reportId, status: 'locked', amountWei: u256(input.amountWei), escrowTx: input.escrowTx },
    { expiration: LIFETIMES.stake(), flags: CREATION_FLAGS.stake },
  );
  return result(out);
}

/** `locked` is the only state that can change, and only to `returned` or `slashed`. Money never moves back out of a final state. */
export async function setStakeStatus(client: TrustWriter, input: { entityKey: string; from: 'locked'; to: 'returned' | 'slashed' }): Promise<void> {
  need(ENTITY_KEY.test(input.entityKey), 'entityKey must be 0x + 64 hex');
  need(input.from === 'locked', 'only a locked stake can change status');
  oneOf('status', input.to, ['returned', 'slashed'] as const);
  await client.patchEntity(SCHEMAS.stake, input.entityKey, { set: { status: input.to } });
}

/* ---------- ruling: the outcome of a case ---------- */

export interface RulingInput {
  caseId: string;
  kind: TargetKind;
  value: string;
  outcome: OutcomeKind;
  /** the operator's reasons, so anyone can see why */
  payload?: Uint8Array;
}

export async function createRuling(client: EntityWriter, input: RulingInput): Promise<WriteResult & { targetHash: string }> {
  need(CASE_ID.test(input.caseId), 'caseId must be 16 lowercase hex digits');
  oneOf('outcome', input.outcome, ENUMS.outcome);
  normalizeTarget(input.kind, input.value); // throws on junk
  need(!input.payload || input.payload.length <= MAX_BYTES, 'payload is over the 128 KiB limit');
  const hash = targetHash(input.kind, input.value);
  const out = await client.createEntity(
    SCHEMAS.ruling,
    defined({ caseId: input.caseId, targetHash: hash, outcome: input.outcome, payload: input.payload }),
    { expiration: LIFETIMES.ruling(), flags: CREATION_FLAGS.ruling },
  );
  return { ...result(out), targetHash: hash };
}

/* ---------- reputation: one score per wallet per checkpoint ---------- */

export interface ReputationInput {
  wallet: string;
  snapshotId: string;
  score: number;
}

export async function createReputation(client: EntityWriter, input: ReputationInput): Promise<WriteResult> {
  need(WALLET.test(input.wallet), 'wallet must be a 0x address');
  need(SNAPSHOT_ID.test(input.snapshotId), 'snapshotId must be 1 to 64 of A-Z a-z 0-9 . _ -');
  need(Number.isFinite(input.score) && input.score >= 0 && input.score <= 1e9, 'score must be a number from 0 to 1,000,000,000');
  const out = await client.createEntity(
    SCHEMAS.reputation,
    { wallet: addr(input.wallet.toLowerCase()), snapshotId: input.snapshotId, score: dec(input.score.toFixed(6)) },
    { expiration: LIFETIMES.reputation(), flags: CREATION_FLAGS.reputation },
  );
  return result(out);
}

/** Publishes a whole checkpoint. Wallets with a zero score are skipped: an unknown wallet already weighs 0. */
export async function publishReputationCheckpoint(
  client: EntityWriter,
  snapshotId: string,
  scores: ReadonlyMap<string, number>,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const [wallet, score] of [...scores].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (score <= 0) { skipped++; continue; }
    await createReputation(client, { wallet, snapshotId, score });
    written++;
  }
  return { written, skipped };
}

/* ---------- bounty: the announcement of a stealth payout ---------- */

export interface BountyInput {
  reportId: string;
  /** a tier, not the exact amount: 0 to 255 */
  amountTier: number;
  /** the ephemeral public key R, compressed: 33 bytes, as bytes or as hex */
  ephemeralPublicKey: Uint8Array | string;
}

function compressedKey(k: Uint8Array | string): Uint8Array {
  let bytes: Uint8Array;
  if (typeof k === 'string') {
    need(/^(0x)?[0-9a-fA-F]{66}$/.test(k), 'ephemeralPublicKey must be 33 bytes (66 hex digits)');
    const h = k.replace(/^0x/, '');
    bytes = Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  } else bytes = k;
  need(bytes.length === 33, 'ephemeralPublicKey must be 33 bytes');
  need(bytes[0] === 0x02 || bytes[0] === 0x03, 'ephemeralPublicKey must be a compressed secp256k1 key (starts 02 or 03)');
  return bytes;
}

/** The payload is a public key, so it is safe in plaintext. There is no view tag and nothing else (arkiv/stealth-format.md). */
export async function createBounty(client: EntityWriter, input: BountyInput): Promise<WriteResult> {
  need(REPORT_ID.test(input.reportId), 'reportId must be 32 lowercase hex digits');
  need(Number.isInteger(input.amountTier) && input.amountTier >= 0 && input.amountTier <= 255, 'amountTier must be an integer from 0 to 255');
  const out = await client.createEntity(
    SCHEMAS.bounty,
    { reportId: input.reportId, amountTier: input.amountTier, payload: compressedKey(input.ephemeralPublicKey) },
    { expiration: LIFETIMES.bounty(), flags: CREATION_FLAGS.bounty },
  );
  return result(out);
}
