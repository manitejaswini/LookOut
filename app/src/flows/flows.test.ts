import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowError, runReportFlow, validateReport, type ReportPorts, type ReportStep } from './report-flow.ts';
import { commit, reveal, savedVote, VoteError, type VotePorts } from './vote-flow.ts';
import { commitVote } from '@lookout/core';

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

/* ------------------------------ voting ------------------------------ */

const J = '0x' + 'ab'.repeat(20);
const CASE = '00112233445566ff';

function votePorts(over: Partial<VotePorts> = {}) {
  const mem = new Map<string, string>();
  const sent: unknown[] = [];
  const revealed: unknown[] = [];
  const ports: VotePorts = {
    storage: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
    createVote: async (i) => (sent.push(i), { entityKey: '0x' + '9'.repeat(64) }),
    revealVote: async (i) => void revealed.push(i),
    ...over,
  };
  return { ports, sent, revealed };
}

test('COMMIT: only the commitment is sent, the salt and vote stay on the device', async () => {
  const { ports, sent } = votePorts();
  const s = await commit(ports, { caseId: CASE, juror: J, outcome: 'block' });
  assert.deepEqual(sent, [{ caseId: CASE, commitHash: s.commitHash }]);
  assert.equal(s.commitHash, commitVote({ caseId: CASE, outcome: 'block', salt: s.salt, juror: J }));
  assert.ok(!JSON.stringify(sent).includes(s.salt));
  assert.equal(savedVote(ports.storage, CASE, J)?.entityKey, '0x' + '9'.repeat(64));
});

test('the salt is saved BEFORE the commitment is sent, so a failed send cannot lose it', async () => {
  const { ports } = votePorts({ createVote: async () => { throw new Error('network'); } });
  await assert.rejects(commit(ports, { caseId: CASE, juror: J, outcome: 'clear' }), /network/);
  const kept = savedVote(ports.storage, CASE, J);
  assert.ok(kept?.salt, 'salt survived');
  assert.equal(kept?.entityKey, undefined);
});

test('retrying an unsent commit reuses the same salt, and a different vote is refused', async () => {
  let fail = true;
  const { ports } = votePorts({ createVote: async () => { if (fail) throw new Error('network'); return { entityKey: '0x' + '1'.repeat(64) }; } });
  await assert.rejects(commit(ports, { caseId: CASE, juror: J, outcome: 'clear' }));
  const salt = savedVote(ports.storage, CASE, J)!.salt;
  await assert.rejects(commit(ports, { caseId: CASE, juror: J, outcome: 'block' }), (e) => e instanceof VoteError && e.code === 'already-committed');
  fail = false;
  const s = await commit(ports, { caseId: CASE, juror: J, outcome: 'clear' });
  assert.equal(s.salt, salt);
});

test('you cannot vote twice in one case, so a saved salt is never overwritten', async () => {
  const { ports } = votePorts();
  await commit(ports, { caseId: CASE, juror: J, outcome: 'block' });
  await assert.rejects(commit(ports, { caseId: CASE, juror: J, outcome: 'clear' }), (e) => e instanceof VoteError && e.code === 'already-committed');
});

test('REVEAL: sends the saved vote and salt for the saved entity, once', async () => {
  const { ports, revealed } = votePorts();
  const s = await commit(ports, { caseId: CASE, juror: J, outcome: 'block' });
  await reveal(ports, { caseId: CASE, juror: J });
  assert.deepEqual(revealed, [{ entityKey: s.entityKey, caseId: CASE, juror: J, outcome: 'block', salt: s.salt, commitHash: s.commitHash }]);
  await assert.rejects(reveal(ports, { caseId: CASE, juror: J }), (e) => e instanceof VoteError && e.code === 'already-revealed');
});

test('reveal on a device with nothing saved, or for an unsent commitment, says why', async () => {
  const a = votePorts();
  await assert.rejects(reveal(a.ports, { caseId: CASE, juror: J }), (e) => e instanceof VoteError && e.code === 'nothing-saved');
  const b = votePorts({ createVote: async () => { throw new Error('x'); } });
  await assert.rejects(commit(b.ports, { caseId: CASE, juror: J, outcome: 'block' }));
  await assert.rejects(reveal(b.ports, { caseId: CASE, juror: J }), (e) => e instanceof VoteError && e.code === 'not-published');
});

test('a tampered saved vote is caught before anything is revealed', async () => {
  const { ports, revealed } = votePorts();
  await commit(ports, { caseId: CASE, juror: J, outcome: 'block' });
  const key = `lookout.vote.v0:${CASE}:${J}`;
  const saved = JSON.parse(ports.storage.get(key)!);
  saved.outcome = 'clear';
  ports.storage.set(key, JSON.stringify(saved));
  await assert.rejects(reveal(ports, { caseId: CASE, juror: J }), (e) => e instanceof VoteError && e.code === 'mismatch');
  assert.equal(revealed.length, 0);
});

test('bad input is refused before anything is saved or sent', async () => {
  const { ports, sent } = votePorts();
  await assert.rejects(commit(ports, { caseId: 'nope', juror: J, outcome: 'block' }), (e) => e instanceof VoteError && e.code === 'bad-input');
  await assert.rejects(commit(ports, { caseId: CASE, juror: J, outcome: 'maybe' as never }), (e) => e instanceof VoteError && e.code === 'bad-input');
  assert.equal(sent.length, 0);
  assert.equal(savedVote(ports.storage, CASE, J), null);
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
