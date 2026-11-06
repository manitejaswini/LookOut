import test from 'node:test';
import assert from 'node:assert/strict';
import { caseIdFor, commitVote, targetHash, type Candidate, type Tally } from '@lookout/core';
import { createDriver, DEFAULT_DRIVER_CONFIG, type CaseRequest, type DriverConfig, type VoteRow } from './driver.ts';
import { memoryJournal } from './journal.ts';
import type { ReportCase, SettleResult } from './settle.ts';

const ONE = 10n ** 18n;
const wallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
const SALT = 'ab'.repeat(16);
const cfg: DriverConfig = { ...DEFAULT_DRIVER_CONFIG, commitSeconds: 100, revealSeconds: 100, panelSize: 3, quorum: 2, minStakeWei: ONE, seedDelayBlocks: 5, maxRounds: 3 };
const TH = targetHash('domain', 'evil.example');
const CASE = caseIdFor(TH, '0x' + '11'.repeat(32));
const req: CaseRequest = { caseId: CASE, reportId: '1'.repeat(32), reporter: wallet(50), kind: 'domain', value: 'evil.example', exclude: [wallet(50)] };

function world(candidates = 10, journal = memoryJournal()) {
  const w = {
    t: 1000, block: 100,
    votes: [] as VoteRow[],
    settled: [] as { c: ReportCase; t: Tally }[],
    settleFails: 0,
    pool: Array.from({ length: candidates }, (_, i): Candidate => ({ wallet: wallet(i), rep: 5, stakeWei: ONE, nullifier: `n${i}` })),
  };
  const make = () => createDriver({
    journal,
    now: () => w.t,
    currentBlock: async () => w.block,
    blockHash: async (b) => (b <= w.block ? '0x' + b.toString(16).padStart(64, '0') : null),
    candidates: async () => w.pool,
    readVotes: async () => w.votes,
    settle: async (c, t) => {
      if (w.settleFails > 0) { w.settleFails--; throw new Error('rpc down'); }
      w.settled.push({ c, t });
      return { status: 'settled', result: t.outcome === 'block' ? 'confirmed' : 'rejected', did: [], repEvents: [] } as SettleResult;
    },
  }, cfg);
  return { w, driver: make(), make };
}

/** every drawn juror commits (and optionally reveals) the given outcome */
const cast = (w: ReturnType<typeof world>['w'], jurors: string[], outcomes: ('block' | 'clear' | null)[], reveal = true, at = 1050) => {
  w.votes = jurors.flatMap((j, i) => {
    const o = outcomes[i];
    if (!o) return [];
    return [{ juror: j, commitHash: commitVote({ caseId: CASE, outcome: o, salt: SALT, juror: j }), createdAt: at, ...(reveal ? { outcome: o, salt: SALT } : {}) } as VoteRow];
  });
};

test('caseId is the first 16 hex digits of a hash of target and trigger, and is stable', () => {
  assert.match(CASE, /^[0-9a-f]{16}$/);
  assert.equal(CASE, caseIdFor(TH.toUpperCase().replace('0X', '0x'), '0x' + '11'.repeat(32)));
  assert.notEqual(CASE, caseIdFor(TH, '0x' + '22'.repeat(32)));
});

test('a case waits for its seed block: the jurors cannot be known when it opens', async () => {
  const { w, driver } = world();
  await driver.open(req);
  assert.equal(driver.get(CASE)!.phase, 'awaiting-seed');
  w.block += 4;
  await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'awaiting-seed', 'block openedBlock+5 does not exist yet');
  w.block += 1;
  await driver.tick();
  const s = driver.get(CASE)!;
  assert.equal(s.phase, 'commit');
  assert.equal(s.jurors!.length, 3);
  assert.equal(s.seed, '0x' + (105).toString(16).padStart(64, '0'));
  assert.ok(!s.jurors!.includes(wallet(50)), 'the reporter is not drawn');
});

test('opening the same case twice changes nothing', async () => {
  const { w, driver } = world();
  const a = await driver.open(req);
  w.block += 50;
  assert.deepEqual(await driver.open(req), a);
  assert.equal(driver.list().length, 1);
});

test('FULL RUN: seed, commit round, reveal round, ruling, settlement', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;

  w.t += 99; await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'commit', 'commit round still open');
  w.t += 1; await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'reveal');

  cast(w, jurors, ['block', 'block', 'clear']);
  w.t += 100; await driver.tick();
  const s = driver.get(CASE)!;
  assert.equal(s.phase, 'settled');
  assert.equal(s.result, 'confirmed');
  assert.equal(w.settled.length, 1);
  assert.deepEqual(w.settled[0].c.jurors, jurors);
  assert.equal(w.settled[0].c.seed, s.seed);
});

test('a commitment made after the commit round closed does not count', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;
  w.t += 100; await driver.tick(); // reveal phase, commitEnd was 1100
  cast(w, jurors, ['block', 'block', 'block'], true, 1101); // all late
  w.t += 100; await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'awaiting-seed', 'nobody counted, so a new round');
  assert.equal(w.settled.length, 0);
});

test('a juror cannot re-commit to change their vote: the earliest commitment is the one that counts', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;
  w.t += 100; await driver.tick();
  cast(w, jurors, ['block', 'block', 'block'], true, 1050);
  // juror 0 later commits and reveals the opposite
  w.votes.push({ juror: jurors[0], commitHash: commitVote({ caseId: CASE, outcome: 'clear', salt: SALT, juror: jurors[0] }), createdAt: 1060, outcome: 'clear', salt: SALT });
  w.t += 100; await driver.tick();
  assert.deepEqual(w.settled[0].t.counts, { block: 3, clear: 0 });
});

test('votes from people who were not drawn are ignored', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;
  w.t += 100; await driver.tick();
  cast(w, jurors, ['block', 'block', null]);
  const outsider = wallet(40);
  w.votes.push({ juror: outsider, commitHash: commitVote({ caseId: CASE, outcome: 'clear', salt: SALT, juror: outsider }), createdAt: 1050, outcome: 'clear', salt: SALT });
  w.t += 100; await driver.tick();
  assert.deepEqual(w.settled[0].t.counts, { block: 2, clear: 0 });
});

test('no quorum starts a new round with a fresh seed, and non-revealers are kept off the next panel', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const first = driver.get(CASE)!.jurors!;
  w.t += 100; await driver.tick();
  cast(w, first, ['block', null, null]); // only one vote: below quorum 2
  w.t += 100; await driver.tick();
  let s = driver.get(CASE)!;
  assert.equal(s.phase, 'awaiting-seed');
  assert.equal(s.round, 2);
  assert.deepEqual([...s.dropped].sort(), [first[1], first[2]].sort());
  w.block += 5; await driver.tick();
  s = driver.get(CASE)!;
  assert.equal(s.phase, 'commit');
  assert.ok(!s.jurors!.includes(first[1]) && !s.jurors!.includes(first[2]));
  assert.notEqual(s.seed, '0x' + (105).toString(16).padStart(64, '0'));
});

test('after the last round with no ruling the case is unresolved and nothing is settled', async () => {
  const { w, driver } = world(30);
  await driver.open(req);
  for (let round = 1; round <= 3; round++) {
    w.block += 5; await driver.tick();
    w.t += 100; await driver.tick();
    w.votes = [];
    w.t += 100; await driver.tick();
  }
  const s = driver.get(CASE)!;
  assert.equal(s.phase, 'unresolved');
  assert.match(s.note!, /reclaims/);
  assert.equal(w.settled.length, 0);
});

test('too few eligible reviewers: the case waits instead of using a smaller panel', async () => {
  const { w, driver } = world(2);
  await driver.open(req);
  w.block += 5; await driver.tick();
  const s = driver.get(CASE)!;
  assert.equal(s.phase, 'awaiting-seed');
  assert.match(s.note!, /need 3 eligible/);
  w.pool.push({ wallet: wallet(7), rep: 5, stakeWei: ONE, nullifier: 'n7' });
  await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'commit');
});

test('if settlement fails the case stays in reveal and is retried, then settles once', async () => {
  const { w, driver } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;
  w.t += 100; await driver.tick();
  cast(w, jurors, ['block', 'block', 'block']);
  w.t += 100;
  w.settleFails = 1;
  const r = await driver.tick();
  assert.match(r[0].error!, /rpc down/);
  assert.equal(driver.get(CASE)!.phase, 'reveal');
  await driver.tick();
  assert.equal(driver.get(CASE)!.phase, 'settled');
  assert.equal(w.settled.length, 1);
});

test('one broken case does not stop the others', async () => {
  const { w, driver } = world();
  await driver.open(req);
  const other = { ...req, caseId: caseIdFor(TH, '0x' + '33'.repeat(32)) };
  await driver.open(other);
  w.block += 5;
  const r = await driver.tick();
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.phase === 'commit'));
});

test('state survives a restart: a new driver on the same journal carries on and settles', async () => {
  const { w, driver, make } = world();
  await driver.open(req);
  w.block += 5; await driver.tick();
  const jurors = driver.get(CASE)!.jurors!;
  const restarted = make(); // same journal, brand new driver
  assert.equal(restarted.get(CASE)!.phase, 'commit');
  assert.deepEqual(restarted.get(CASE)!.jurors, jurors);
  w.t += 100; await restarted.tick();
  cast(w, jurors, ['clear', 'clear', 'block']);
  w.t += 100; await restarted.tick();
  assert.equal(restarted.get(CASE)!.result, 'rejected');
});
