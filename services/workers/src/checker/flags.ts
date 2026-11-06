import { normalizeTarget, scoreTarget, targetHash, type TargetKind } from '@lookout/core';
import { toScoringInput, type IndexState } from '@lookout/indexer';

/**
 * "Flagged" means: somewhere the checker can point to, this destination is already known to be bad.
 * A source returns a short reason (who says so), or undefined.
 */
export interface FlagSource {
  isFlagged(kind: TargetKind, value: string): string | undefined;
}

interface ListEntry {
  value: string;
  /** where the claim comes from. Required, so nothing unsourced can ever cause a block */
  source: string;
}

export interface FlagList {
  domains?: ListEntry[];
  addresses?: ListEntry[];
}

/** A curated list with a source for every entry. */
export class StaticFlagSource implements FlagSource {
  private byHash = new Map<string, string>();

  constructor(list: FlagList) {
    for (const [kind, entries] of [['domain', list.domains ?? []], ['address', list.addresses ?? []]] as const) {
      for (const e of entries) {
        if (!e.source || typeof e.source !== 'string') throw new Error(`flag list: "${e.value}" has no source. Every entry needs one`);
        normalizeTarget(kind, e.value); // throws on a malformed entry
        this.byHash.set(targetHash(kind, e.value), `${e.source}`);
      }
    }
  }

  isFlagged(kind: TargetKind, value: string): string | undefined {
    try {
      return this.byHash.get(targetHash(kind, value));
    } catch {
      return undefined;
    }
  }
}

/**
 * Flagged = Lookout itself already blocks it. A site that redirects to a destination Lookout blocks is part of the
 * same attack, and the proof is checkable: the verdict for the destination is public on Arkiv.
 */
export function indexFlagSource(state: IndexState): FlagSource {
  return {
    isFlagged(kind, value) {
      let hash: string;
      try {
        hash = targetHash(kind, value);
      } catch {
        return undefined;
      }
      const target = state.targets.get(hash);
      if (!target) return undefined;
      const result = scoreTarget(toScoringInput(target, state.timing));
      return result.verdict === 'block' ? `blocked by Lookout (${result.reasons.length} signals)` : undefined;
    },
  };
}

/** The first source that flags it wins. */
export function anyOf(...sources: FlagSource[]): FlagSource {
  return {
    isFlagged(kind, value) {
      for (const s of sources) {
        const r = s.isFlagged(kind, value);
        if (r) return r;
      }
      return undefined;
    },
  };
}
