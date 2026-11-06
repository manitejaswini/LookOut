import { eq, and } from '@arkiv-network/sdk/query';
import { SCHEMAS, createVerdict, refreshVerdict, type EntityWriter, type VerdictInput, type WriteResult } from '@lookout/arkiv';
import { targetHash } from '@lookout/core';
import type { Finding } from './domain.ts';
import { evidenceBytes, evidenceHash } from './evidence.ts';

/** The one source id this checker writes under. It must match services/indexer/registry.json. */
export const CHECKER_SOURCE_ID = 'lookout-checker';

/**
 * A finding becomes a `block` verdict whose `proofHash` is the hash of the evidence and whose payload IS the evidence,
 * so any reader can recompute the hash (see verifyProof in evidence.ts) and then repeat the observation.
 */
export function findingToVerdict(f: Finding): VerdictInput {
  return {
    kind: f.targetKind,
    value: f.value,
    sourceType: 'checker',
    sourceId: CHECKER_SOURCE_ID,
    level: 'block',
    proofHash: evidenceHash(f.evidence),
    reason: f.reason,
    payload: evidenceBytes(f.evidence),
  };
}

export interface PublishResult extends Partial<WriteResult> {
  action: 'created' | 'refreshed';
  entityKey: string;
  proofHash: string;
}

/**
 * Publishes a finding. If this checker already has an unexpired verdict for the target, it is REFRESHED (its lifetime is
 * extended from now) instead of writing a duplicate. A source that stops refreshing lets the flag expire on its own.
 */
export async function publishFinding(writer: EntityWriter, f: Finding, existingKey?: string): Promise<PublishResult> {
  const verdict = findingToVerdict(f);
  if (existingKey) {
    const out = await refreshVerdict(writer, existingKey);
    return { action: 'refreshed', entityKey: existingKey, expiresAt: out.expiresAt, proofHash: verdict.proofHash! };
  }
  const out = await createVerdict(writer, verdict);
  return { action: 'created', ...out, proofHash: verdict.proofHash! };
}

/* The Arkiv query builder types are very deep, so this adapter is loose on purpose. It is covered by the live run. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

/** The entity key of this checker's unexpired verdict for the target, if one exists on Arkiv. */
export async function findExistingVerdict(publicClient: AnyPublicClient, f: Finding, creatorAddress: string): Promise<string | undefined> {
  const { entities } = await publicClient
    .select({ $key: true, $creator: true })
    .from(SCHEMAS.verdict)
    .where(and(eq('targetHash', targetHash(f.targetKind, f.value)), eq('sourceId', CHECKER_SOURCE_ID)))
    .fetch();
  const mine = (entities as { $key: string; $creator: string }[]).find((e) => String(e.$creator).toLowerCase() === creatorAddress.toLowerCase());
  return mine ? String(mine.$key).toLowerCase() : undefined;
}
