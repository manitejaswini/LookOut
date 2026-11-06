import { emptyTarget, scoreTarget, targetHash } from '@lookout/core';
import type { CheckResult, Signal, TargetKind } from '@lookout/core';

/**
 * What the indexer's plain lookup returns for one targetHash: the raw signals, not a verdict.
 * The client scores them itself, so a wallet never has to trust the indexer's verdict.
 * PROPOSED CONTRACT: Dev A implements `GET /lookup?targetHash=0x...` to return this shape.
 * Phase 4 replaces the transport with PIR; the shape of the answer stays the same.
 */
export interface LookupResponse {
  snapshotId: string;
  disputed: boolean;
  proof?: string;
  ruling?: 'block' | 'clear';
  signals: Signal[];
}

export interface ClientOptions {
  /** Base URL of the indexer, e.g. http://localhost:8787 */
  indexerUrl: string;
  fetch?: typeof fetch;
}

export const inferKind = (value: string): TargetKind =>
  /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? 'address' : 'domain';

export class LookupError extends Error {}

export function createClient({ indexerUrl, fetch: doFetch = fetch }: ClientOptions) {
  const base = indexerUrl.replace(/\/+$/, '');

  /**
   * Same result shape as the mock. `verified` is false until the answer is checked against an
   * Arkiv snapshot root (Phase 4), so a plain lookup never claims a check it did not do.
   */
  async function checkTarget(value: string, kind: TargetKind = inferKind(value)): Promise<CheckResult> {
    const hash = targetHash(kind, value); // throws on malformed input
    let res: Response;
    try {
      res = await doFetch(`${base}/lookup?targetHash=${hash}`);
    } catch (e) {
      throw new LookupError(`indexer unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new LookupError(`indexer returned ${res.status}`);
    const body = (await res.json()) as LookupResponse;
    const result = scoreTarget({
      ...emptyTarget(value, kind),
      signals: body.signals,
      disputed: body.disputed,
      proof: body.proof,
      ruling: body.ruling,
    });
    return { ...result, snapshotId: body.snapshotId, verified: false };
  }

  return { checkTarget };
}

export type LookoutClient = ReturnType<typeof createClient>;
