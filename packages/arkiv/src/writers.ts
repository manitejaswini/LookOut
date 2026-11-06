import { randomBytes } from 'node:crypto';
import { normalizeTarget, targetHash, type TargetKind } from '@lookout/core';
import { CREATION_FLAGS, LIFETIMES, VERDICT_REFRESH } from './lifetimes.ts';
import { ENUMS } from './kinds.ts';
import { SCHEMAS } from './schemas.ts';

/**
 * Writers for the three entity kinds that people and sources create: report, verdict, attestation.
 * They validate every input BEFORE anything is sent, so a bad value never costs gas or reaches the chain.
 * They never take or hold a key: they are given a client that already has a wallet.
 *
 * Who is allowed to write what is NOT enforced here (anyone can write to Arkiv). Indexers enforce it by
 * checking `$creator`, see "Trusted writers" in arkiv/schema.md.
 */

/** The part of the Arkiv wallet client the writers use. A fake with the same shape is used in tests. */
export interface EntityWriter {
  createEntity(
    schema: unknown,
    values: Record<string, unknown>,
    options: { expiration: unknown; flags?: { readonly?: boolean } },
  ): Promise<{ entityKey: string; txHash: string; expiresAt: bigint | number | string }>;
  extendEntity(args: { entityKey: string; expiration: unknown }): Promise<{ expiresAt: bigint | number | string }>;
}

export interface WriteResult {
  entityKey: string;
  txHash: string;
  expiresAt: string;
}

const HEX32 = /^0x[0-9a-f]{64}$/;
const REPORT_ID = /^[0-9a-f]{32}$/;
const MAX_STR_BYTES = 128;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

function target(kind: TargetKind, value: string) {
  oneOf('targetKind', kind, ENUMS.targetKind);
  // normalizeTarget throws on junk, e.g. a malformed address or a host without a dot
  return { normalized: normalizeTarget(kind, value), hash: targetHash(kind, value) };
}

const result = (r: { entityKey: string; txHash: string; expiresAt: bigint | number | string }): WriteResult => ({
  entityKey: r.entityKey,
  txHash: r.txHash,
  expiresAt: String(r.expiresAt),
});

/** drops keys whose value is undefined, so optional columns are simply left out */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/* ---------- snapshot ---------- */

export interface SnapshotInput {
  snapshotId: string;
  bucketCount: number;
  rootHash: string;
  indexerId: string;
}

const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,64}$/;
const INDEXER_ID = /^[a-z0-9._-]{1,64}$/;

/**
 * An indexer publishes the root of the table it built, so clients can check what PIR servers serve against
 * something the servers do not control. Only a wallet in the indexer registry is trusted to do this.
 */
export async function createSnapshot(client: EntityWriter, input: SnapshotInput): Promise<WriteResult> {
  if (!SNAPSHOT_ID.test(input.snapshotId)) throw new Error('snapshotId must be 1 to 64 of A-Z a-z 0-9 . _ -');
  if (!INDEXER_ID.test(input.indexerId)) throw new Error('indexerId must be 1 to 64 of a-z 0-9 . _ -');
  if (!HEX32.test(input.rootHash)) throw new Error('rootHash must be 0x followed by 64 lowercase hex digits');
  if (!Number.isInteger(input.bucketCount) || input.bucketCount < 2 || (input.bucketCount & (input.bucketCount - 1)) !== 0 || input.bucketCount > 2 ** 24) {
    throw new Error('bucketCount must be a power of two between 2 and 16,777,216');
  }
  const out = await client.createEntity(
    SCHEMAS.snapshot,
    { snapshotId: input.snapshotId, bucketCount: input.bucketCount, rootHash: input.rootHash, indexerId: input.indexerId },
    { expiration: LIFETIMES.snapshot(), flags: CREATION_FLAGS.snapshot },
  );
  return result(out);
}

/* ---------- report ---------- */

export interface ReportInput {
  kind: TargetKind;
  value: string;
  category: (typeof ENUMS.category)[number];
  /** evidence pointer and the reporter's encrypted stealth meta-address. Encryption is the caller's job (open question) */
  payload?: Uint8Array;
  /** 32 hex digits. Generated if omitted. The escrow deposit must use the same id */
  reportId?: string;
}

export async function createReport(client: EntityWriter, input: ReportInput): Promise<WriteResult & { reportId: string; targetHash: string }> {
  const { hash } = target(input.kind, input.value);
  oneOf('category', input.category, ENUMS.category);
  const reportId = input.reportId ?? randomBytes(16).toString('hex');
  if (!REPORT_ID.test(reportId)) throw new Error('reportId must be 32 lowercase hex digits');

  const out = await client.createEntity(
    SCHEMAS.report,
    defined({ reportId, targetHash: hash, targetKind: input.kind, category: input.category, payload: input.payload }),
    { expiration: LIFETIMES.report(), flags: CREATION_FLAGS.report },
  );
  return { ...result(out), reportId, targetHash: hash };
}

/* ---------- verdict ---------- */

export interface VerdictInput {
  kind: TargetKind;
  value: string;
  /** a verdict comes from a source, never from a community report or a ruling */
  sourceType: 'feed' | 'checker' | 'verifier';
  sourceId: string;
  level: 'block' | 'warn';
  /** marks re-checkable proof. 0x + 64 hex */
  proofHash?: string;
  /** short text, at most 128 bytes */
  reason?: string;
  /** pointer to the proof (bytecode match, redirect trace) */
  payload?: Uint8Array;
}

export async function createVerdict(client: EntityWriter, input: VerdictInput): Promise<WriteResult & { targetHash: string }> {
  const { hash } = target(input.kind, input.value);
  oneOf('sourceType', input.sourceType, ['feed', 'checker', 'verifier'] as const);
  oneOf('level', input.level, ENUMS.level);
  if (!input.sourceId || utf8Length(input.sourceId) > MAX_STR_BYTES) throw new Error('sourceId must be 1 to 128 bytes');
  if (input.proofHash !== undefined && !HEX32.test(input.proofHash)) throw new Error('proofHash must be 0x + 64 lowercase hex');
  if (input.reason !== undefined && utf8Length(input.reason) > MAX_STR_BYTES) throw new Error('reason must be at most 128 bytes');

  const out = await client.createEntity(
    SCHEMAS.verdict,
    defined({
      targetHash: hash, sourceType: input.sourceType, sourceId: input.sourceId, level: input.level,
      proofHash: input.proofHash, reason: input.reason, payload: input.payload,
    }),
    { expiration: LIFETIMES.verdict(), flags: CREATION_FLAGS.verdict },
  );
  return { ...result(out), targetHash: hash };
}

/**
 * A source calls this while its finding still holds. It extends the verdict by a full verdict lifetime counted
 * from now. Verified live: extendEntity works on a readonly entity. A source that stops refreshing lets the flag expire.
 */
export async function refreshVerdict(client: EntityWriter, entityKey: string): Promise<{ expiresAt: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) throw new Error('entityKey must be 0x + 64 hex');
  const out = await client.extendEntity({ entityKey, expiration: VERDICT_REFRESH() });
  return { expiresAt: String(out.expiresAt) };
}

/* ---------- attestation ---------- */

export interface AttestationInput {
  kind: TargetKind;
  value: string;
  claim: (typeof ENUMS.claim)[number];
  /** proof of control: a deployer signature over the targetHash, or an ENS name. Verified by indexers, not here */
  payload?: Uint8Array;
}

export async function createAttestation(client: EntityWriter, input: AttestationInput): Promise<WriteResult & { targetHash: string }> {
  const { hash } = target(input.kind, input.value);
  oneOf('claim', input.claim, ENUMS.claim);
  const out = await client.createEntity(
    SCHEMAS.attestation,
    defined({ targetHash: hash, claim: input.claim, payload: input.payload }),
    { expiration: LIFETIMES.attestation(), flags: CREATION_FLAGS.attestation },
  );
  return { ...result(out), targetHash: hash };
}
