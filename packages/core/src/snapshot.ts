import { keccak_256 } from '@noble/hashes/sha3.js';
import type { SourceType } from './types.ts';

/**
 * Snapshot format v0: the bucketed lookup table that PIR servers serve.
 * The byte layout is documented in arkiv/snapshot-format.md. Change both together.
 *
 *   table  = bucketCount x 512-byte buckets            (8 MiB at 16,384 buckets)
 *   hashes = bucketCount x 32-byte bucket hashes       (512 KiB at 16,384 buckets)
 *   root   = keccak256("lookout.root.v0" | snapshotId | bucketCount | hashes)
 *
 * Everything here is deterministic: two indexers with the same input produce byte-identical output.
 */

export const BUCKET_SIZE = 512;
export const DEFAULT_BUCKET_COUNT = 16384;
export const MAX_SIGNALS_PER_TARGET = 4;
export const FINGERPRINT_BYTES = 8;
export const SIGNAL_BYTES = 41;
export const RECORD_HEADER_BYTES = FINGERPRINT_BYTES + 2; // fingerprint, flags, signalCount
export const BUCKET_HEADER_BYTES = 2; // u16 record count
export const BUCKET_CAPACITY = BUCKET_SIZE - BUCKET_HEADER_BYTES;

const SOURCE_TYPE_CODE: Record<SourceType, number> = { community: 0, feed: 1, checker: 2, verifier: 3, ruling: 4 };
const SOURCE_TYPE_NAME = Object.fromEntries(Object.entries(SOURCE_TYPE_CODE).map(([k, v]) => [v, k])) as Record<number, SourceType>;

export const FLAG = { disputed: 1, proof: 2, rulingBlock: 4, rulingClear: 8 } as const;

export interface SnapshotSignal {
  sourceType: SourceType;
  level: 'block' | 'warn';
  /** 0..1. Stored as one byte, so it is quantised to 1/255. The indexer bakes reputation into it */
  weight: number;
  /** index into the source registry */
  sourceIdx: number;
  /** unix seconds when the entity was created */
  createdAt: number;
  /** the Arkiv entity key, 0x + 64 hex */
  entityKey: string;
}

export interface TargetRecord {
  /** 0x + 64 hex, see targetHash in target.ts */
  targetHash: string;
  flags: number;
  signals: SnapshotSignal[];
}

export class BucketOverflowError extends Error {
  targetHash: string;
  bucketCount: number;
  constructor(targetHash: string, bucketCount: number) {
    super(`no room for ${targetHash} in either candidate bucket (bucketCount=${bucketCount}); use more buckets`);
    this.targetHash = targetHash;
    this.bucketCount = bucketCount;
  }
}

/* ---------- small helpers ---------- */

function fromHex(hex: string, bytes: number): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length !== bytes * 2) throw new Error(`expected ${bytes} bytes of hex, got ${hex}`);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32be = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/* ---------- placement ---------- */

/**
 * Two candidate buckets per target (two-choice hashing). bucketCount must be a power of two.
 * i1 = first 4 bytes of targetHash, i2 = next 4 bytes, both masked. If they collide, i2 = i1 + 1.
 */
export function bucketIndexes(targetHash: string, bucketCount = DEFAULT_BUCKET_COUNT): [number, number] {
  if (bucketCount < 2 || (bucketCount & (bucketCount - 1)) !== 0) throw new Error('bucketCount must be a power of two >= 2');
  const h = fromHex(targetHash, 32);
  const dv = new DataView(h.buffer);
  const i1 = dv.getUint32(0) & (bucketCount - 1);
  let i2 = dv.getUint32(4) & (bucketCount - 1);
  if (i2 === i1) i2 = (i1 + 1) & (bucketCount - 1);
  return [i1, i2];
}

/** 8 bytes of the hash, taken from a different slice than the bucket indexes, used to find a record inside a bucket */
export const fingerprint = (targetHash: string): Uint8Array => fromHex(targetHash, 32).slice(8, 8 + FINGERPRINT_BYTES);

/* ---------- records ---------- */

export function recordSize(r: TargetRecord): number {
  return RECORD_HEADER_BYTES + Math.min(r.signals.length, MAX_SIGNALS_PER_TARGET) * SIGNAL_BYTES;
}

/**
 * Keeps at most MAX_SIGNALS_PER_TARGET signals, the same ones on every indexer.
 *
 * Scoring only uses the strongest signal of each source type, so those are kept FIRST (strongest type first).
 * Plain "top 4 by weight" would let a flood of full-weight reports of one type, with keys that sort low,
 * push a real checker or feed signal out of the table and downgrade a genuine block to a warning.
 * Leftover slots are filled with the next strongest signals. Ties break on entityKey ascending.
 */
export function topSignals(signals: SnapshotSignal[]): SnapshotSignal[] {
  const order = (a: SnapshotSignal, b: SnapshotSignal) =>
    b.weight - a.weight || (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0);
  const sorted = [...signals].sort(order);
  const bestOfType = new Map<SourceType, SnapshotSignal>();
  for (const s of sorted) if (!bestOfType.has(s.sourceType)) bestOfType.set(s.sourceType, s);
  const picked = [...bestOfType.values()].sort(order).slice(0, MAX_SIGNALS_PER_TARGET);
  for (const s of sorted) {
    if (picked.length >= MAX_SIGNALS_PER_TARGET) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort(order);
}

export function encodeRecord(r: TargetRecord): Uint8Array {
  const signals = topSignals(r.signals);
  const out = new Uint8Array(RECORD_HEADER_BYTES + signals.length * SIGNAL_BYTES);
  out.set(fingerprint(r.targetHash), 0);
  out[8] = r.flags;
  out[9] = signals.length;
  const dv = new DataView(out.buffer);
  signals.forEach((s, n) => {
    const o = RECORD_HEADER_BYTES + n * SIGNAL_BYTES;
    out[o] = SOURCE_TYPE_CODE[s.sourceType];
    out[o + 1] = s.level === 'block' ? 1 : 0;
    out[o + 2] = Math.round(Math.min(1, Math.max(0, s.weight)) * 255);
    dv.setUint16(o + 3, s.sourceIdx);
    dv.setUint32(o + 5, s.createdAt);
    out.set(fromHex(s.entityKey, 32), o + 9);
  });
  return out;
}

export interface DecodedRecord {
  fingerprint: Uint8Array;
  flags: number;
  signals: SnapshotSignal[];
}

/** reads every record in one 512-byte bucket */
export function decodeBucket(bucket: Uint8Array): DecodedRecord[] {
  if (bucket.length !== BUCKET_SIZE) throw new Error(`bucket must be ${BUCKET_SIZE} bytes`);
  const dv = new DataView(bucket.buffer, bucket.byteOffset, bucket.length);
  const count = dv.getUint16(0);
  const out: DecodedRecord[] = [];
  let o = BUCKET_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const fp = bucket.slice(o, o + FINGERPRINT_BYTES);
    const flags = bucket[o + 8];
    const n = bucket[o + 9];
    const signals: SnapshotSignal[] = [];
    for (let k = 0; k < n; k++) {
      const p = o + RECORD_HEADER_BYTES + k * SIGNAL_BYTES;
      signals.push({
        sourceType: SOURCE_TYPE_NAME[bucket[p]],
        level: bucket[p + 1] === 1 ? 'block' : 'warn',
        weight: bucket[p + 2] / 255,
        sourceIdx: dv.getUint16(p + 3),
        createdAt: dv.getUint32(p + 5),
        entityKey: toHex(bucket.slice(p + 9, p + 9 + 32)),
      });
    }
    out.push({ fingerprint: fp, flags, signals });
    o += RECORD_HEADER_BYTES + n * SIGNAL_BYTES;
  }
  return out;
}

/** finds a target in the two buckets a client fetched. Returns undefined for a miss */
export function findRecord(targetHash: string, bucketA: Uint8Array, bucketB: Uint8Array): DecodedRecord | undefined {
  const want = toHex(fingerprint(targetHash));
  for (const b of [bucketA, bucketB])
    for (const r of decodeBucket(b)) if (toHex(r.fingerprint) === want) return r;
  return undefined;
}

/* ---------- hashing ---------- */

/** binds the bucket to its own index so buckets cannot be swapped */
export const bucketHash = (index: number, bucket: Uint8Array): Uint8Array =>
  keccak_256(concat(utf8('lookout.bucket.v0'), u32be(index), bucket));

export const tableRoot = (snapshotId: string, bucketCount: number, hashes: Uint8Array): string =>
  toHex(keccak_256(concat(utf8('lookout.root.v0'), utf8(snapshotId), u32be(bucketCount), hashes)));

/* ---------- building ---------- */

export interface Snapshot {
  snapshotId: string;
  bucketCount: number;
  /** bucketCount x 512 bytes */
  buckets: Uint8Array;
  /** bucketCount x 32 bytes */
  hashes: Uint8Array;
  /** 0x + 64 hex, published in the snapshot entity as rootHash */
  root: string;
}

/**
 * Builds the table. Deterministic: records are placed in targetHash order, each in the candidate bucket
 * with more free space (ties go to the first candidate), so every indexer gets identical bytes.
 * Throws BucketOverflowError if a record fits neither candidate, and the fix is a larger bucketCount.
 */
export function buildSnapshot(snapshotId: string, records: TargetRecord[], bucketCount = DEFAULT_BUCKET_COUNT): Snapshot {
  const buckets = new Uint8Array(bucketCount * BUCKET_SIZE);
  const used = new Array<number>(bucketCount).fill(0); // record bytes per bucket
  const counts = new Array<number>(bucketCount).fill(0);
  const sorted = [...records].sort((a, b) => (a.targetHash < b.targetHash ? -1 : a.targetHash > b.targetHash ? 1 : 0));

  for (let n = 1; n < sorted.length; n++)
    if (sorted[n].targetHash === sorted[n - 1].targetHash) throw new Error(`duplicate target ${sorted[n].targetHash}`);

  for (const rec of sorted) {
    const [i1, i2] = bucketIndexes(rec.targetHash, bucketCount);
    const bytes = encodeRecord(rec);
    const order = used[i1] <= used[i2] ? [i1, i2] : [i2, i1];
    const home = order.find((i) => used[i] + bytes.length <= BUCKET_CAPACITY);
    if (home === undefined) throw new BucketOverflowError(rec.targetHash, bucketCount);
    buckets.set(bytes, home * BUCKET_SIZE + BUCKET_HEADER_BYTES + used[home]);
    used[home] += bytes.length;
    counts[home]++;
  }
  for (let i = 0; i < bucketCount; i++) {
    new DataView(buckets.buffer).setUint16(i * BUCKET_SIZE, counts[i]);
  }

  const hashes = new Uint8Array(bucketCount * 32);
  for (let i = 0; i < bucketCount; i++) hashes.set(bucketHash(i, buckets.subarray(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE)), i * 32);
  return { snapshotId, bucketCount, buckets, hashes, root: tableRoot(snapshotId, bucketCount, hashes) };
}
