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
}

export async function mirrorDeposits(deps: MirrorDeps, events: readonly DepositedEvent[]): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const e of events) {
    const k = `stake:${e.reporter.toLowerCase()}:${e.reportId}`;
    if (deps.journal.has(k)) { skipped++; continue; }
    const out = await createStake(deps.arkiv as EntityWriter, { reportId: e.reportId, amountWei: e.amount, escrowTx: e.txHash.toLowerCase() });
    deps.journal.mark(k, out.entityKey);
    created++;
  }
  return { created, skipped };
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
    await setStakeStatus(deps.arkiv, { entityKey, from: 'locked', to: e.kind === 'rejected' ? 'slashed' : 'returned' });
    deps.journal.mark(done, e.kind);
    updated++;
  }
  return { updated, skipped, unknown };
}
