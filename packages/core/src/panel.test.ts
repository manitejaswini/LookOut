import test from 'node:test';
import assert from 'node:assert/strict';
import { drawJurors, eligible, PanelError, reportResult, tally, type Candidate, type Reveal } from './panel.ts';
import { commitVote, type VoteOutcome } from './vote.ts';

const CASE = '00112233445566ff';
const SEED = '0x' + 'ab'.repeat(32);
const SALT = 'c0'.repeat(16);
const ONE = 10n ** 18n;
const wallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
const cand = (i: number, over: Partial<Candidate> = {}): Candidate => ({ wallet: wallet(i), rep: 10, stakeWei: ONE, nullifier: `n${i}`, ...over });
const pool = (n: number) => Array.from({ length: n }, (_, i) => cand(i));
const base = { caseId: CASE, seed: SEED, size: 5, minStakeWei: ONE };

test('the draw is deterministic: same inputs, same jurors, in any candidate order', () => {
  const a = drawJurors({ ...base, candidates: pool(40) });
  const b = drawJurors({ ...base, candidates: [...pool(40)].reverse() });
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.equal(new Set(a).size, 5);
});

test('a different seed or case gives a different panel', () => {
  const a = drawJurors({ ...base, candidates: pool(40) });
  assert.notDeepEqual(a, drawJurors({ ...base, seed: '0x' + 'cd'.repeat(32), candidates: pool(40) }));
  assert.notDeepEqual(a, drawJurors({ ...base, caseId: '00112233445566aa', candidates: pool(40) }));
});

test('reporter and disputer are never drawn, and neither is anyone sharing their World ID seat', () => {
  const candidates = [...pool(30), cand(100, { nullifier: 'n0' })]; // a second wallet for the same human as wallet 0
  const exclude = [wallet(0), wallet(1)];
  for (let i = 0; i < 20; i++) {
    const jurors = drawJurors({ ...base, caseId: i.toString(16).padStart(16, '0'), candidates, exclude });
    for (const x of [wallet(0), wallet(1), wallet(100)]) assert.ok(!jurors.includes(x));
  }
});

test('one human, one seat: two wallets with the same nullifier count once', () => {
  const candidates = [cand(0), cand(1, { nullifier: 'n0' }), cand(2)];
  assert.equal(eligible({ ...base, size: 1, candidates }).length, 2);
});

test('too little stake or too little reputation is not eligible', () => {
  const candidates = [cand(0, { stakeWei: ONE - 1n }), cand(1, { rep: 1 }), cand(2)];
  assert.deepEqual(eligible({ ...base, minRep: 5, candidates }).map((c) => c.wallet), [wallet(2)]);
});

test('too few eligible reviewers is an error, never a smaller or weaker panel', () => {
  assert.throws(() => drawJurors({ ...base, candidates: pool(4) }), (e) => e instanceof PanelError && e.code === 'TooFewEligible');
});

test('bad input is refused: even panel, bad seed, bad case id', () => {
  for (const bad of [{ size: 4 }, { size: 0 }, { seed: '0x12' }, { caseId: 'nope' }]) {
    assert.throws(() => drawJurors({ ...base, candidates: pool(10), ...bad }), (e) => e instanceof PanelError && e.code === 'BadInput');
  }
});

test('draw is not biased toward low or high addresses', () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    for (const j of drawJurors({ ...base, caseId: i.toString(16).padStart(16, '0'), size: 3, candidates: pool(10) })) counts.set(j, (counts.get(j) ?? 0) + 1);
  }
  // expected 120 each; allow a wide margin so this never flakes (the draw is deterministic anyway)
  for (const c of counts.values()) assert.ok(c > 70 && c < 170, `count ${c}`);
  assert.equal(counts.size, 10);
});

/* --------------------------------- tally --------------------------------- */

const jurors = [0, 1, 2, 3, 4].map(wallet);
function round(votes: (VoteOutcome | null)[], over: { badReveal?: number } = {}) {
  const commits = new Map<string, string>();
  const reveals = new Map<string, Reveal>();
  votes.forEach((v, i) => {
    if (v === null) return;
    commits.set(jurors[i], commitVote({ caseId: CASE, outcome: v, salt: SALT, juror: jurors[i] }));
    // a juror who tries to change their vote after the commit round
    const shown: VoteOutcome = over.badReveal === i ? (v === 'block' ? 'clear' : 'block') : v;
    reveals.set(jurors[i], { outcome: shown, salt: SALT });
  });
  return { caseId: CASE, jurors, commits, reveals, quorum: 3 };
}

test('majority wins, the others lose', () => {
  const t = tally(round(['block', 'block', 'block', 'clear', 'clear']));
  assert.equal(t.status, 'ruled');
  assert.equal(t.outcome, 'block');
  assert.deepEqual(t.counts, { block: 3, clear: 2 });
  assert.deepEqual(t.winners, jurors.slice(0, 3));
  assert.deepEqual(t.losers, jurors.slice(3));
  assert.equal(reportResult(t), 'confirmed');
});

test('a clear ruling rejects the report', () => {
  assert.equal(reportResult(tally(round(['clear', 'clear', 'clear', 'block', 'block']))), 'rejected');
});

test('a juror who does not reveal counts as losing, and is named', () => {
  const t = tally(round(['block', 'block', 'block', null, 'clear']));
  assert.deepEqual(t.nonReveal, [jurors[3]]);
  assert.deepEqual(t.counts, { block: 3, clear: 1 });
  assert.equal(t.outcome, 'block');
});

test('a reveal that does not match the commitment is thrown out, so changing your vote gains nothing', () => {
  const t = tally(round(['block', 'block', 'clear', 'clear', 'clear'], { badReveal: 2 }));
  assert.deepEqual(t.nonReveal, [jurors[2]], 'the changed vote is not counted');
  assert.deepEqual(t.counts, { block: 2, clear: 2 });
  assert.equal(t.status, 'inconclusive');
  assert.equal(t.reason, 'tie');
});

test('a commitment cannot be copied from another juror, or replayed from another case', () => {
  const r = round(['block', 'block', 'block', 'clear', 'clear']);
  // juror 4 copies juror 0's commitment and reveal
  r.commits.set(jurors[4], r.commits.get(jurors[0])!);
  r.reveals.set(jurors[4], r.reveals.get(jurors[0])!);
  const t = tally(r);
  assert.ok(t.nonReveal.includes(jurors[4]));
  assert.equal(tally({ ...round(['block', 'block', 'block', 'block', 'block']), caseId: '0000000000000001' }).nonReveal.length, 5);
});

test('reveals from people who are not jurors are ignored', () => {
  const r = round(['block', 'block', 'block', 'clear', 'clear']);
  const outsider = wallet(99);
  r.commits.set(outsider, commitVote({ caseId: CASE, outcome: 'clear', salt: SALT, juror: outsider }));
  r.reveals.set(outsider, { outcome: 'clear', salt: SALT });
  assert.deepEqual(tally(r).counts, { block: 3, clear: 2 });
});

test('below quorum is inconclusive and settles nothing', () => {
  const t = tally(round(['block', 'block', null, null, null]));
  assert.equal(t.status, 'inconclusive');
  assert.equal(t.reason, 'below-quorum');
  assert.equal(t.outcome, null);
  assert.equal(reportResult(t), null);
  assert.deepEqual(t.winners, []);
});

test('a tie is inconclusive', () => {
  const t = tally(round(['block', 'block', 'clear', 'clear', null]));
  assert.equal(t.reason, 'tie');
});

test('a juror listed twice counts once', () => {
  const r = round(['block', 'block', 'block', 'clear', 'clear']);
  assert.deepEqual(tally({ ...r, jurors: [...jurors, jurors[0]] }).counts, { block: 3, clear: 2 });
});
