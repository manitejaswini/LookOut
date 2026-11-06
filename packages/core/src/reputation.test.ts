import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from './config.ts';
import { decayFactor, deltaFor, nextCheckpoint, repEventFromSettlement, type Checkpoint, type RepEvent } from './reputation.ts';
import { reportWeight } from './scoring.ts';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const DAY = 86_400;
const ev = (wallet: string, kind: RepEvent['kind'], at: number, ref: string): RepEvent => ({ wallet, kind, at, ref });
const first = (events: RepEvent[], at = 1000) => nextCheckpoint(null, events, at, 'rep-1');
const score = (c: Checkpoint, w: string) => c.scores.get(w) ?? 0;

test('a wallet nobody has heard of has no score, so its report weighs 0', () => {
  const c = first([]);
  assert.equal(c.scores.size, 0);
  assert.equal(reportWeight(score(c, A)), 0);
});

test('a confirmed report earns the fixed gain', () => {
  assert.equal(score(first([ev(A, 'report_confirmed', 500, 'r1')]), A), CONFIG.REP_CONFIRM_GAIN);
});

test('a rejected report costs TWICE what a confirmed one earns', () => {
  assert.equal(deltaFor('report_rejected'), -2 * deltaFor('report_confirmed'));
  const c = first([ev(A, 'report_confirmed', 100, 'r1'), ev(A, 'report_confirmed', 200, 'r2'), ev(A, 'report_rejected', 300, 'r3')]);
  assert.equal(score(c, A), 0, 'two confirmations are wiped by one rejection');
});

test('reputation never goes below zero, and a wallet at zero is dropped', () => {
  const c = first([ev(A, 'report_rejected', 100, 'r1'), ev(B, 'report_confirmed', 100, 'r2')]);
  assert.equal(c.scores.has(A), false);
  assert.equal(score(c, B), CONFIG.REP_CONFIRM_GAIN);
});

test('reputation stops at the maximum, and weight stops at the cap', () => {
  const events = Array.from({ length: 500 }, (_, i) => ev(A, 'report_confirmed', 100 + i, `r${i}`));
  assert.equal(score(first(events, 10_000), A), CONFIG.REP_MAX);
  assert.equal(reportWeight(CONFIG.REP_MAX), 1);
  assert.equal(reportWeight(CONFIG.REP_CAP / 2), 0.5);
});

test('DECAY: an untouched score halves every half-life', () => {
  const half = CONFIG.REP_HALF_LIFE_DAYS * DAY;
  assert.equal(decayFactor(half), 0.5);
  assert.equal(decayFactor(2 * half), 0.25);
  assert.equal(decayFactor(0), 1);
  assert.equal(decayFactor(-5), 1);
  const c1 = first([ev(A, 'report_confirmed', 500, 'r1')], 1000);
  const c2 = nextCheckpoint(c1, [], 1000 + half, 'rep-2');
  assert.equal(score(c2, A), CONFIG.REP_CONFIRM_GAIN / 2);
  assert.equal(score(nextCheckpoint(c2, [], 1000 + 2 * half, 'rep-3'), A), CONFIG.REP_CONFIRM_GAIN / 4);
});

test('a score that is never refreshed fades to nothing and is dropped', () => {
  let c = first([ev(A, 'report_confirmed', 500, 'r1')], 1000);
  for (let i = 1; i <= 40; i++) c = nextCheckpoint(c, [], 1000 + i * 30 * DAY, `rep-${i + 1}`);
  assert.equal(c.scores.has(A), false);
});

test('events outside the window are ignored: an old one is not counted twice, a future one waits', () => {
  const c1 = first([ev(A, 'report_confirmed', 500, 'r1')], 1000);
  const old = ev(A, 'report_confirmed', 500, 'r1');
  const future = ev(A, 'report_confirmed', 5000, 'r9');
  const c2 = nextCheckpoint(c1, [old, future], 2000, 'rep-2');
  assert.ok(Math.abs(score(c2, A) - CONFIG.REP_CONFIRM_GAIN) < 0.01, 'only a sliver of decay changed it');
  const c3 = nextCheckpoint(c2, [future], 6000, 'rep-3');
  assert.ok(score(c3, A) > CONFIG.REP_CONFIRM_GAIN, 'the future event counts in its own window');
});

test('the same event reported twice counts once, whatever the address case', () => {
  const e = ev(A, 'report_confirmed', 500, 'r1');
  const upper = ev('0x' + A.slice(2).toUpperCase(), 'report_confirmed', 500, 'r1');
  assert.equal(score(first([e, { ...e }, upper]), A), CONFIG.REP_CONFIRM_GAIN);
});

test('DETERMINISM: the same events in any order give the same scores', () => {
  const events = [
    ev(A, 'report_confirmed', 100, 'r1'), ev(B, 'report_rejected', 100, 'r2'), ev(B, 'report_confirmed', 150, 'r3'),
    ev(A, 'report_rejected', 200, 'r4'), ev(A, 'report_confirmed', 250, 'r5'),
  ];
  const baseline = [...first(events).scores].sort();
  for (let i = 0; i < 25; i++) {
    const shuffled = [...events].sort(() => Math.random() - 0.5);
    assert.deepEqual([...first(shuffled).scores].sort(), baseline);
  }
});

test('where the zero floor makes order matter, the fixed order (time first) decides', () => {
  assert.equal(score(first([ev(A, 'report_rejected', 100, 'r1'), ev(A, 'report_confirmed', 200, 'r2')]), A), CONFIG.REP_CONFIRM_GAIN);
  assert.equal(score(first([ev(A, 'report_confirmed', 100, 'r1'), ev(A, 'report_rejected', 200, 'r2')]), A), 0);
});

test('a verified human has a floor, a fresh wallet has none, and the floor never exceeds what one report needs to be taken seriously', () => {
  const c = nextCheckpoint(null, [], 1000, 'rep-1', undefined, new Set([A]));
  assert.equal(score(c, A), CONFIG.HUMAN_BASE_REP);
  assert.equal(c.scores.has(B), false);
  assert.ok(reportWeight(CONFIG.HUMAN_BASE_REP) < 0.5, 'one human alone cannot reach the 0.5 block threshold');
});

test('the floor holds through rejections and decay, and good history still rises above it', () => {
  const humans = new Set([A]);
  let c = nextCheckpoint(null, [ev(A, 'report_rejected', 100, 'r1')], 1000, 'rep-1', undefined, humans);
  assert.equal(score(c, A), CONFIG.HUMAN_BASE_REP, 'a rejection cannot push a human below the floor');
  for (let i = 1; i <= 30; i++) c = nextCheckpoint(c, [], 1000 + i * 30 * DAY, `rep-${i + 1}`, undefined, humans);
  assert.equal(score(c, A), CONFIG.HUMAN_BASE_REP, 'decay stops at the floor');
  const T = 1000 + 30 * 30 * DAY; // the time of the last checkpoint above
  const many = Array.from({ length: 12 }, (_, i) => ev(A, 'report_confirmed', T + 1 + i, `c${i}`));
  assert.ok(score(nextCheckpoint(c, many, T + 100, 'rep-x', undefined, humans), A) > CONFIG.HUMAN_BASE_REP);
});

test('losing the human status takes the floor away at the next checkpoint', () => {
  const c1 = nextCheckpoint(null, [], 1000, 'rep-1', undefined, new Set([A]));
  const c2 = nextCheckpoint(c1, [], 1000 + 60 * DAY, 'rep-2');
  assert.ok(score(c2, A) < CONFIG.HUMAN_BASE_REP, 'decaying with no floor');
});

test('a checkpoint cannot go back in time', () => {
  const c = first([ev(A, 'report_confirmed', 100, 'r1')]);
  assert.throws(() => nextCheckpoint(c, [], 500, 'rep-0'), /earlier/);
});

test('settlements map to the reporter events, and a reclaim changes nothing', () => {
  assert.equal(repEventFromSettlement('reclaimed', A, 'r1', 100), null);
  assert.deepEqual(repEventFromSettlement('confirmed', '0x' + A.slice(2).toUpperCase(), 'r1', 100), { wallet: A, kind: 'report_confirmed', at: 100, ref: 'r1' });
  assert.equal(repEventFromSettlement('rejected', A, 'r1', 100)?.kind, 'report_rejected');
});

test('THE ATTACK: a thousand fresh wallets that all get rejected end at exactly zero', () => {
  const wallets = Array.from({ length: 1000 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
  const c = first(wallets.map((w, i) => ev(w, 'report_rejected', 100, `s${i}`)));
  assert.equal(c.scores.size, 0);
});
