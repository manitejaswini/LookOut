import {
  buildSnapshot, DEFAULT_BUCKET_COUNT, FLAG, type Snapshot, type SnapshotSignal, type TargetRecord,
} from '@lookout/core';
import type { TargetView } from './signals.ts';
import type { BlockTiming } from './types.ts';

/**
 * Converts the accepted signals into the records of the PIR table (arkiv/snapshot-format.md).
 * The snapshot id is derived from the Arkiv block the data was read at, so two indexers that read at the same
 * block and use the same registry and reputation checkpoint produce the same id, bytes and root.
 */
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
