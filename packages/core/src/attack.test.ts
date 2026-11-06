import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateSybil } from './attack.ts';
import { CONFIG } from './config.ts';
import type { Signal } from './types.ts';

const other = (sourceType: Signal['sourceType'], weight = 1): Signal => ({
  entityId: `e-${sourceType}`, sourceType, sourceId: 's', level: 'block', weight, ageSeconds: 1, note: '',
});

test('1,000 fresh wallets: weight 0, no strong type, warn, deposits at risk', () => {
  const r = simulateSybil(1000, 0);
  assert.equal(r.weightEach, 0);
  assert.equal(r.communityScore, 0);
  assert.equal(r.strongTypes, 0);
  assert.equal(r.verdict, 'warn');
  assert.equal(r.depositsAtRiskEth, 1000 * CONFIG.DEPOSIT_ETH);
});

test('volume never helps: score depends on reputation, not wallet count', () => {
  for (const rep of [0, 10, CONFIG.REP_CAP / 2, CONFIG.REP_CAP]) {
    const one = simulateSybil(1, rep);
    const many = simulateSybil(1000, rep);
    assert.equal(many.communityScore, one.communityScore, `rep ${rep}`);
    assert.equal(many.verdict, one.verdict, `rep ${rep}`);
  }
});

test('even full reputation on every wallet cannot block alone (one source type)', () => {
  const r = simulateSybil(1000, CONFIG.REP_CAP);
  assert.equal(r.strongTypes, 1);
  assert.equal(r.verdict, 'warn');
});

test('known limit, by design: one farmed wallet plus a second independent type does block', () => {
  const r = simulateSybil(1, CONFIG.REP_CAP, [other('feed')]);
  assert.equal(r.verdict, 'block');
});

test('a weak second type does not help the attacker', () => {
  const r = simulateSybil(1000, CONFIG.REP_CAP, [other('feed', CONFIG.THRESHOLD - 0.01)]);
  assert.equal(r.verdict, 'warn');
});
