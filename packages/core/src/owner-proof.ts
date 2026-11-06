import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { targetHash } from './target.ts';

/**
 * Proof that the person disputing a flag OWNS the flagged address: a signature, made with that address's own key, over a
 * fixed message that names the target. It is checked with plain maths (ecrecover) and needs no network, no allowlist and no
 * trusted party, so every indexer reaches the same answer from the same bytes.
 *
 *   message = "Lookout dispute v0\ntarget: <targetHash>\nclaim: legit"
 *   payload = the 65-byte personal_sign signature (r, s, v)
 *
 * The signer's address is recovered from the signature, and the proof counts only if that address hashes to the `targetHash`
 * of the dispute. So the target is not taken from anything the disputer writes: it IS the signer.
 *
 * What this covers, plainly: an address that signs with its own key (an ordinary wallet). It does not cover a contract (it has
 * no key), a domain (needs a DNS or file proof), or a smart-contract wallet (would need ERC-1271 on chain). Those cases cannot
 * be disputed by their owner yet, and can still be reviewed through a deposit-backed report.
 */

export const disputeMessage = (targetHashHex: string): string => `Lookout dispute v0\ntarget: ${targetHashHex.toLowerCase()}\nclaim: legit`;

const HEX65 = /^(0x)?[0-9a-fA-F]{130}$/;

const fromHex = (h: string): Uint8Array => Uint8Array.from((h.replace(/^0x/, '').match(/../g) ?? []).map((x) => parseInt(x, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The EIP-191 "personal_sign" digest that wallets sign. */
function personalDigest(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix, 0);
  all.set(body, prefix.length);
  return keccak_256(all);
}

/** The lowercase address that produced a personal_sign signature over `message`, or null if the signature is not valid. */
export function recoverSigner(message: string, signatureHex: string): string | null {
  if (!HEX65.test(signatureHex)) return null;
  const sig = fromHex(signatureHex);
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  if (v !== 0 && v !== 1) return null;
  try {
    const parsed = secp256k1.Signature.fromBytes(sig.subarray(0, 64), 'compact').addRecoveryBit(v);
    const pub = parsed.recoverPublicKey(personalDigest(message)).toBytes(false); // 65 bytes, 0x04 first
    return `0x${toHex(keccak_256(pub.subarray(1)).subarray(12))}`;
  } catch {
    return null;
  }
}

export type OwnerProof = { ok: true; address: string } | { ok: false; reason: string };

/**
 * Does `signatureHex` prove that the owner of the address behind `dispute.targetHash` made this dispute?
 * `ok` carries the recovered address, which is also the plaintext target for the case.
 */
export function verifyOwnerProof(dispute: { targetHash: string; creator: string }, signatureHex: string | undefined): OwnerProof {
  if (!signatureHex) return { ok: false, reason: 'no proof attached' };
  const signer = recoverSigner(disputeMessage(dispute.targetHash), signatureHex);
  if (!signer) return { ok: false, reason: 'not a valid signature' };
  if (targetHash('address', signer) !== dispute.targetHash.toLowerCase()) return { ok: false, reason: 'the signer is not the flagged address' };
  // the dispute must also be WRITTEN by the owner: otherwise anyone could replay a published signature as their own attestation
  if (dispute.creator.toLowerCase() !== signer) return { ok: false, reason: 'the dispute was not written by the signer' };
  return { ok: true, address: signer };
}
