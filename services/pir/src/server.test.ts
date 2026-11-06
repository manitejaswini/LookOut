import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combine, queryPair } from '@lookout/pir';
import { BUCKET_SIZE, rootOf, verifyBucket } from '@lookout/snapshot';
import { buildDemoSnapshot } from './demo-snapshot.ts';
import { createPirServer } from './server.ts';
import { loadSnapshots, saveSnapshot } from './store.ts';

const N = 256;
const snap = buildDemoSnapshot(N);
const stored = { snapshotId: 'snap-t', ...snap };
const servers = ['A', 'B'].map((name) => createPirServer({ name, snapshots: new Map([['snap-t', stored]]), latest: 'snap-t', log: () => {} }));
const bases: string[] = [];
await Promise.all(servers.map((s) => new Promise<void>((r) => s.listen(0, () => { bases.push(`http://localhost:${(s.address() as AddressInfo).port}`); r(); }))));
after(() => { servers.forEach((s) => s.close()); });

const post = (base: string, body: unknown) => fetch(`${base}/pir/query`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const b64 = (v: Uint8Array) => Buffer.from(v).toString('base64');

test('GET /snapshot/latest and /snapshot/:id/hashes', async () => {
  const latest = await (await fetch(`${bases[0]}/snapshot/latest`)).json();
  assert.deepEqual(latest, { snapshotId: 'snap-t', root: snap.root, bucketCount: N });
  const hashes = new Uint8Array(await (await fetch(`${bases[0]}/snapshot/snap-t/hashes`)).arrayBuffer());
  assert.equal(rootOf(hashes), snap.root);
  assert.equal((await fetch(`${bases[0]}/snapshot/nope/hashes`)).status, 404);
});

test('every bucket comes back through two servers over HTTP and verifies against the hash table', async () => {
  for (const i of [0, 1, 37, 100, 255]) {
    const { a, b } = queryPair(i, N);
    const [ra, rb] = await Promise.all([a, b].map(async (v, k) => new Uint8Array(await (await post(bases[k], { snapshotId: 'snap-t', vector: b64(v) })).arrayBuffer())));
    const bucket = combine(ra, rb);
    assert.deepEqual(bucket, snap.buckets.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE));
    assert.ok(verifyBucket(snap.hashes, i, bucket));
  }
});

test('bad requests are refused with a clear status', async () => {
  const { a } = queryPair(3, N);
  assert.equal((await post(bases[0], 'not json')).status, 400);
  assert.equal((await post(bases[0], { snapshotId: 'snap-t' })).status, 400);
  assert.equal((await post(bases[0], { snapshotId: 'other', vector: b64(a) })).status, 404);
  assert.equal((await post(bases[0], { snapshotId: 'snap-t', vector: b64(new Uint8Array(3)) })).status, 400);
  assert.equal((await post(bases[0], 'x'.repeat(70_000))).status, 413);
  assert.equal((await fetch(`${bases[0]}/nowhere`)).status, 404);
});

test('privacy: the log holds only the snapshot id and a random-looking vector, never a target or index', async () => {
  const before = servers[0].recent.length;
  const { a } = queryPair(42, N);
  await post(bases[0], { snapshotId: 'snap-t', vector: b64(a) });
  const line = servers[0].recent[before];
  assert.match(line, /^\S+ \[A\] query snapshot=snap-t vector=[0-9a-f]{24}… bits_set=\d+\/256$/);
  assert.ok(!/42|claim|airdrop|0x5fd9/.test(line.replace(/vector=[0-9a-f]+/, '').replace(/^\S+/, '').replace(/bits_set=\S+/, '')));
  const served = await (await fetch(`${bases[0]}/log`)).json();
  assert.ok(served.lines.some((l: string) => l.includes('query snapshot=snap-t')));
});

test('store: save, reload, and refuse a hash table that does not match its root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-pir-'));
  try {
    saveSnapshot(dir, 'snap-a', snap);
    const { snapshots, latest } = loadSnapshots(dir);
    assert.equal(latest, 'snap-a');
    assert.equal(snapshots.get('snap-a')!.root, snap.root);
    assert.deepEqual(snapshots.get('snap-a')!.buckets, snap.buckets);
    const bad = snap.hashes.slice(); bad[0] ^= 1;
    writeFileSync(join(dir, 'snap-a', 'hashes.bin'), bad);
    assert.throws(() => loadSnapshots(dir), /does not match its root/);
    assert.throws(() => saveSnapshot(dir, '../escape', snap), /bad snapshot id/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
