import { normalizeTarget } from '@lookout/core';
import type { CheckResult, TargetKind } from '@lookout/core';

/** What a wallet or an agent needs: one question, one answer. Every lookup path implements this. */
export interface LookoutClient {
  checkTarget(value: string, kind?: TargetKind): Promise<CheckResult>;
}

export interface ClientOptions {
  /** Base URL of the indexer, e.g. http://localhost:8787 */
  indexerUrl: string;
  fetch?: typeof fetch;
}

export const inferKind = (value: string): TargetKind =>
  /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? 'address' : 'domain';

export class LookupError extends Error {}

/**
 * The TEMPORARY plain lookup against Dev A's indexer: `GET /lookup?kind=&value=` returns a finished
 * CheckResult. It is NOT private: the indexer sees exactly what you check, and it does the scoring.
 * `verified` is always false, because nothing is checked against a root. Use `createPirClient` for the
 * real thing. This exists for development and as a fallback while PIR servers are not running.
 */
export function createClient({ indexerUrl, fetch: doFetch = fetch }: ClientOptions): LookoutClient {
  const base = indexerUrl.replace(/\/+$/, '');

  async function checkTarget(value: string, kind: TargetKind = inferKind(value)): Promise<CheckResult> {
    normalizeTarget(kind, value); // throws on malformed input, before any request
    let res: Response;
    try {
      res = await doFetch(`${base}/lookup?kind=${kind}&value=${encodeURIComponent(value)}`);
    } catch (e) {
      throw new LookupError(`indexer unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new LookupError(`indexer returned ${res.status}`);
    const { private: _private, targetHash: _hash, ...result } = (await res.json()) as CheckResult & { private?: boolean; targetHash?: string };
    void _private; void _hash;
    return { ...result, verified: false };
  }

  return { checkTarget };
}
