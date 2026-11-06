import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReport, type Corroboration } from './resolution.ts';

const REPORTER = '0x' + 'a1'.repeat(20);
const FEED = '0x' + 'f1'.repeat(20);
const CHECKER = '0x' + 'c1'.repeat(20);
const DAY = 86_400;
const T0 = 1_000_000;
const sig = (over: Partial<Corroboration> = {}): Corroboration => ({
  sourceType: 'feed', sourceId: 'openfeed', level: 'block', createdAt: T0 + 3600, creator: FEED, entityKey: '0x' + '01'.repeat(32), ...over,
});
const run = (signals: Corroboration[], now = T0 + 10, extra: { minSources?: number } = {}) =>
  resolveReport({ report: { createdAt: T0, reporter: REPORTER }, now, signals, windowSeconds: 7 * DAY, ...extra });

test('CONFIRM: a trusted source flags the target after the report, within the window', () => {
  const r = run([sig()]);
  assert.equal(r.action, 'confirm');
  assert.equal((r as { evidence: Corroboration[] }).evidence.length, 1);
});

test('WAIT: nothing yet, and the deadline is reported', () => {
  assert.deepEqual(run([]), { action: 'wait', until: T0 + 7 * DAY });
});

test('REFUND not-corroborated: the window passed with nothing, so the deposit goes back and nothing is forfeited', () => {
  assert.deepEqual(run([], T0 + 7 * DAY), { action: 'refund', reason: 'not-corroborated' });
  assert.deepEqual(run([], T0 + 30 * DAY), { action: 'refund', reason: 'not-corroborated' });
});

test('COPYING: a target a trusted source ALREADY flagged earns no bounty, only the deposit back', () => {
  const early = sig({ createdAt: T0 - 100 });
  assert.deepEqual(run([early]), { action: 'refund', reason: 'already-flagged' });
  // and a later signal does not turn a copy into a discovery
  assert.deepEqual(run([early, sig({ createdAt: T0 + 50, sourceId: 'other' })]), { action: 'refund', reason: 'already-flagged' });
});

test('SELF-CORROBORATION: a source wallet cannot confirm its own report', () => {
  const own = sig({ creator: REPORTER.toUpperCase().replace('0X', '0x') });
  assert.deepEqual(run([own]), { action: 'wait', until: T0 + 7 * DAY });
  assert.deepEqual(run([own], T0 + 8 * DAY), { action: 'refund', reason: 'not-corroborated' });
  // an early signal from the reporter's own wallet does not mark the target "already flagged" either
  assert.equal(run([sig({ creator: REPORTER, createdAt: T0 - 5 })]).action, 'wait');
});

test('a late signal (after the window) is too late: it was already refunded', () => {
  assert.deepEqual(run([sig({ createdAt: T0 + 8 * DAY })], T0 + 9 * DAY), { action: 'refund', reason: 'not-corroborated' });
});

test('a weak (warn) signal does not confirm', () => {
  assert.equal(run([sig({ level: 'warn' })]).action, 'wait');
});

test('the same source writing twice counts once, and two different sources can be required', () => {
  const a = sig();
  const b = sig({ entityKey: '0x' + '02'.repeat(32), createdAt: T0 + 7200 });
  assert.equal(run([a, b], T0 + 10, { minSources: 2 }).action, 'wait', 'two entities from ONE source is one source');
  const c = sig({ sourceType: 'checker', sourceId: 'lookout-checker', creator: CHECKER, entityKey: '0x' + '03'.repeat(32) });
  const r = run([a, b, c], T0 + 10, { minSources: 2 });
  assert.equal(r.action, 'confirm');
  assert.equal((r as { evidence: Corroboration[] }).evidence.length, 2);
});

test('the automatic path can never forfeit: whatever the inputs, the action is only confirm, refund or wait', () => {
  const kinds = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const signals = Array.from({ length: i % 4 }, (_, k) => sig({ createdAt: T0 + ((i * 7919 + k * 104729) % (20 * DAY)) - 3 * DAY, level: k % 2 ? 'warn' : 'block', creator: k % 3 ? FEED : REPORTER, sourceId: `s${k}` }));
    kinds.add(run(signals, T0 + ((i * 31) % (20 * DAY))).action);
  }
  assert.deepEqual([...kinds].sort(), ['confirm', 'refund', 'wait']);
});
