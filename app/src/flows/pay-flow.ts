import { parseEther } from 'viem';
import type { CheckResult, TargetKind } from '@lookout/core';

/**
 * Paying an address, with Lookout in front of it.
 *
 *   parsePayment -> reviewPayment (private lookup) -> sendPayment (only with enough confirmation)
 *
 * How much confirmation a payment needs depends on what the check found:
 *   unknown (nothing found)   none      one click. Lookout never says "safe", only "found nothing".
 *   warn                      care      the person confirms they have seen the warning
 *   block                     override  the person explicitly chooses "send anyway", and it is logged
 *   the check itself failed   override  a failed check is never read as "fine". A person has to choose
 *
 * "Send anyway" is allowed on purpose: a wallet should inform, not imprison. The decision is made by the person, and the
 * send is refused unless the confirmation they gave is at least what this review demands.
 */

export type Tier = 'none' | 'care' | 'override';
const RANK: Record<Tier, number> = { none: 0, care: 1, override: 2 };

export interface PaymentInput {
  recipient: string;
  amountEth: string;
}

export interface Payment {
  recipient: `0x${string}`; // lowercase
  amountWei: bigint;
}

export class PayError extends Error {
  code: 'bad-input' | 'needs-confirmation' | 'stale-review' | 'send-failed';
  constructor(code: PayError['code'], message: string) {
    super(message);
    this.name = 'PayError';
    this.code = code;
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d{1,9}(\.\d{1,18})?$/;
const ZERO = '0x0000000000000000000000000000000000000000';

/** Checks what was typed. Returns the payment, or the reason it cannot be one. */
export function parsePayment(input: PaymentInput): { ok: true; payment: Payment } | { ok: false; error: string } {
  const to = input.recipient.trim();
  if (!ADDRESS.test(to)) return { ok: false, error: 'Enter a full wallet address: 0x followed by 40 hex characters.' };
  if (to.toLowerCase() === ZERO) return { ok: false, error: 'That is the zero address. Funds sent there are burned.' };
  const amt = input.amountEth.trim();
  if (!AMOUNT.test(amt)) return { ok: false, error: 'Enter an amount in ETH, like 0.001.' };
  const wei = parseEther(amt);
  if (wei <= 0n) return { ok: false, error: 'The amount must be more than zero.' };
  return { ok: true, payment: { recipient: to.toLowerCase() as `0x${string}`, amountWei: wei } };
}

export function tierFor(check: CheckResult | null): Tier {
  if (!check) return 'override'; // the check did not complete
  if (check.verdict === 'block') return 'override';
  if (check.verdict === 'warn') return 'care';
  return 'none';
}

export interface Review {
  payment: Payment;
  /** null when the check could not be completed */
  check: CheckResult | null;
  checkError?: string;
  tier: Tier;
  /** unix ms the review was made, so an old review cannot be used to send later */
  at: number;
}

export interface ReviewPorts {
  checkTarget(value: string, kind?: TargetKind): Promise<CheckResult>;
  now(): number;
}

export async function reviewPayment(ports: ReviewPorts, payment: Payment): Promise<Review> {
  try {
    const check = await ports.checkTarget(payment.recipient, 'address');
    return { payment, check, tier: tierFor(check), at: ports.now() };
  } catch (e) {
    return { payment, check: null, checkError: e instanceof Error ? e.message : String(e), tier: 'override', at: ports.now() };
  }
}

/** What is written down every time a payment is attempted past a warning, so overrides are never silent. */
export interface PaymentRecord {
  at: number;
  recipient: string;
  amountWei: string;
  verdict: CheckResult['verdict'] | 'check-failed';
  tier: Tier;
  ack: Tier;
  /** true when the person went ahead although the review asked for more than a plain click */
  overrode: boolean;
  txHash?: string;
}

export interface SendPorts {
  now(): number;
  switchChain(): Promise<void>;
  sendEth(to: `0x${string}`, wei: bigint): Promise<{ hash: string }>;
  record(entry: PaymentRecord): void;
}

/** A review older than this is not used to send: the table may have changed. */
export const REVIEW_MAX_AGE_MS = 10 * 60_000;

export async function sendPayment(ports: SendPorts, review: Review, ack: Tier): Promise<{ hash: string; record: PaymentRecord }> {
  if (RANK[ack] < RANK[review.tier]) {
    const need = review.tier === 'override' ? 'choose "send anyway"' : 'confirm that you have read the warning';
    throw new PayError('needs-confirmation', `This payment needs you to ${need} first.`);
  }
  if (ports.now() - review.at > REVIEW_MAX_AGE_MS) throw new PayError('stale-review', 'This check is more than 10 minutes old. Check the address again before sending.');

  const entry: PaymentRecord = {
    at: ports.now(), recipient: review.payment.recipient, amountWei: review.payment.amountWei.toString(),
    verdict: review.check ? review.check.verdict : 'check-failed', tier: review.tier, ack, overrode: review.tier !== 'none',
  };
  // the intent is written down BEFORE anything is sent, so an override is on record even if the wallet then fails
  ports.record(entry);
  try {
    await ports.switchChain();
    const { hash } = await ports.sendEth(review.payment.recipient, review.payment.amountWei);
    const done = { ...entry, txHash: hash };
    ports.record(done);
    return { hash, record: done };
  } catch (e) {
    throw new PayError('send-failed', e instanceof Error ? e.message : String(e));
  }
}
