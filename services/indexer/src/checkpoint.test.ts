import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheckpoint, withCheckpoint } from './checkpoint.ts';
import { buildIndexState } from './lookup.ts';
import { ADDR, registry as base, report, timing } from './fixtures.ts';
import { parseRegistry } from './registry.ts';
import type { StoredEntity } from './types.ts';

const IDX = '0x9999999999999999999999999999999999999999';
const IDX2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const registry = parseRegistry({ ...JSON.parse(JSON.stringify({ sources: [], attesters: [], operator: null })), indexers: [{ indexerId: 'one', address: IDX }, { indexerId: 'two', address: IDX2 }], reputation: { [ADDR.rep100]: 100 } });
let n = 0;
const rep = (creator: string, wallet: string, snapshotId: string, score: string, created = 99_000): StoredEntity => ({
  key: `0x${(++n).toString(16).padStart(64, '0')}`, kind: 'reputation', creator, owner: creator, createdBlock: created, expiresBlock: 200_000, attrs: { wallet, snapshotId, score },
});

test('no checkpoint published: the registry file is used as before', () => {
  assert.equal(readCheckpoint([], registry), null);
  assert.equal(withCheckpoint(registry, []), registry);
});

test('a published checkpoint replaces the registry scores', () => {
  const r = withCheckpoint(registry, [rep(IDX, ADDR.rep82, 'rep-1', '82.5')]);
  assert.deepEqual(r.reputation, { [ADDR.rep82]: 82.5 }, 'the hand-written 100 is gone');
});

test('only the newest checkpoint counts', () => {
  const cp = readCheckpoint([rep(IDX, ADDR.rep82, 'rep-1', '10', 90_000), rep(IDX, ADDR.rep82, 'rep-2', '20', 95_000), rep(IDX, ADDR.rep100, 'rep-1', '99', 90_000)], registry);
  assert.equal(cp?.snapshotId, 'rep-2');
  assert.deepEqual(cp?.scores, { [ADDR.rep82]: 20 });
});

test('rows from a wallet that is not a registered indexer are ignored, and counted', () => {
  const cp = readCheckpoint([rep(ADDR.stranger, ADDR.stranger, 'rep-9', '1000', 99_999), rep(IDX, ADDR.rep82, 'rep-1', '5')], registry);
  assert.equal(cp?.snapshotId, 'rep-1');
  assert.equal(cp?.ignored, 1);
  assert.equal(cp?.scores[ADDR.stranger], undefined);
});

test('malformed rows are ignored', () => {
  const cp = readCheckpoint([rep(IDX, 'nope', 'rep-1', '5'), rep(IDX, ADDR.rep82, 'rep-1', '-3'), rep(IDX, ADDR.rep82, 'rep-1', 'abc'), rep(IDX, ADDR.rep100, 'rep-1', '7')], registry);
  assert.deepEqual(cp?.scores, { [ADDR.rep100]: 7 });
  assert.equal(cp?.ignored, 3);
});

test('two indexers that disagree: the LOWER score wins, so a disagreement never raises weight', () => {
  const cp = readCheckpoint([rep(IDX, ADDR.rep82, 'rep-1', '80'), rep(IDX2, ADDR.rep82, 'rep-1', '60')], registry);
  assert.equal(cp?.scores[ADDR.rep82], 60);
});

test('the checkpoint reaches report weighing, and reputation rows are not treated as targets', () => {
  const entities = [report(ADDR.rep82), rep(IDX, ADDR.rep82, 'rep-1', '10')];
  const state = buildIndexState(entities, timing, null, registry);
  assert.equal(state.dropped.length, 0, 'the reputation row is not reported as a dropped entity');
  const sig = [...state.targets.values()][0].signals[0];
  assert.equal(sig.weight, 0.1, 'weight comes from the checkpoint score 10, not the file');
  void base;
});
