import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createPirClient } from '@lookout/client';
import { createPirServer } from './server.ts';
import { buildDemoSnapshot } from './demo-snapshot.ts';

// The whole path over real HTTP: client -> two PIR servers -> verified verdict.
const snap = buildDemoSnapshot(); // full demo size: 16,384 buckets
const stored = { snapshotId: 'snap-e2e', ...snap };
const [A, B] = ['A', 'B'].map((name) => createPirServer({ name, snapshots: new Map([['snap-e2e', stored]]), latest: 'snap-e2e', log: () => {} }));
const port = (s: typeof A) => new Promise<string>((r) => s.listen(0, () => r(`http://localhost:${(s.address() as AddressInfo).port}`)));
const [a, b] = [await port(A), await port(B)];
after(() => { A.close(); B.close(); });

const client = createPirClient({ pairs: [{ a, b }], publishedRoots: async () => [snap.root] });

test('end to end: the five demo targets get the verdicts the wallet page promises', async () => {
  const expect: [string, string][] = [
    ['claim-arbitrum-airdrop.xyz', 'block'],
    ['uniswapp-rewards.io', 'warn'],
    ['orbit-bridge.app', 'warn'],
    ['0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', 'block'],
    ['my-local-bakery.in', 'unknown'],
  ];
  for (const [target, verdict] of expect) {
    const r = await client.checkTarget(target);
    assert.equal(r.verdict, verdict, target);
    assert.equal(r.verified, true, `${target} verified against the published root`);
  }
});

test('end to end: both server logs show only random-looking vectors, two per lookup', async () => {
  const before = [A.recent.length, B.recent.length];
  await client.checkTarget('claim-arbitrum-airdrop.xyz');
  for (const [s, n] of [[A, before[0]], [B, before[1]]] as const) {
    const lines = s.recent.slice(n);
    assert.equal(lines.length, 2, 'both candidate buckets are queried');
    for (const l of lines) {
      assert.match(l, /query snapshot=snap-e2e vector=[0-9a-f]{24}… bits_set=\d+\/16384$/);
      assert.ok(!/claim|arbitrum|airdrop/i.test(l));
    }
  }
});

test('end to end: the stealth bounty is found by reportId only', async () => {
  const hit = await client.findBounty('rep_demo');
  assert.equal(hit?.tier, 1);
  assert.equal(await client.findBounty('rep_someone_else'), null);
});
