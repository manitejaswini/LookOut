import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer } from '@lookout/pir';
import {
  FLAG_DISPUTED, FLAG_RULING_BLOCK, bountyKey, buildSnapshot, candidates, keyFromHex, type SnapshotRecord, type SnapshotSignal,
} from '@lookout/snapshot';
import { targetHash } from '@lookout/core';
import { createPirClient, VerificationError } from './pir.ts';

const N = 256;
const NOW_MS = 1_700_001_000_000;
const sig = (sourceType: SnapshotSignal['sourceType'], weight: number, n: number): SnapshotSignal => ({
  sourceType, level: 'block', weight, createdAt: NOW_MS / 1000 - 60, entityKey: `0x${n.toString(16).padStart(16, '0')}`,
});
const tkey = (kind: 'domain' | 'address', v: string) => keyFromHex(targetHash(kind, v));
const RECORDS: SnapshotRecord[] = [
  { kind: 'target', key: tkey('domain', 'scam.xyz'), flags: 0, signals: [sig('feed', 1, 1), sig('checker', 1, 2)] },
  { kind: 'target', key: tkey('domain', 'orbit.app'), flags: FLAG_DISPUTED, signals: [sig('community', 0, 3)] },
  { kind: 'target', key: tkey('address', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08'), flags: FLAG_RULING_BLOCK, signals: [] },
  { kind: 'bounty', key: bountyKey('rep_0001'), tier: 3, ephemeralPublicKey: `0x03${'22'.repeat(32)}` },
];
const SNAP = buildSnapshot(RECORDS, N);
const ID = 'snap-t';

interface Seen { method: string; path: string; body: string }
/** In-memory PIR operators. Each base URL is a server that holds the table and records every request it gets. */
function world(opts: { tamper?: Set<string>; wrongRoot?: Set<string>; bad?: Set<string> } = {}) {
  const seen = new Map<string, Seen[]>();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const base = u.origin;
    (seen.get(base) ?? seen.set(base, []).get(base)!).push({ method: init?.method ?? 'GET', path: u.pathname, body: String(init?.body ?? '') });
    const ok = (body: BodyInit | Uint8Array, type = 'application/json') => new Response(body as BodyInit, { status: 200, headers: { 'content-type': type } });
    if (opts.bad?.has(base)) return new Response('', { status: 500 });
    if (u.pathname === '/snapshot/latest') {
      return ok(JSON.stringify({ snapshotId: ID, root: opts.wrongRoot?.has(base) ? '0xbad' : SNAP.root, bucketCount: N }));
    }
    if (u.pathname === `/snapshot/${ID}/hashes`) return ok(SNAP.hashes, 'application/octet-stream');
    if (u.pathname === '/pir/query') {
      const { vector } = JSON.parse(String(init!.body));
      const out = answer(SNAP.buckets, N, new Uint8Array(Buffer.from(vector, 'base64')));
      if (opts.tamper?.has(base)) out[10] ^= 0xff;
      return ok(out, 'application/octet-stream');
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, seen };
}
const PAIR1 = { a: 'http://a1.test', b: 'http://b1.test' };
const PAIR2 = { a: 'http://a2.test', b: 'http://b2.test' };
const client = (w: ReturnType<typeof world>, extra: Partial<Parameters<typeof createPirClient>[0]> = {}) =>
  createPirClient({ pairs: [PAIR1], fetch: w.fetch, now: () => NOW_MS, ...extra });
const queries = (w: ReturnType<typeof world>, base: string) => (w.seen.get(base) ?? []).filter((r) => r.path === '/pir/query');

test('a listed scam blocks, an unlisted target is unknown, a disputed one warns', async () => {
  const w = world();
  const c = client(w);
  assert.equal((await c.checkTarget('scam.xyz')).verdict, 'block');
  assert.equal((await c.checkTarget('nothing.example')).verdict, 'unknown');
  const orbit = await c.checkTarget('https://Orbit.app/bridge');
  assert.equal(orbit.verdict, 'warn');
  assert.equal(orbit.disputed, true);
  assert.equal((await c.checkTarget('0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08')).verdict, 'block');
});

test('result carries the snapshot id and signal ages computed on the client', async () => {
  const r = await client(world()).checkTarget('scam.xyz');
  assert.equal(r.snapshotId, ID);
  assert.equal(r.reasons[0].ageSeconds, 60);
});

test('PRIVACY: neither server ever sees the target, its hash, or the bucket it wanted', async () => {
  const w = world();
  await client(w).checkTarget('scam.xyz');
  const key = targetHash('domain', 'scam.xyz');
  const wanted = candidates(keyFromHex(key), N);
  for (const base of [PAIR1.a, PAIR1.b]) {
    const everything = JSON.stringify(w.seen.get(base));
    assert.ok(!everything.includes('scam'), `${base} saw the domain`);
    assert.ok(!everything.includes(key.slice(2, 18)), `${base} saw the hash`);
  }
  // Each query alone is a random vector. Across many runs a server sees the wanted bit set about half the time.
  let ones = 0, runs = 300;
  for (let i = 0; i < runs; i++) {
    const w2 = world();
    await client(w2).checkTarget('scam.xyz');
    for (const q of queries(w2, PAIR1.a)) {
      const v = Buffer.from(JSON.parse(q.body).vector, 'base64');
      for (const idx of wanted) ones += (v[idx >> 3] >> (7 - (idx & 7))) & 1;
    }
  }
  const trials = runs * 2 * 2; // runs x two queries x two candidate bits looked at per query
  assert.ok(Math.abs(ones - trials / 2) < 6 * Math.sqrt(trials / 4), `wanted bits set ${ones}/${trials} on server A`);
});

test('PRIVACY: a hit and a miss are identical on the wire (same requests, both buckets always)', async () => {
  const shape = async (target: string) => {
    const w = world();
    await client(w).checkTarget(target);
    return [PAIR1.a, PAIR1.b].map((b) => (w.seen.get(b) ?? []).map((r) => `${r.method} ${r.path} ${r.body.length}`));
  };
  const hit = await shape('scam.xyz');
  const miss = await shape('nothing.example');
  assert.deepEqual(hit, miss);
  assert.equal(hit[0].filter((l) => l.includes('/pir/query')).length, 2);
});

test('PRIVACY: the same lookup twice sends different vectors', async () => {
  const w = world();
  const c = client(w);
  await c.checkTarget('scam.xyz');
  await c.checkTarget('scam.xyz');
  const vs = queries(w, PAIR1.a).map((q) => q.body);
  assert.equal(new Set(vs).size, vs.length);
});

test('the A and B vectors of one query differ in exactly one bit', async () => {
  const w = world();
  await client(w).checkTarget('scam.xyz');
  const qa = queries(w, PAIR1.a), qb = queries(w, PAIR1.b);
  assert.equal(qa.length, 2);
  qa.forEach((q, i) => {
    const x = Buffer.from(JSON.parse(q.body).vector, 'base64'), y = Buffer.from(JSON.parse(qb[i].body).vector, 'base64');
    assert.equal(x.reduce((n, v, k) => n + (v ^ y[k]).toString(2).replace(/0/g, '').length, 0), 1);
  });
});

test('TAMPER: a tampered answer is rejected and the client retries on the next operator pair', async () => {
  const w = world({ tamper: new Set([PAIR1.b]) });
  const r = await client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz');
  assert.equal(r.verdict, 'block'); // correct answer from pair 2
  assert.ok(queries(w, PAIR2.a).length > 0, 'fell back to the second pair');
});

test('TAMPER: if every pair is bad, the lookup fails loudly and never returns a verdict', async () => {
  const w = world({ tamper: new Set([PAIR1.b, PAIR2.b]) });
  await assert.rejects(client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz'), VerificationError);
});

test('servers that disagree about the latest snapshot are refused', async () => {
  const w = world({ wrongRoot: new Set([PAIR1.b]) });
  await assert.rejects(client(w).checkTarget('scam.xyz'), /disagree/);
});

test('a dead server pair falls through to the next one', async () => {
  const w = world({ bad: new Set([PAIR1.a]) });
  assert.equal((await client(w, { pairs: [PAIR1, PAIR2] }).checkTarget('scam.xyz')).verdict, 'block');
});

test('VERIFIED: true only when the table matches a root published on Arkiv', async () => {
  const w = world();
  const good = await client(w, { publishedRoots: async () => ['0xdead', SNAP.root] }).checkTarget('scam.xyz');
  assert.equal(good.verified, true);
  const none = await client(world()).checkTarget('scam.xyz');
  assert.equal(none.verified, false);
});

test('VERIFIED: a self-consistent table that Arkiv does not vouch for is rejected, not downgraded', async () => {
  const w = world();
  await assert.rejects(client(w, { publishedRoots: async () => ['0xdead'] }).checkTarget('scam.xyz'), /published on Arkiv/);
});

test('stealth bounty: the reporter finds their own payout by reportId, and others get null', async () => {
  const c = client(world(), { publishedRoots: async () => [SNAP.root] });
  const hit = await c.findBounty('rep_0001');
  assert.deepEqual(hit && { tier: hit.tier, R: hit.ephemeralPublicKey, verified: hit.verified }, { tier: 3, R: `0x03${'22'.repeat(32)}`, verified: true });
  assert.equal(await c.findBounty('rep_9999'), null);
});

test('malformed targets are rejected before any request', async () => {
  const w = world();
  await assert.rejects(client(w).checkTarget('0x123'));
  assert.equal(w.seen.size, 0);
});

test('the hash table is downloaded once per snapshot, not per lookup', async () => {
  const w = world();
  const c = client(w);
  await c.checkTarget('scam.xyz');
  await c.checkTarget('nothing.example');
  assert.equal((w.seen.get(PAIR1.a) ?? []).filter((r) => r.path.endsWith('/hashes')).length, 1);
});

test('no pairs configured is a clear error', async () => {
  await assert.rejects(createPirClient({ pairs: [], fetch: world().fetch }).checkTarget('scam.xyz'), /no PIR server pairs/);
});
