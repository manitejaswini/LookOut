import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { createClient, createPirClient } from '@lookout/client';
import type { OnPirEvent } from '@lookout/client';
import type { CheckResult, TargetKind } from '@lookout/core';
import { arkivRootsSource, type TrustedIndexer } from '@lookout/arkiv/roots';
import { http } from 'viem';
import { checkTarget as mockCheck } from './mock';

/**
 * One entry point for "check this target". In order of preference:
 *  1. NEXT_PUBLIC_PIR_A + NEXT_PUBLIC_PIR_B: private 2-server PIR lookup (the real thing). The root of the table the
 *     servers hold is checked against the `snapshot` entities on Arkiv, accepting only indexers listed in
 *     services/indexer/registry.json. If Arkiv does not vouch for the table, the lookup FAILS rather than answering.
 *     NEXT_PUBLIC_PIR_VERIFY=off skips that check and the result is shown as UNVERIFIED (for servers whose snapshot
 *     is not published, such as `npm run demo -w @lookout/pir-server`).
 *     NEXT_PUBLIC_PIR_ROOTS=0x..,0x.. is a test override that supplies the accepted roots by hand.
 *  2. NEXT_PUBLIC_INDEXER_URL: plain lookup that reveals the target to the indexer.
 *  3. Neither: mock data, so the demo still works if a service is down.
 */
const pirA = process.env.NEXT_PUBLIC_PIR_A;
const pirB = process.env.NEXT_PUBLIC_PIR_B;
const manualRoots = process.env.NEXT_PUBLIC_PIR_ROOTS?.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
const verifyOff = process.env.NEXT_PUBLIC_PIR_VERIFY === 'off';
const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL;
const trusted = JSON.parse(process.env.NEXT_PUBLIC_TRUSTED_INDEXERS ?? '[]') as TrustedIndexer[];

/** Reads Arkiv without an access key (the public RPC is rate limited). A key would also identify this visitor to Arkiv. */
function publishedRoots() {
  if (verifyOff) return undefined;
  if (manualRoots?.length) return async () => manualRoots;
  if (trusted.length === 0) return undefined;
  return arkivRootsSource({ publicClient: createPublicClient({ chain: rabdi({ accessKey: '' }), transport: http() }), trusted });
}

const pirClient = pirA && pirB ? createPirClient({ pairs: [{ a: pirA, b: pirB }], publishedRoots: publishedRoots() }) : null;
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
