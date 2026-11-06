import { keccak_256 } from '@noble/hashes/sha3.js';
import type { TargetKind } from './types.ts';

/**
 * Canonical form of a target, so every writer, indexer and client computes the same hash.
 * The rules are documented in arkiv/schema.md ("targetHash"). Change both together.
 *
 *  - address / contract: 0x + 40 hex digits, lowercased. EIP-55 checksum case is ignored.
 *  - domain: lowercase punycode host. Scheme, userinfo, port, path, query, fragment and a trailing
 *    dot are dropped. A leading "www." is kept: it is a different host and scams use subdomains.
 */
export function normalizeTarget(kind: TargetKind, value: string): string {
  const raw = value.trim();
  if (kind === 'address' || kind === 'contract') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`invalid ${kind}: ${value}`);
    return raw.toLowerCase();
  }
  if (!raw) throw new Error('empty domain');
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    throw new Error(`invalid domain: ${value}`);
  }
  host = host.replace(/\.$/, '');
  if (!host || !host.includes('.')) throw new Error(`invalid domain: ${value}`);
  return host;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * targetHash = keccak256( namespace ":" normalizedTarget ), as 0x-prefixed lowercase hex.
 * Namespace is "domain" for domains and "evm" for both addresses and contracts, so the same
 * 0x address matches whichever kind a reporter chose.
 */
export function targetHash(kind: TargetKind, value: string): string {
  const ns = kind === 'domain' ? 'domain' : 'evm';
  return `0x${toHex(keccak_256(new TextEncoder().encode(`${ns}:${normalizeTarget(kind, value)}`)))}`;
}
