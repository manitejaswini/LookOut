import { CONFIG } from './config.ts';
import { emptyTarget, fakeReports, reportWeight, scoreTarget } from './scoring.ts';
import type { Signal, Verdict } from './types.ts';

export interface SybilRun {
  wallets: number;
  repEach: number;
  weightEach: number;
  communityScore: number; // the single score the community source type contributes
  strongTypes: number;
  verdict: Verdict;
  depositsAtRiskEth: number; // forfeited if the panel rejects every report
}

/**
 * N wallets, each with the same reputation, all flag one legitimate target. `extra` adds
 * signals from other source types, to test what an attacker gains from outside help.
 */
export function simulateSybil(wallets: number, repEach: number, extra: Signal[] = []): SybilRun {
  const r = scoreTarget({ ...emptyTarget('legit.example'), signals: [...fakeReports(wallets, repEach), ...extra] });
  return {
    wallets,
    repEach,
    weightEach: reportWeight(repEach),
    communityScore: r.typeScores.community ?? 0,
    strongTypes: r.strongTypes,
    verdict: r.verdict,
    depositsAtRiskEth: Math.round(wallets * CONFIG.DEPOSIT_ETH * 1e9) / 1e9,
  };
}
