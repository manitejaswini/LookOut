import { CONFIG } from './config.ts';
import type { CheckResult, Signal, SourceType, Target } from './types.ts';

/** report weight = min(1, rep / cap) */
export const reportWeight = (rep: number) => Math.min(1, Math.max(0, rep / CONFIG.REP_CAP));

export const SNAPSHOT_ID = 'snap-0412';

/** Reference scoring logic from the PRD. Pure function, no I/O. */
export function scoreTarget(t: Target): CheckResult {
  const typeScores: Partial<Record<SourceType, number>> = {};
  for (const s of t.signals) {
    typeScores[s.sourceType] = Math.max(typeScores[s.sourceType] ?? 0, s.weight);
  }
  const strongTypes = Object.values(typeScores).filter((w) => (w ?? 0) >= CONFIG.THRESHOLD).length;

  const reasons = [...t.signals]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map(({ sourceType, sourceId, level, entityId, ageSeconds }) => ({
      sourceType, sourceId, level, entityId, ageSeconds,
    }));

  const base = { disputed: t.disputed, reasons, snapshotId: SNAPSHOT_ID, verified: true, typeScores, strongTypes };

  if (t.ruling === 'block') return { ...base, verdict: 'block', headline: 'A reviewer panel ruled this a scam.' };
  if (t.ruling === 'clear') return { ...base, verdict: 'unknown', headline: 'A reviewer panel cleared this target. No active flags.' };
  if (t.proof) return { ...base, verdict: 'block', headline: `Re-checkable proof: ${t.proof}` };
  if (strongTypes >= CONFIG.MIN_STRONG_TYPES)
    return { ...base, verdict: 'block', headline: `${strongTypes} independent source types agree.` };
  if (t.signals.length > 0) {
    return {
      ...base,
      verdict: 'warn',
      headline: t.disputed
        ? 'Flagged, but the owner has disputed it. A panel is reviewing.'
        : strongTypes === 1
          ? 'Only one source type is confident. Block needs two.'
          : 'Signals exist, but only from low-reputation reports.',
    };
  }
  if (t.disputed) return { ...base, verdict: 'warn', headline: 'Under dispute. Never auto-cleared.' };
  return { ...base, verdict: 'unknown', headline: 'No signal found. Unknown is not the same as safe.' };
}

export const emptyTarget = (value: string, kind: Target['kind'] = 'domain'): Target => ({
  kind, value, title: 'Unlisted target', blurb: 'Interact with this target', signals: [], disputed: false,
});

/** Build N fresh-wallet community reports (rep 0 → weight 0) for the attack demo. */
export function fakeReports(n: number, repEach: number): Signal[] {
  return Array.from({ length: n }, (_, i) => ({
    entityId: `report-sybil-${i}`,
    sourceType: 'community' as const,
    sourceId: `0x${(i + 1).toString(16).padStart(4, '0')}…`,
    level: 'block' as const,
    weight: reportWeight(repEach),
    ageSeconds: 30,
    note: 'Fresh wallet report',
  }));
}
