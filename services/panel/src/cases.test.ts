import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { caseIdFor, disputeMessage, encodeReportPayload, targetHash } from '@lookout/core';
import { planCases, type AttestationRow, type PlanPorts, type ReportRow } from './cases.ts';

const REPORTER = '0x' + 'a1'.repeat(20);
const DOMAIN = 'evil-site.example';
const DH = targetHash('domain', DOMAIN);
const sealed = new Uint8Array(128).fill(5);
const report = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: '0x' + '01'.repeat(32), creator: REPORTER, reportId: '1'.repeat(32), targetHash: DH,
  payload: encodeReportPayload({ kind: 'domain', value: DOMAIN, sealed }), ...over,
});
const ports = (status: 'locked' | 'returned' | 'none' = 'locked', open: string | null = 'st:eth:0xmeta'): PlanPorts & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, deposit: async (r, id) => (asked.push(`${r}:${id}`), { status }), openSealed: () => open };
};

test('REPORT: a report whose deposit is locked in the escrow opens a case with the plain target and the opened bounty address', async () => {
  const p = ports();
  const { requests, skipped } = await planCases({ reports: [report()], attestations: [] }, p);
  assert.deepEqual(skipped, []);
  assert.equal(requests.length, 1);
  const q = requests[0];
  assert.equal(q.type, 'report');
  assert.equal(q.caseId, caseIdFor(DH, '0x' + '01'.repeat(32)));
  assert.deepEqual([q.kind, q.value, q.reporterMeta], ['domain', DOMAIN, 'st:eth:0xmeta']);
  assert.deepEqual(q.exclude, [REPORTER]);
  assert.deepEqual(p.asked, [`${REPORTER}:${'1'.repeat(32)}`], 'the contract was asked about exactly this reporter and report');
});

test('REPORT: no case unless the contract says LOCKED (already settled, never deposited, or reclaimed)', async () => {
  for (const status of ['returned', 'none'] as const) {
    const { requests, skipped } = await planCases({ reports: [report()], attestations: [] }, ports(status));
    assert.equal(requests.length, 0);
    assert.match(skipped[0].reason, new RegExp(`deposit is ${status}`));
  }
});

test('REPORT: a payload that names another target, or no payload, opens nothing', async () => {
  const wrong = report({ payload: encodeReportPayload({ kind: 'domain', value: 'innocent.example' }) });
  const none = report({ key: '0x' + '02'.repeat(32), payload: undefined });
  const { requests, skipped } = await planCases({ reports: [wrong, none], attestations: [] }, ports());
  assert.equal(requests.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason.slice(0, 20)), ['the target in the pa', 'the report has no pa']);
});

test('REPORT: a bounty address that cannot be opened still opens the case, just without a bounty', async () => {
  const { requests } = await planCases({ reports: [report()], attestations: [] }, ports('locked', null));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reporterMeta, undefined);
});

test('REPORT: if the escrow cannot be reached the report is skipped for now, not guessed at', async () => {
  const down: PlanPorts = { deposit: async () => { throw new Error('rpc down'); }, openSealed: () => null };
  const { requests, skipped } = await planCases({ reports: [report()], attestations: [] }, down);
  assert.equal(requests.length, 0);
  assert.match(skipped[0].reason, /escrow lookup failed: rpc down/);
});

const owner = privateKeyToAccount(('0x' + '55'.repeat(32)) as `0x${string}`);
const OH = targetHash('address', owner.address);
const dispute = async (over: Partial<AttestationRow> = {}, signer = owner): Promise<AttestationRow> => ({
  key: '0x' + '0d'.repeat(32), creator: owner.address, targetHash: OH, claim: 'legit', payload: await signer.signMessage({ message: disputeMessage(OH) }), ...over,
});

test('DISPUTE: an owner proof opens a case about that address, and the owner cannot sit on the panel', async () => {
  const { requests } = await planCases({ reports: [], attestations: [await dispute()] }, ports());
  assert.equal(requests.length, 1);
  const q = requests[0];
  assert.equal(q.type, 'dispute');
  assert.deepEqual([q.kind, q.value], ['address', owner.address.toLowerCase()]);
  assert.deepEqual(q.exclude, [owner.address.toLowerCase()]);
});

test('DISPUTE: no proof, a stranger, a replayed signature or a non-dispute claim opens nothing', async () => {
  const stranger = privateKeyToAccount(('0x' + '66'.repeat(32)) as `0x${string}`);
  const rows = [
    await dispute({ payload: undefined, key: '0x' + '01'.repeat(32) }),
    await dispute({ creator: stranger.address, key: '0x' + '02'.repeat(32) }), // owner signature published by someone else
    await dispute({ claim: 'confirmed', key: '0x' + '03'.repeat(32) }),
    await dispute({ key: '0x' + '04'.repeat(32) }, stranger), // stranger signs, but it is not the target
  ];
  const { requests, skipped } = await planCases({ reports: [], attestations: rows }, ports());
  assert.equal(requests.length, 0);
  assert.equal(skipped.length, 4);
});

test('the same inputs give the same case ids, so running it every pass never makes a second case', async () => {
  const a = await planCases({ reports: [report()], attestations: [await dispute()] }, ports());
  const b = await planCases({ reports: [report()], attestations: [await dispute()] }, ports());
  assert.deepEqual(a.requests.map((r) => r.caseId), b.requests.map((r) => r.caseId));
  assert.equal(new Set(a.requests.map((r) => r.caseId)).size, 2);
});
