import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, bucketIndexes, buildSnapshot, targetHash, type SnapshotSignal, type TargetRecord } from '@lookout/core';
import { createPirClient, VerificationError } from './pir.ts';
import { fakePirWorld } from './testing.ts';

const N = 256;
const NOW_MS = 1_700_001_000_000;
const sig = (sourceType: SnapshotSignal['sourceType'], weight: number, n: number): SnapshotSignal => ({
  sourceType, level: 'block', weight, sourceIdx: n, createdAt: NOW_MS / 1000 - 60, entityKey: `0x${n.toString(16).padStart(64, '0')}`,
});
const rec = (kind: 'domain' | 'address', v: string, flags: number, signals: SnapshotSignal[]): TargetRecord =>
  ({ targetHash: targetHash(kind, v), flags, signals });
const SNAP = buildSnapshot('snap-t', [
  rec('domain', 'scam.xyz', 0, [sig('feed', 1, 1), sig('checker', 1, 2)]),
  rec('domain', 'orbit.app', FLAG.disputed, [sig('community', 0, 3)]),
  rec('address', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', FLAG.rulingBlock, []),
], N);

const PAIR1 = { a: 'http://a1.test', b: 'http://b1.test' };
const PAIR2 = { a: 'http://a2.test', b: 'http://b2.test' };
type World = ReturnType<typeof fakePirWorld>;
const client = (w: World, extra: Partial<Parameters<typeof createPirClient>[0]> = {}) =>
  createPirClient({ pairs: [PAIR1], fetch: w.fetch, now: () => NOW_MS, ...extra });
const queries = (w: World, base: string) => (w.seen.get(base) ?? []).filter((r) => r.path === '/pir/query');
const vec = (q: { body: string }) => Buffer.from(JSON.parse(q.body).vector, 'base64');

test('a listed scam blocks, an unlisted target is unknown, a disputed one warns', async () => {
  const c = client(fakePirWorld(SNAP));
  assert.equal((await c.checkTarget('scam.xyz')).verdict, 'block');
  assert.equal((await c.checkTarget('nothing.example')).verdict, 'unknown');
  const orbit = await c.checkTarget('https://Orbit.app/bridge');
  assert.equal(orbit.verdict, 'warn');
  assert.equal(orbit.disputed, true);
  assert.equal((await c.checkTarget('0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08')).verdict, 'block');
});

test('result carries the snapshot id and signal ages computed on the client', async () => {
  const r = await client(fakePirWorld(SNAP)).checkTarget('scam.xyz');
  assert.equal(r.snapshotId, 'snap-t');
  assert.equal(r.reasons[0].ageSeconds, 60);
  assert.match(r.reasons[0].entityId, /^0x[0-9a-f]{64}$/);
});

test('PRIVACY: neither server ever sees the target, its hash, or the buckets it wanted', async () => {
  const w = fakePirWorld(SNAP);
  await client(w).checkTarget('scam.xyz');
  const hash = targetHash('domain', 'scam.xyz');
  for (const base of [PAIR1.a, PAIR1.b]) {
    const everything = JSON.stringify(w.seen.get(base));
    assert.ok(!everything.includes('scam'), `${base} saw the domain`);
    assert.ok(!everything.includes(hash.slice(2, 18)), `${base} saw the hash`);
  }
  // Each query alone is a random vector: across many runs a server sees the wanted bits set about half the time.
  const wanted = bucketIndexes(hash, N);
  let ones = 0;
  const runs = 300;
  for (let i = 0; i < runs; i++) {
    const w2 = fakePirWorld(SNAP);
    await client(w2).checkTarget('scam.xyz');
    for (const q of queries(w2, PAIR1.a)) for (const idx of wanted) ones += (vec(q)[idx >> 3] >> (idx & 7)) & 1;
  }
  const trials = runs * 2 * 2; // runs x two queries x two candidate bits looked at per query
  assert.ok(Math.abs(ones - trials / 2) < 6 * Math.sqrt(trials / 4), `wanted bits set ${ones}/${trials} on server A`);
});

test('PRIVACY: a hit and a miss are identical on the wire (same requests, both buckets always)', async () => {
  const shape = async (target: string) => {
    const w = fakePirWorld(SNAP);
    await client(w).checkTarget(target);
    return [PAIR1.a, PAIR1.b].map((b) => (w.seen.get(b) ?? []).map((r) => `${r.method} ${r.path} ${r.body.length}`));
  };
  const hit = await shape('scam.xyz');
  const miss = await shape('nothing.example');
  assert.deepEqual(hit, miss);
  assert.equal(hit[0].filter((l) => l.includes('/pir/query')).length, 2);
});

test('PRIVACY: the same lookup twice sends different vectors', async () => {
  const w = fakePirWorld(SNAP);
  const c = client(w);
  await c.checkTarget('scam.xyz');
  await c.checkTarget('scam.xyz');
  const vs = queries(w, PAIR1.a).map((q) => q.body);
  assert.equal(new Set(vs).size, vs.length);
});

test('the A and B vectors of one query differ in exactly one bit', async () => {
  const w = fakePirWorld(SNAP);
  await client(w).checkTarget('scam.xyz');
  const qa = queries(w, PAIR1.a), qb = queries(w, PAIR1.b);
  assert.equal(qa.length, 2);
  qa.forEach((q, i) => {
    const x = vec(q), y = vec(qb[i]);
    assert.equal(x.reduce((n, v, k) => n + (v ^ y[k]).toString(2).replace(/0/g, '').length, 0), 1);
  });
});

test('TAMPER: a tampered answer is rejected and the client retries on the next operator pair', async () => {
  const w = fakePirWorld(SNAP, { tamper: new Set([PAIR1.b]) });
  const r = await client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz');
  assert.equal(r.verdict, 'block'); // correct answer from pair 2
  assert.ok(queries(w, PAIR2.a).length > 0, 'fell back to the second pair');
});

test('TAMPER: if every pair is bad, the lookup fails loudly and never returns a verdict', async () => {
  const w = fakePirWorld(SNAP, { tamper: new Set([PAIR1.b, PAIR2.b]) });
  await assert.rejects(client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz'), VerificationError);
});

test('servers that disagree about the latest snapshot are refused', async () => {
  const w = fakePirWorld(SNAP, { wrongRoot: new Set([PAIR1.b]) });
  await assert.rejects(client(w).checkTarget('scam.xyz'), /disagree/);
});

test('a dead server pair falls through to the next one', async () => {
  const w = fakePirWorld(SNAP, { bad: new Set([PAIR1.a]) });
  assert.equal((await client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz')).verdict, 'block');
});

test('VERIFIED: true only when the root is published on Arkiv', async () => {
  const good = await client(fakePirWorld(SNAP), { publishedRoots: async () => ['0xdead', SNAP.root.toUpperCase().replace('0X', '0x')] }).checkTarget('scam.xyz');
  assert.equal(good.verified, true);
  assert.equal((await client(fakePirWorld(SNAP)).checkTarget('scam.xyz')).verified, false);
});

test('VERIFIED: a self-consistent table that Arkiv does not vouch for is rejected, not downgraded', async () => {
  const w = fakePirWorld(SNAP);
  await assert.rejects(client(w, { publishedRoots: async () => ['0xdead'] }).checkTarget('scam.xyz'), /published on Arkiv/);
});

test('the same data under a different snapshot id has a different root (a root cannot be replayed)', () => {
  const other = buildSnapshot('snap-other', [rec('domain', 'scam.xyz', 0, [sig('feed', 1, 1)])], N);
  const same = buildSnapshot('snap-t', [rec('domain', 'scam.xyz', 0, [sig('feed', 1, 1)])], N);
  assert.notEqual(other.root, same.root);
  assert.deepEqual(other.hashes, same.hashes);
});

test('malformed targets are rejected before any request', async () => {
  const w = fakePirWorld(SNAP);
  await assert.rejects(client(w).checkTarget('0x123'));
  assert.equal(w.seen.size, 0);
});

test('the hash table is downloaded once per snapshot, not per lookup', async () => {
  const w = fakePirWorld(SNAP);
  const c = client(w);
  await c.checkTarget('scam.xyz');
  await c.checkTarget('nothing.example');
  assert.equal((w.seen.get(PAIR1.a) ?? []).filter((r) => r.path.endsWith('/hashes')).length, 1);
});

test('no pairs configured is a clear error', async () => {
  await assert.rejects(createPirClient({ pairs: [], fetch: fakePirWorld(SNAP).fetch }).checkTarget('scam.xyz'), /no PIR server pairs/);
});

test('EVENTS: a lookup reports its real steps in order, two rounds, ending in scored', async () => {
  const types: string[] = [];
  await client(fakePirWorld(SNAP), { publishedRoots: async () => [SNAP.root] }).checkTarget('scam.xyz', undefined, (e) => types.push(e.type));
  assert.deepEqual(types, ['hashed', 'snapshot', 'table', 'query', 'combined', 'bucket-verified', 'query', 'combined', 'bucket-verified', 'scored']);
});

test('EVENTS: the vectors in the events are exactly the bytes the two servers received', async () => {
  const w = fakePirWorld(SNAP);
  const sent: { a: Uint8Array; b: Uint8Array }[] = [];
  await client(w).checkTarget('scam.xyz', undefined, (e) => { if (e.type === 'query') sent.push({ a: e.a, b: e.b }); });
  assert.deepEqual(queries(w, PAIR1.a).map(vec), sent.map((s) => Buffer.from(s.a)));
  assert.deepEqual(queries(w, PAIR1.b).map(vec), sent.map((s) => Buffer.from(s.b)));
});

test('EVENTS: the table event says whether Arkiv vouched for it', async () => {
  const seen: boolean[] = [];
  const grab = (e: { type: string; matchedPublishedRoot?: boolean }) => { if (e.type === 'table') seen.push(e.matchedPublishedRoot!); };
  await client(fakePirWorld(SNAP), { publishedRoots: async () => [SNAP.root] }).checkTarget('scam.xyz', undefined, grab);
  await client(fakePirWorld(SNAP)).checkTarget('scam.xyz', undefined, grab);
  assert.deepEqual(seen, [true, false]);
});

test('EVENTS: a failed pair emits retry with the reason before the next pair runs', async () => {
  const w = fakePirWorld(SNAP, { tamper: new Set([PAIR1.b]) });
  const events: string[] = [];
  let reason = '';
  await client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz', undefined, (e) => { events.push(e.type); if (e.type === 'retry') reason = e.reason; });
  assert.ok(events.includes('retry'));
  assert.match(reason, /does not match the hash table/);
  assert.ok(events.indexOf('retry') < events.lastIndexOf('scored'));
});
