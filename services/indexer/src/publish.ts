import { createSnapshot, type EntityWriter } from '@lookout/arkiv';
import type { PublishedRoot } from '@lookout/arkiv/roots';
import type { Snapshot } from '@lookout/core';
import type { Registry } from './registry.ts';

export type PublishResult =
  | { status: 'published'; entityKey: string; txHash: string }
  | { status: 'already-published'; entityKey: string };

/**
 * Publishes the root of a snapshot as a `snapshot` entity, so clients can check what PIR servers serve against
 * something the servers do not control. Safe to run on every epoch, and again after a crash:
 *  - the wallet must be a registered indexer, or no client would trust the entity;
 *  - the same root published already is a no-op;
 *  - a DIFFERENT root for the same snapshot id is refused. An indexer must not contradict itself. It means its cache
 *    changed after the epoch block (see "Which block does a snapshot describe?" in arkiv/snapshot-format.md).
 */
export async function publishSnapshot(opts: {
  snap: Snapshot;
  registry: Registry;
  indexerId: string;
  address: string;
  writer: EntityWriter;
  readRows: (snapshotId: string) => Promise<PublishedRoot[]>;
}): Promise<PublishResult> {
  const { snap, registry, indexerId, writer } = opts;
  const address = opts.address.toLowerCase();
  const registered = registry.indexers.some((i) => i.indexerId === indexerId && i.address === address);
  if (!registered) throw new Error(`${indexerId} at ${address} is not in the registry's indexers list, so clients would ignore its roots`);

  const mine = (await opts.readRows(snap.snapshotId)).filter((r) => r.creator.toLowerCase() === address && r.indexerId === indexerId);
  const same = mine.find((r) => r.rootHash.toLowerCase() === snap.root.toLowerCase());
  if (same) return { status: 'already-published', entityKey: same.entityKey };
  if (mine.length > 0) {
    throw new Error(
      `${indexerId} already published root ${mine[0].rootHash} for ${snap.snapshotId} but this cache builds ${snap.root}. ` +
      'Refusing to contradict itself. Re-sync and wait for the next epoch.',
    );
  }

  const out = await createSnapshot(writer, { snapshotId: snap.snapshotId, bucketCount: snap.bucketCount, rootHash: snap.root, indexerId });
  return { status: 'published', entityKey: out.entityKey, txHash: out.txHash };
}
