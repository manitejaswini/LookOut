import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowError, runReportFlow, validateReport, type ReportPorts, type ReportStep } from './report-flow.ts';

const goodInput = { kind: 'domain', value: 'Claim-Airdrop.xyz', category: 'drainer' } as const;

function reportPorts(over: Partial<ReportPorts> = {}) {
  const calls: string[] = [];
  const ports: ReportPorts = {
    newReportId: () => (calls.push('id'), 'a'.repeat(32)),
    switchChain: async (w) => void calls.push(`chain:${w}`),
    deposit: async (id) => (calls.push(`deposit:${id}`), { hash: '0xdep' }),
    post: async (i) => (calls.push(`post:${i.reportId}:${i.value}`), { entityKey: '0xkey', expiresAt: 'soon' }),
    ...over,
  };
  return { ports, calls };
}

test('validation catches bad targets before the wallet is touched', async () => {
  const { ports, calls } = reportPorts();
  assert.ok(validateReport({ ...goodInput, value: 'not a domain' }));
  assert.ok(validateReport({ ...goodInput, kind: 'address', value: '0x123' }));
  assert.equal(validateReport(goodInput), null);
  await assert.rejects(runReportFlow(ports, { ...goodInput, value: '' }), (e) => e instanceof FlowError && e.step === 'validate' && !e.depositLocked);
  assert.deepEqual(calls, [], 'no id, no chain switch, no transaction');
});

test('HAPPY PATH: the deposit is made first, on the escrow chain, then the report on Arkiv, with the same id', async () => {
  const { ports, calls } = reportPorts();
  const steps: ReportStep[] = [];
  const r = await runReportFlow(ports, goodInput, (s) => steps.push(s));
  assert.deepEqual(calls, ['id', 'chain:escrow', `deposit:${'a'.repeat(32)}`, 'chain:arkiv', `post:${'a'.repeat(32)}:Claim-Airdrop.xyz`]);
  assert.deepEqual(steps, ['validate', 'deposit', 'post', 'done']);
  assert.deepEqual(r, { reportId: 'a'.repeat(32), depositTx: '0xdep', entityKey: '0xkey', expiresAt: 'soon' });
});

test('declining the deposit in the wallet stops everything: no report is posted', async () => {
  const { ports, calls } = reportPorts({ deposit: async () => { throw new Error('User rejected the request'); } });
  await assert.rejects(runReportFlow(ports, goodInput), (e) => e instanceof FlowError && e.step === 'deposit' && !e.depositLocked && /rejected/.test(e.message));
  assert.ok(!calls.some((c) => c.startsWith('post')));
});

test('declining the network switch is a deposit-step failure with nothing locked', async () => {
  const { ports } = reportPorts({ switchChain: async () => { throw new Error('switch refused'); } });
  await assert.rejects(runReportFlow(ports, goodInput), (e) => e instanceof FlowError && e.step === 'deposit' && !e.depositLocked);
});

test('if posting fails the deposit is reported as locked, and a retry reuses the id and does NOT deposit again', async () => {
  let fail = true;
  const { ports, calls } = reportPorts({ post: async (i) => { if (fail) throw new Error('arkiv down'); return { entityKey: `0x${i.reportId.slice(0, 4)}`, expiresAt: 'x' }; } });
  let err: FlowError | undefined;
  try { await runReportFlow(ports, goodInput); } catch (e) { err = e as FlowError; }
  assert.ok(err);
  assert.equal(err.step, 'post');
  assert.equal(err.depositLocked, true);
  assert.equal(err.depositTx, '0xdep');

  fail = false;
  const r = await runReportFlow(ports, goodInput, undefined, { reportId: err.reportId!, depositTx: err.depositTx! });
  assert.equal(r.reportId, 'a'.repeat(32));
  assert.equal(calls.filter((c) => c.startsWith('deposit')).length, 1, 'only one deposit in total');
});

/* ------------------------------ disputing ------------------------------ */

import { privateKeyToAccount } from 'viem/accounts';
import { verifyOwnerProof, targetHash as th } from '@lookout/core';
import { DisputeError, runDispute, whyNotDispute, type DisputePorts, type DisputeStep } from './dispute-flow.ts';

const ownerAcct = privateKeyToAccount(('0x' + '77'.repeat(32)) as `0x${string}`);
const OWN = ownerAcct.address.toLowerCase();

function disputePorts(connected: string | null, over: Partial<DisputePorts> = {}) {
  const calls: string[] = [];
  let posted: { target: string; signature: string } | undefined;
  const ports: DisputePorts = {
    connected: () => connected,
    sign: async (m) => (calls.push('sign'), ownerAcct.signMessage({ message: m })),
    switchChain: async () => void calls.push('chain'),
    post: async (i) => (calls.push('post'), (posted = i), { entityKey: '0xe' }),
    ...over,
  };
  return { ports, calls, posted: () => posted };
}

test('the dispute button is only offered to the owner of an ordinary wallet address', () => {
  assert.equal(whyNotDispute(OWN, OWN), null);
  assert.match(whyNotDispute(OWN, null)!, /Connect the wallet/);
  assert.match(whyNotDispute(OWN, '0x' + '99'.repeat(20))!, /Only the owner/);
  assert.match(whyNotDispute('evil-site.example', OWN)!, /Only a wallet address/);
});

test('DISPUTE: the owner signs, the signature is the proof the panel will accept, and it is posted to Arkiv', async () => {
  const d = disputePorts(OWN);
  const steps: DisputeStep[] = [];
  const r = await runDispute(d.ports, OWN, (s) => steps.push(s));
  assert.deepEqual(d.calls, ['sign', 'chain', 'post']);
  assert.deepEqual(steps, ['validate', 'sign', 'post', 'done']);
  // the very signature that was posted verifies as an owner proof for this target, written by this wallet
  const proof = verifyOwnerProof({ targetHash: th('address', OWN), creator: OWN }, d.posted()!.signature);
  assert.deepEqual(proof, { ok: true, address: OWN });
  assert.equal(r.entityKey, '0xe');
});

test('nothing is signed or sent for the wrong wallet, no wallet, or a non-address target', async () => {
  for (const [connected, target, code] of [['0x' + '99'.repeat(20), OWN, 'wrong-wallet'], [null, OWN, 'no-wallet'], [OWN, 'evil-site.example', 'not-an-address']] as const) {
    const d = disputePorts(connected);
    await assert.rejects(runDispute(d.ports, target), (e) => e instanceof DisputeError && e.code === code, code);
    assert.deepEqual(d.calls, []);
  }
});

test('declining the signature stops everything, and a failed post says so', async () => {
  const declined = disputePorts(OWN, { sign: async () => { throw new Error('User rejected the request'); } });
  await assert.rejects(runDispute(declined.ports, OWN), (e) => e instanceof DisputeError && e.code === 'declined' && /rejected/.test(e.message));
  assert.deepEqual(declined.calls, []);
  const failed = disputePorts(OWN, { post: async () => { throw new Error('arkiv down'); } });
  await assert.rejects(runDispute(failed.ports, OWN), (e) => e instanceof DisputeError && e.code === 'post-failed');
});
