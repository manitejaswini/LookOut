import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * Hidden-then-reveal voting for the reviewer panel.
 *
 * A juror first publishes only a commitment (`commitHash`). Nobody, including the panel service and the other jurors, can
 * tell the vote from it, and nobody can copy it. After the commit round closes, the juror reveals `outcome` and `salt`, and
 * anyone can check that they match the commitment published earlier. Changing your vote after seeing others' is impossible.
 *
 * The commitment binds the CASE and the JUROR as well as the vote, so a commitment cannot be replayed in another case or
 * copied by another juror. The salt must be secret and random, otherwise a two-option vote could be guessed by hashing both.
 *
 *   commitHash = keccak256( "lookout.vote.v0:" caseId ":" outcome ":" salt ":" juror )      0x + 64 lowercase hex
 */

export const VOTE_OUTCOMES = ['block', 'clear'] as const;
export type VoteOutcome = (typeof VOTE_OUTCOMES)[number];

const CASE_ID = /^[0-9a-f]{16}$/;
const SALT = /^[0-9a-f]{32,64}$/;
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export interface Commitment {
  caseId: string; // 16 lowercase hex digits, see arkiv/schema.md
  outcome: VoteOutcome;
  salt: string; // 32 to 64 lowercase hex digits, random, kept secret until the reveal
  juror: string; // the reviewer's wallet
}

function check(c: Commitment): void {
  if (!CASE_ID.test(c.caseId)) throw new Error('caseId must be 16 lowercase hex digits');
  if (!(VOTE_OUTCOMES as readonly string[]).includes(c.outcome)) throw new Error(`outcome must be one of ${VOTE_OUTCOMES.join(', ')}`);
  if (!SALT.test(c.salt)) throw new Error('salt must be 32 to 64 lowercase hex digits');
  if (!WALLET.test(c.juror)) throw new Error('juror must be a 0x address');
}

const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

export function commitVote(c: Commitment): string {
  check(c);
  return toHex(keccak_256(new TextEncoder().encode(`lookout.vote.v0:${c.caseId}:${c.outcome}:${c.salt}:${c.juror.toLowerCase()}`)));
}

/** The check anyone runs on a reveal: does it match what the juror committed to? Bad input is simply "no". */
export function verifyReveal(commitHash: string, c: Commitment): boolean {
  try {
    return commitVote(c) === commitHash.toLowerCase();
  } catch {
    return false;
  }
}

/** A fresh random salt (128 bits). The juror's device must keep it until the reveal. */
export function newSalt(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('');
}
