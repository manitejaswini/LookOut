import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * A ruling carries a `caseId`: the first 16 hex digits of keccak256(targetHash ":" triggerEntityKey), where the trigger is the
 * dispute (or verdict) the operator is ruling on. Same dispute, same id (arkiv/schema.md).
 */
export function caseIdFor(targetHash: string, triggerEntityKey: string): string {
  const bytes = keccak_256(new TextEncoder().encode(`${targetHash.toLowerCase()}:${triggerEntityKey.toLowerCase()}`));
  return Array.from(bytes.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
