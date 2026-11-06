import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Stealth bounties, ERC-5564 style on secp256k1. Spec and test vectors: arkiv/stealth-format.md.
 * Not ERC-5564 conformant: no view tags (the PRD drops them) and no ERC-6538 registry.
 * Keys never leave the caller. Nothing here does I/O.
 */
export const SCHEME = 'lookout-stealth-v0';
export const META_PREFIX = 'st:eth:0x';

const { Point } = secp256k1;
const N = Point.Fn.ORDER;

export interface StealthKeys {
  spendingKey: Uint8Array; // 32 bytes. Spends the funds. Keep on device.
  viewingKey: Uint8Array; // 32 bytes. Can find payments, cannot spend them.
}

const toScalar = (b: Uint8Array) => BigInt(`0x${bytesToHex(b)}`);
const toBytes32 = (n: bigint) => hexToBytes(n.toString(16).padStart(64, '0'));
const pub = (secret: Uint8Array) => secp256k1.getPublicKey(secret, true);

export function generateKeys(): StealthKeys {
  return { spendingKey: secp256k1.utils.randomSecretKey(), viewingKey: secp256k1.utils.randomSecretKey() };
}

/** `st:eth:0x` + spending pubkey (33 bytes) + viewing pubkey (33 bytes), compressed, hex. */
export function metaAddress(keys: StealthKeys): string {
  return META_PREFIX + bytesToHex(concatBytes(pub(keys.spendingKey), pub(keys.viewingKey)));
}

export function parseMetaAddress(meta: string): { spendingPub: Uint8Array; viewingPub: Uint8Array } {
  if (!meta.startsWith(META_PREFIX)) throw new Error('not a Lookout meta-address');
  const hex = meta.slice(META_PREFIX.length);
  if (!/^[0-9a-f]{132}$/.test(hex)) throw new Error('meta-address must be 66 bytes of lowercase hex');
  const raw = hexToBytes(hex);
  const spendingPub = raw.slice(0, 33);
  const viewingPub = raw.slice(33);
  Point.fromBytes(spendingPub); // throws if not a valid curve point
  Point.fromBytes(viewingPub);
  return { spendingPub, viewingPub };
}

/** h = keccak256(compressed shared point) mod n. Same value on both sides of the ECDH. */
function sharedScalar(shared: Uint8Array): bigint {
  const h = toScalar(keccak_256(shared)) % N;
  if (h === 0n) throw new Error('degenerate shared secret, pick another ephemeral key');
  return h;
}

export function toAddress(point: InstanceType<typeof Point>): string {
  return `0x${bytesToHex(keccak_256(point.toBytes(false).slice(1)).slice(12))}`;
}

/** The address a private key controls. Used by the claimer to prove the derivation closed. */
export function addressFromPrivateKey(secret: Uint8Array): string {
  return toAddress(Point.fromBytes(pub(secret)));
}

/** EIP-55 mixed-case form, for display only. Addresses are stored and compared lowercase. */
export function checksumAddress(address: string): string {
  const a = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(a)));
  return `0x${[...a].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('')}`;
}

/**
 * Payer side. The ephemeral key is deterministic per (payer secret, reportId), so retrying a
 * failed payout reproduces the same address and can never pay one report to two addresses.
 */
export function ephemeralFor(payerSecret: Uint8Array, reportId: string): Uint8Array {
  const r = toScalar(keccak_256(concatBytes(payerSecret, utf8ToBytes(`${SCHEME}:ephemeral:${reportId}`)))) % N;
  if (r === 0n) throw new Error('degenerate ephemeral key');
  return toBytes32(r);
}

/**
 * The opaque id the escrow records a bounty under (`payBounty(bountyId, stealth)`). It is derived from the payer's secret, so
 * nobody else can compute it from a public report id, and the on-chain payment cannot be tied back to a report. The payer can
 * always recompute it, which makes a retry idempotent: the same report always maps to the same id, and the contract refuses a second payment.
 */
export function bountyIdFor(payerSecret: Uint8Array, reportId: string): string {
  return `0x${bytesToHex(keccak_256(concatBytes(payerSecret, utf8ToBytes(`${SCHEME}:bounty-id:${reportId}`))))}`;
}

export interface Payment {
  stealthAddress: string; // lowercase, where the ETH goes
  ephemeralPublicKey: string; // 0x + 33 bytes hex. This is the `bounty` entity payload.
}

export function createPayment(meta: string, ephemeralSecret: Uint8Array): Payment {
  const { spendingPub, viewingPub } = parseMetaAddress(meta);
  const h = sharedScalar(secp256k1.getSharedSecret(ephemeralSecret, viewingPub, true));
  const P = Point.fromBytes(spendingPub).add(Point.BASE.multiply(h));
  return { stealthAddress: toAddress(P), ephemeralPublicKey: `0x${bytesToHex(pub(ephemeralSecret))}` };
}

/** Viewing side: find the address for an announcement. Needs only the viewing key. */
export function stealthAddressFor(viewingKey: Uint8Array, spendingPub: Uint8Array, ephemeralPublicKey: string): string {
  const R = hexToBytes(ephemeralPublicKey.replace(/^0x/, ''));
  const h = sharedScalar(secp256k1.getSharedSecret(viewingKey, R, true));
  return toAddress(Point.fromBytes(spendingPub).add(Point.BASE.multiply(h)));
}

/** Claim side: the private key that controls the stealth address. Needs the spending key. */
export function stealthPrivateKey(keys: StealthKeys, ephemeralPublicKey: string): Uint8Array {
  const R = hexToBytes(ephemeralPublicKey.replace(/^0x/, ''));
  const h = sharedScalar(secp256k1.getSharedSecret(keys.viewingKey, R, true));
  return toBytes32((toScalar(keys.spendingKey) + h) % N);
}

/**
 * No relayer: the stealth address pays its own gas, so the sweep sends balance minus the fee.
 * Returns null when the balance does not cover the fee (the bounty tier must be set above it).
 */
export function sweepValue(balanceWei: bigint, gasPriceWei: bigint, gasLimit = 21_000n): bigint | null {
  const fee = gasPriceWei * gasLimit;
  return balanceWei > fee ? balanceWei - fee : null;
}
