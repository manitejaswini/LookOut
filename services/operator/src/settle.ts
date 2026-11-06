import { createRuling, type EntityWriter } from '@lookout/arkiv';
import { caseIdFor, CONFIG, repEventFromSettlement, type RepEvent, type Resolution, type TargetKind } from '@lookout/core';
import type { Escrow } from '@lookout/escrow';
import type { Journal } from './journal.ts';

/**
 * Applies a decision to the money and the record. The decision itself comes from core `resolveReport` (the automatic rules) or from
 * an explicit operator command. Every step is written to the journal AFTER it succeeds, so a crash halfway is repaired by running
 * again, and the escrow contract refuses repeats as a second line of defence.
 *
 *  confirm   the escrow credits the deposit back, reputation goes up, and a verified human is also credited a bounty from the pool
 *  refund    the escrow returns the deposit, nothing else: no bounty, no reputation change
 *  reject    (operator only) the deposit is forfeited to the pool and reputation goes down twice as fast
 */

export interface ResolveDeps {
  arkiv: EntityWriter;
  escrow: Pick<Escrow, 'confirm' | 'refund' | 'reject' | 'bountyPool' | 'deposit'>;
  journal: Journal;
  now: () => number;
  /** wallets bound to a unique human (World ID) */
  humans: () => ReadonlySet<string>;
  /** only verified humans are paid a bounty (core/config.ts BOUNTY_REQUIRES_HUMAN) */
  bountyRequiresHuman?: boolean;
}

export interface ReportToResolve {
  /** the report entity's key */
  key: string;
  reportId: string;
  reporter: string;
  /** unix seconds the report entity was created */
  createdAt: number;
  targetHash: string;
  kind: TargetKind;
  value: string;
}

/** paid: the pool paid it. pool-empty: asked for, but the pool could not afford it (the deposit still came back) */
export type BountyOutcome = 'paid' | 'pool-empty' | 'not-a-verified-human' | 'already-settled' | 'none';

export interface Outcome {
  action: Resolution['action'] | 'reject';
  bounty: BountyOutcome;
  /** the steps this run actually performed (empty on a pure retry) */
  did: string[];
  repEvents: RepEvent[];
}

const stepper = (journal: Journal, scope: string, did: string[]) => async (key: string, run: () => Promise<string | void>) => {
  const k = `${scope}:${key}`;
  if (journal.has(k)) return;
  const detail = await run();
  journal.mark(k, detail ?? '');
  did.push(key);
};

export async function applyResolution(deps: ResolveDeps, r: ReportToResolve, res: Resolution): Promise<Outcome> {
  const did: string[] = [];
  if (res.action === 'wait') return { action: 'wait', bounty: 'none', did, repEvents: [] };
  const step = stepper(deps.journal, r.key, did);

  if (res.action === 'refund') {
    await step('refund', async () => {
      const d = await deps.escrow.deposit(r.reporter, r.reportId);
      if (d.status !== 'locked') return `already ${d.status}`;
      return (await deps.escrow.refund(r.reporter, r.reportId)).hash;
    });
    return { action: 'refund', bounty: 'none', did, repEvents: [] };
  }

  // confirm: the deposit comes back, and a verified human is credited a bounty in the SAME transaction, so there is no second step
  // that can fail halfway. The contract pays the bounty only if the pool can afford it, and the pool is read before and after.
  const needsHuman = deps.bountyRequiresHuman ?? CONFIG.BOUNTY_REQUIRES_HUMAN;
  const qualifies = !needsHuman || deps.humans().has(r.reporter.toLowerCase());
  let bounty: BountyOutcome = qualifies ? 'pool-empty' : 'not-a-verified-human';
  await step('confirm', async () => {
    const d = await deps.escrow.deposit(r.reporter, r.reportId);
    if (d.status !== 'locked') { bounty = 'already-settled'; return `already ${d.status}`; }
    const before = await deps.escrow.bountyPool();
    const tx = await deps.escrow.confirm(r.reporter, r.reportId, qualifies);
    if (qualifies && (await deps.escrow.bountyPool()) < before) bounty = 'paid';
    return `${tx.hash} bounty:${bounty}`;
  });
  // a retry finds the step already journaled: the outcome of the first run is what the journal says
  if (!did.includes('confirm')) {
    const recorded = deps.journal.detail(`${r.key}:confirm`) ?? '';
    bounty = recorded.includes('bounty:paid') ? 'paid' : recorded.includes('bounty:pool-empty') ? 'pool-empty' : recorded.includes('bounty:not-a-verified-human') ? 'not-a-verified-human' : 'already-settled';
  }

  const rep = repEventFromSettlement('confirmed', r.reporter, r.reportId, deps.now());
  return { action: 'confirm', bounty, did, repEvents: rep ? [rep] : [] };
}

/* ------------------------------ operator commands ------------------------------ */

/** Explicitly rejects a report: the deposit is forfeited to the pool. This is the ONLY way a deposit is ever forfeited. */
export async function rejectReport(deps: Pick<ResolveDeps, 'escrow' | 'journal' | 'now'>, r: Pick<ReportToResolve, 'key' | 'reportId' | 'reporter'>): Promise<Outcome> {
  const did: string[] = [];
  await stepper(deps.journal, r.key, did)('reject', async () => {
    const d = await deps.escrow.deposit(r.reporter, r.reportId);
    if (d.status !== 'locked') return `already ${d.status}`;
    return (await deps.escrow.reject(r.reporter, r.reportId)).hash;
  });
  const rep = repEventFromSettlement('rejected', r.reporter, r.reportId, deps.now());
  return { action: 'reject', bounty: 'none', did, repEvents: rep ? [rep] : [] };
}

/**
 * Publishes the operator's ruling on a target: `clear` overturns the flags, `block` confirms them. The reason is public, in the
 * ruling's payload, so the operator is accountable for what it decides.
 */
export async function ruleOnTarget(
  deps: Pick<ResolveDeps, 'arkiv' | 'now'>,
  input: { kind: TargetKind; value: string; outcome: 'block' | 'clear'; reason: string; triggerKey: string; targetHash: string },
): Promise<{ entityKey: string; caseId: string }> {
  if (!input.reason.trim()) throw new Error('a ruling needs a reason, and the reason is published');
  const caseId = caseIdFor(input.targetHash, input.triggerKey);
  const payload = new TextEncoder().encode(JSON.stringify({ v: 0, by: 'operator', reason: input.reason.slice(0, 500), at: deps.now() }));
  const out = await createRuling(deps.arkiv, { caseId, kind: input.kind, value: input.value, outcome: input.outcome, payload });
  return { entityKey: out.entityKey, caseId };
}
