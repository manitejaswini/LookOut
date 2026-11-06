import { FLAG, buildSnapshot, targetHash, type TargetRecord, type SnapshotSignal } from '@lookout/core';

/**
 * Stand-in for the indexer's output: the same five demo targets the wallet page ships with, in Dev A's
 * snapshot format (arkiv/snapshot-format.md), so the PIR path can be demoed without Arkiv. The real
 * snapshot comes from `npm run indexer:sync`. Weights mirror app/src/mock.ts.
 */
const NOW = () => Math.floor(Date.now() / 1000);
const key = (n: number) => `0x${n.toString(16).padStart(64, '0')}`; // stand-in for an Arkiv entity key
const sig = (
  sourceType: SnapshotSignal['sourceType'], weight: number, agoSeconds: number, n: number, sourceIdx: number, level: 'block' | 'warn' = 'block',
): SnapshotSignal => ({ sourceType, level, weight, sourceIdx, createdAt: NOW() - agoSeconds, entityKey: key(0xa11ce000 + n) });
const target = (kind: 'domain' | 'address', value: string, flags: number, signals: SnapshotSignal[]): TargetRecord =>
  ({ targetHash: targetHash(kind, value), flags, signals });

export function demoRecords(): TargetRecord[] {
  return [
    target('domain', 'claim-arbitrum-airdrop.xyz', FLAG.proof, [sig('community', 0.82, 600, 1, 0), sig('feed', 1, 240, 2, 2), sig('checker', 1, 95, 3, 1)]),
    target('domain', 'uniswapp-rewards.io', 0, [sig('community', 0.7, 1800, 4, 0), sig('community', 0.1, 1500, 5, 0, 'warn')]),
    target('domain', 'orbit-bridge.app', FLAG.disputed, [sig('community', 0, 3400, 6, 0), sig('verifier', 0.2, 1200, 7, 3, 'warn')]),
    target('address', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', FLAG.rulingBlock, [sig('ruling', 1, 86400, 8, 4), sig('checker', 1, 90000, 9, 1)]),
  ];
}

export const buildDemoSnapshot = (snapshotId = 'snap-demo', bucketCount?: number) => buildSnapshot(snapshotId, demoRecords(), bucketCount);
