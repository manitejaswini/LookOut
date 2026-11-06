import { caseIdFor, decodeReportPayload, verifyOwnerProof } from '@lookout/core';
import type { DepositStatus } from '@lookout/escrow';
import type { CaseRequest } from './driver.ts';

/**
 * Decides WHICH cases to open, from what is on Arkiv. Pure apart from the two lookups it is handed.
 *
 *  REPORT case   a `report` whose payload names its target (and matches the hash), whose deposit is LOCKED in the escrow
 *                CONTRACT. The contract is asked, not the Arkiv `stake` mirror, because the contract is the source of truth
 *                for money: a forged or stale mirror cannot open a case.
 *  DISPUTE case  an `attestation` that claims `legit` and carries a valid owner proof (core/owner-proof.ts). The signer IS
 *                the target, so the plain text comes from the proof and not from anything the disputer typed.
 *
 * Opening the same case twice is harmless (the driver ignores a known case id), so this can run on every pass.
 */

export interface ReportRow {
  key: string;
  creator: string;
  reportId: string;
  targetHash: string;
  payload?: Uint8Array;
}

export interface AttestationRow {
  key: string;
  creator: string;
  targetHash: string;
  claim: string;
  /** the owner's signature, 0x hex */
  payload?: string;
}

export interface PlanPorts {
  /** the escrow contract's view of this deposit */
  deposit(reporter: string, reportId: string): Promise<{ status: DepositStatus }>;
  /** opens a sealed bounty address with the payer's key. Returns null if it cannot be opened */
  openSealed(blob: Uint8Array, reportId: string): string | null;
}

export interface Skipped {
  key: string;
  reason: string;
}

export async function planCases(
  input: { reports: readonly ReportRow[]; attestations: readonly AttestationRow[] },
  ports: PlanPorts,
): Promise<{ requests: CaseRequest[]; skipped: Skipped[] }> {
  const requests: CaseRequest[] = [];
  const skipped: Skipped[] = [];

  for (const r of input.reports) {
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

    let reporterMeta: string | undefined;
    if (decoded.payload.sealed) reporterMeta = ports.openSealed(decoded.payload.sealed, r.reportId) ?? undefined;

    requests.push({
      type: 'report', caseId: caseIdFor(r.targetHash, r.key), reportId: r.reportId, reporter: r.creator.toLowerCase(),
      kind: decoded.payload.kind, value: decoded.payload.target, ...(reporterMeta ? { reporterMeta } : {}), exclude: [r.creator.toLowerCase()],
    });
  }

  for (const a of input.attestations) {
    if (a.claim !== 'legit') { skipped.push({ key: a.key, reason: 'not a dispute' }); continue; }
    const proof = verifyOwnerProof({ targetHash: a.targetHash, creator: a.creator }, a.payload);
    if (!proof.ok) { skipped.push({ key: a.key, reason: proof.reason }); continue; }
    requests.push({
      type: 'dispute', caseId: caseIdFor(a.targetHash, a.key), reportId: '', reporter: proof.address, kind: 'address', value: proof.address,
      exclude: [proof.address],
    });
  }

  return { requests, skipped };
}
