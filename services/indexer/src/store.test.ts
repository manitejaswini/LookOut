import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { timing } from './fixtures.ts';
import type { RawRow } from './types.ts';

const row = (n: number, extra: Partial<RawRow> = {}): RawRow => ({
  key: `0x${n.toString(16).padStart(64, '0')}`,
  creator: `0x${'1'.repeat(40)}`,
  owner: `0x${'1'.repeat(40)}`,
  createdBlock: 10,
  expiresBlock: 99,
  attrs: { targetHash: `0x${'ab'.repeat(32)}`, category: 'drainer' },
  ...extra,
});

test('stores and reads back entities, kind, attributes and timing', () => {
  const s = new Store();
  assert.equal(s.timing(), null);
  s.replaceAll([{ kind: 'report', row: row(2) }, { kind: 'verdict', row: row(1, { attrs: { targetHash: '0x1', level: 'block' } }) }], timing);
  const all = s.entities();
  assert.deepEqual(all.map((e) => [e.kind, e.key.slice(-1)]), [['verdict', '1'], ['report', '2']], 'ordered by key');
  assert.deepEqual(all[0].attrs, { targetHash: '0x1', level: 'block' });
  assert.equal(all[1].createdBlock, 10);
  assert.deepEqual(s.timing(), timing);
  assert.equal(s.count(), 2);
  assert.ok((s.syncedAt() ?? 0) > 0);
});

test('a second sync replaces the first, so entities that expired on Arkiv disappear', () => {
  const s = new Store();
  s.replaceAll([{ kind: 'report', row: row(1) }, { kind: 'report', row: row(2) }], timing);
  s.replaceAll([{ kind: 'report', row: row(2) }], { ...timing, currentBlock: 100_100 });
  assert.equal(s.count(), 1);
  assert.equal(s.timing()?.currentBlock, 100_100);
});

test('a failed sync rolls back and leaves the previous data untouched', () => {
  const s = new Store();
  s.replaceAll([{ kind: 'report', row: row(1) }], timing);
  // two rows with the same key violate the primary key halfway through the insert
  assert.throws(() => s.replaceAll([{ kind: 'report', row: row(7) }, { kind: 'report', row: row(7) }], { ...timing, currentBlock: 1 }));
  assert.equal(s.count(), 1);
  assert.equal(s.entities()[0].key, row(1).key);
  assert.equal(s.timing()?.currentBlock, timing.currentBlock, 'timing is rolled back too');
});

test('rows without a targetHash are still stored', () => {
  const s = new Store();
  s.replaceAll([{ kind: 'ruling', row: row(3, { attrs: { outcome: 'block' } }) }], timing);
  assert.equal(s.count(), 1);
});
