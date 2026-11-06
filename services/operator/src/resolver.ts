import { CONFIG, resolveReport, type Corroboration, type RepEvent, type Resolution } from '@lookout/core';
import type { Journal } from './journal.ts';
import { applyResolution, type BountyOutcome, type ReportToResolve, type ResolveDeps } from './settle.ts';

/**
 * One pass over the reports that are waiting: look up what the trusted sources have said about each target, apply the
 * automatic rules (core/resolution.ts), and act on the result. A report that is settled is never touched again.
 *
 * The automatic rules can only confirm or refund. They never forfeit a deposit.
 */

export interface EvidenceSource {
  /** every verdict from a REGISTERED source about this target, with the time it was first written */
  signalsFor(targetHash: string): Promise<Corroboration[]>;
}

export interface ResolverDeps extends ResolveDeps {
  evidence: EvidenceSource;
  windowSeconds?: number;
  minSources?: number;
}

export interface ReportStatus {
  reportId: string;
  target: { kind: string; value: string };
  state: 'waiting' | 'confirmed' | 'refunded';
  reason?: string;
  /** unix seconds the automatic window closes, while waiting */
  decideBy?: number;
  bounty: BountyOutcome;
  evidence: { sourceId: string; sourceType: string }[];
}

const SETTLED = (key: string) => `${key}:settled`;

export async function resolveAll(deps: ResolverDeps, reports: readonly ReportToResolve[]): Promise<{ statuses: ReportStatus[]; repEvents: RepEvent[]; errors: { reportId: string; message: string }[] }> {
  const statuses: ReportStatus[] = [];
  const repEvents: RepEvent[] = [];
  const errors: { reportId: string; message: string }[] = [];

  for (const r of reports) {
    try {
      const signals = await deps.evidence.signalsFor(r.targetHash);
      const res: Resolution = resolveReport({
        report: { createdAt: r.createdAt, reporter: r.reporter }, now: deps.now(), signals,
        windowSeconds: deps.windowSeconds ?? CONFIG.REPORT_CONFIRM_WINDOW_DAYS * 86_400,
        minSources: deps.minSources ?? CONFIG.RESOLUTION_MIN_SOURCES,
      });
      const out = await applyResolution(deps, r, res);
      if (res.action !== 'wait') deps.journal.mark(SETTLED(r.key), res.action);
      repEvents.push(...out.repEvents);
      const status: ReportStatus = {
        reportId: r.reportId, target: { kind: r.kind, value: r.value },
        state: res.action === 'confirm' ? 'confirmed' : res.action === 'refund' ? 'refunded' : 'waiting',
        reason: res.action === 'refund' ? res.reason : undefined,
        decideBy: res.action === 'wait' ? res.until : undefined,
        bounty: out.bounty,
        evidence: res.action === 'confirm' ? res.evidence.map((e) => ({ sourceId: e.sourceId, sourceType: e.sourceType })) : [],
      };
      statuses.push(status);
      rememberStatus(deps.journal, status);
    } catch (e) {
      errors.push({ reportId: r.reportId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { statuses, repEvents, errors };
}

/** Reports the journal already shows as settled need no more attention, even if the contract call is repeated. */
export const isSettled = (journal: { has(k: string): boolean }, key: string) => journal.has(SETTLED(key));

/* A settled report disappears from the "waiting" list (its deposit is no longer locked), so its outcome is kept for the API. */

const INDEX = 'report-status:index';
export function rememberStatus(journal: Journal, s: ReportStatus): void {
  journal.mark(`report-status:${s.reportId}`, JSON.stringify(s));
  const ids = JSON.parse(journal.detail(INDEX) ?? '[]') as string[];
  if (!ids.includes(s.reportId)) journal.mark(INDEX, JSON.stringify([...ids, s.reportId]));
}
export function allStatuses(journal: Journal): ReportStatus[] {
  return (JSON.parse(journal.detail(INDEX) ?? '[]') as string[]).map((id) => JSON.parse(journal.detail(`report-status:${id}`)!) as ReportStatus);
}
