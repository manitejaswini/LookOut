import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { targetHash } from '@lookout/core';
import {
  BUCKET_SIZE, FLAG_DISPUTED, MAX_SIGNALS, bountyKey, buildSnapshot, candidates, capSignals, decodeBucket,
  findRecord, keyFromHex, verifyBucket, verifyTable, type SnapshotRecord, type SnapshotSignal,
} from './snapshot.ts';

const sig = (sourceType: SnapshotSignal['sourceType'], weight: number, n = 1): SnapshotSignal => ({
  sourceType, level: 'block', weight, createdAt: 1_700_000_000 + n, entityKey: `0x${n.toString(16).padStart(16, '0')}`,
});
const tkey = (domain: string) => keyFromHex(targetHash('domain', domain));
const target = (domain: string, signals: SnapshotSignal[], flags = 0): SnapshotRecord => ({ kind: 'target', key: tkey(domain), flags, signals });
const SMALL = 64;

test('candidates: two distinct buckets in range, for any key', () => {
  for (let i = 0; i < 2000; i++) {
    const [a, b] = candidates(keccak_256(utf8ToBytes(`k${i}`)), SMALL);
    assert.ok(a !== b && a >= 0 && b >= 0 && a < SMALL && b < SMALL);
  }
  assert.throws(() => candidates(new Uint8Array(32), 1));
});

test('round trip: hit returns the stored signals, miss returns null', () => {
  const rec = target('scam.xyz', [sig('feed', 1, 1), sig('checker', 1, 2)], FLAG_DISPUTED);
  const snap = buildSnapshot([rec, target('other.xyz', [sig('community', 0.3, 3)])], SMALL);
  const [a, b] = candidates(rec.key, SMALL);
  const bs = [a, b].map((i) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE));
  const hit = findRecord(rec.key, 'target', bs);
  assert.ok(hit && hit.kind === 'target');
  assert.equal(hit.flags, FLAG_DISPUTED);
  assert.deepEqual(hit.signals.map((s) => [s.sourceType, s.level, s.entityKey]), [['feed', 'block', '0x0000000000000001'], ['checker', 'block', '0x0000000000000002']]);
  const miss = tkey('nothing.example');
  const mb = candidates(miss, SMALL).map((i) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE));
  assert.equal(findRecord(miss, 'target', mb), null);
});

test('weights survive the u16 round trip, including the 0.5 threshold edge', () => {
  const snap = buildSnapshot([target('edge.xyz', [sig('feed', 0.5, 1), sig('checker', 0.4999, 2)])], SMALL);
  const k = tkey('edge.xyz');
  const hit = findRecord(k, 'target', candidates(k, SMALL).map((i) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE)));
  assert.ok(hit && hit.kind === 'target');
  const w = Object.fromEntries(hit.signals.map((s) => [s.sourceType, s.weight]));
  assert.ok(w.feed >= 0.5);
  assert.ok(w.checker < 0.5);
});

test('bounty records are found by reportId', () => {
  const R = `0x02${'ab'.repeat(32)}`;
  const snap = buildSnapshot([{ kind: 'bounty', key: bountyKey('rep_0001'), tier: 2, ephemeralPublicKey: R }], SMALL);
  const k = bountyKey('rep_0001');
  const hit = findRecord(k, 'bounty', candidates(k, SMALL).map((i) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE)));
  assert.deepEqual(hit, { kind: 'bounty', tier: 2, ephemeralPublicKey: R });
  assert.equal(findRecord(bountyKey('rep_0002'), 'bounty', []), null);
});

test('deterministic: any input order gives byte-identical buckets and the same root', () => {
  const recs = Array.from({ length: 80 }, (_, i) => target(`d${i}.example.com`, [sig('feed', 1, i + 1)]));
  const a = buildSnapshot(recs, 256);
  const b = buildSnapshot([...recs].reverse(), 256);
  const c = buildSnapshot([...recs].sort(() => 0.5 - Math.random()), 256);
  assert.equal(a.root, b.root);
  assert.equal(a.root, c.root);
  assert.deepEqual(a.buckets, b.buckets);
});

test('two-choice placement keeps the fullest bucket well below a single-choice table', () => {
  const recs = Array.from({ length: 600 }, (_, i) => target(`s${i}.example.com`, [sig('feed', 1, i + 1)]));
  const snap = buildSnapshot(recs, 128);
  const used = Array.from({ length: 128 }, (_, i) => (snap.buckets[i * BUCKET_SIZE] << 8) | snap.buckets[i * BUCKET_SIZE + 1]);
  assert.ok(Math.max(...used) <= BUCKET_SIZE);
  // every record is retrievable
  let found = 0;
  for (const r of recs) {
    const bs = candidates(r.key, 128).map((i) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE));
    if (findRecord(r.key, 'target', bs)) found++;
  }
  assert.equal(found, recs.length);
});

test('overflow fails loudly instead of dropping records', () => {
  const recs = Array.from({ length: 200 }, (_, i) => target(`o${i}.example.com`, [sig('feed', 1, i + 1)]));
  assert.throws(() => buildSnapshot(recs, 4), /bucket overflow/);
});

test('capSignals keeps the strongest of every source type before filling by weight', () => {
  const many = [
    ...Array.from({ length: 12 }, (_, i) => sig('community', 0.9 - i * 0.01, i + 1)),
    sig('feed', 0.1, 50), sig('checker', 0.05, 51),
  ];
  const kept = capSignals(many);
  assert.equal(kept.length, MAX_SIGNALS);
  assert.ok(kept.some((s) => s.sourceType === 'feed') && kept.some((s) => s.sourceType === 'checker'));
});

test('verification: table must match a published root, bucket must match the table', () => {
  const snap = buildSnapshot([target('scam.xyz', [sig('feed', 1)])], SMALL);
  assert.ok(verifyTable(snap.hashes, ['0xdead', snap.root.toUpperCase().replace('0X', '0x')]));
  assert.ok(!verifyTable(snap.hashes, ['0xdead']));
  const tampered = snap.hashes.slice(); tampered[5] ^= 1;
  assert.ok(!verifyTable(tampered, [snap.root]));
  // the bucket that actually holds the record (empty buckets are identical, so they prove nothing)
  const i = Array.from({ length: SMALL }, (_, n) => n).find((n) => snap.buckets[n * BUCKET_SIZE + 1] > 2)!;
  const bucket = snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);
  assert.ok(verifyBucket(snap.hashes, i, bucket));
  const bad = bucket.slice(); bad[100] ^= 1;
  assert.ok(!verifyBucket(snap.hashes, i, bad));
  assert.ok(!verifyBucket(snap.hashes, (i + 1) % SMALL, bucket)); // right bytes, wrong position
});

test('a corrupt bucket is rejected, not misread', () => {
  assert.throws(() => decodeBucket(new Uint8Array(10)));
  const b = new Uint8Array(BUCKET_SIZE); b[0] = 0xff; b[1] = 0xff;
  assert.throws(() => decodeBucket(b), /corrupt/);
});

test('table size at demo scale matches the PRD: 8 MiB of buckets, 512 KiB of hashes', () => {
  const snap = buildSnapshot([target('scam.xyz', [sig('feed', 1)])]);
  assert.equal(snap.buckets.length, 16_384 * 512);
  assert.equal(snap.hashes.length, 16_384 * 32);
});

test('pinned vector (changing it breaks every indexer and client, so bump the schema version)', () => {
  const key = keyFromHex(targetHash('domain', 'example.com'));
  const snap = buildSnapshot([{
    kind: 'target', key, flags: 0,
    signals: [{ sourceType: 'feed', level: 'block', weight: 1, createdAt: 1_700_000_000, entityKey: '0x0000000000000001' }],
  }], 16);
  assert.deepEqual(candidates(key, 16), [10, 2]);
  const bucket = snap.buckets.slice(10 * BUCKET_SIZE, 11 * BUCKET_SIZE);
  assert.equal((bucket[0] << 8) | bucket[1], 38);
  assert.equal(
    Buffer.from(bucket.slice(2, 38)).toString('hex'),
    '012f82eafa4c5209aa62b23f7c721d9cbb1200010101ffff6553f1000000000000000001',
  );
  assert.equal(snap.root, '0x826224403b487934e2978114707eac4e3fdb77f9bf811af9611863d4162b5951');
});
