import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  BUCKET_SIZE, BucketOverflowError, FLAG, bucketHash, bucketIndexes, buildSnapshot, decodeBucket, encodeRecord,
  findRecord, tableRoot, type SnapshotSignal, type TargetRecord,
} from './snapshot.ts';
import { targetHash } from './target.ts';

const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const enc = new TextEncoder();
const th = (s: string) => targetHash('domain', s);
const key = (s: string) => hex(keccak_256(enc.encode(`entity:${s}`)));

const sig = (name: string, over: Partial<SnapshotSignal> = {}): SnapshotSignal => ({
  sourceType: 'feed', level: 'block', weight: 1, sourceIdx: 3, createdAt: 1_700_000_000, entityKey: key(name), ...over,
});

/** n deterministic fake targets with 1 to 3 signals */
function makeRecords(n: number): TargetRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    targetHash: th(`site-${i}.example`),
    flags: i % 7 === 0 ? FLAG.disputed : 0,
    signals: Array.from({ length: 1 + (i % 3) }, (_, k) => sig(`${i}-${k}`, { weight: (50 + ((i * 7 + k * 31) % 200)) / 255 })),
  }));
}

test('bucketIndexes: in range, deterministic, always two different buckets', () => {
  for (let i = 0; i < 500; i++) {
    const [a, b] = bucketIndexes(th(`x${i}.example`), 16384);
    assert.ok(a >= 0 && a < 16384 && b >= 0 && b < 16384);
    assert.notEqual(a, b);
    assert.deepEqual(bucketIndexes(th(`x${i}.example`), 16384), [a, b]);
  }
  assert.throws(() => bucketIndexes(th('x.example'), 1000), /power of two/);
});

test('record encode/decode round trip (weight is quantised to 1/255)', () => {
  const rec: TargetRecord = {
    targetHash: th('claim-arbitrum-airdrop.xyz'), flags: FLAG.proof | FLAG.disputed,
    signals: [sig('a', { weight: 0.8, sourceType: 'community', level: 'warn' }), sig('b', { sourceType: 'checker' })],
  };
  const snap = buildSnapshot('snap-test', [rec], 64);
  const [i1, i2] = bucketIndexes(rec.targetHash, 64);
  const found = findRecord(rec.targetHash, snap.buckets.slice(i1 * BUCKET_SIZE, (i1 + 1) * BUCKET_SIZE), snap.buckets.slice(i2 * BUCKET_SIZE, (i2 + 1) * BUCKET_SIZE));
  assert.ok(found);
  assert.equal(found.flags, FLAG.proof | FLAG.disputed);
  assert.equal(found.signals.length, 2);
  assert.equal(found.signals[0].sourceType, 'checker'); // strongest first
  assert.equal(found.signals[0].weight, 1);
  assert.ok(Math.abs(found.signals[1].weight - 0.8) < 1 / 255);
  assert.equal(found.signals[1].entityKey, key('a'));
  assert.equal(encodeRecord(rec).length, 10 + 2 * 41);
});

test('a miss is a miss: an unlisted target is not found', () => {
  const snap = buildSnapshot('snap-test', makeRecords(200), 1024);
  const t = th('not-listed.example');
  const [i1, i2] = bucketIndexes(t, 1024);
  const b = (i: number) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);
  assert.equal(findRecord(t, b(i1), b(i2)), undefined);
});

test('build: every one of 5000 targets is findable in its two candidate buckets', () => {
  const recs = makeRecords(5000);
  const snap = buildSnapshot('snap-test', recs, 16384);
  const b = (i: number) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);
  for (const r of recs) {
    const [i1, i2] = bucketIndexes(r.targetHash, 16384);
    const f = findRecord(r.targetHash, b(i1), b(i2));
    assert.ok(f, r.targetHash);
    assert.equal(f.signals.length, r.signals.length);
  }
  // every bucket parses and stays inside its 512 bytes
  for (let i = 0; i < 16384; i++) decodeBucket(b(i));
});

test('determinism: input order does not change a single byte or the root', () => {
  const recs = makeRecords(1500);
  const a = buildSnapshot('snap-test', recs, 4096);
  const c = buildSnapshot('snap-test', [...recs].reverse(), 4096);
  assert.deepEqual(a.buckets, c.buckets);
  assert.equal(a.root, c.root);
});

test('root: changes with a bucket byte, the snapshot id and the bucket count', () => {
  const recs = makeRecords(300);
  const a = buildSnapshot('snap-1', recs, 1024);
  assert.notEqual(buildSnapshot('snap-2', recs, 1024).root, a.root);
  assert.notEqual(buildSnapshot('snap-1', recs, 2048).root, a.root);
  const tampered = a.buckets.slice();
  tampered[5 * BUCKET_SIZE + 100] ^= 1;
  const th5 = bucketHash(5, tampered.subarray(5 * BUCKET_SIZE, 6 * BUCKET_SIZE));
  assert.notDeepEqual(th5, a.hashes.subarray(5 * 32, 6 * 32));
  assert.match(a.root, /^0x[0-9a-f]{64}$/);
});

test('bucket hash binds the index: the same bytes at another index hash differently', () => {
  const bucket = new Uint8Array(BUCKET_SIZE);
  assert.notDeepEqual(bucketHash(1, bucket), bucketHash(2, bucket));
});

test('overflow: too many records for too few buckets throws, and says to add buckets', () => {
  assert.throws(() => buildSnapshot('snap-test', makeRecords(200), 2), BucketOverflowError);
  assert.throws(() => buildSnapshot('snap-test', [...makeRecords(3), ...makeRecords(3)], 1024), /duplicate/);
});

test('PIR round trip: A gets r, B gets r with bit i flipped, XOR of answers is bucket i, and it verifies', () => {
  const N = 1024;
  const recs = makeRecords(400);
  const snap = buildSnapshot('snap-pir', recs, N);

  // tiny deterministic generator, so the test is reproducible
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;

  const target = recs[137].targetHash;
  const wanted = bucketIndexes(target, N);
  const fetched: Uint8Array[] = wanted.map((i) => {
    const r = new Uint8Array(N / 8).map(rand); // N bits packed, bit j = (byte[j>>3] >> (j&7)) & 1
    const rB = r.slice();
    rB[i >> 3] ^= 1 << (i & 7);
    const answer = (v: Uint8Array) => {
      const out = new Uint8Array(BUCKET_SIZE);
      for (let j = 0; j < N; j++)
        if ((v[j >> 3] >> (j & 7)) & 1) for (let k = 0; k < BUCKET_SIZE; k++) out[k] ^= snap.buckets[j * BUCKET_SIZE + k];
      return out;
    };
    const a = answer(r), b = answer(rB);
    return a.map((x, k) => x ^ b[k]);
  });

  // the client checks each bucket against the table, and the table against the published root
  wanted.forEach((i, n) => assert.deepEqual(bucketHash(i, fetched[n]), snap.hashes.subarray(i * 32, (i + 1) * 32)));
  assert.equal(tableRoot('snap-pir', N, snap.hashes), snap.root);
  const rec = findRecord(target, fetched[0], fetched[1]);
  assert.ok(rec);
  assert.equal(rec.signals.length, recs[137].signals.length);
});

test('pinned vector: a fixed one-record snapshot has this root (changing it breaks every indexer)', () => {
  const snap = buildSnapshot('snap-pinned', [{
    targetHash: th('example.com'), flags: FLAG.proof,
    signals: [{ sourceType: 'checker', level: 'block', weight: 1, sourceIdx: 7, createdAt: 1_700_000_000, entityKey: key('pinned') }],
  }], 16);
  assert.equal(snap.root, PINNED_ROOT);
});

// Produced by this implementation, so it guards against accidental format drift. It is not an independent check.
const PINNED_ROOT = '0x9a0bb763f05268fe7d28f98de1cc832050b86ff008c44e1e7f940bc6babc753b';
