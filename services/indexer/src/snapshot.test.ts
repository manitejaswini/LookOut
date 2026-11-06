import test from 'node:test';
import assert from 'node:assert/strict';
import { BUCKET_SIZE, FLAG, bucketHash, bucketIndexes, findRecord, tableRoot, targetHash } from '@lookout/core';
import { buildTargets } from './signals.ts';
import { buildStoreSnapshot, snapshotIdFor, toTargetRecords } from './snapshot.ts';
import { ADDR, H, attestation, checkerVerdict, feedVerdict, registry, report, ruling, timing } from './fixtures.ts';

const N = 1024;
const bucket = (snap: { buckets: Uint8Array }, i: number) => snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);

const entities = () => [report(ADDR.rep82), feedVerdict(), checkerVerdict(true), attestation(ADDR.attester)];

function recordFor(snap: ReturnType<typeof buildStoreSnapshot>, hash: string) {
  const [i1, i2] = bucketIndexes(hash, N);
  return findRecord(hash, bucket(snap, i1), bucket(snap, i2));
}

test('the snapshot id comes from the Arkiv block, so two indexers reading the same block agree', () => {
  assert.equal(snapshotIdFor(timing), 'snap-100000');
});

test('a target with signals lands in the PIR table with its flags, signals, source indexes and created times', () => {
  const { targets } = buildTargets(entities(), timing, registry);
  const snap = buildStoreSnapshot(targets, timing, N);
  const rec = recordFor(snap, H);
  assert.ok(rec, 'the fake airdrop is findable in its two candidate buckets');
  assert.equal(rec.flags, FLAG.proof | FLAG.disputed);
  assert.equal(rec.signals.length, 3);
  // strongest first: the two weight-1 verdicts, then the 0.82 community report
  assert.deepEqual(rec.signals.map((s) => [s.sourceType, s.sourceIdx]), [['feed', 1], ['checker', 2], ['community', 0]]);
  assert.ok(Math.abs(rec.signals[2].weight - 0.82) < 1 / 255);
  assert.equal(rec.signals[0].createdAt, timing.currentBlockTime - 1000 * timing.blockDuration);
  assert.match(rec.signals[0].entityKey, /^0x[0-9a-f]{64}$/);
});

test('every bucket verifies against the table, and the table against the published root', () => {
  const { targets } = buildTargets(entities(), timing, registry);
  const snap = buildStoreSnapshot(targets, timing, N);
  for (let i = 0; i < N; i++) assert.deepEqual(bucketHash(i, bucket(snap, i)), snap.hashes.subarray(i * 32, (i + 1) * 32));
  assert.equal(tableRoot(snap.snapshotId, N, snap.hashes), snap.root);
  assert.equal(snap.snapshotId, 'snap-100000');
});

test('two indexers with the same data get the same root, whatever order they read it in', () => {
  const list = entities();
  const s1 = buildStoreSnapshot(buildTargets(list, timing, registry).targets, timing, N);
  const s2 = buildStoreSnapshot(buildTargets([...list].reverse(), timing, registry).targets, timing, N);
  assert.equal(s1.root, s2.root);
  assert.deepEqual(s1.buckets, s2.buckets);
});

test('a different reputation checkpoint changes the weights, and so the root (all indexers must share one)', () => {
  const list = entities();
  const s1 = buildStoreSnapshot(buildTargets(list, timing, registry).targets, timing, N);
  const raised = { ...registry, reputation: { ...registry.reputation, [ADDR.rep82]: 100 } };
  const s2 = buildStoreSnapshot(buildTargets(list, timing, raised).targets, timing, N);
  assert.notEqual(s1.root, s2.root);
});

test('targets with nothing to say are left out, but a ruling alone is kept', () => {
  const other = targetHash('domain', 'only-cleared.example');
  const { targets } = buildTargets([ruling(ADDR.panel, 'clear', other), report(ADDR.stranger, targetHash('domain', 'only-a-fresh-report.example'))], timing, registry);
  const records = toTargetRecords(targets, timing);
  assert.equal(records.length, 2, 'a fresh-wallet report still counts as a (zero weight) signal');
  const cleared = records.find((r) => r.targetHash === other)!;
  assert.equal(cleared.flags, FLAG.rulingClear);
  assert.equal(cleared.signals.length, 0);
});

test('an unlisted target is a miss', () => {
  const { targets } = buildTargets(entities(), timing, registry);
  const snap = buildStoreSnapshot(targets, timing, N);
  assert.equal(recordFor(snap, targetHash('domain', 'my-local-bakery.in')), undefined);
});

test('a block ruling sets the ruling flag', () => {
  const other = targetHash('domain', 'ruled.example');
  const { targets } = buildTargets([ruling(ADDR.panel, 'block', other)], timing, registry);
  const snap = buildStoreSnapshot(targets, timing, N);
  assert.equal(recordFor(snap, other)?.flags, FLAG.rulingBlock);
});
