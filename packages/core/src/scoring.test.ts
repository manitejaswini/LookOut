import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from './config.ts';
import { emptyTarget, fakeReports, reportWeight, scoreTarget } from './scoring.ts';
import type { Signal, Target } from './types.ts';

const sig = (sourceType: Signal['sourceType'], weight: number, level: Signal['level'] = 'block'): Signal => ({
  entityId: `e-${sourceType}-${weight}`, sourceType, sourceId: 's', level, weight, ageSeconds: 60, note: '',
});
const target = (over: Partial<Target>): Target => ({ ...emptyTarget('t.example'), ...over });

// Each row: what the indexer hands us, and the verdict the PRD says must come out.
const TABLE: { name: string; t: Target; verdict: 'block' | 'warn' | 'unknown'; disputed?: boolean }[] = [
  { name: 'no signals', t: target({}), verdict: 'unknown' },
  { name: 'one strong type', t: target({ signals: [sig('feed', 1)] }), verdict: 'warn' },
  { name: 'many reports of one type stay one type', t: target({ signals: [sig('community', 0.9), sig('community', 0.9), sig('community', 0.9)] }), verdict: 'warn' },
  { name: 'two strong types', t: target({ signals: [sig('feed', 1), sig('checker', 1)] }), verdict: 'block' },
  { name: 'two types, one below threshold', t: target({ signals: [sig('feed', 1), sig('community', CONFIG.THRESHOLD - 0.01)] }), verdict: 'warn' },
  { name: 'two types exactly at threshold', t: target({ signals: [sig('feed', CONFIG.THRESHOLD), sig('checker', CONFIG.THRESHOLD)] }), verdict: 'block' },
  { name: 'only weak reports', t: target({ signals: [sig('community', 0.1), sig('community', 0.05)] }), verdict: 'warn' },
  { name: 're-checkable proof blocks alone', t: target({ proof: 'drainer bytecode' }), verdict: 'block' },
  { name: 'panel ruling block', t: target({ ruling: 'block' }), verdict: 'block' },
  { name: 'panel ruling clear beats strong signals', t: target({ ruling: 'clear', signals: [sig('feed', 1), sig('checker', 1)] }), verdict: 'unknown' },
  { name: 'disputed with no signals is warn, never cleared', t: target({ disputed: true }), verdict: 'warn', disputed: true },
  { name: 'disputed with one weak signal is warn', t: target({ disputed: true, signals: [sig('community', 0)] }), verdict: 'warn', disputed: true },
];

for (const row of TABLE) {
  test(`scoring: ${row.name} -> ${row.verdict}`, () => {
    const r = scoreTarget(row.t);
    assert.equal(r.verdict, row.verdict);
    assert.equal(r.disputed, row.disputed ?? false);
  });
}

test('strongTypes counts distinct source types, not signals', () => {
  const r = scoreTarget(target({ signals: [sig('community', 1), sig('community', 1), sig('feed', 1)] }));
  assert.equal(r.strongTypes, 2);
});

test('reasons are sorted strongest first and capped at six', () => {
  const signals = Array.from({ length: 9 }, (_, i) => sig('community', (i + 1) / 10));
  const r = scoreTarget(target({ signals }));
  assert.equal(r.reasons.length, 6);
  assert.equal(r.reasons[0].entityId, 'e-community-0.9');
});

test('reportWeight: linear, clamped to 0..1, full at the cap', () => {
  assert.equal(reportWeight(0), 0);
  assert.equal(reportWeight(CONFIG.REP_CAP / 2), 0.5);
  assert.equal(reportWeight(CONFIG.REP_CAP), 1);
  assert.equal(reportWeight(CONFIG.REP_CAP * 10), 1);
  assert.equal(reportWeight(-5), 0);
});

test('sybil attack: 1,000 fresh-wallet reports never get past warn', () => {
  const r = scoreTarget(target({ signals: fakeReports(1000, 0) }));
  assert.equal(r.verdict, 'warn');
  assert.equal(r.strongTypes, 0);
});

test('sybil attack: even 1,000 high-rep reports are still one source type', () => {
  const r = scoreTarget(target({ signals: fakeReports(1000, CONFIG.REP_CAP) }));
  assert.equal(r.verdict, 'warn');
  assert.equal(r.strongTypes, 1);
});
