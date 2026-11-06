/**
 * How a report with a locked deposit is settled, WITHOUT a vote. A pure function of public facts, so anyone can re-run it.
 *
 *   confirm   a trusted source (a feed or the checker) flagged the same target AFTER the report, within the window, and is not
 *             the reporter. The report was early and right: deposit back, a bounty, reputation.
 *   refund    the report added nothing new, or nothing corroborated it in time. The deposit goes back with NO bounty and NO
 *             reputation change. An honest early report of a scam the feeds have not caught yet is never punished for being early.
 *   wait      not decided yet.
 *
 * The automatic path can only confirm or refund. It NEVER forfeits a deposit: only an explicit operator ruling can, so a report
 * cannot lose money to a spoofed dispute or to a source that is merely slow.
 *
 * Two attacks this is built against:
 *   - copying: reporting a target a feed ALREADY flags earns nothing (the `already-flagged` refund), so known scams cannot be
 *     farmed for bounties.
 *   - self-corroboration: a source wallet cannot confirm its own report, because a signal written by the reporter does not count.
 */

export type StrongSourceType = 'feed' | 'checker' | 'verifier';

export interface Corroboration {
  sourceType: StrongSourceType;
  sourceId: string;
  level: 'block' | 'warn';
  /** unix seconds the source's verdict was first written */
  createdAt: number;
  /** the wallet that wrote it */
  creator: string;
  entityKey: string;
}

export interface ResolveInput {
  report: { createdAt: number; reporter: string };
  now: number;
  /** every verdict from a registered source about the same target */
  signals: readonly Corroboration[];
  windowSeconds: number;
  /** independent strong sources needed after the report. Default 1 */
  minSources?: number;
}

export type Resolution =
  | { action: 'confirm'; evidence: Corroboration[] }
  | { action: 'refund'; reason: 'already-flagged' | 'not-corroborated' }
  | { action: 'wait'; until: number };

export function resolveReport(input: ResolveInput): Resolution {
  const reporter = input.report.reporter.toLowerCase();
  const strong = input.signals.filter((s) => s.level === 'block' && s.creator.toLowerCase() !== reporter);
  const reportedAt = input.report.createdAt;
  const deadline = reportedAt + input.windowSeconds;

  // the target was already flagged by an independent source when this report came in: it told us nothing new
  if (strong.some((s) => s.createdAt <= reportedAt)) return { action: 'refund', reason: 'already-flagged' };

  const after = strong.filter((s) => s.createdAt > reportedAt && s.createdAt <= deadline);
  // distinct SOURCES, not distinct entities: one feed writing twice is still one source
  const sources = new Map<string, Corroboration>();
  for (const s of after) if (!sources.has(`${s.sourceType}:${s.sourceId}`)) sources.set(`${s.sourceType}:${s.sourceId}`, s);
  if (sources.size >= (input.minSources ?? 1)) return { action: 'confirm', evidence: [...sources.values()] };

  if (input.now >= deadline) return { action: 'refund', reason: 'not-corroborated' };
  return { action: 'wait', until: deadline };
}
