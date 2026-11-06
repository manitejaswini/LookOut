import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createPirClient } from '@lookout/client';
import { targetHash } from '@lookout/core';
import { buildStoreSnapshot, lookup, type AcceptedSignal, type IndexState, type TargetView } from '@lookout/indexer';
import { createPirServer } from './server.ts';
import { buildDemoSnapshot } from './demo-snapshot.ts';

// The whole path over real HTTP: client -> two PIR servers -> verified verdict.
const port = (s: ReturnType<typeof createPirServer>) => new Promise<string>((r) => s.listen(0, () => r(`http://localhost:${(s.address() as AddressInfo).port}`)));
const serve = async (snap: ReturnType<typeof buildDemoSnapshot>) => {
  const mk = (name: string) => createPirServer({ name, snapshots: new Map([[snap.snapshotId, snap]]), latest: snap.snapshotId, log: () => {} });
  const [A, B] = [mk('A'), mk('B')];
  return { A, B, a: await port(A), b: await port(B) };
};

/* ---------- 1. the demo snapshot, full size (16,384 buckets) ---------- */
const demo = buildDemoSnapshot();
const demoWorld = await serve(demo);
const demoClient = createPirClient({ pairs: [{ a: demoWorld.a, b: demoWorld.b }], publishedRoots: async () => [demo.root] });

test('end to end: the demo targets get the verdicts the wallet page promises', async () => {
  const expect: [string, string][] = [
    ['claim-arbitrum-airdrop.xyz', 'block'],
    ['uniswapp-rewards.io', 'warn'],
    ['orbit-bridge.app', 'warn'],
    ['0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', 'block'],
    ['my-local-bakery.in', 'unknown'],
  ];
  for (const [target, verdict] of expect) {
    const r = await demoClient.checkTarget(target);
    assert.equal(r.verdict, verdict, target);
    assert.equal(r.verified, true, `${target} verified against the published root`);
  }
});

test('end to end: both server logs show only a length and a short hash, two queries per lookup', async () => {
  const before = [demoWorld.A.recent.length, demoWorld.B.recent.length];
  await demoClient.checkTarget('claim-arbitrum-airdrop.xyz');
  for (const [s, n] of [[demoWorld.A, before[0]], [demoWorld.B, before[1]]] as const) {
    const lines = s.recent.slice(n);
    assert.equal(lines.length, 2, 'both candidate buckets are queried');
    for (const l of lines) {
      assert.match(l, /query snapshot=snap-demo vector_bytes=2048 vector_fp=[0-9a-f]{12} bits_set=\d+\/16384$/);
      assert.ok(!/claim|arbitrum|airdrop/i.test(l));
    }
  }
});

/* ---------- 2. a snapshot built by Dev A's real indexer code ---------- */
const timing = { currentBlock: 5000, currentBlockTime: 1_700_000_000, blockDuration: 2 };
let n = 0;
const acc = (sourceType: AcceptedSignal['sourceType'], sourceIdx: number, weight: number, ageBlocks: number, level: 'block' | 'warn' = 'block'): AcceptedSignal => ({
  entityKey: `0x${(++n).toString(16).padStart(64, '0')}`, sourceType, sourceId: `src-${sourceIdx}`, sourceIdx, level, weight,
  createdBlock: timing.currentBlock - ageBlocks, note: '', hasProof: false,
});
const view = (domain: string, signals: AcceptedSignal[], extra: Partial<TargetView> = {}): [string, TargetView] => {
  const h = targetHash('domain', domain);
  return [h, { targetHash: h, signals, disputed: false, ...extra }];
};
const targets = new Map<string, TargetView>([
  view('real-scam.xyz', [acc('feed', 2, 1, 120), acc('checker', 1, 1, 40), acc('community', 0, 0.6, 10)]),
  view('only-reports.io', [acc('community', 0, 0.9, 5), acc('community', 0, 0.7, 6)]),
  view('owner-disputes.app', [acc('community', 0, 0.2, 9, 'warn')], { disputed: true }),
  view('panel-cleared.org', [acc('community', 0, 1, 50)], { ruling: 'clear' }),
]);
const state: IndexState = { targets, dropped: [], entities: [], timing, epoch: timing, epochTargets: targets, entityCount: 7, syncedAt: 0 };
const real = buildStoreSnapshot(targets, timing);
const realWorld = await serve(real);
const realClient = createPirClient({ pairs: [{ a: realWorld.a, b: realWorld.b }], publishedRoots: async () => [real.root] });

test('indexer snapshot -> PIR servers -> client gives the same verdict as reading the indexer directly', async () => {
  for (const domain of ['real-scam.xyz', 'only-reports.io', 'owner-disputes.app', 'panel-cleared.org', 'not-listed.example']) {
    const direct = lookup(state, 'domain', domain);
    const viaPir = await realClient.checkTarget(domain);
    assert.equal(viaPir.verdict, direct.verdict, `${domain}: verdict`);
    assert.equal(viaPir.disputed, direct.disputed, `${domain}: disputed`);
    assert.equal(viaPir.strongTypes, direct.strongTypes, `${domain}: strong types`);
    assert.equal(viaPir.verified, true);
    assert.equal(viaPir.snapshotId, 'snap-5000');
  }
});

test('indexer snapshot: the real scam blocks, reports alone only warn, a ruling clears', async () => {
  assert.equal((await realClient.checkTarget('real-scam.xyz')).verdict, 'block');
  assert.equal((await realClient.checkTarget('only-reports.io')).verdict, 'warn');
  assert.equal((await realClient.checkTarget('owner-disputes.app')).verdict, 'warn');
  assert.equal((await realClient.checkTarget('panel-cleared.org')).verdict, 'unknown');
});

after(() => { for (const w of [demoWorld, realWorld]) { w.A.close(); w.B.close(); } });
