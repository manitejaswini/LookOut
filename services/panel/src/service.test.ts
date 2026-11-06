import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { caseIdFor, encodeReportPayload, targetHash, type Candidate } from '@lookout/core';
import { createDriver, DEFAULT_DRIVER_CONFIG } from './driver.ts';
import { memoryJournal } from './journal.ts';
import { createPanelApi, createPanelService, publicCase, type ServiceDeps } from './service.ts';
import type { ReportRow } from './cases.ts';

const ONE = 10n ** 18n;
const REPORTER = '0x' + 'a1'.repeat(20);
const wallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
const DH = targetHash('domain', 'evil-site.example');
const reportRow = (): ReportRow => ({ key: '0x' + '01'.repeat(32), creator: REPORTER, reportId: '1'.repeat(32), targetHash: DH, payload: encodeReportPayload({ kind: 'domain', value: 'evil-site.example' }) });
const TX = '0x' + 'ab'.repeat(32);

function rig(over: Partial<ServiceDeps> = {}) {
  const w = { t: 1000, block: 100, ebl: 50n, created: [] as Record<string, unknown>[], patched: 0, fail: new Set<string>() };
  const journal = memoryJournal();
  const pool: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ wallet: wallet(i), rep: 5, stakeWei: ONE, nullifier: `n${i}` }));
  const driver = createDriver({
    journal, now: () => w.t, currentBlock: async () => w.block, blockHash: async (b) => (b <= w.block ? '0x' + b.toString(16).padStart(64, '0') : null),
    candidates: async () => pool, readVotes: async () => [], settle: async () => ({ status: 'settled', result: 'confirmed', did: [], repEvents: [] }),
  }, { ...DEFAULT_DRIVER_CONFIG, commitSeconds: 100, revealSeconds: 100, panelSize: 3, quorum: 2, minStakeWei: ONE, seedDelayBlocks: 2 });
  const deposits = [{ reporter: REPORTER as `0x${string}`, reportId: '1'.repeat(32), amount: 10n ** 15n, txHash: TX as `0x${string}`, blockNumber: 60n }];
  const settled: { kind: 'confirmed'; reporter: `0x${string}`; reportId: string; txHash: `0x${string}`; blockNumber: bigint }[] = [];
  const deps: ServiceDeps = {
    journal, driver, escrowFromBlock: 50n, latestEscrowBlock: async () => w.ebl, now: () => w.t, checkpointEverySeconds: 600,
    caseSource: { reports: async () => { if (w.fail.has('reports')) throw new Error('arkiv down'); return [reportRow()]; }, attestations: async () => [] },
    planPorts: { deposit: async () => ({ status: 'locked' }), openSealed: () => 'st:eth:0xsecretmeta' },
    escrow: { depositEvents: async () => { if (w.fail.has('escrow')) throw new Error('rpc down'); return deposits; }, settledEvents: async () => settled },
    arkiv: {
      async createEntity(_s: unknown, v: Record<string, unknown>) { w.created.push(v); return { entityKey: `0x${w.created.length.toString(16).padStart(64, '0')}`, txHash: TX, expiresAt: 0 }; },
      async extendEntity() { return { expiresAt: 0 }; },
      async patchEntity() { w.patched++; },
    },
    ...over,
  };
  return { w, deps, service: createPanelService(deps), driver, journal, settled };
}

test('one pass mirrors the deposit, opens the case from the report, and starts it', async () => {
  const { w, service, driver } = rig();
  const r = await service.tick();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.mirrored, { deposits: 1, settlements: 0, waiting: 0 });
  assert.equal(r.opened?.new, 1);
  assert.equal(driver.list().length, 1);
  assert.equal(driver.list()[0].request.caseId, caseIdFor(DH, '0x' + '01'.repeat(32)));
  assert.equal(driver.list()[0].phase, 'awaiting-seed');
  assert.ok(w.created.some((c) => c.status === 'locked'), 'a stake entity was written');
});

test('running it again does not mirror twice or open a second case', async () => {
  const { w, service, driver } = rig();
  await service.tick();
  const stakes = () => w.created.filter((c) => c.status === 'locked').length;
  const before = stakes();
  const r = await service.tick();
  assert.equal(r.mirrored, undefined, 'nothing new on chain to scan');
  assert.equal(r.opened?.new, 0);
  assert.equal(driver.list().length, 1);
  assert.equal(stakes(), before, 'no second stake entity');
});

test('time and blocks move the case along on later passes', async () => {
  const { w, service, driver } = rig();
  await service.tick();
  w.block += 2;
  await service.tick();
  assert.equal(driver.list()[0].phase, 'commit');
  w.t += 100;
  await service.tick();
  assert.equal(driver.list()[0].phase, 'reveal');
});

test('FAILURE ISOLATION: a broken escrow RPC does not stop cases opening, and a broken Arkiv read does not stop the mirror', async () => {
  const a = rig();
  a.w.fail.add('escrow');
  const r1 = await a.service.tick();
  assert.deepEqual(r1.errors.map((e) => e.part), ['mirror']);
  assert.equal(r1.opened?.new, 1, 'the case still opened');

  const b = rig();
  b.w.fail.add('reports');
  const r2 = await b.service.tick();
  assert.deepEqual(r2.errors.map((e) => e.part), ['open']);
  assert.equal(r2.mirrored?.deposits, 1, 'the deposit was still mirrored');
});

test('a settlement whose deposit is not mirrored yet is retried, and the cursor does not skip past it', async () => {
  const { service, settled, journal } = rig();
  settled.push({ kind: 'confirmed', reporter: ('0x' + 'bb'.repeat(20)) as `0x${string}`, reportId: '9'.repeat(32), txHash: TX as `0x${string}`, blockNumber: 70n });
  const r = await service.tick();
  assert.equal(r.mirrored?.waiting, 1);
  assert.equal(journal.detail('service:escrow-cursor'), undefined, 'cursor did not advance while something waits');
});

test('the cursor advances once everything is mirrored, so old blocks are not rescanned', async () => {
  const { service, journal, w } = rig();
  await service.tick();
  assert.equal(journal.detail('service:escrow-cursor'), (w.ebl + 1n).toString());
});

test('a reputation checkpoint is published on the first pass and then only when due and there is something new', async () => {
  const { w, service, journal } = rig();
  const first = await service.tick();
  assert.ok(first.checkpoint);
  w.t += 10;
  assert.equal((await service.tick()).checkpoint, undefined, 'not due yet');
  w.t += 1000;
  assert.equal((await service.tick()).checkpoint, undefined, 'due, but no new events, so nothing to publish');
  journal.mark('checkpoint:events', JSON.stringify([{ wallet: wallet(1), kind: 'report_confirmed', at: w.t, ref: 'x' }]));
  w.t += 1;
  assert.ok((await service.tick()).checkpoint, 'due and there is a new event');
});

test('API: cases are listed and filtered by juror, and the opened bounty address never appears', async () => {
  const { w, service, driver } = rig();
  await service.tick();
  w.block += 2;
  await service.tick();
  const jurors = driver.list()[0].jurors!;
  const server = createPanelApi(service);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const all = (await (await fetch(`${base}/cases`)).json()) as { cases: ReturnType<typeof publicCase>[] };
    assert.equal(all.cases.length, 1);
    assert.equal(all.cases[0].phase, 'commit');
    assert.ok(!JSON.stringify(all).includes('secretmeta'), 'the sealed-then-opened meta-address is private');
    assert.ok(!JSON.stringify(all).includes('reporterMeta'));

    const mine = (await (await fetch(`${base}/cases?juror=${jurors[0].toUpperCase().replace('0X', '0x')}`)).json()) as { cases: unknown[] };
    assert.equal(mine.cases.length, 1);
    const none = (await (await fetch(`${base}/cases?juror=${wallet(40)}`)).json()) as { cases: unknown[] };
    assert.equal(none.cases.length, 0);

    assert.equal((await fetch(`${base}/cases?juror=nope`)).status, 400);
    assert.equal((await fetch(`${base}/cases/${all.cases[0].caseId}`)).status, 200);
    assert.equal((await fetch(`${base}/cases/${'0'.repeat(16)}`)).status, 404);
    assert.equal((await fetch(`${base}/cases`, { method: 'POST' })).status, 405, 'there is no write endpoint');
    assert.equal(((await (await fetch(`${base}/status`)).json()) as { open: number }).open, 1);
  } finally {
    server.close();
  }
});
