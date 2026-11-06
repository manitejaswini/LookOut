import { createClient, createPirClient } from '@lookout/client';
import type { CheckResult, TargetKind } from '@lookout/core';
import { checkTarget as mockCheck } from './mock';

/**
 * One entry point for "check this target". In order of preference:
 *  1. NEXT_PUBLIC_PIR_A + NEXT_PUBLIC_PIR_B: private 2-server PIR lookup (the real thing).
 *     Results say `verified: true` only if NEXT_PUBLIC_PIR_ROOTS lists a root for the snapshot.
 *     That variable is a stand-in for the `snapshot` entities on Arkiv until the indexer
 *     publishes them. Without it the lookup still runs and is shown as UNVERIFIED.
 *  2. NEXT_PUBLIC_INDEXER_URL: plain lookup that reveals the target to the indexer.
 *  3. Neither: mock data, so the demo still works if a service is down.
 */
const pirA = process.env.NEXT_PUBLIC_PIR_A;
const pirB = process.env.NEXT_PUBLIC_PIR_B;
const roots = process.env.NEXT_PUBLIC_PIR_ROOTS?.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL;

const live = pirA && pirB
  ? createPirClient({ pairs: [{ a: pirA, b: pirB }], publishedRoots: roots?.length ? async () => roots : undefined })
  : indexerUrl
    ? createClient({ indexerUrl })
    : null;

export const MODE: 'pir' | 'indexer' | 'mock' = pirA && pirB ? 'pir' : indexerUrl ? 'indexer' : 'mock';
export const LIVE = live !== null;

export async function checkTarget(value: string, kind?: TargetKind): Promise<CheckResult> {
  return live ? live.checkTarget(value, kind) : mockCheck(value);
}
