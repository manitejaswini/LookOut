import { createClient, createPirClient } from '@lookout/client';
import type { OnPirEvent } from '@lookout/client';
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

const pirClient = pirA && pirB
  ? createPirClient({ pairs: [{ a: pirA, b: pirB }], publishedRoots: roots?.length ? async () => roots : undefined })
  : null;
const live = pirClient ?? (indexerUrl ? createClient({ indexerUrl }) : null);

/** Base URL of Dev A's indexer, if configured. The explorer reads public Arkiv entities from it. */
export const INDEXER_URL = indexerUrl;

export const MODE: 'pir' | 'indexer' | 'mock' = pirA && pirB ? 'pir' : indexerUrl ? 'indexer' : 'mock';
export const LIVE = live !== null;

/** The PIR servers, for showing what each one logged. Null unless running in pir mode. */
export const PIR_SERVERS = pirA && pirB ? { a: pirA, b: pirB } : null;

/** `onEvent` reports the real PIR steps as they happen. Other modes never call it. */
export async function checkTarget(value: string, kind?: TargetKind, onEvent?: OnPirEvent): Promise<CheckResult> {
  if (pirClient) return pirClient.checkTarget(value, kind, onEvent);
  return live ? live.checkTarget(value, kind) : mockCheck(value);
}
