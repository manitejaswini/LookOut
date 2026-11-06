import type { Registry } from './registry.ts';
import type { StoredEntity } from './types.ts';

/**
 * Reputation comes from `reputation` entities that a REGISTERED indexer published (arkiv/schema.md, "reputation"), not from
 * a hand-edited file. The checkpoint in force is the snapshotId of the most recently created trusted entity.
 *
 * If two registered indexers publish the same checkpoint and disagree about a wallet, the LOWER score is used. Reputation
 * is only ever trusted as far as everyone agrees on it, and a disagreement must never raise anyone's weight.
 * Rows from wallets that are not registered indexers, or with a malformed score, are ignored.
 */
export interface Checkpoint {
  snapshotId: string;
  scores: Record<string, number>; // lowercase wallet -> score
  /** how many rows were ignored, so a misconfiguration is visible rather than silent */
  ignored: number;
}

export function readCheckpoint(entities: readonly StoredEntity[], registry: Registry): Checkpoint | null {
  const trusted = new Set(registry.indexers.map((i) => i.address));
  let ignored = 0;
  const rows = entities.filter((e) => e.kind === 'reputation').filter((e) => {
    const ok = trusted.has(e.creator) && /^0x[0-9a-f]{40}$/i.test(e.attrs.wallet ?? '') && !!e.attrs.snapshotId && Number.isFinite(Number(e.attrs.score)) && Number(e.attrs.score) >= 0;
    if (!ok) ignored++;
    return ok;
  });
  if (rows.length === 0) return null;

  // newest by creation block; the key breaks ties so every indexer picks the same one
  const newest = rows.reduce((a, b) => (b.createdBlock > a.createdBlock || (b.createdBlock === a.createdBlock && b.key > a.key) ? b : a));
  const snapshotId = newest.attrs.snapshotId;

  const scores: Record<string, number> = {};
  for (const r of rows) {
    if (r.attrs.snapshotId !== snapshotId) continue;
    const w = r.attrs.wallet.toLowerCase();
    const s = Number(r.attrs.score);
    scores[w] = w in scores ? Math.min(scores[w], s) : s;
  }
  return { snapshotId, scores, ignored };
}

/** The registry with its reputation replaced by the published checkpoint. With no checkpoint the registry is returned unchanged. */
export function withCheckpoint(registry: Registry, entities: readonly StoredEntity[]): Registry {
  const cp = readCheckpoint(entities, registry);
  return cp ? { ...registry, reputation: cp.scores } : registry;
}
