import { createBounty, createRuling, type EntityWriter } from '@lookout/arkiv';
import { caseIdFor, CONFIG, repEventFromSettlement, type RepEvent, type Resolution, type TargetKind } from '@lookout/core';
import type { Escrow } from '@lookout/escrow';
import { bountyIdFor, createPayment, ephemeralFor } from '@lookout/stealth';
import type { Journal } from './journal.ts';

/**
 * Applies a decision to the money and the record. The decision itself comes from core `resolveReport` (the automatic rules) or from
 * an explicit operator command. Every step is written to the journal AFTER it succeeds, so a crash halfway is repaired by running
 * again, and the escrow contract refuses repeats as a second line of defence.
 *
 *  confirm   the escrow returns the deposit, reputation goes up, and a verified human is paid a private bounty
 *  refund    the escrow returns the deposit, nothing else: no bounty, no reputation change
 *  reject    (operator only) the deposit is forfeited to the pool and reputation goes down twice as fast
 */

export interface ResolveDeps {
  arkiv: EntityWriter;
  escrow: Pick<Escrow, 'confirm' | 'refund' | 'reject' | 'payBounty' | 'bountyPaid' | 'deposit'>;
  journal: Journal;
  /** derives each report's one-time bounty address and the opaque bounty id the escrow records */
  stealthPayerSecret: Uint8Array;
  now: () => number;
  /** the bounty tier published with the payout (0 to 255) */
  bountyTier: number;
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
  /** the reporter's stealth meta-address, opened from the sealed payload. Without it no bounty can be paid */
  reporterMeta?: string;
}

export type BountyOutcome = 'paid' | 'not-a-verified-human' | 'no-bounty-address' | 'already-paid' | 'none';

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

  // the deposit: only if the contract still holds it locked (an earlier run may have settled it before crashing)
  await step(res.action, async () => {
    const d = await deps.escrow.deposit(r.reporter, r.reportId);
    if (d.status !== 'locked') return `already ${d.status}`;
    return (res.action === 'confirm' ? await deps.escrow.confirm(r.reporter, r.reportId) : await deps.escrow.refund(r.reporter, r.reportId)).hash;
  });
  if (res.action === 'refund') return { action: 'refund', bounty: 'none', did, repEvents: [] };

  // the bounty: a confirmed report from a verified human, to a one-time address
  let bounty: BountyOutcome = 'none';
  const needsHuman = deps.bountyRequiresHuman ?? CONFIG.BOUNTY_REQUIRES_HUMAN;
  if (!r.reporterMeta) bounty = 'no-bounty-address';
  else if (needsHuman && !deps.humans().has(r.reporter.toLowerCase())) bounty = 'not-a-verified-human';
  else {
    const bountyId = bountyIdFor(deps.stealthPayerSecret, r.reportId);
    if (await deps.escrow.bountyPaid(bountyId)) bounty = 'already-paid';
    else {
      await step('bounty', async () => {
        const pay = createPayment(r.reporterMeta!, ephemeralFor(deps.stealthPayerSecret, r.reportId));
        // announce first: if the payment then fails, the announcement is harmless and a retry reuses the same address
        await createBounty(deps.arkiv, { reportId: r.reportId, amountTier: deps.bountyTier, ephemeralPublicKey: pay.ephemeralPublicKey });
        return (await deps.escrow.payBounty(bountyId, pay.stealthAddress)).hash;
      });
      bounty = 'paid';
    }
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
