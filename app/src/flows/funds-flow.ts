/**
 * What the escrow owes the connected wallet, and what it can do about it.
 *
 *  - A refund (the panel confirmed a report) is held in the contract until the owner CLAIMS it. It is pulled, not pushed, so a
 *    wallet that refuses ETH can never block anyone else's settlement.
 *  - A deposit the panel never ruled on can be RECLAIMED by the reporter once the window has passed. No bounty, no reputation change.
 */

export type DepositStatus = 'none' | 'locked' | 'returned' | 'slashed' | 'reclaimed';

export interface FundsPorts {
  claimable(address: string): Promise<bigint>;
  deposit(address: string, reportId: string): Promise<{ status: DepositStatus; lockedAt: bigint }>;
  /** seconds a deposit must wait before the reporter may reclaim it */
  resolveWindow(): Promise<bigint>;
  /** unix seconds */
  now(): number;
}

export interface SavedReport {
  reportId: string;
  kind: string;
  value: string;
  /** unix seconds the report was filed from this browser */
  at: number;
}

export interface DepositView extends SavedReport {
  status: DepositStatus;
  /** unix seconds from which the reporter may reclaim, or null when not locked */
  reclaimableAt: number | null;
  canReclaim: boolean;
  /** a plain sentence for the person */
  note: string;
}

export interface Funds {
  claimableWei: bigint;
  deposits: DepositView[];
}

const NOTE: Record<DepositStatus, string> = {
  none: 'No deposit was found for this report in the escrow.',
  locked: 'Waiting for the review panel.',
  returned: 'The panel confirmed this report. The deposit was refunded to you.',
  slashed: 'The panel rejected this report. The deposit went to the bounty pool.',
  reclaimed: 'You took this deposit back after the panel did not rule in time.',
};

export async function loadFunds(ports: FundsPorts, address: string, reports: readonly SavedReport[]): Promise<Funds> {
  const [claimableWei, window] = [await ports.claimable(address), await ports.resolveWindow()];
  const now = ports.now();
  const deposits: DepositView[] = [];
  for (const r of reports) {
    let d: { status: DepositStatus; lockedAt: bigint };
    try {
      d = await ports.deposit(address, r.reportId);
    } catch {
      continue; // one unreadable report must not hide the rest
    }
    const reclaimableAt = d.status === 'locked' ? Number(d.lockedAt + window) : null;
    const canReclaim = reclaimableAt !== null && now >= reclaimableAt;
    const note = d.status === 'locked' && reclaimableAt !== null && !canReclaim
      ? `${NOTE.locked} You can take the deposit back yourself in ${Math.ceil((reclaimableAt - now) / 86_400)} day(s) if nobody rules.`
      : d.status === 'locked' && canReclaim ? 'The panel has not ruled in time. You can take the deposit back now.' : NOTE[d.status];
    deposits.push({ ...r, status: d.status, reclaimableAt, canReclaim, note });
  }
  return { claimableWei, deposits };
}
