import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, normalizeRow, readAll, syncStore } from './reader.ts';
import { Store } from './store.ts';
import { timing } from './fixtures.ts';
import type { IndexedKind, RawRow, ReaderClient } from './types.ts';

const key = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const makeRow = (n: number): RawRow => ({ key: key(n), creator: '0xaa', owner: '0xaa', createdBlock: 1, expiresBlock: 9, attrs: { targetHash: key(n) } });

/** A fake Arkiv that serves rows in key order, 100 at a time, exactly like the real paging recipe. */
function fakeReader(rowsByKind: Partial<Record<IndexedKind, RawRow[]>>) {
  const calls: { kind: IndexedKind; after?: string }[] = [];
  const reader: ReaderClient = {
    async getBlockTiming() { return timing; },
    async getBlockTime() { return timing.currentBlockTime; },
    async fetchPage(kind, after) {
      calls.push({ kind, after });
      const rows = (rowsByKind[kind] ?? []).filter((r) => !after || r.key > after).sort((a, b) => (a.key < b.key ? -1 : 1));
      return rows.slice(0, PAGE_SIZE);
    },
  };
  return { reader, calls };
}

test('normalizeRow flattens { type, value } columns and plain system fields', () => {
  const raw = normalizeRow('verdict', {
    $key: `0x${'AB'.repeat(32)}`, $creator: '0xCreator', $owner: '0xOwner', $createdAt: 291624n, $expiresAt: '378027n'.replace('n', ''),
    targetHash: { type: 'str', value: '0xabc' }, sourceType: { type: 'str', value: 'checker' }, proofHash: undefined, level: { type: 'str', value: 'block' },
  });
  assert.equal(raw.key, `0x${'ab'.repeat(32)}`, 'key lowercased');
  assert.equal(raw.creator, '0xcreator');
  assert.equal(raw.createdBlock, 291624);
  assert.equal(raw.expiresBlock, 378027);
  assert.deepEqual(raw.attrs, { targetHash: '0xabc', sourceType: 'checker', level: 'block' }, 'missing optional columns are left out');
});

test('readAll pages through 250 rows in three calls, in order, without repeats', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => makeRow(i + 1));
  const { reader, calls } = fakeReader({ report: rows });
  const got = await readAll(reader, 'report');
  assert.equal(got.length, 250);
  assert.equal(new Set(got.map((r) => r.key)).size, 250);
  assert.deepEqual(got.map((r) => r.key), rows.map((r) => r.key));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].after, undefined);
  assert.equal(calls[1].after, key(100));
  assert.equal(calls[2].after, key(200));
});

test('readAll with an exact multiple of the page size makes one extra, empty call and stops', async () => {
  const { reader, calls } = fakeReader({ report: Array.from({ length: 200 }, (_, i) => makeRow(i + 1)) });
  assert.equal((await readAll(reader, 'report')).length, 200);
  assert.equal(calls.length, 3);
});

test('readAll on an empty kind returns nothing after one call', async () => {
  const { reader, calls } = fakeReader({});
  assert.deepEqual(await readAll(reader, 'ruling'), []);
  assert.equal(calls.length, 1);
});

test('syncStore reads every kind and replaces the store in one go', async () => {
  const { reader } = fakeReader({
    report: [makeRow(1), makeRow(2)],
    verdict: [makeRow(3)],
    attestation: [],
    ruling: [makeRow(4)],
  });
  const store = new Store();
  const r = await syncStore(store, reader);
  assert.deepEqual(r.counts, { report: 2, verdict: 1, attestation: 0, ruling: 1 });
  assert.equal(r.total, 4);
  assert.equal(store.count(), 4);
  assert.deepEqual(store.timing(), timing);
});

test('if Arkiv fails halfway, the previous data is kept', async () => {
  const store = new Store();
  await syncStore(store, fakeReader({ report: [makeRow(1)] }).reader);
  const broken: ReaderClient = {
    async getBlockTiming() { return timing; },
    async getBlockTime() { return timing.currentBlockTime; },
    async fetchPage(kind) { if (kind === 'verdict') throw new Error('rpc down'); return []; },
  };
  await assert.rejects(syncStore(store, broken), /rpc down/);
  assert.equal(store.count(), 1, 'nothing was replaced');
});
