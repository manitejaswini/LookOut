/**
 * What the escrow owes the connected wallet, and what it can do about it.
 *
 *  - A refund (a report was confirmed or refunded) is held in the contract until the owner CLAIMS it. It is pulled, not pushed, so a
 *    wallet that refuses ETH can never block anyone else's settlement.
 *  - A deposit nobody settled can be RECLAIMED by the reporter once the window has passed. No bounty, no reputation change.
 */

export type DepositStatus = 'none' | 'locked' | 'returned' | 'slashed' | 'reclaimed' | 'refunded';

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
  locked: 'Waiting for a trusted source to corroborate it.',
  returned: 'Confirmed: a trusted source corroborated this report. The deposit was returned to you.',
  slashed: 'The operator rejected this report. The deposit went to the bounty pool.',
  reclaimed: 'You took this deposit back after nobody settled it in time.',
  refunded: 'Refunded: the report added nothing new, or no trusted source corroborated it in time. No bounty, and your reputation did not change.',
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
      ? `${NOTE.locked} You can take the deposit back yourself in ${Math.ceil((reclaimableAt - now) / 86_400)} day(s) if nobody settles it.`
      : d.status === 'locked' && canReclaim ? 'Nobody has settled this in time. You can take the deposit back now.' : NOTE[d.status];
    deposits.push({ ...r, status: d.status, reclaimableAt, canReclaim, note });
  }
  return { claimableWei, deposits };
}
