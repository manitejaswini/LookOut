import {
  CONFIG, buildSnapshot, DEFAULT_BUCKET_COUNT, FLAG, type Snapshot, type SnapshotSignal, type TargetRecord,
} from '@lookout/core';
import type { TargetView } from './signals.ts';
import type { BlockTiming } from './types.ts';

/**
 * Converts the accepted signals into the records of the PIR table (arkiv/snapshot-format.md).
 * The snapshot id is derived from the Arkiv block the data was read at, so two indexers that read at the same
 * block and use the same registry and reputation checkpoint produce the same id, bytes and root.
 */
/**
 * Why snapshots are built "as of an epoch" (answers open question 4 in arkiv/snapshot-format.md):
 * two indexers that sync at different moments must still publish the same root. So a snapshot describes the
 * chain at an agreed block, the latest multiple of SNAPSHOT_EPOCH_BLOCKS, and nothing about when the indexer ran.
 *  - the epoch block's timestamp comes from the chain (it drifts from 2 s per block, so it is read, not computed)
 *  - only entities created by the epoch block count
 *  - only entities that stay alive for one more epoch count, because Arkiv drops expired entities and a slower
 *    indexer could not see one that expired between the epoch block and its own sync
 * The price is freshness: a new report appears at the next epoch boundary, and an entity leaves snapshots up to
 * one epoch before it expires on Arkiv. Entities changed or deleted after the epoch block can still make roots
 * differ until the next epoch.
 */
export const epochOf = (block: number): number => Math.floor(block / CONFIG.SNAPSHOT_EPOCH_BLOCKS) * CONFIG.SNAPSHOT_EPOCH_BLOCKS;

/** Whether an entity belongs in the snapshot of this epoch. */
export const inEpoch = (e: { createdBlock: number; expiresBlock: number }, epochBlock: number): boolean =>
  e.createdBlock <= epochBlock && e.expiresBlock > epochBlock + CONFIG.SNAPSHOT_EPOCH_BLOCKS;

export const snapshotIdFor = (timing: BlockTiming): string => `snap-${timing.currentBlock}`;

export function toTargetRecords(targets: Map<string, TargetView>, timing: BlockTiming): TargetRecord[] {
  const out: TargetRecord[] = [];
  for (const t of targets.values()) {
    let flags = 0;
    if (t.disputed) flags |= FLAG.disputed;
    if (t.signals.some((s) => s.hasProof)) flags |= FLAG.proof;
    if (t.ruling === 'block') flags |= FLAG.rulingBlock;
    if (t.ruling === 'clear') flags |= FLAG.rulingClear;
    if (t.signals.length === 0 && flags === 0) continue; // nothing to say about this target

    const signals: SnapshotSignal[] = t.signals.map((s) => ({
      sourceType: s.sourceType,
      level: s.level,
      weight: s.weight,
      sourceIdx: s.sourceIdx,
      createdAt: Math.max(0, timing.currentBlockTime - (timing.currentBlock - s.createdBlock) * timing.blockDuration),
      entityKey: s.entityKey,
    }));
    out.push({ targetHash: t.targetHash, flags, signals });
  }
  return out;
}

export function buildStoreSnapshot(
  targets: Map<string, TargetView>,
  timing: BlockTiming,
  bucketCount = DEFAULT_BUCKET_COUNT,
): Snapshot {
  return buildSnapshot(snapshotIdFor(timing), toTargetRecords(targets, timing), bucketCount);
}

/** The snapshot every indexer should publish for the epoch this state was synced into. Null if no epoch is known. */
export function buildEpochSnapshot(
  state: { epoch: BlockTiming | null; epochTargets: Map<string, TargetView> },
  bucketCount = DEFAULT_BUCKET_COUNT,
): Snapshot {
  if (!state.epoch) throw new Error('no epoch known: sync first');
  return buildStoreSnapshot(state.epochTargets, state.epoch, bucketCount);
}
