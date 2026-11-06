import test from 'node:test';
import assert from 'node:assert/strict';
import { arkivRootsSource, readSnapshotRows, trustedRoots, type PublishedRoot, type TrustedIndexer } from './roots.ts';

const ROOT_A = `0x${'aa'.repeat(32)}`;
const ROOT_B = `0x${'bb'.repeat(32)}`;
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const EVIL = '0x6666666666666666666666666666666666666666';
const trusted: TrustedIndexer[] = [{ indexerId: 'idx-1', address: W1 }, { indexerId: 'idx-2', address: W2 }];
const row = (over: Partial<PublishedRoot>): PublishedRoot =>
  ({ snapshotId: 'snap-300', rootHash: ROOT_A, bucketCount: 16384, indexerId: 'idx-1', creator: W1, entityKey: `0x${'01'.repeat(32)}`, ...over });

test('a root published by a trusted indexer under its own id is accepted', () => {
  assert.deepEqual(trustedRoots([row({})], trusted), [ROOT_A]);
});

test('an impostor claiming a trusted indexer id from another wallet is ignored', () => {
  assert.deepEqual(trustedRoots([row({ creator: EVIL })], trusted), []);
});

test('a wallet that is not a registered indexer is ignored, even with a plausible id', () => {
  assert.deepEqual(trustedRoots([row({ indexerId: 'idx-9', creator: EVIL })], trusted), []);
  assert.deepEqual(trustedRoots([row({})], []), []);
});

test('a trusted wallet publishing under another trusted indexer\'s id is ignored', () => {
  assert.deepEqual(trustedRoots([row({ indexerId: 'idx-2', creator: W1 })], trusted), []);
});

test('addresses and roots are compared case-insensitively and returned lowercase', () => {
  const r = row({ creator: W1.toUpperCase().replace('0X', '0x'), rootHash: ROOT_A.toUpperCase().replace('0X', '0x') });
  assert.deepEqual(trustedRoots([r], trusted), [ROOT_A]);
});

test('minIndexers: a root needs that many DIFFERENT trusted indexers to agree', () => {
  const both = [row({}), row({ indexerId: 'idx-2', creator: W2 })];
  assert.deepEqual(trustedRoots(both, trusted, 2), [ROOT_A]);
  const split = [row({}), row({ indexerId: 'idx-2', creator: W2, rootHash: ROOT_B })];
  assert.deepEqual(trustedRoots(split, trusted, 2), [], 'two indexers, two different roots: no quorum');
  assert.deepEqual(trustedRoots(split, trusted, 1), [ROOT_A, ROOT_B]);
  const twice = [row({}), row({ entityKey: `0x${'02'.repeat(32)}` })];
  assert.deepEqual(trustedRoots(twice, trusted, 2), [], 'one indexer publishing twice is still one indexer');
});

test('a malformed root is ignored rather than trusted', () => {
  assert.deepEqual(trustedRoots([row({ rootHash: '0xdead' })], trusted), []);
});

test('readSnapshotRows reads the SDK\'s { type, value } columns and system fields', async () => {
  let queried = '';
  const client = {
    select: () => ({
      from: () => ({
        where: (cond: { args?: unknown }) => { queried = JSON.stringify(cond, (_k, v) => (typeof v === 'bigint' ? String(v) : v)); return {
          limit: () => ({
            fetch: async () => ({
              entities: [{
                $key: `0x${'AB'.repeat(32)}`, $creator: W1.toUpperCase().replace('0X', '0x'),
                snapshotId: { type: 'str', value: 'snap-300' }, rootHash: { type: 'str', value: ROOT_A },
                bucketCount: { type: 'i32', value: 16384 }, indexerId: { type: 'str', value: 'idx-1' },
              }],
            }),
          }),
        }; },
      }),
    }),
  };
  const rows = await readSnapshotRows(client, 'snap-300');
  assert.match(queried, /snap-300/);
  assert.deepEqual(rows, [{ snapshotId: 'snap-300', rootHash: ROOT_A, bucketCount: 16384, indexerId: 'idx-1', creator: W1, entityKey: `0x${'ab'.repeat(32)}` }]);
  const source = arkivRootsSource({ publicClient: client, trusted });
  assert.deepEqual(await source('snap-300'), [ROOT_A]);
});
