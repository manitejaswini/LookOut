// The operator's decisions applied to the REAL compiled escrow on a local EVM (anvil). Arkiv is replaced by a recorder.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import { CONFIG, type Corroboration } from '@lookout/core';
import { createEscrow, deployEscrow, type Escrow } from '@lookout/escrow';
import { anvilAvailable, startLocalChain, type LocalChain } from '../../../packages/escrow/src/anvil.ts';
import { memoryJournal } from './journal.ts';
import { allStatuses, resolveAll, type ResolverDeps } from './resolver.ts';
import { applyResolution, rejectReport, ruleOnTarget, type ReportToResolve } from './settle.ts';

const skip = anvilAvailable() ? false : 'anvil (Foundry) is not installed';
const DEPOSIT = parseEther('0.01');
const BOUNTY = parseEther('0.005');
const DAY = 86_400;
const T0 = 1_000_000;

let chain: LocalChain;
let address: `0x${string}`;
const acct = (i: number) => chain.accounts[i];
const as = (i: number, at: `0x${string}` = address): Escrow => createEscrow({ address: at, publicClient: chain.publicClient, walletClient: acct(i).wallet });
const rid = (n: number) => n.toString(16).padStart(32, '0');
const deploy = async () => (await deployEscrow({ publicClient: chain.publicClient, walletClient: acct(0).wallet, resolver: acct(0).address, depositWei: DEPOSIT, bountyWei: BOUNTY, resolveWindow: 30n * BigInt(DAY) })).address;

before(async () => {
  if (skip) return;
  chain = await startLocalChain();
  address = await deploy();
  await as(0).fundPool(parseEther('1')); // the pool pays bounties
});
after(async () => { if (!skip) await chain.stop(); });

function recorder() {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    writer: {
      async createEntity(_s: unknown, values: Record<string, unknown>) { created.push(values); return { entityKey: `0x${created.length.toString(16).padStart(64, '0')}`, txHash: '0x0', expiresAt: 0 }; },
      async extendEntity() { return { expiresAt: 0 }; },
    },
  };
}

const deps = (rec: ReturnType<typeof recorder>, humans: string[] = [], journal = memoryJournal(), escrow: Escrow = as(0)) => ({
  arkiv: rec.writer, escrow, journal, now: () => T0 + 100, humans: () => new Set(humans.map((h) => h.toLowerCase())),
});

function report(n: number): ReportToResolve {
  return { key: `0x${n.toString(16).padStart(64, '0')}`, reportId: rid(n), reporter: acct(1).address.toLowerCase(), createdAt: T0, targetHash: '0x' + 'ab'.repeat(32), kind: 'domain', value: `evil-${n}.example` };
}
const lock = (n: number, escrow: Escrow = as(1)) => escrow.lockDeposit(rid(n));

test('CONFIRM a verified human: the deposit AND a bounty are credited to the reporter, in one step, and reputation goes up', { skip }, async () => {
  const r = report(1);
  await lock(1);
  const poolBefore = await as(0).bountyPool();
  const out = await applyResolution(deps(recorder(), [r.reporter]), r, { action: 'confirm', evidence: [] });
  assert.equal(out.action, 'confirm');
  assert.equal(out.bounty, 'paid');
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'returned');
  assert.equal(await as(0).claimable(r.reporter), DEPOSIT + BOUNTY);
  assert.equal(await as(0).bountyPool(), poolBefore - BOUNTY, 'the pool paid it');
  assert.deepEqual(out.repEvents.map((e) => e.kind), ['report_confirmed']);
  const t = await as(0).totals();
  assert.equal(await as(0).balance(), t.locked + t.claimable + t.pool, 'the escrow still balances to the wei');
  // and the reporter takes it all out with one claim, to the wallet that filed the report
  const before = await chain.publicClient.getBalance({ address: acct(1).address });
  await as(1).claim();
  assert.ok((await chain.publicClient.getBalance({ address: acct(1).address }) - before) > DEPOSIT + BOUNTY - parseEther('0.001'));
});

test('CONFIRM a wallet that is NOT a verified human: the deposit and reputation, but no bounty, so fresh wallets cannot farm rewards', { skip }, async () => {
  const r = report(2);
  await lock(2);
  const poolBefore = await as(0).bountyPool();
  const out = await applyResolution(deps(recorder(), []), r, { action: 'confirm', evidence: [] });
  assert.equal(out.bounty, 'not-a-verified-human');
  assert.equal(await as(0).claimable(r.reporter), DEPOSIT);
  assert.equal(await as(0).bountyPool(), poolBefore, 'the pool paid nothing');
  assert.equal(out.repEvents.length, 1);
  await as(1).claim();
  // the rule can be switched off, and then the same report is paid
  const r2 = report(3);
  await lock(3);
  const out2 = await applyResolution({ ...deps(recorder(), []), bountyRequiresHuman: false }, r2, { action: 'confirm', evidence: [] });
  assert.equal(out2.bounty, 'paid');
  assert.equal(CONFIG.BOUNTY_REQUIRES_HUMAN, true, 'and the shipped default requires a human');
  await as(1).claim();
});

test('CONFIRM with an empty pool: the deposit still comes back, and the outcome says the bounty could not be paid', { skip }, async () => {
  const empty = await deploy(); // a fresh escrow whose pool holds nothing
  const r = report(4);
  await lock(4, as(1, empty));
  const out = await applyResolution(deps(recorder(), [r.reporter], memoryJournal(), as(0, empty)), r, { action: 'confirm', evidence: [] });
  assert.equal(out.bounty, 'pool-empty');
  assert.equal(await as(0, empty).claimable(r.reporter), DEPOSIT, 'the reporter is never left without their deposit');
  assert.equal(await as(0, empty).bountyPool(), 0n);
});

test('REFUND: the deposit goes back with no bounty and NO reputation change', { skip }, async () => {
  const r = report(5);
  await lock(5);
  const poolBefore = await as(0).bountyPool();
  const out = await applyResolution(deps(recorder(), [r.reporter]), r, { action: 'refund', reason: 'not-corroborated' });
  assert.equal(out.bounty, 'none');
  assert.deepEqual(out.repEvents, []);
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'refunded');
  assert.equal(await as(0).claimable(r.reporter), DEPOSIT);
  assert.equal(await as(0).bountyPool(), poolBefore);
  await as(1).claim();
});

test('WAIT does nothing at all', { skip }, async () => {
  const r = report(6);
  await lock(6);
  const out = await applyResolution(deps(recorder(), []), r, { action: 'wait', until: T0 + DAY });
  assert.deepEqual(out, { action: 'wait', bounty: 'none', did: [], repEvents: [] });
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'locked');
});

test('RETRY and CRASH RECOVERY: running again changes nothing and never pays a second bounty, even with the journal lost', { skip }, async () => {
  const r = report(7);
  await lock(7);
  const journal = memoryJournal();
  const first = await applyResolution(deps(recorder(), [r.reporter], journal), r, { action: 'confirm', evidence: [] });
  assert.equal(first.bounty, 'paid');
  const second = await applyResolution(deps(recorder(), [r.reporter], journal), r, { action: 'confirm', evidence: [] });
  assert.deepEqual(second.did, []);
  assert.equal(second.bounty, 'paid', 'the first run\'s outcome is what is reported');
  const owed = await as(0).claimable(r.reporter);
  const lost = await applyResolution(deps(recorder(), [r.reporter], memoryJournal()), r, { action: 'confirm', evidence: [] });
  assert.equal(lost.bounty, 'already-settled');
  assert.equal(await as(0).claimable(r.reporter), owed, 'the contract credited nothing more');
  await as(1).claim();
});

test('REJECT is the only way a deposit is forfeited, and it goes to the pool, never to the operator', { skip }, async () => {
  const r = report(8);
  await lock(8);
  const poolBefore = await as(0).bountyPool();
  const opBalance = await chain.publicClient.getBalance({ address: acct(0).address });
  const out = await rejectReport({ escrow: as(0), journal: memoryJournal(), now: () => T0 }, r);
  assert.equal(out.action, 'reject');
  assert.deepEqual(out.repEvents.map((e) => e.kind), ['report_rejected']);
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'slashed');
  assert.equal(await as(0).bountyPool(), poolBefore + DEPOSIT);
  assert.ok((await chain.publicClient.getBalance({ address: acct(0).address })) <= opBalance, 'the operator gained nothing (it only paid gas)');
  await rejectReport({ escrow: as(0), journal: memoryJournal(), now: () => T0 }, r);
  assert.equal(await as(0).bountyPool(), poolBefore + DEPOSIT, 'a second reject moved no money');
});

test('RULING needs a reason, publishes it, and carries a stable case id', { skip }, async () => {
  const rec = recorder();
  const input = { kind: 'address' as const, value: acct(3).address, outcome: 'clear' as const, reason: 'the owner proved control and the flag came from a single report', triggerKey: '0x' + '0d'.repeat(32), targetHash: '0x' + 'cd'.repeat(32) };
  await assert.rejects(ruleOnTarget({ arkiv: rec.writer, now: () => T0 }, { ...input, reason: '  ' }), /needs a reason/);
  assert.equal(rec.created.length, 0);
  const out = await ruleOnTarget({ arkiv: rec.writer, now: () => T0 }, input);
  assert.match(out.caseId, /^[0-9a-f]{16}$/);
  assert.equal(rec.created[0].outcome, 'clear');
  const payload = JSON.parse(new TextDecoder().decode(rec.created[0].payload as Uint8Array));
  assert.equal(payload.by, 'operator');
  assert.match(payload.reason, /owner proved control/);
});

/* --------------------------- the whole pass: evidence decides --------------------------- */

const FEED = '0x' + 'f1'.repeat(20);
const signal = (over: Partial<Corroboration> = {}): Corroboration => ({ sourceType: 'feed', sourceId: 'openfeed', level: 'block', createdAt: T0 + 3600, creator: FEED, entityKey: '0x' + '01'.repeat(32), ...over });

function resolver(rec: ReturnType<typeof recorder>, signals: () => Corroboration[], humans: string[], now: () => number, journal = memoryJournal()): ResolverDeps {
  return { ...deps(rec, humans, journal), now, evidence: { signalsFor: async () => signals() }, windowSeconds: 7 * DAY };
}

test('PASS: a report waits, then a trusted source corroborates it and it is confirmed with a bounty', { skip }, async () => {
  const r = report(20);
  await lock(20);
  let flagged = false;
  let now = T0 + 60;
  const journal = memoryJournal();
  const d = resolver(recorder(), () => (flagged ? [signal()] : []), [r.reporter], () => now, journal);

  const first = await resolveAll(d, [r]);
  assert.equal(first.statuses[0].state, 'waiting');
  assert.equal(first.statuses[0].decideBy, T0 + 7 * DAY);
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'locked');

  flagged = true;
  now = T0 + 7200;
  const second = await resolveAll(d, [r]);
  assert.equal(second.statuses[0].state, 'confirmed');
  assert.equal(second.statuses[0].bounty, 'paid');
  assert.deepEqual(second.statuses[0].evidence, [{ sourceId: 'openfeed', sourceType: 'feed' }]);
  assert.equal(second.repEvents.length, 1);
  assert.equal((await as(0).deposit(r.reporter, r.reportId)).status, 'returned');
  assert.equal(allStatuses(journal).find((s) => s.reportId === r.reportId)?.state, 'confirmed', 'the outcome is kept for the API');
  await as(1).claim();
});

test('PASS: copying a target a source ALREADY flagged only gets the deposit back, and a late window refunds with nothing forfeited', { skip }, async () => {
  const copy = report(21);
  await lock(21);
  const early = await resolveAll(resolver(recorder(), () => [signal({ createdAt: T0 - 500 })], [copy.reporter], () => T0 + 10), [copy]);
  assert.equal(early.statuses[0].state, 'refunded');
  assert.equal(early.statuses[0].reason, 'already-flagged');
  assert.equal(early.statuses[0].bounty, 'none');
  assert.equal((await as(0).deposit(copy.reporter, copy.reportId)).status, 'refunded');

  const lonely = report(22);
  await lock(22);
  const out = await resolveAll(resolver(recorder(), () => [], [], () => T0 + 8 * DAY), [lonely]);
  assert.equal(out.statuses[0].state, 'refunded');
  assert.equal(out.statuses[0].reason, 'not-corroborated');
  assert.equal((await as(0).deposit(lonely.reporter, lonely.reportId)).status, 'refunded', 'refunded, never forfeited');
  await as(1).claim();
});

test('PASS: a source cannot confirm its own report, and one broken report does not stop the others', { skip }, async () => {
  const own = report(23);
  const fine = report(24);
  await lock(23);
  await lock(24);
  let calls = 0;
  const d = resolver(recorder(), () => [], [], () => T0 + 60);
  d.evidence = { signalsFor: async (h) => { if (calls++ === 0) throw new Error('arkiv down'); void h; return [signal({ creator: own.reporter })]; } };
  const out = await resolveAll(d, [own, fine]);
  assert.equal(out.errors.length, 1);
  assert.equal(out.statuses.length, 1, 'the second report was still handled');
  assert.equal(out.statuses[0].state, 'waiting', "a signal written by the reporter's own wallet does not count");
});
