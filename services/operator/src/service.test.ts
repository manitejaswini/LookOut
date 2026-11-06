import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { caseIdFor, CONFIG, disputeMessage, encodeReportPayload, targetHash, type Corroboration } from '@lookout/core';
import { memoryJournal } from './journal.ts';
import { listDisputes, planReports, type AttestationRow, type PlanPorts, type ReportRow } from './reports.ts';
import { createOperatorApi, createOperatorService, type ServiceDeps } from './service.ts';

const REPORTER = '0x' + 'a1'.repeat(20);
const DOMAIN = 'evil-site.example';
const DH = targetHash('domain', DOMAIN);
const TX = '0x' + 'ab'.repeat(32);
const T0 = 1_000_000;
const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: '0x' + '01'.repeat(32), creator: REPORTER, reportId: '1'.repeat(32), targetHash: DH, createdAt: T0,
  payload: encodeReportPayload({ kind: 'domain', value: DOMAIN }), ...over,
});
const ports = (status: 'locked' | 'returned' | 'none' = 'locked'): PlanPorts & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, deposit: async (r, id) => (asked.push(`${r}:${id}`), { status }) };
};

/* ------------------------------- planning ------------------------------- */

test('REPORT: a report with a locked deposit and a matching payload is planned, with the plain target', async () => {
  const p = ports();
  const { reports, skipped } = await planReports([row()], p);
  assert.deepEqual(skipped, []);
  assert.equal(reports.length, 1);
  assert.deepEqual([reports[0].kind, reports[0].value, reports[0].createdAt], ['domain', DOMAIN, T0]);
  assert.deepEqual(p.asked, [`${REPORTER}:${'1'.repeat(32)}`], 'the contract was asked about exactly this reporter and report');
});

test('REPORT: only a LOCKED deposit counts (already settled or never deposited are skipped), and a mirror cannot fake it', async () => {
  for (const status of ['returned', 'none'] as const) {
    const { reports, skipped } = await planReports([row()], ports(status));
    assert.equal(reports.length, 0);
    assert.match(skipped[0].reason, new RegExp(`deposit is ${status}`));
  }
});

test('REPORT: a payload naming another target, or no payload, is skipped; a down RPC is skipped for now', async () => {
  const wrong = row({ payload: encodeReportPayload({ kind: 'domain', value: 'innocent.example' }) });
  const none = row({ key: '0x' + '02'.repeat(32), payload: undefined });
  const r1 = await planReports([wrong, none], ports());
  assert.equal(r1.reports.length, 0);
  assert.deepEqual(r1.skipped.map((s) => s.reason.slice(0, 20)), ['the target in the pa', 'the report has no pa']);
  const down: PlanPorts = { deposit: async () => { throw new Error('rpc down'); } };
  assert.match((await planReports([row()], down)).skipped[0].reason, /escrow lookup failed: rpc down/);
});

const owner = privateKeyToAccount(('0x' + '55'.repeat(32)) as `0x${string}`);
const OH = targetHash('address', owner.address);
const dispute = async (over: Partial<AttestationRow> = {}, signer = owner): Promise<AttestationRow> => ({
  key: '0x' + '0d'.repeat(32), creator: owner.address, targetHash: OH, claim: 'legit', createdAt: T0, payload: await signer.signMessage({ message: disputeMessage(OH) }), ...over,
});

test('DISPUTE: an owner proof is listed for a ruling, with the address recovered from the signature', async () => {
  const { disputes } = listDisputes([await dispute()]);
  assert.equal(disputes.length, 1);
  assert.equal(disputes[0].owner, owner.address.toLowerCase());
  assert.equal(disputes[0].caseId, caseIdFor(OH, '0x' + '0d'.repeat(32)));
});

test('DISPUTE: no proof, a stranger, a replayed signature or a non-dispute claim is not listed', async () => {
  const stranger = privateKeyToAccount(('0x' + '66'.repeat(32)) as `0x${string}`);
  const rows = [
    await dispute({ payload: undefined, key: '0x' + '01'.repeat(32) }),
    await dispute({ creator: stranger.address, key: '0x' + '02'.repeat(32) }),
    await dispute({ claim: 'confirmed', key: '0x' + '03'.repeat(32) }),
    await dispute({ key: '0x' + '04'.repeat(32) }, stranger),
  ];
  const { disputes, skipped } = listDisputes(rows);
  assert.equal(disputes.length, 0);
  assert.equal(skipped.length, 4);
});

/* ---------------------------------- the pass ---------------------------------- */

function rig(over: Partial<ServiceDeps> = {}) {
  const w = { t: T0 + 60, ebl: 50n, created: [] as Record<string, unknown>[], fail: new Set<string>(), flagged: false };
  const journal = memoryJournal();
  const humans = new Set<string>();
  const deposits = [{ reporter: REPORTER as `0x${string}`, reportId: '1'.repeat(32), amount: 10n ** 15n, txHash: TX as `0x${string}`, blockNumber: 60n }];
  const settled: { kind: 'confirmed'; bountyWei: bigint; reporter: `0x${string}`; reportId: string; txHash: `0x${string}`; blockNumber: bigint }[] = [];
  const arkiv = {
    async createEntity(_s: unknown, v: Record<string, unknown>) { w.created.push(v); return { entityKey: `0x${w.created.length.toString(16).padStart(64, '0')}`, txHash: TX, expiresAt: 0 }; },
    async extendEntity() { return { expiresAt: 0 }; },
    async patchEntity() {},
  };
  const escrowFake = {
    deposit: async () => ({ status: 'locked' as const, lockedAt: 0n }), confirm: async () => ({ hash: '0xc', blockNumber: 1n, gasUsed: 1n, bountyWei: 5n * 10n ** 14n }),
    refund: async () => ({ hash: '0xr', blockNumber: 1n, gasUsed: 1n }), reject: async () => ({ hash: '0xj', blockNumber: 1n, gasUsed: 1n }),
  };
  const deps: ServiceDeps = {
    journal, humans: () => humans, arkiv, escrowFromBlock: 50n, latestEscrowBlock: async () => w.ebl, now: () => w.t, checkpointEverySeconds: 600,
    resolver: {
      arkiv, escrow: escrowFake as never, journal, now: () => w.t, humans: () => humans,
      evidence: { signalsFor: async () => (w.flagged ? [{ sourceType: 'feed', sourceId: 'openfeed', level: 'block', createdAt: w.t - 10, creator: '0x' + 'f1'.repeat(20), entityKey: '0x' + '09'.repeat(32) } as Corroboration] : []) },
    },
    source: { reports: async () => { if (w.fail.has('reports')) throw new Error('arkiv down'); return [row()]; }, attestations: async () => [] },
    planPorts: { deposit: async () => ({ status: 'locked' }) },
    escrow: { depositEvents: async () => { if (w.fail.has('escrow')) throw new Error('rpc down'); return deposits; }, settledEvents: async () => settled },
    ...over,
  };
  return { w, deps, service: createOperatorService(deps), journal, humans, settled };
}

test('one pass mirrors the deposit and starts watching the report', async () => {
  const { w, service } = rig();
  const r = await service.tick();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.mirrored, { deposits: 1, settlements: 0, waiting: 0 });
  assert.deepEqual([r.resolved?.waiting, r.resolved?.confirmed, r.resolved?.refunded], [1, 0, 0]);
  assert.ok(w.created.some((c) => c.status === 'locked'), 'a stake entity was written');
  assert.equal(service.reports()[0].state, 'waiting');
});

test('when a trusted source corroborates the report, the next pass confirms it', async () => {
  const { w, service } = rig();
  await service.tick();
  w.flagged = true;
  w.t += 30;
  const r = await service.tick();
  assert.equal(r.resolved?.confirmed, 1);
  assert.equal(service.reports()[0].state, 'confirmed');
});

test('running again does not mirror twice', async () => {
  const { w, service } = rig();
  await service.tick();
  const stakes = () => w.created.filter((c) => c.status === 'locked').length;
  const before = stakes();
  const r = await service.tick();
  assert.equal(r.mirrored, undefined, 'nothing new on chain to scan');
  assert.equal(stakes(), before);
});

test('FAILURE ISOLATION: a broken escrow RPC does not stop resolving, and a broken Arkiv read does not stop the mirror', async () => {
  const a = rig();
  a.w.fail.add('escrow');
  const r1 = await a.service.tick();
  assert.deepEqual(r1.errors.map((e) => e.part), ['mirror']);
  assert.equal(r1.resolved?.waiting, 1);

  const b = rig();
  b.w.fail.add('reports');
  const r2 = await b.service.tick();
  assert.deepEqual(r2.errors.map((e) => e.part), ['resolve', 'disputes'].slice(0, 1));
  assert.equal(r2.mirrored?.deposits, 1);
});

test('a settlement whose deposit is not mirrored yet is retried, and the cursor does not skip past it', async () => {
  const { service, settled, journal } = rig();
  settled.push({ kind: 'confirmed', bountyWei: 0n, reporter: ('0x' + 'bb'.repeat(20)) as `0x${string}`, reportId: '9'.repeat(32), txHash: TX as `0x${string}`, blockNumber: 70n });
  const r = await service.tick();
  assert.equal(r.mirrored?.waiting, 1);
  assert.equal(journal.detail('service:escrow-cursor'), undefined);
});

test('reputation: a verified human appears in the checkpoint at the floor, and a fresh wallet does not', async () => {
  const { service, humans } = rig();
  humans.add(REPORTER);
  const r = await service.tick();
  assert.ok(r.checkpoint);
  assert.equal(service.reputation()?.scores.get(REPORTER), CONFIG.HUMAN_BASE_REP);
  assert.equal(service.reputation()?.scores.has('0x' + 'cc'.repeat(20)), false);
});

test('API: reports and disputes are listed read-only and filterable by report id', async () => {
  const { w, service, humans } = rig();
  humans.add(REPORTER);
  await service.tick();
  w.flagged = true;
  w.t += 30;
  await service.tick();
  const server = createOperatorApi(service);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const all = (await (await fetch(`${base}/reports`)).json()) as { reports: { reportId: string; state: string }[] };
    assert.equal(all.reports.length, 1);
    assert.equal(all.reports[0].state, 'confirmed');
    assert.equal(((await (await fetch(`${base}/reports?reportId=${'1'.repeat(32)}`)).json()) as { reports: unknown[] }).reports.length, 1);
    assert.equal(((await (await fetch(`${base}/reports?reportId=${'2'.repeat(32)}`)).json()) as { reports: unknown[] }).reports.length, 0);
    assert.equal((await fetch(`${base}/reports?reportId=nope`)).status, 400);
    assert.equal((await fetch(`${base}/disputes`)).status, 200);
    assert.equal((await fetch(`${base}/reports`, { method: 'POST' })).status, 405, 'there is no write endpoint');
    assert.equal(((await (await fetch(`${base}/status`)).json()) as { reports: number }).reports, 1);
    assert.equal((await fetch(`${base}/cases`)).status, 404);
  } finally {
    server.close();
  }
});

/* ---------- the stake mirror never writes a duplicate ---------- */

import { mirrorDeposits, mirrorSettlements } from './mirror.ts';

test('MIRROR: if Arkiv already holds a stake for the report (an earlier write that timed out), none is created, and it is journaled', async () => {
  const { w, journal } = rig();
  const arkiv = { async createEntity() { w.created.push({ extra: true }); return { entityKey: '0xnew', txHash: TX, expiresAt: 0 }; }, async extendEntity() { return { expiresAt: 0 }; }, async patchEntity() {} };
  const dep = { reporter: REPORTER as `0x${string}`, reportId: '7'.repeat(32), amount: 10n ** 15n, txHash: TX as `0x${string}`, blockNumber: 1n };
  const r = await mirrorDeposits({ arkiv, journal, findStakes: async () => ['0x' + 'aa'.repeat(32)] }, [dep]);
  assert.deepEqual(r, { created: 0, skipped: 1 });
  assert.equal(w.created.length, 0, 'no second entity');
  assert.equal(journal.detail(`stake:${REPORTER}:${'7'.repeat(32)}`), '0x' + 'aa'.repeat(32), 'the existing one is remembered');
});

test('MIRROR: a settlement updates EVERY stake entity for the report, so a duplicate cannot stay "locked"', async () => {
  const { journal } = rig();
  const patched: string[] = [];
  const arkiv = { async createEntity() { return { entityKey: '0xnew', txHash: TX, expiresAt: 0 }; }, async extendEntity() { return { expiresAt: 0 }; }, async patchEntity(_s: unknown, key: string) { patched.push(key); } };
  const id = '8'.repeat(32);
  journal.mark(`stake:${REPORTER}:${id}`, '0x' + '01'.repeat(32));
  const ev = { kind: 'confirmed' as const, bountyWei: 0n, reporter: REPORTER as `0x${string}`, reportId: id, txHash: TX as `0x${string}`, blockNumber: 2n };
  const r = await mirrorSettlements({ arkiv, journal, findStakes: async () => ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32)] }, [ev]);
  assert.equal(r.updated, 1);
  assert.deepEqual([...patched].sort(), ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32)]);
});
