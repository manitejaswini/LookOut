import { normalizeTarget, scoreTarget, targetHash, type CheckResult, type TargetKind } from '@lookout/core';
import { buildTargets, toScoringInput, type Dropped, type TargetView } from './signals.ts';
import { epochOf, inEpoch } from './snapshot.ts';
import type { Registry } from './registry.ts';
import type { BlockTiming, StoredEntity } from './types.ts';
import type { Store } from './store.ts';

/** Everything a lookup needs, built once per sync. */
export interface IndexState {
  targets: Map<string, TargetView>;
  dropped: Dropped[];
  /** every stored entity, for the explorer. Signals are built from these, so they are the same rows. */
  entities: StoredEntity[];
  timing: BlockTiming;
  /** the epoch the snapshot describes, with the chain's own timestamp for that block. Null before the first epoch-aware sync */
  epoch: BlockTiming | null;
  /** the targets as of `epoch`: the view every indexer agrees on, and what the PIR snapshot is built from */
  epochTargets: Map<string, TargetView>;
  entityCount: number;
  syncedAt: number;
}

/**
 * Everything a lookup and a snapshot need, from stored entities. Pure, so tests and the loader share it.
 * Caches written before epochs have no stored epoch time (`epoch` null): falling back to arithmetic keeps them
 * working, but such a snapshot cannot be relied on to match another indexer's. Re-sync to get the exact timestamp.
 */
export function buildIndexState(
  entities: StoredEntity[], timing: BlockTiming, epoch: BlockTiming | null, registry: Registry, syncedAt = 0,
): IndexState {
  const { targets, dropped } = buildTargets(entities, timing, registry);
  const e = epoch ?? {
    currentBlock: epochOf(timing.currentBlock),
    currentBlockTime: timing.currentBlockTime - (timing.currentBlock - epochOf(timing.currentBlock)) * timing.blockDuration,
    blockDuration: timing.blockDuration,
  };
  const epochTargets = buildTargets(entities.filter((x) => inEpoch(x, e.currentBlock)), e, registry).targets;
  return { targets, dropped, entities, timing, epoch: e, epochTargets, entityCount: entities.length, syncedAt };
}

/** Rebuilds the in-memory view from the SQLite store. Returns null if nothing has been synced yet. */
export function loadState(store: Store, registry: Registry): IndexState | null {
  const timing = store.timing();
  if (!timing) return null;
  return buildIndexState(store.entities(), timing, store.epoch(), registry, store.syncedAt() ?? 0);
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
