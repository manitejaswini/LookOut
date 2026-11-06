import { keccak_256 } from '@noble/hashes/sha3.js';
import { verifyReveal, type VoteOutcome } from './vote.ts';

/**
 * The reviewer panel's rules, as pure functions. The panel SERVICE (services/panel) only moves data in and out; every
 * decision it makes can be re-run by anyone from public data:
 *
 *  - WHO judges:   drawJurors(). Sorted by keccak256(seed : caseId : wallet), so nobody, including the service, can pick
 *                  friendly jurors once the seed is fixed. The seed must be unpredictable when the case is opened and
 *                  public afterwards: the service uses the hash of an Arkiv block that is produced AFTER the case opens.
 *  - WHAT they decided: tally(). Only reveals that match the commitment published earlier count.
 *
 * Plainly stated limits: the service could still withhold or delay a case, and a single draw cannot stop one person
 * from running several seats, which is why each seat needs a World ID nullifier (one per human) plus a stake.
 */

export interface Candidate {
  /** 0x address of the reviewer */
  wallet: string;
  /** current reputation (checkpointed, see reputation.ts) */
  rep: number;
  /** stake locked in escrow, in wei */
  stakeWei: bigint;
  /** the seat's World ID nullifier. Two candidates with the same nullifier are one human */
  nullifier: string;
}

export interface DrawInput {
  caseId: string;
  /** 0x + 64 hex, public, unpredictable before the case opened */
  seed: string;
  candidates: readonly Candidate[];
  size: number;
  /** wallets that may not judge this case: the reporter, whoever disputed, and anyone they share a seat with */
  exclude?: readonly string[];
  minRep?: number;
  minStakeWei: bigint;
}

export class PanelError extends Error {
  code: 'TooFewEligible' | 'BadInput';
  constructor(code: 'TooFewEligible' | 'BadInput', message: string) {
    super(message);
    this.name = 'PanelError';
    this.code = code;
  }
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rankOf = (seed: string, caseId: string, wallet: string) =>
  toHex(keccak_256(new TextEncoder().encode(`lookout.draw.v0:${seed.toLowerCase()}:${caseId}:${wallet.toLowerCase()}`)));

/** The wallets eligible for this case, before the draw. Exported so a verifier can recompute it. */
export function eligible(input: DrawInput): Candidate[] {
  const out = new Set((input.exclude ?? []).map((w) => w.toLowerCase()));
  // a human who is excluded excludes all of their seats
  const blockedNullifiers = new Set(input.candidates.filter((c) => out.has(c.wallet.toLowerCase())).map((c) => c.nullifier));
  const seenWallet = new Set<string>();
  const seenNullifier = new Set<string>();
  const list: Candidate[] = [];
  const sorted = [...input.candidates].sort((a, b) => (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1));
  for (const c of sorted) {
    const w = c.wallet.toLowerCase();
    if (out.has(w) || blockedNullifiers.has(c.nullifier)) continue;
    if (c.stakeWei < input.minStakeWei) continue;
    if (c.rep < (input.minRep ?? 0)) continue;
    if (seenWallet.has(w) || seenNullifier.has(c.nullifier)) continue; // one human, one seat
    seenWallet.add(w);
    seenNullifier.add(c.nullifier);
    list.push(c);
  }
  return list;
}

/** Picks `size` jurors. Same input, same jurors, on any machine. Throws if there are not enough eligible reviewers. */
export function drawJurors(input: DrawInput): string[] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.seed)) throw new PanelError('BadInput', 'seed must be 0x + 64 hex digits');
  if (!/^[0-9a-f]{16}$/.test(input.caseId)) throw new PanelError('BadInput', 'caseId must be 16 lowercase hex digits');
  if (!Number.isInteger(input.size) || input.size < 1 || input.size % 2 === 0) throw new PanelError('BadInput', 'panel size must be an odd number');
  const pool = eligible(input);
  if (pool.length < input.size) throw new PanelError('TooFewEligible', `need ${input.size} eligible reviewers, have ${pool.length}`);
  return pool
    .map((c) => ({ w: c.wallet.toLowerCase(), r: rankOf(input.seed, input.caseId, c.wallet) }))
    .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0))
    .slice(0, input.size)
    .map((x) => x.w);
}

/* ---------------------------------- tally ---------------------------------- */

export interface Reveal {
  outcome: VoteOutcome;
  salt: string;
}

export interface TallyInput {
  caseId: string;
  jurors: readonly string[];
  /** wallet to the commitHash it published in the commit round */
  commits: ReadonlyMap<string, string>;
  /** wallet to what it revealed. Reveals by non-jurors are ignored */
  reveals: ReadonlyMap<string, Reveal>;
  /** minimum number of VALID reveals for a ruling at all */
  quorum: number;
}

export type TallyStatus = 'ruled' | 'inconclusive';

export interface Tally {
  status: TallyStatus;
  /** set only when status is 'ruled' */
  outcome: VoteOutcome | null;
  counts: { block: number; clear: number };
  /** jurors who revealed a valid vote for the winning outcome */
  winners: string[];
  /** jurors who voted the other way */
  losers: string[];
  /** jurors who did not reveal, or whose reveal did not match their commitment. They count as losing */
  nonReveal: string[];
  /** why it was inconclusive, when it was */
  reason?: 'below-quorum' | 'tie';
}

export function tally(input: TallyInput): Tally {
  const jurors = [...new Set(input.jurors.map((j) => j.toLowerCase()))];
  const valid = new Map<string, VoteOutcome>();
  const nonReveal: string[] = [];
  for (const j of jurors) {
    const commit = input.commits.get(j);
    const reveal = input.reveals.get(j);
    if (commit && reveal && verifyReveal(commit, { caseId: input.caseId, outcome: reveal.outcome, salt: reveal.salt, juror: j })) {
      valid.set(j, reveal.outcome);
    } else {
      nonReveal.push(j);
    }
  }
  const counts = { block: 0, clear: 0 };
  for (const o of valid.values()) counts[o]++;

  const base = { counts, nonReveal, winners: [] as string[], losers: [] as string[] };
  if (valid.size < input.quorum) return { status: 'inconclusive', outcome: null, reason: 'below-quorum', ...base };
  if (counts.block === counts.clear) return { status: 'inconclusive', outcome: null, reason: 'tie', ...base };

  const outcome: VoteOutcome = counts.block > counts.clear ? 'block' : 'clear';
  const winners = [...valid].filter(([, o]) => o === outcome).map(([j]) => j);
  const losers = [...valid].filter(([, o]) => o !== outcome).map(([j]) => j);
  return { status: 'ruled', outcome, counts, winners, losers, nonReveal };
}

/**
 * What a ruling means for the report that triggered the case.
 * `block` means the target really is a scam, so the report was right. `clear` means it was not.
 * An inconclusive case settles nothing: the deposit stays locked until a new round, or the reporter's reclaim window.
 */
export function reportResult(t: Tally): 'confirmed' | 'rejected' | null {
  if (t.status !== 'ruled') return null;
  return t.outcome === 'block' ? 'confirmed' : 'rejected';
}
