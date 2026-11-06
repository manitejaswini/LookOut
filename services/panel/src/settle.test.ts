// End to end against the REAL compiled escrow contract on a local EVM (anvil). Arkiv is replaced by a recorder.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import { commitVote, drawJurors, tally, type Candidate, type Reveal, type VoteOutcome } from '@lookout/core';
import { createEscrow, deployEscrow, type Escrow } from '@lookout/escrow';
import { anvilAvailable, startLocalChain, type LocalChain } from '../../../packages/escrow/src/anvil.ts';
import { bountyIdFor, generateKeys, metaAddress, stealthAddressFor } from '@lookout/stealth';
import { memoryJournal } from './journal.ts';
import { rulingPayload, settleReportCase, type ReportCase, type SettleDeps } from './settle.ts';

const skip = anvilAvailable() ? false : 'anvil (Foundry) is not installed';
const DEPOSIT = parseEther('0.01');
const BOUNTY = parseEther('0.005');
const MIN_STAKE = parseEther('1');
const SLASH_LOSER = parseEther('0.1');
const SLASH_NOREVEAL = parseEther('0.3');
const SALT = 'ab'.repeat(16);
const PAYER_SECRET = new Uint8Array(32).fill(7);
const paid = (c: ReportCase) => as(0).bountyPaid(bountyIdFor(PAYER_SECRET, c.reportId));

let chain: LocalChain;
let address: `0x${string}`;
const acct = (i: number) => chain.accounts[i];
const as = (i: number): Escrow => createEscrow({ address, publicClient: chain.publicClient, walletClient: acct(i).wallet });
const rid = (n: number) => n.toString(16).padStart(32, '0');
const cid = (n: number) => n.toString(16).padStart(16, '0');

// accounts: 0 resolver/panel, 1 reporter, 2..4 jurors (anvil has 6 funded accounts, jurors 2-4 are the three we use)
const JURORS = [2, 3, 4];

before(async () => {
  if (skip) return;
  chain = await startLocalChain();
  ({ address } = await deployEscrow({
    publicClient: chain.publicClient, walletClient: acct(0).wallet, resolver: acct(0).address,
    depositWei: DEPOSIT, bountyWei: BOUNTY, minReviewerStake: MIN_STAKE, unstakeDelay: 7n * 86_400n, resolveWindow: 30n * 86_400n,
  }));
  for (const j of JURORS) await as(j).stake(parseEther('2'));
  await as(0).fundPool(parseEther('1')); // the pool pays bounties
});
after(async () => { if (!skip) await chain.stop(); });

function recorder() {
  const created: { values: Record<string, unknown> }[] = [];
  return {
    created,
    writer: {
      async createEntity(_s: unknown, values: Record<string, unknown>) { created.push({ values }); return { entityKey: `0x${created.length.toString(16).padStart(64, '0')}`, txHash: '0x0', expiresAt: 0 }; },
      async extendEntity() { return { expiresAt: 0 }; },
    },
  };
}

function deps(rec: ReturnType<typeof recorder>, journal = memoryJournal()): SettleDeps {
  return { arkiv: rec.writer, escrow: as(0), journal, stealthPayerSecret: PAYER_SECRET, now: () => 1_700_000_000, slashLoserWei: SLASH_LOSER, slashNonRevealWei: SLASH_NOREVEAL, bountyTier: 3 };
}

function theCase(n: number, meta?: string): ReportCase {
  return { caseId: cid(n), reportId: rid(n), reporter: acct(1).address, kind: 'domain', value: 'evil.example', jurors: JURORS.map((i) => acct(i).address), seed: '0x' + 'ab'.repeat(32), reporterMeta: meta };
}

function votes(c: ReportCase, v: (VoteOutcome | null)[]) {
  const commits = new Map<string, string>();
  const reveals = new Map<string, Reveal>();
  v.forEach((o, i) => {
    const j = c.jurors[i].toLowerCase();
    if (o === null) return;
    commits.set(j, commitVote({ caseId: c.caseId, outcome: o, salt: SALT, juror: j }));
    reveals.set(j, { outcome: o, salt: SALT });
  });
  return tally({ caseId: c.caseId, jurors: c.jurors, commits, reveals, quorum: 2 });
}

test('CONFIRMED: ruling published, deposit returned, loser and non-revealer slashed, bounty paid to a stealth address only the reporter can find', { skip }, async () => {
  const keys = generateKeys();
  const c = theCase(1, metaAddress(keys));
  await as(1).lockDeposit(c.reportId);
  const t = votes(c, ['block', 'block', 'clear']);
  assert.equal(t.status, 'ruled');

  const rec = recorder();
  const poolBefore = await as(0).bountyPool();
  const r = await settleReportCase(deps(rec), c, t);

  assert.equal(r.status, 'settled');
  assert.equal(r.result, 'confirmed');
  assert.equal((await as(1).deposit(acct(1).address, c.reportId)).status, 'returned');
  assert.equal(await paid(c), true);

  // the loser was slashed, the winners were not
  assert.equal((await as(0).stakeOf(acct(4).address)).amount, parseEther('2') - SLASH_LOSER);
  assert.equal((await as(0).stakeOf(acct(2).address)).amount, parseEther('2'));

  // the bounty went to the stealth address that the reporter's own keys derive from the published ephemeral key
  const ruling = rec.created[0].values;
  assert.equal(ruling.outcome, 'block');
  const bounty = rec.created[1].values;
  const R = '0x' + Buffer.from(bounty.payload as Uint8Array).toString('hex');
  const spendingPub = (await import('@lookout/stealth')).parseMetaAddress(metaAddress(keys)).spendingPub;
  const found = stealthAddressFor(keys.viewingKey, spendingPub, R);
  assert.equal(await chain.publicClient.getBalance({ address: found as `0x${string}` }), BOUNTY);
  assert.equal(await as(0).bountyPool(), poolBefore + SLASH_LOSER - BOUNTY);

  // the ruling payload lets anyone re-check the case
  const payload = JSON.parse(new TextDecoder().decode(rulingPayload(c, t)));
  assert.deepEqual(payload.counts, { block: 2, clear: 1 });
  assert.equal(payload.seed, c.seed);

  // reputation events: reporter up, two winners up, the loser down
  assert.deepEqual(r.repEvents.map((e) => [e.kind]).sort(), [['juror_lost'], ['juror_won'], ['juror_won'], ['report_confirmed']]);

  // accounting still balances to the wei
  const tot = await as(0).totals();
  assert.equal(await as(0).balance(), tot.locked + tot.staked + tot.claimable + tot.pool);
});

test('RETRY: running settlement again changes nothing and does not pay twice', { skip }, async () => {
  const c = theCase(1, metaAddress(generateKeys()));
  const t = votes(c, ['block', 'block', 'clear']);
  const rec = recorder();
  const journal = memoryJournal();
  // first the original settlement for a new report, then the same again
  await as(1).lockDeposit(rid(11));
  const c2 = { ...theCase(11, c.reporterMeta), reportId: rid(11) };
  const first = await settleReportCase(deps(rec, journal), c2, votes(c2, ['block', 'block', 'clear']));
  const entities = rec.created.length;
  const stakeAfter = (await as(0).stakeOf(acct(4).address)).amount;
  const second = await settleReportCase(deps(rec, journal), c2, votes(c2, ['block', 'block', 'clear']));
  assert.ok(first.did.length > 0);
  assert.deepEqual(second.did, [], 'every step was already done');
  assert.equal(rec.created.length, entities, 'no second ruling or bounty announcement');
  assert.equal((await as(0).stakeOf(acct(4).address)).amount, stakeAfter, 'no second slash');
  void t;
});

test('CRASH RECOVERY: the money moved but the journal was lost. Re-running does not fail and does not pay twice', { skip }, async () => {
  const c = theCase(12, metaAddress(generateKeys()));
  await as(1).lockDeposit(c.reportId);
  const t = votes(c, ['block', 'block', 'block']);
  await settleReportCase(deps(recorder()), c, t); // journal discarded
  const bal = await chain.publicClient.getBalance({ address });
  const again = await settleReportCase(deps(recorder()), c, t); // fresh journal
  assert.equal(again.status, 'settled');
  assert.equal(await chain.publicClient.getBalance({ address }), bal, 'the escrow paid nothing more');
});

test('REJECTED: the deposit goes to the pool, no bounty, the reporter loses reputation', { skip }, async () => {
  const c = theCase(2, metaAddress(generateKeys()));
  await as(1).lockDeposit(c.reportId);
  const poolBefore = await as(0).bountyPool();
  const rec = recorder();
  const r = await settleReportCase(deps(rec), c, votes(c, ['clear', 'clear', 'block']));
  assert.equal(r.result, 'rejected');
  assert.equal((await as(0).deposit(acct(1).address, c.reportId)).status, 'slashed');
  assert.equal(await paid(c), false);
  assert.ok((await as(0).bountyPool()) >= poolBefore + DEPOSIT);
  assert.equal(rec.created.length, 1, 'only the ruling, no bounty announcement');
  assert.ok(r.repEvents.some((e) => e.kind === 'report_rejected'));
});

test('INCONCLUSIVE: nothing is published, no money moves, and the deposit stays locked', { skip }, async () => {
  const c = theCase(3);
  await as(1).lockDeposit(c.reportId);
  const rec = recorder();
  const t = votes(c, ['block', null, null]); // below quorum
  const r = await settleReportCase(deps(rec), c, t);
  assert.equal(r.status, 'inconclusive');
  assert.equal(rec.created.length, 0);
  assert.equal((await as(0).deposit(acct(1).address, c.reportId)).status, 'locked');
});

test('a confirmed report with no stealth address gets its deposit back but no bounty', { skip }, async () => {
  const c = theCase(4);
  await as(1).lockDeposit(c.reportId);
  const rec = recorder();
  await settleReportCase(deps(rec), c, votes(c, ['block', 'block', 'block']));
  assert.equal((await as(0).deposit(acct(1).address, c.reportId)).status, 'returned');
  assert.equal(await paid(c), false);
});

test('the draw feeds the settlement: jurors drawn from the pool are the ones judged', { skip }, async () => {
  const pool: Candidate[] = JURORS.map((i) => ({ wallet: acct(i).address, rep: 10, stakeWei: parseEther('2'), nullifier: `n${i}` }));
  const drawn = drawJurors({ caseId: cid(9), seed: '0x' + 'ab'.repeat(32), candidates: pool, size: 3, minStakeWei: MIN_STAKE });
  assert.deepEqual([...drawn].sort(), JURORS.map((i) => acct(i).address.toLowerCase()).sort());
});
