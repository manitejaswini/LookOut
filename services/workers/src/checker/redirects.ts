import type { HopFetcher } from './http.ts';
import { BlockedUrlError, validateUrl } from './ssrf.ts';

export interface Hop {
  url: string;
  status: number;
}

export interface RedirectChain {
  /** every URL visited, in order. The first is the one we started from */
  chain: Hop[];
  finalUrl: string;
  /** we came back to a URL already visited */
  loop: boolean;
  /** we stopped because we hit the hop limit while there was still somewhere to go */
  truncated: boolean;
  /** a hop that the SSRF guard or a network error stopped, with the reason */
  stoppedBy?: string;
}

export const MAX_HOPS = 5;

/**
 * Follows redirects by hand (HTTP 3xx and `meta refresh`), one validated hop at a time. Each next URL is resolved
 * against the current one and re-validated, so a redirect to `http://169.254.169.254/` or to a non-http scheme ends
 * the walk instead of being followed.
 */
export async function followRedirects(start: string, fetchHop: HopFetcher, maxHops = MAX_HOPS): Promise<RedirectChain> {
  const chain: Hop[] = [];
  const seen = new Set<string>();
  let current = validateUrl(start).toString(); // the start URL must pass the guard too
  let loop = false;
  let truncated = false;
  let stoppedBy: string | undefined;

  for (let i = 0; i <= maxHops; i++) {
    seen.add(current);
    let result;
    try {
      result = await fetchHop(current);
    } catch (e) {
      stoppedBy = e instanceof Error ? e.message : String(e);
      if (chain.length === 0) chain.push({ url: current, status: 0 });
      break;
    }
    chain.push({ url: current, status: result.status });

    const next = result.location ?? result.metaRefresh;
    if (!next) break;
    let resolved: string;
    try {
      resolved = validateUrl(new URL(next, current).toString()).toString();
    } catch (e) {
      stoppedBy = e instanceof BlockedUrlError ? `redirect refused: ${e.message}` : `bad redirect target: ${next}`;
      break;
    }
    if (seen.has(resolved)) { loop = true; break; }
    if (i === maxHops) { truncated = true; break; }
    current = resolved;
  }
  return { chain, finalUrl: chain[chain.length - 1].url, loop, truncated, stoppedBy };
}
