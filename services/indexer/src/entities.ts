import type { IndexState } from './lookup.ts';
import type { IndexedKind } from './types.ts';

/** One entity as the explorer shows it. Times are unix seconds, converted from Arkiv block numbers. */
export interface ExplorerEntity {
  key: string;
  kind: IndexedKind;
  /** who created it. Authorization uses this, never `owner`, which can be transferred */
  creator: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
  attrs: Record<string, string>;
  /** set when the indexer read the entity but does not count it, with the reason */
  notCounted?: string;
}

export interface EntityList {
  block: number;
  blockTime: number;
  blockDuration: number;
  syncedAt: number;
  total: number;
  entities: ExplorerEntity[];
}

/** Newest first. `limit` is clamped to 1..500. */
export function listEntities(state: IndexState, opts: { kind?: string; limit?: number } = {}): EntityList {
  const { currentBlock, currentBlockTime, blockDuration } = state.timing;
  const at = (block: number) => currentBlockTime + (block - currentBlock) * blockDuration;
  const dropped = new Map(state.dropped.map((d) => [d.key, d.reason]));
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 200)));

  const rows = state.entities
    .filter((e) => !opts.kind || e.kind === opts.kind)
    .sort((a, b) => b.createdBlock - a.createdBlock || (a.key < b.key ? -1 : 1));

  return {
    block: currentBlock,
    blockTime: currentBlockTime,
    blockDuration,
    syncedAt: state.syncedAt,
    total: rows.length,
    entities: rows.slice(0, limit).map((e) => ({
      key: e.key,
      kind: e.kind,
      creator: e.creator,
      owner: e.owner,
      createdAt: at(e.createdBlock),
      expiresAt: at(e.expiresBlock),
      attrs: e.attrs,
      ...(dropped.has(e.key) ? { notCounted: dropped.get(e.key) } : {}),
    })),
  };
}
