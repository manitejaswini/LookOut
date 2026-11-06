import { createStake, setStakeStatus, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import type { DepositedEvent, SettledEvent } from '@lookout/escrow';
import type { Journal } from './journal.ts';

/**
 * Mirrors the escrow contract into Arkiv `stake` entities (arkiv/schema.md). The CONTRACT is the source of truth for
 * money; these entities only let the rest of the system see it without reading a second chain.
 *
 * Idempotent through the journal: a deposit is mirrored once, a status change is applied once. The schema has only
 * locked / returned / slashed, so a reclaim is recorded as `returned`, which is what happened to the money.
 */
export interface MirrorDeps {
  arkiv: TrustWriter;
  journal: Journal;
  /**
   * The `stake` entities Arkiv ALREADY holds for this report that this wallet created. A write that times out can still land, so
   * "my journal has no record" does not prove "nothing was written": looking first stops a retry from creating a duplicate.
   */
  findStakes?: (reportId: string) => Promise<string[]>;
  /** unix seconds. Defaults to the clock */
  now?: () => number;
}

/**
 * After a create fails (a timeout can still mean the write landed), wait this long before creating again. The node's index lags a
 * block or two behind the chain, so looking immediately can miss an entity that is already there and write a duplicate.
 */
export const RETRY_AFTER_FAILED_CREATE_SECONDS = 60;

export async function mirrorDeposits(deps: MirrorDeps, events: readonly DepositedEvent[]): Promise<{ created: number; skipped: number; deferred: number }> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  let created = 0;
  let skipped = 0;
  let deferred = 0;
  for (const e of events) {
    const k = `stake:${e.reporter.toLowerCase()}:${e.reportId}`;
    if (deps.journal.has(k)) { skipped++; continue; }
    const attempt = `stake-attempt:${e.reporter.toLowerCase()}:${e.reportId}`;
    const last = Number(deps.journal.detail(attempt) ?? 0);
    // a create failed a moment ago and may have landed: give the index time to catch up before deciding it did not
    if (last > 0 && now() - last < RETRY_AFTER_FAILED_CREATE_SECONDS) { deferred++; continue; }
    const have = (await deps.findStakes?.(e.reportId)) ?? [];
    if (have.length > 0) { deps.journal.mark(k, have[0]); skipped++; continue; } // written by an earlier run that did not get to journal it
    try {
      const out = await createStake(deps.arkiv as EntityWriter, { reportId: e.reportId, amountWei: e.amount, escrowTx: e.txHash.toLowerCase() });
      deps.journal.mark(k, out.entityKey);
      created++;
    } catch (err) {
      deps.journal.mark(attempt, String(now()));
      throw err;
    }
  }
  return { created, skipped, deferred };
}

export async function mirrorSettlements(deps: MirrorDeps, events: readonly SettledEvent[]): Promise<{ updated: number; skipped: number; unknown: number }> {
  let updated = 0;
  let skipped = 0;
  let unknown = 0;
  for (const e of events) {
    const done = `stake-status:${e.reporter.toLowerCase()}:${e.reportId}`;
    if (deps.journal.has(done)) { skipped++; continue; }
    const entityKey = deps.journal.detail(`stake:${e.reporter.toLowerCase()}:${e.reportId}`);
    if (!entityKey) { unknown++; continue; } // its deposit is not mirrored yet: try again on the next run
    const to = e.kind === 'rejected' ? 'slashed' : 'returned';
    // every stake entity for this report gets the outcome, so a duplicate left by an earlier timeout cannot stay "locked" forever
    const keys = new Set([entityKey, ...((await deps.findStakes?.(e.reportId)) ?? [])]);
    for (const key of keys) await setStakeStatus(deps.arkiv, { entityKey: key, from: 'locked', to });
    deps.journal.mark(done, e.kind);
    updated++;
  }
  return { updated, skipped, unknown };
}
