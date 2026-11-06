import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '@lookout/core';
import { syncStore } from './reader.ts';
import { Store } from './store.ts';
import { buildIndexState } from './lookup.ts';
import { buildEpochSnapshot, buildStoreSnapshot, epochOf, inEpoch, snapshotIdFor } from './snapshot.ts';
import { ADDR, checkerVerdict, feedVerdict, registry, report } from './fixtures.ts';
import type { BlockTiming, IndexedKind, ReaderClient, StoredEntity } from './types.ts';

// A fake chain: blocks are NOT exactly 2 s (one extra second per 1,500 blocks, like the live chain), and Arkiv
// only returns entities that exist at the moment you ask: not yet created, or already expired, are invisible.
const T0 = 1_800_000_000;
const chainTime = (block: number) => T0 + block * 2 + Math.floor(block / 1500);
const E = CONFIG.SNAPSHOT_EPOCH_BLOCKS;
const EPOCH = 334 * E; // 100,200
const target = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

const chain: StoredEntity[] = [
  report(ADDR.rep82, target(1), { created: EPOCH - 1000, expires: EPOCH + 90_000 }),
  feedVerdict({ created: EPOCH - 500, expires: EPOCH + 90_000 }),
  report(ADDR.rep82, target(3), { created: EPOCH + 100, expires: EPOCH + 90_000 }), // created AFTER the epoch block
  report(ADDR.rep82, target(4), { created: EPOCH - 50, expires: EPOCH + 150 }), // expires soon after the epoch block
  checkerVerdict(true, { created: EPOCH - 20, expires: EPOCH + E + 400 }), // alive for a full epoch after the epoch block
];

/** An Arkiv node at `block`, with `skew` seconds of local clock error on the "current" time. */
function arkivAt(block: number, skew = 0): ReaderClient {
  const visible = (kind: IndexedKind) => chain.filter((e) => e.kind === kind && e.createdBlock <= block && e.expiresBlock > block);
  return {
    async getBlockTiming(): Promise<BlockTiming> { return { currentBlock: block, currentBlockTime: chainTime(block) + skew, blockDuration: 2 }; },
    async getBlockTime(b) { return chainTime(b); },
    async fetchPage(kind, after) {
      return visible(kind).filter((e) => !after || e.key > after).sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, 100)
        .map(({ key, creator, owner, createdBlock, expiresBlock, attrs }) => ({ key, creator, owner, createdBlock, expiresBlock, attrs }));
    },
  };
}

async function indexerAt(block: number, skew = 0) {
  const store = new Store();
  await syncStore(store, arkivAt(block, skew));
  return buildIndexState(store.entities(), store.timing()!, store.epoch(), registry);
}

test('epochOf is the latest multiple of the epoch length, and an entity must outlive one more epoch', () => {
  assert.equal(epochOf(EPOCH), EPOCH);
  assert.equal(epochOf(EPOCH + E - 1), EPOCH);
  assert.equal(epochOf(EPOCH + E), EPOCH + E);
  assert.ok(inEpoch({ createdBlock: EPOCH, expiresBlock: EPOCH + E + 1 }, EPOCH));
  assert.ok(!inEpoch({ createdBlock: EPOCH, expiresBlock: EPOCH + E }, EPOCH), 'expires within the next epoch: left out');
  assert.ok(!inEpoch({ createdBlock: EPOCH + 1, expiresBlock: EPOCH + 9999 }, EPOCH), 'created after the epoch block: left out');
});

test('two indexers that sync at different moments of the same epoch publish byte-identical snapshots', async () => {
  const early = await indexerAt(EPOCH + 10, 0);
  const late = await indexerAt(EPOCH + 250, 3); // later, and with a 3 s error on its clock
  const a = buildEpochSnapshot(early);
  const b = buildEpochSnapshot(late);
  assert.equal(a.snapshotId, `snap-${EPOCH}`);
  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(a.root, b.root);
  assert.deepEqual(a.buckets, b.buckets);
  assert.deepEqual(a.hashes, b.hashes);
});

test('CONTROL: the old way (snapshot of "now") gives these two indexers different roots, so the test above is meaningful', async () => {
  const early = await indexerAt(EPOCH + 10, 0);
  const late = await indexerAt(EPOCH + 250, 3);
  const oldA = buildStoreSnapshot(early.targets, early.timing);
  const oldB = buildStoreSnapshot(late.targets, late.timing);
  assert.notEqual(oldA.snapshotId, oldB.snapshotId);
  assert.notEqual(oldA.root, oldB.root);
});

test('the epoch timestamp is the chain\'s, not computed: it differs from block arithmetic when blocks drift', async () => {
  const s = await indexerAt(EPOCH + 10, 0);
  assert.equal(s.epoch!.currentBlockTime, chainTime(EPOCH));
  assert.notEqual(chainTime(EPOCH), T0 + EPOCH * 2, 'the fake chain really drifts');
});

test('the next epoch is a new snapshot that includes what was created after the previous epoch block', async () => {
  const thisEpoch = buildEpochSnapshot(await indexerAt(EPOCH + 10));
  const next = buildEpochSnapshot(await indexerAt(EPOCH + E + 10));
  assert.equal(next.snapshotId, snapshotIdFor({ currentBlock: EPOCH + E, currentBlockTime: 0, blockDuration: 2 }));
  assert.notEqual(next.root, thisEpoch.root);
  const early = await indexerAt(EPOCH + 10);
  const later = await indexerAt(EPOCH + E + 10);
  assert.ok(!early.epochTargets.has(target(3)), 'created after the epoch block: not in this epoch');
  assert.ok(later.epochTargets.has(target(3)), 'but in the next');
});

test('rebuilding from nothing gives the same root: wipe the cache and sync again', async () => {
  const first = buildEpochSnapshot(await indexerAt(EPOCH + 100));
  const again = buildEpochSnapshot(await indexerAt(EPOCH + 100)); // a brand new Store: nothing carried over
  assert.equal(first.root, again.root);
});

test('a cache from before epochs still loads, using arithmetic, and says its epoch', async () => {
  const store = new Store();
  await syncStore(store, arkivAt(EPOCH + 10));
  const legacy = buildIndexState(store.entities(), store.timing()!, null, registry); // as if no epoch was stored
  assert.equal(legacy.epoch!.currentBlock, EPOCH);
});
