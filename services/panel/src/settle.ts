import { createBounty, createRuling, type EntityWriter } from '@lookout/arkiv';
import { reportResult, repEventFromSettlement, type RepEvent, type Tally, type TargetKind } from '@lookout/core';
import type { Escrow } from '@lookout/escrow';
import { bountyIdFor, createPayment, ephemeralFor } from '@lookout/stealth';
import type { Journal } from './journal.ts';

/**
 * Settles one case about a REPORT, after the vote has been counted (core/panel.ts `tally`).
 *
 * In order: publish the ruling, settle the reporter's deposit in escrow, slash jurors who lost or did not reveal, pay the
 * bounty to a one-time stealth address (confirmed reports only), then hand back the reputation events.
 *
 * Every step is recorded in the journal AFTER it succeeds, so a crash halfway is repaired by simply running this again.
 * The escrow contract itself also refuses repeats (NotLocked, AlreadyPaid), which is the second line of defence.
 *
 * An inconclusive tally settles nothing: no ruling, no money moves, and the reporter keeps the right to reclaim.
 */

export interface SettleDeps {
  /** writes the ruling. Must be the panel wallet, because indexers trust `ruling` only from there */
  arkiv: EntityWriter;
  escrow: Pick<Escrow, 'confirm' | 'reject' | 'slash' | 'payBounty' | 'bountyPaid' | 'deposit'>;
  journal: Journal;
  /** derives each report's one-time bounty address, so a retry can never pay a second address */
  stealthPayerSecret: Uint8Array;
  now: () => number;
  /** taken from a juror who voted against the majority, in wei */
  slashLoserWei: bigint;
  /** taken from a juror who did not reveal, in wei */
  slashNonRevealWei: bigint;
  /** the bounty tier published with the payout (0 to 255) */
  bountyTier: number;
}

export interface ReportCase {
  /** a `dispute` is an owner contesting a flag: no deposit, so only a ruling and the jurors' own stakes and reputation are affected */
  type?: 'report' | 'dispute';
  caseId: string;
  reportId: string;
  reporter: string;
  /** what the report was about, for the ruling's target hash */
  kind: TargetKind;
  value: string;
  jurors: readonly string[];
  /** the draw seed, published in the ruling so anyone can redo the draw */
  seed: string;
  /** the reporter's stealth meta address (st:eth:0x...), for the bounty. Without it no bounty is paid */
  reporterMeta?: string;
}

export interface SettleResult {
  status: 'settled' | 'inconclusive';
  result: 'confirmed' | 'rejected' | null;
  /** what the panel decided about the target: block means it is a scam, clear means it is not */
  outcome?: 'block' | 'clear' | null;
  /** steps this run actually performed (empty on a pure retry) */
  did: string[];
  repEvents: RepEvent[];
}

/** What goes in the ruling entity's payload: enough for anyone to re-check it. */
export function rulingPayload(c: ReportCase, t: Tally): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    v: 0,
    caseId: c.caseId,
    seed: c.seed,
    jurors: [...c.jurors].map((j) => j.toLowerCase()).sort(),
    counts: t.counts,
    winners: [...t.winners].sort(),
    losers: [...t.losers].sort(),
    nonReveal: [...t.nonReveal].sort(),
  }));
}

export async function settleReportCase(deps: SettleDeps, c: ReportCase, t: Tally): Promise<SettleResult> {
  const result = reportResult(t);
  if (result === null || t.outcome === null) return { status: 'inconclusive', result: null, did: [], repEvents: [] };

  const did: string[] = [];
  const step = async (key: string, run: () => Promise<string | void>) => {
    const k = `${c.caseId}:${key}`;
    if (deps.journal.has(k)) return;
    const detail = await run();
    deps.journal.mark(k, detail ?? '');
    did.push(key);
  };

  // 1. the public ruling
  await step('ruling', async () => {
    const out = await createRuling(deps.arkiv, { caseId: c.caseId, kind: c.kind, value: c.value, outcome: t.outcome!, payload: rulingPayload(c, t) });
    return out.entityKey;
  });

  // 2. the reporter's deposit
  await step('escrow', async () => {
    const d = await deps.escrow.deposit(c.reporter, c.reportId);
    if (d.status !== 'locked') return `already ${d.status}`; // settled by an earlier run that crashed before journaling
    const tx = result === 'confirmed' ? await deps.escrow.confirm(c.reporter, c.reportId) : await deps.escrow.reject(c.reporter, c.reportId);
    return tx.hash;
  });

  // 3. jurors who lost, or did not reveal, lose part of their stake into the pool
  for (const [group, wei] of [[t.losers, deps.slashLoserWei], [t.nonReveal, deps.slashNonRevealWei]] as const) {
    for (const j of group) {
      if (wei <= 0n) continue;
      await step(`slash:${j.toLowerCase()}`, async () => (await deps.escrow.slash(j, wei)).hash);
    }
  }

  // 4. the bounty, to a one-time stealth address, only for a confirmed report
  if (result === 'confirmed' && c.reporterMeta) {
    await step('bounty', async () => {
      // the escrow knows this bounty only by an opaque id that nobody else can derive, so no payment can be tied to a report on chain
      const bountyId = bountyIdFor(deps.stealthPayerSecret, c.reportId);
      // paid by an earlier run that crashed before journaling: nothing to do (the contract would refuse a second payment anyway)
      if (await deps.escrow.bountyPaid(bountyId)) return 'already paid';
      const pay = createPayment(c.reporterMeta!, ephemeralFor(deps.stealthPayerSecret, c.reportId));
      // announce first: if the payment then fails the announcement is harmless and the retry reuses the same address
      await createBounty(deps.arkiv, { reportId: c.reportId, amountTier: deps.bountyTier, ephemeralPublicKey: pay.ephemeralPublicKey });
      const tx = await deps.escrow.payBounty(bountyId, pay.stealthAddress);
      return tx.hash;
    });
  }

  // 5. reputation: the reporter for the report, jurors for how they voted
  const at = deps.now();
  const repEvents: RepEvent[] = [];
  const rep = repEventFromSettlement(result, c.reporter, c.reportId, at);
  if (rep) repEvents.push(rep);
  for (const j of t.winners) repEvents.push({ wallet: j.toLowerCase(), kind: 'juror_won', at, ref: c.caseId });
  for (const j of [...t.losers, ...t.nonReveal]) repEvents.push({ wallet: j.toLowerCase(), kind: 'juror_lost', at, ref: c.caseId });

  return { status: 'settled', result, outcome: t.outcome, did, repEvents };
}


/**
 * Settles a DISPUTE case: the owner of a flagged address contested the flag. There is no deposit, so nothing moves for the
 * owner. The panel publishes its ruling (a `clear` ruling overrides the flags, a `block` ruling confirms them), jurors on the
 * losing side or who did not reveal are slashed, and jurors earn or lose reputation as in any case.
 */
export async function settleDisputeCase(deps: SettleDeps, c: ReportCase, t: Tally): Promise<SettleResult> {
  if (t.status !== 'ruled' || t.outcome === null) return { status: 'inconclusive', result: null, outcome: null, did: [], repEvents: [] };

  const did: string[] = [];
  const step = async (key: string, run: () => Promise<string | void>) => {
    const k = `${c.caseId}:${key}`;
    if (deps.journal.has(k)) return;
    const detail = await run();
    deps.journal.mark(k, detail ?? '');
    did.push(key);
  };

  await step('ruling', async () => {
    const out = await createRuling(deps.arkiv, { caseId: c.caseId, kind: c.kind, value: c.value, outcome: t.outcome!, payload: rulingPayload(c, t) });
    return out.entityKey;
  });
  for (const [group, wei] of [[t.losers, deps.slashLoserWei], [t.nonReveal, deps.slashNonRevealWei]] as const) {
    for (const j of group) {
      if (wei <= 0n) continue;
      await step(`slash:${j.toLowerCase()}`, async () => (await deps.escrow.slash(j, wei)).hash);
    }
  }

  const at = deps.now();
  const repEvents: RepEvent[] = [];
  for (const j of t.winners) repEvents.push({ wallet: j.toLowerCase(), kind: 'juror_won', at, ref: c.caseId });
  for (const j of [...t.losers, ...t.nonReveal]) repEvents.push({ wallet: j.toLowerCase(), kind: 'juror_lost', at, ref: c.caseId });
  return { status: 'settled', result: null, outcome: t.outcome, did, repEvents };
}

/** One entry point for the driver: a report case or a dispute case. */
export const settleCase = (deps: SettleDeps, c: ReportCase, t: Tally): Promise<SettleResult> =>
  c.type === 'dispute' ? settleDisputeCase(deps, c, t) : settleReportCase(deps, c, t);
