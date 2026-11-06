import { normalizeTarget, scoreTarget, targetHash, type CheckResult, type TargetKind } from '@lookout/core';
import { buildTargets, toScoringInput, type Dropped, type TargetView } from './signals.ts';
import type { Registry } from './registry.ts';
import type { BlockTiming } from './types.ts';
import type { Store } from './store.ts';

/** Everything a lookup needs, built once per sync. */
export interface IndexState {
  targets: Map<string, TargetView>;
  dropped: Dropped[];
  timing: BlockTiming;
  entityCount: number;
  syncedAt: number;
}

/** Rebuilds the in-memory view from the SQLite store. Returns null if nothing has been synced yet. */
export function loadState(store: Store, registry: Registry): IndexState | null {
  const timing = store.timing();
  if (!timing) return null;
  const entities = store.entities();
  const { targets, dropped } = buildTargets(entities, timing, registry);
  return { targets, dropped, timing, entityCount: entities.length, syncedAt: store.syncedAt() ?? 0 };
}

export interface PlainLookupResult extends CheckResult {
  /** This lookup is NOT private. The server saw the target. It exists only until PIR replaces it. */
  private: false;
  targetHash: string;
}

/**
 * The temporary plain lookup. It scores with the same shared rule the wallet client will run, but it is
 * deliberately NOT private: the caller tells this server what it is checking. Phase 4 replaces it with PIR.
 * `verified` is false because there is no bucket to check against a root yet.
 */
export function lookup(state: IndexState, kind: TargetKind, value: string): PlainLookupResult {
  normalizeTarget(kind, value); // throws on junk, the server turns that into a 400
  const hash = targetHash(kind, value);
  const result = scoreTarget(toScoringInput(state.targets.get(hash), state.timing));
  return { ...result, snapshotId: `plain-${state.timing.currentBlock}`, verified: false, private: false, targetHash: hash };
}
