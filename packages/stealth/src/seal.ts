import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { META_PREFIX, SCHEME, parseMetaAddress } from './stealth.ts';

/**
 * Seals a reporter's meta-address so only the payer can read it. It goes in the `report`
 * entity payload on Arkiv, which is public. Spec: arkiv/stealth-format.md ("Sealing").
 *
 *   blob = 0x01 || ephemeralPub (33) || nonce (12) || ciphertext (66) || tag (16)   = 128 bytes
 *
 * ECIES on secp256k1: ECDH, HKDF-SHA256, ChaCha20-Poly1305. The reportId is bound in as
 * associated data, so a blob copied onto another report fails to open.
 */
export const SEAL_VERSION = 1;
export const SEALED_LENGTH = 128;

const KEY_INFO = utf8ToBytes(`${SCHEME}:seal-key`);
const aad = (reportId: string) => utf8ToBytes(`${SCHEME}:seal:${reportId}`);
const sealKey = (shared: Uint8Array) => hkdf(sha256, shared, undefined, KEY_INFO, 32);

export interface SealOptions {
  /** Fixed values for tests only. Production leaves both out and gets fresh randomness. */
  ephemeralSecret?: Uint8Array;
  nonce?: Uint8Array;
}

/** `payerEncryptionKey` is the payer's compressed public key, 33 bytes, hex with or without 0x. */
export function sealMetaAddress(meta: string, payerEncryptionKey: string, reportId: string, opts: SealOptions = {}): Uint8Array {
  const { spendingPub, viewingPub } = parseMetaAddress(meta);
  const payerPub = hexToBytes(payerEncryptionKey.replace(/^0x/, ''));
  secp256k1.Point.fromBytes(payerPub); // throws on a bad key
  const eph = opts.ephemeralSecret ?? secp256k1.utils.randomSecretKey();
  const nonce = opts.nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const key = sealKey(secp256k1.getSharedSecret(eph, payerPub, true));
  const ct = chacha20poly1305(key, nonce, aad(reportId)).encrypt(concatBytes(spendingPub, viewingPub));
  return concatBytes(Uint8Array.of(SEAL_VERSION), secp256k1.getPublicKey(eph, true), nonce, ct);
}

/** Payer side. Throws if the blob was altered, belongs to another report, or this is the wrong key. */
export function openMetaAddress(blob: Uint8Array, payerSecret: Uint8Array, reportId: string): string {
  if (blob.length !== SEALED_LENGTH) throw new Error(`sealed meta-address must be ${SEALED_LENGTH} bytes`);
  if (blob[0] !== SEAL_VERSION) throw new Error(`unknown seal version ${blob[0]}`);
  const ephPub = blob.slice(1, 34);
  const nonce = blob.slice(34, 46);
  const key = sealKey(secp256k1.getSharedSecret(payerSecret, ephPub, true));
  let plain: Uint8Array;
  try {
    plain = chacha20poly1305(key, nonce, aad(reportId)).decrypt(blob.slice(46));
  } catch {
    throw new Error('cannot open sealed meta-address (wrong key, wrong report, or tampered)');
  }
  const meta = META_PREFIX + bytesToHex(plain);
  parseMetaAddress(meta); // never hand back something that is not a valid meta-address
  return meta;
}

export const payerEncryptionPublicKey = (payerSecret: Uint8Array): string => `0x${bytesToHex(secp256k1.getPublicKey(payerSecret, true))}`;
