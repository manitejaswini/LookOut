import test from 'node:test';
import assert from 'node:assert/strict';
import type { EntityWriter } from '@lookout/arkiv';
import type { PublishedRoot } from '@lookout/arkiv/roots';
import { buildSnapshot, type Snapshot } from '@lookout/core';
import { publishSnapshot } from './publish.ts';
import { parseRegistry } from './registry.ts';

const ME = '0x37324a0cc17959ee99233c8552e741519983573e';
const OTHER = '0x2222222222222222222222222222222222222222';
const registry = parseRegistry({ indexers: [{ indexerId: 'idx-1', address: ME }] });
const snap: Snapshot = buildSnapshot('snap-300', [], 16);
const otherSnap: Snapshot = buildSnapshot('snap-300', [{ targetHash: `0x${'11'.repeat(32)}`, flags: 1, signals: [] }], 16);

function fakeWriter() {
  const created: Record<string, unknown>[] = [];
  const writer: EntityWriter = {
    async createEntity(_schema, values) { created.push(values); return { entityKey: `0x${'ee'.repeat(32)}`, txHash: `0x${'dd'.repeat(32)}`, expiresAt: 1n }; },
    async extendEntity() { return { expiresAt: 1n }; },
  };
  return { writer, created };
}
const row = (over: Partial<PublishedRoot> = {}): PublishedRoot =>
  ({ snapshotId: 'snap-300', rootHash: snap.root, bucketCount: 16, indexerId: 'idx-1', creator: ME, entityKey: `0x${'aa'.repeat(32)}`, ...over });
const base = (writer: EntityWriter, rows: PublishedRoot[], over: Record<string, unknown> = {}) =>
  ({ snap, registry, indexerId: 'idx-1', address: ME, writer, readRows: async () => rows, ...over });

test('publishes the root of the epoch snapshot with the snapshot id, size and indexer id', async () => {
  const { writer, created } = fakeWriter();
  const r = await publishSnapshot(base(writer, []));
  assert.equal(r.status, 'published');
  assert.deepEqual(created, [{ snapshotId: 'snap-300', bucketCount: 16, rootHash: snap.root, indexerId: 'idx-1' }]);
});

test('running it again for the same root writes nothing', async () => {
  const { writer, created } = fakeWriter();
  const r = await publishSnapshot(base(writer, [row()]));
  assert.equal(r.status, 'already-published');
  assert.equal(created.length, 0);
});

test('refuses to contradict itself: a different root for the same snapshot id is not published', async () => {
  const { writer, created } = fakeWriter();
  await assert.rejects(publishSnapshot(base(writer, [row({ rootHash: otherSnap.root })])), /contradict itself/);
  assert.equal(created.length, 0);
});

test('someone else\'s root for this snapshot is not a conflict and does not stop us', async () => {
  const { writer, created } = fakeWriter();
  const r = await publishSnapshot(base(writer, [row({ creator: OTHER, indexerId: 'idx-9', rootHash: otherSnap.root })]));
  assert.equal(r.status, 'published');
  assert.equal(created.length, 1);
});

test('a wallet that is not a registered indexer cannot publish, so no client would trust it', async () => {
  const { writer, created } = fakeWriter();
  await assert.rejects(publishSnapshot(base(writer, [], { address: OTHER })), /not in the registry/);
  await assert.rejects(publishSnapshot(base(writer, [], { indexerId: 'idx-9' })), /not in the registry/);
  assert.equal(created.length, 0);
});

test('the wallet address check is case-insensitive', async () => {
  const { writer } = fakeWriter();
  const r = await publishSnapshot(base(writer, [], { address: ME.toUpperCase().replace('0X', '0x') }));
  assert.equal(r.status, 'published');
});
