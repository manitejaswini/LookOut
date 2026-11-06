import { targetHash } from '@lookout/core';
import {
  FLAG_DISPUTED, FLAG_PROOF, FLAG_RULING_BLOCK, bountyKey, buildSnapshot, keyFromHex,
  type SnapshotRecord, type SnapshotSignal,
} from '@lookout/snapshot';

/**
 * Stand-in for the indexer's output: the same five demo targets the wallet page ships with,
 * so the PIR path can be demoed before Dev A's indexer exists. The real snapshot comes from
 * reading Arkiv. Weights and kinds mirror app/src/mock.ts.
 */
const NOW = () => Math.floor(Date.now() / 1000);
const sig = (sourceType: SnapshotSignal['sourceType'], weight: number, agoSeconds: number, n: number, level: 'block' | 'warn' = 'block'): SnapshotSignal => ({
  sourceType, level, weight, createdAt: NOW() - agoSeconds, entityKey: `0x${(0xa11ce000 + n).toString(16).padStart(16, '0')}`,
});
const target = (kind: 'domain' | 'address', value: string, flags: number, signals: SnapshotSignal[]): SnapshotRecord =>
  ({ kind: 'target', key: keyFromHex(targetHash(kind, value)), flags, signals });

export function demoRecords(): SnapshotRecord[] {
  return [
    target('domain', 'claim-arbitrum-airdrop.xyz', FLAG_PROOF, [sig('community', 0.82, 600, 1), sig('feed', 1, 240, 2), sig('checker', 1, 95, 3)]),
    target('domain', 'uniswapp-rewards.io', 0, [sig('community', 0.7, 1800, 4), sig('community', 0.1, 1500, 5, 'warn')]),
    target('domain', 'orbit-bridge.app', FLAG_DISPUTED, [sig('community', 0, 3400, 6), sig('verifier', 0.2, 1200, 7, 'warn')]),
    target('address', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', FLAG_RULING_BLOCK, [sig('ruling', 1, 86400, 8), sig('checker', 1, 90000, 9)]),
    { kind: 'bounty', key: bountyKey('rep_demo'), tier: 1, ephemeralPublicKey: `0x03${'11'.repeat(32)}` },
  ];
}

export const buildDemoSnapshot = (bucketCount?: number) => buildSnapshot(demoRecords(), bucketCount);
