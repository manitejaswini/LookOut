import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * Evidence is what makes a block verdict "re-checkable". The checker writes the evidence JSON into the verdict's
 * payload, and puts keccak256 of that exact text into `proofHash`. Anyone can read the payload, recompute the hash and
 * confirm the finding was not altered, then repeat the observation (fetch the URL, read the contract) themselves.
 */

/** JSON with sorted keys and no whitespace, so the same evidence always produces the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

export const evidenceBytes = (evidence: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(evidence));

/** 0x + 64 lowercase hex: the value stored as `proofHash` on the verdict. */
export const evidenceHash = (evidence: unknown): string => toHex(keccak_256(evidenceBytes(evidence)));

/** The check an auditor runs: does this payload match the proofHash on the verdict? */
export function verifyProof(payload: Uint8Array, proofHash: string): boolean {
  return toHex(keccak_256(payload)) === proofHash.toLowerCase();
}

/** Truncates to at most `max` UTF-8 bytes without cutting a character in half (Arkiv `str` limit is 128 bytes). */
export function fit(text: string, max = 128): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (enc.encode(out + ch + '…').length > max) break;
    out += ch;
  }
  return `${out}…`;
}
