import { CONFIG } from './config.ts';

/**
 * Reputation: earned when reports are confirmed, lost when rejected (twice as fast), earned or lost by reviewers for how
 * they vote, non-transferable, and it decays. A new wallet starts at 0, so a thousand fresh wallets still weigh nothing.
 *
 * Everything here is a PURE function of public data, so any indexer that reads the same events reaches the same scores.
 * Arkiv entities expire, so scores are CHECKPOINTS: each is computed from the previous checkpoint plus the events since,
 * and published as `reputation` entities.
 *
 * Simplification, stated plainly: events inside one checkpoint window are applied after the previous scores have decayed
 * to the end of the window, and do not decay inside the window. With windows of hours and a half-life of 30 days the
 * difference is negligible, and it keeps the rule easy to recompute and audit.
 */

export type RepEventKind = 'report_confirmed' | 'report_rejected' | 'juror_won' | 'juror_lost';

export interface RepEvent {
  /** 0x address, compared case-insensitively */
  wallet: string;
  kind: RepEventKind;
  /** unix seconds. Only events after the previous checkpoint and up to this one are applied */
  at: number;
  /** what it was about: a reportId or a caseId. Part of the sort order, so ties break the same way everywhere */
  ref: string;
}

export interface Checkpoint {
  snapshotId: string;
  /** unix seconds this checkpoint is as of */
  at: number;
  scores: ReadonlyMap<string, number>;
}

export interface RepConfig {
  confirmGain: number;
  rejectMultiplier: number;
  jurorWin: number;
  jurorLoss: number;
  halfLifeDays: number;
  max: number;
}

export const DEFAULT_REP_CONFIG: RepConfig = {
  confirmGain: CONFIG.REP_CONFIRM_GAIN,
  rejectMultiplier: CONFIG.REP_REJECT_MULTIPLIER,
  jurorWin: CONFIG.REP_JUROR_WIN,
  jurorLoss: CONFIG.REP_JUROR_LOSS,
  halfLifeDays: CONFIG.REP_HALF_LIFE_DAYS,
  max: CONFIG.REP_MAX,
};

export function deltaFor(kind: RepEventKind, cfg: RepConfig = DEFAULT_REP_CONFIG): number {
  switch (kind) {
    case 'report_confirmed': return cfg.confirmGain;
    case 'report_rejected': return -cfg.confirmGain * cfg.rejectMultiplier;
    case 'juror_won': return cfg.jurorWin;
    case 'juror_lost': return -cfg.jurorLoss;
  }
}

/** What an untouched score is multiplied by after `seconds`: exactly one half per half-life. */
export function decayFactor(seconds: number, halfLifeDays: number = CONFIG.REP_HALF_LIFE_DAYS): number {
  if (seconds <= 0) return 1;
  return Math.pow(0.5, seconds / (halfLifeDays * 86_400));
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
/** below this a score is noise (weight under 0.00001), so it is dropped. Without it a rounded 0.000001 would never fade away */
export const MIN_SCORE = 0.001;
// scores are published with six decimals, so work at that precision to keep every machine identical
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: RepEvent, b: RepEvent) =>
  a.at - b.at || cmp(a.ref, b.ref) || cmp(a.wallet.toLowerCase(), b.wallet.toLowerCase()) || cmp(a.kind, b.kind);

/**
 * The next checkpoint. `prev` is null for the first one, which starts everyone at 0.
 * Events apply only if prev.at < event.at <= at, each (kind, ref, wallet) at most once, in a fixed order.
 */
export function nextCheckpoint(
  prev: Checkpoint | null,
  events: readonly RepEvent[],
  at: number,
  snapshotId: string,
  cfg: RepConfig = DEFAULT_REP_CONFIG,
): Checkpoint {
  if (prev && at < prev.at) throw new Error('a checkpoint cannot be earlier than the one before it');
  const scores = new Map<string, number>();

  if (prev) {
    const f = decayFactor(at - prev.at, cfg.halfLifeDays);
    for (const [w, s] of prev.scores) scores.set(w.toLowerCase(), round6(clamp(s * f, cfg.max)));
  }

  const from = prev ? prev.at : -Infinity;
  const seen = new Set<string>();
  for (const e of [...events].sort(order)) {
    if (!(e.at > from && e.at <= at)) continue;
    const w = e.wallet.toLowerCase();
    const key = `${e.kind}|${e.ref}|${w}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scores.set(w, round6(clamp((scores.get(w) ?? 0) + deltaFor(e.kind, cfg), cfg.max)));
  }

  // a wallet at (almost) zero is the same as one we never heard of, so it is not carried forward
  for (const [w, s] of scores) if (s < MIN_SCORE) scores.delete(w);
  return { snapshotId, at, scores };
}

/** Escrow outcomes become reputation events for the reporter. A reclaim (the panel never ruled) changes nothing. */
export function repEventFromSettlement(
  kind: 'confirmed' | 'rejected' | 'reclaimed',
  reporter: string,
  reportId: string,
  at: number,
): RepEvent | null {
  if (kind === 'reclaimed') return null;
  return { wallet: reporter.toLowerCase(), kind: kind === 'confirmed' ? 'report_confirmed' : 'report_rejected', at, ref: reportId };
}
