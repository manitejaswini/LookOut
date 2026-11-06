import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { SourceType } from '@lookout/core';

/**
 * The private lookup table. Byte layout and rationale: arkiv/snapshot-format.md.
 * Pure functions, no I/O. The indexer builds with this, PIR servers serve the bytes,
 * and the client decodes and verifies with the same code.
 */
export const BUCKET_SIZE = 512;
export const DEFAULT_BUCKET_COUNT = 16_384;
export const KEY_PREFIX = 16; // bytes of the lookup key stored in each record
export const MAX_SIGNALS = 8;
const HEADER = 2; // u16 bytes used in the bucket

export const SOURCE_CODES: SourceType[] = ['community', 'feed', 'checker', 'verifier', 'ruling'];
export const FLAG_DISPUTED = 1;
export const FLAG_PROOF = 2;
export const FLAG_RULING_BLOCK = 4;
export const FLAG_RULING_CLEAR = 8;

export interface SnapshotSignal {
  sourceType: SourceType;
  level: 'block' | 'warn';
  weight: number; // 0..1, stored as u16
  createdAt: number; // epoch seconds
  entityKey: string; // first 8 bytes of the Arkiv entity key, 0x + 16 hex
}

export type SnapshotRecord =
  | { kind: 'target'; key: Uint8Array; flags: number; signals: SnapshotSignal[] }
  | { kind: 'bounty'; key: Uint8Array; tier: number; ephemeralPublicKey: string };

export interface DecodedTarget { kind: 'target'; flags: number; signals: SnapshotSignal[] }
export interface DecodedBounty { kind: 'bounty'; tier: number; ephemeralPublicKey: string }
export type Decoded = DecodedTarget | DecodedBounty;

const KIND_TARGET = 1;
const KIND_BOUNTY = 2;
const SIGNAL_BYTES = 16;

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const readU32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Lookup key for a bounty: found by the reporter over PIR with their own reportId. */
export const bountyKey = (reportId: string): Uint8Array => keccak_256(utf8ToBytes(`lookout-bounty-key-v0:${reportId}`));

export const keyFromHex = (hex: string): Uint8Array => {
  const k = hexToBytes(hex.replace(/^0x/, ''));
  if (k.length !== 32) throw new Error('lookup key must be 32 bytes');
  return k;
};

/** Two distinct candidate buckets for a key (two-choice hashing). */
export function candidates(key: Uint8Array, bucketCount = DEFAULT_BUCKET_COUNT): [number, number] {
  if (bucketCount < 2) throw new Error('need at least 2 buckets');
  const a = readU32(key, 0) % bucketCount;
  const b = (a + 1 + (readU32(key, 4) % (bucketCount - 1))) % bucketCount; // never equal to a
  return [a, b];
}

/** Keep the strongest signal of every source type first (scoring needs them), then fill by weight. */
export function capSignals(signals: SnapshotSignal[]): SnapshotSignal[] {
  const byWeight = [...signals].sort((x, y) => y.weight - x.weight || x.entityKey.localeCompare(y.entityKey));
  const picked: SnapshotSignal[] = [];
  const seen = new Set<SourceType>();
  for (const s of byWeight) if (!seen.has(s.sourceType)) { seen.add(s.sourceType); picked.push(s); }
  for (const s of byWeight) if (picked.length < MAX_SIGNALS && !picked.includes(s)) picked.push(s);
  return picked.slice(0, MAX_SIGNALS).sort((x, y) => y.weight - x.weight || x.entityKey.localeCompare(y.entityKey));
}

export function encodeRecord(r: SnapshotRecord): Uint8Array {
  const key = r.key.slice(0, KEY_PREFIX);
  if (r.kind === 'bounty') {
    const R = hexToBytes(r.ephemeralPublicKey.replace(/^0x/, ''));
    if (R.length !== 33) throw new Error('ephemeral public key must be 33 bytes');
    const body = concatBytes(Uint8Array.of(r.tier), R);
    return concatBytes(Uint8Array.of(KIND_BOUNTY), key, Uint8Array.of(body.length), body);
  }
  const signals = capSignals(r.signals);
  const parts = signals.map((s) => {
    const code = SOURCE_CODES.indexOf(s.sourceType);
    const w = Math.round(Math.min(1, Math.max(0, s.weight)) * 65535);
    return concatBytes(Uint8Array.of(code, s.level === 'block' ? 1 : 0, w >> 8, w & 255), u32(s.createdAt), hexToBytes(s.entityKey.replace(/^0x/, '')));
  });
  const body = concatBytes(Uint8Array.of(r.flags, signals.length), ...parts);
  return concatBytes(Uint8Array.of(KIND_TARGET), key, Uint8Array.of(body.length), body);
}

/** All records in one bucket as raw {kind, key16, decoded}. */
export function decodeBucket(bucket: Uint8Array): { kind: number; key: Uint8Array; decoded: Decoded }[] {
  if (bucket.length !== BUCKET_SIZE) throw new Error(`bucket must be ${BUCKET_SIZE} bytes`);
  const used = (bucket[0] << 8) | bucket[1];
  if (used < HEADER || used > BUCKET_SIZE) throw new Error('corrupt bucket header');
  const out: { kind: number; key: Uint8Array; decoded: Decoded }[] = [];
  let o = HEADER;
  while (o < used) {
    const kind = bucket[o];
    const key = bucket.slice(o + 1, o + 1 + KEY_PREFIX);
    const len = bucket[o + 1 + KEY_PREFIX];
    const body = bucket.slice(o + 2 + KEY_PREFIX, o + 2 + KEY_PREFIX + len);
    if (body.length !== len) throw new Error('corrupt record');
    if (kind === KIND_BOUNTY) {
      out.push({ kind, key, decoded: { kind: 'bounty', tier: body[0], ephemeralPublicKey: `0x${bytesToHex(body.slice(1))}` } });
    } else if (kind === KIND_TARGET) {
      const n = body[1];
      const signals: SnapshotSignal[] = [];
      for (let i = 0; i < n; i++) {
        const s = body.slice(2 + i * SIGNAL_BYTES, 2 + (i + 1) * SIGNAL_BYTES);
        signals.push({
          sourceType: SOURCE_CODES[s[0]],
          level: s[1] === 1 ? 'block' : 'warn',
          weight: ((s[2] << 8) | s[3]) / 65535,
          createdAt: readU32(s, 4),
          entityKey: `0x${bytesToHex(s.slice(8, 16))}`,
        });
      }
      out.push({ kind, key, decoded: { kind: 'target', flags: body[0], signals } });
    } else throw new Error(`unknown record kind ${kind}`);
    o += 2 + KEY_PREFIX + len;
  }
  return out;
}

/** Search the buckets a client fetched (both candidates, always) for a key. */
export function findRecord(key: Uint8Array, kind: 'target' | 'bounty', buckets: Uint8Array[]): Decoded | null {
  const want = key.slice(0, KEY_PREFIX);
  for (const b of buckets) {
    for (const r of decodeBucket(b)) {
      if (r.decoded.kind === kind && r.key.every((v, i) => v === want[i])) return r.decoded;
    }
  }
  return null;
}

export const bucketHash = (index: number, bucket: Uint8Array): Uint8Array =>
  keccak_256(concatBytes(utf8ToBytes('lookout-bucket-v0'), u32(index), bucket));

export const rootOf = (hashes: Uint8Array): string => {
  const count = hashes.length / 32;
  return `0x${bytesToHex(keccak_256(concatBytes(utf8ToBytes('lookout-root-v0'), u32(count), hashes)))}`;
};

export interface Snapshot {
  bucketCount: number;
  buckets: Uint8Array; // bucketCount * 512 bytes, what the PIR servers hold
  hashes: Uint8Array; // bucketCount * 32 bytes, what the client downloads
  root: string; // what the indexer publishes in the `snapshot` entity
}

/**
 * Deterministic: the same records give byte-identical output on any machine, in any input
 * order, so independent indexers publish the same root and a wiped system rebuilds to it.
 * Each record goes in the emptier of its two candidate buckets.
 */
export function buildSnapshot(records: SnapshotRecord[], bucketCount = DEFAULT_BUCKET_COUNT): Snapshot {
  const buckets = new Uint8Array(bucketCount * BUCKET_SIZE);
  const used = new Uint16Array(bucketCount).fill(HEADER);
  const ordered = records
    .map((r) => ({ r, enc: encodeRecord(r) }))
    .sort((x, y) => bytesToHex(x.enc).localeCompare(bytesToHex(y.enc)));
  for (const { r, enc } of ordered) {
    const [a, b] = candidates(r.key, bucketCount);
    const fits = [a, b].filter((i) => used[i] + enc.length <= BUCKET_SIZE);
    if (fits.length === 0) throw new Error(`bucket overflow: both candidates (${a}, ${b}) are full; raise bucketCount`);
    const pick = fits.length === 2 && used[b] < used[a] ? b : fits[0];
    buckets.set(enc, pick * BUCKET_SIZE + used[pick]);
    used[pick] += enc.length;
  }
  for (let i = 0; i < bucketCount; i++) {
    buckets[i * BUCKET_SIZE] = used[i] >> 8;
    buckets[i * BUCKET_SIZE + 1] = used[i] & 255;
  }
  const hashes = new Uint8Array(bucketCount * 32);
  for (let i = 0; i < bucketCount; i++) hashes.set(bucketHash(i, buckets.subarray(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE)), i * 32);
  return { bucketCount, buckets, hashes, root: rootOf(hashes) };
}

/** Client check 1: the downloaded hash table matches a root published on Arkiv. */
export const verifyTable = (hashes: Uint8Array, publishedRoots: string[]): boolean =>
  publishedRoots.map((r) => r.toLowerCase()).includes(rootOf(hashes));

/** Client check 2: a returned bucket matches its entry in the verified table. */
export function verifyBucket(hashes: Uint8Array, index: number, bucket: Uint8Array): boolean {
  const want = hashes.subarray(index * 32, (index + 1) * 32);
  const got = bucketHash(index, bucket);
  return want.length === 32 && got.every((v, i) => v === want[i]);
}
