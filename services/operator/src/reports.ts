import { caseIdFor, decodeReportPayload, verifyOwnerProof } from '@lookout/core';
import type { DepositStatus } from '@lookout/escrow';
import type { ReportToResolve } from './settle.ts';

/**
 * Decides WHICH reports and disputes the operator has to deal with, from what is on Arkiv. Pure apart from the two lookups it is handed.
 *
 *  REPORT    a `report` whose payload names its target (and matches the hash) AND whose deposit is LOCKED in the escrow CONTRACT.
 *            The contract is asked, not the Arkiv `stake` mirror, because the contract is the source of truth for money: a forged
 *            or stale mirror cannot make the operator act.
 *  DISPUTE   an `attestation` that claims `legit` and carries a valid owner proof (core/owner-proof.ts). The signer IS the target,
 *            so the plain text comes from the proof and not from anything the disputer typed.
 */

export interface ReportRow {
  key: string;
  creator: string;
  reportId: string;
  targetHash: string;
  /** unix seconds the report entity was created */
  createdAt: number;
  payload?: Uint8Array;
}

export interface AttestationRow {
  key: string;
  creator: string;
  targetHash: string;
  claim: string;
  /** unix seconds the dispute was created */
  createdAt?: number;
  /** the owner's signature, 0x hex */
  payload?: string;
}

export interface PlanPorts {
  /** the escrow contract's view of this deposit */
  deposit(reporter: string, reportId: string): Promise<{ status: DepositStatus }>;
}

export interface Skipped {
  key: string;
  reason: string;
}

export async function planReports(rows: readonly ReportRow[], ports: PlanPorts): Promise<{ reports: ReportToResolve[]; skipped: Skipped[] }> {
  const reports: ReportToResolve[] = [];
  const skipped: Skipped[] = [];
  for (const r of rows) {
    const decoded = decodeReportPayload(r.payload, r.targetHash);
    if (!decoded.ok) { skipped.push({ key: r.key, reason: decoded.reason }); continue; }
    let status: DepositStatus;
    try {
      status = (await ports.deposit(r.creator, r.reportId)).status;
    } catch (e) {
      skipped.push({ key: r.key, reason: `escrow lookup failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (status !== 'locked') { skipped.push({ key: r.key, reason: `deposit is ${status}, not locked` }); continue; }
    reports.push({
      key: r.key, reportId: r.reportId, reporter: r.creator.toLowerCase(), createdAt: r.createdAt, targetHash: r.targetHash.toLowerCase(),
      kind: decoded.payload.kind, value: decoded.payload.target,
    });
  }
  return { reports, skipped };
}

export interface Dispute {
  caseId: string;
  entityKey: string;
  /** the flagged wallet address, recovered from the signature */
  owner: string;
  targetHash: string;
  createdAt: number | null;
}

/** Owner disputes with a valid proof. These wait for an operator ruling: a dispute never clears a flag by itself. */
export function listDisputes(rows: readonly AttestationRow[]): { disputes: Dispute[]; skipped: Skipped[] } {
  const disputes: Dispute[] = [];
  const skipped: Skipped[] = [];
  for (const a of rows) {
    if (a.claim !== 'legit') { skipped.push({ key: a.key, reason: 'not a dispute' }); continue; }
    const proof = verifyOwnerProof({ targetHash: a.targetHash, creator: a.creator }, a.payload);
    if (!proof.ok) { skipped.push({ key: a.key, reason: proof.reason }); continue; }
    disputes.push({ caseId: caseIdFor(a.targetHash, a.key), entityKey: a.key, owner: proof.address, targetHash: a.targetHash.toLowerCase(), createdAt: a.createdAt ?? null });
  }
  return { disputes, skipped };
}
