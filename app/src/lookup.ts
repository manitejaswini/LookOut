import { createClient } from '@lookout/client';
import type { CheckResult, TargetKind } from '@lookout/core';
import { checkTarget as mockCheck } from './mock';

/**
 * One entry point for "check this target". With NEXT_PUBLIC_INDEXER_URL set it asks the real
 * indexer through @lookout/client. Without it the app runs on mock data, so the demo still
 * works if a service is down.
 */
const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL;
const live = indexerUrl ? createClient({ indexerUrl }) : null;

export const LIVE = live !== null;

export async function checkTarget(value: string, kind?: TargetKind): Promise<CheckResult> {
  return live ? live.checkTarget(value, kind) : mockCheck(value);
}
