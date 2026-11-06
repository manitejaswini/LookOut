import { normalizeTarget, type TargetKind } from '@lookout/core';
import { fit } from './evidence.ts';
import type { FlagSource } from './flags.ts';
import type { HopFetcher } from './http.ts';
import { followRedirects, type RedirectChain } from './redirects.ts';

/** A claim the checker is willing to put its name to, with the evidence anyone can re-check. */
export interface Finding {
  kind: 'redirect-to-flagged' | 'known-drainer-bytecode';
  targetKind: TargetKind;
  /** the original target value, as normalised */
  value: string;
  /** one short line for the verdict screen (at most 128 bytes) */
  reason: string;
  evidence: Record<string, unknown>;
}

export interface CheckOutcome {
  finding: Finding | null;
  /** plain-language account of what was looked at, shown even when nothing was found */
  notes: string[];
}

export interface DomainDeps {
  fetchHop: HopFetcher;
  flags: FlagSource;
  now?: () => Date;
}

const EVM_ADDRESS = /0x[0-9a-fA-F]{40}/g;
const LIMITS = ['HTTP and meta-refresh redirects only', 'JavaScript is not run, so script redirects are not seen'];

/**
 * Domain check: follow the site's redirects and see whether any hop sends the visitor to a destination that is
 * already flagged, either a flagged domain or a flagged address placed in the URL. That is evidence anyone can
 * re-check by repeating the request. A site that merely LOOKS suspicious is never blocked by this check.
 */
export async function checkDomain(input: string, deps: DomainDeps): Promise<CheckOutcome> {
  const host = normalizeTarget('domain', input);
  const notes: string[] = [];

  let walk: RedirectChain = await followRedirects(`https://${host}/`, deps.fetchHop);
  if (walk.chain[0].status === 0 && walk.chain.length === 1) {
    notes.push(`https failed (${walk.stoppedBy ?? 'no response'}), trying http`);
    walk = await followRedirects(`http://${host}/`, deps.fetchHop);
  }
  notes.push(`followed ${walk.chain.length} URL${walk.chain.length === 1 ? '' : 's'}: ${walk.chain.map((h) => `${h.status || 'error'}`).join(' -> ')}`);
  if (walk.stoppedBy) notes.push(`stopped: ${walk.stoppedBy}`);
  if (walk.loop) notes.push('the redirects loop');
  if (walk.truncated) notes.push('hop limit reached, later redirects were not followed');

  for (const hop of walk.chain.slice(1)) {
    const url = new URL(hop.url);
    let match: { as: 'domain' | 'address'; value: string; because: string } | undefined;

    if (url.hostname !== host) {
      const because = deps.flags.isFlagged('domain', url.hostname);
      if (because) match = { as: 'domain', value: url.hostname, because };
    }
    if (!match) {
      for (const addr of `${url.pathname}${url.search}`.match(EVM_ADDRESS) ?? []) {
        const because = deps.flags.isFlagged('address', addr);
        if (because) { match = { as: 'address', value: addr.toLowerCase(), because }; break; }
      }
    }
    if (!match) continue;

    const evidence = {
      version: 0,
      type: 'redirect-to-flagged',
      target: host,
      checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
      chain: walk.chain,
      matchedHop: hop.url,
      matchedAs: match.as,
      matchedValue: match.value,
      flaggedBecause: match.because,
      limits: LIMITS,
    };
    notes.push(`FOUND: ${hop.url} is a flagged ${match.as} (${match.because})`);
    return {
      finding: { kind: 'redirect-to-flagged', targetKind: 'domain', value: host, reason: fit(`redirects to flagged ${match.as} ${match.value} (${match.because})`), evidence },
      notes,
    };
  }

  notes.push('no hop led to a flagged destination');
  return { finding: null, notes };
}
