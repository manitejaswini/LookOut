import { nextCheckpoint, type Checkpoint, type RepEvent } from '@lookout/core';
import { publishReputationCheckpoint, type EntityWriter } from '@lookout/arkiv';
import type { Journal } from './journal.ts';

/**
 * Computes the next reputation checkpoint from the previous one plus new events, and publishes it as `reputation`
 * entities (core/reputation.ts has the rules). The previous checkpoint and the pending events live in the journal as
 * JSON, because Arkiv entities expire and scores cannot be rebuilt from genesis.
 *
 * Safe to repeat: a checkpoint already published under the same snapshotId is not published again.
 */
export interface CheckpointJobDeps {
  arkiv: EntityWriter;
  journal: Journal;
  now: () => number;
}

const LAST = 'checkpoint:last';
const EVENTS = 'checkpoint:events';

const encode = (c: Checkpoint) => JSON.stringify({ snapshotId: c.snapshotId, at: c.at, scores: [...c.scores] });
const decode = (s: string): Checkpoint => {
  const j = JSON.parse(s) as { snapshotId: string; at: number; scores: [string, number][] };
  return { snapshotId: j.snapshotId, at: j.at, scores: new Map(j.scores) };
};

export function lastCheckpoint(journal: Journal): Checkpoint | null {
  const s = journal.detail(LAST);
  return s ? decode(s) : null;
}

/** Events that have happened but are not yet in a checkpoint. Duplicates are harmless, the rules count each once. */
export function addEvents(journal: Journal, events: readonly RepEvent[]): void {
  const all = [...(JSON.parse(journal.detail(EVENTS) ?? '[]') as RepEvent[]), ...events];
  journal.mark(EVENTS, JSON.stringify(all));
}

export async function runCheckpoint(deps: CheckpointJobDeps): Promise<{ snapshotId: string; written: number; people: number }> {
  const prev = lastCheckpoint(deps.journal);
  const events = JSON.parse(deps.journal.detail(EVENTS) ?? '[]') as RepEvent[];
  const at = Math.max(deps.now(), prev?.at ?? 0);
  const snapshotId = `rep-${at}`;
  const next = nextCheckpoint(prev, events, at, snapshotId);

  const key = `checkpoint:published:${snapshotId}`;
  if (!deps.journal.has(key)) {
    const out = await publishReputationCheckpoint(deps.arkiv, snapshotId, next.scores);
    deps.journal.mark(key, JSON.stringify(out));
  }
  deps.journal.mark(LAST, encode(next));
  // events up to `at` are now inside the checkpoint, so only later ones are kept
  deps.journal.mark(EVENTS, JSON.stringify(events.filter((e) => e.at > at)));
  return { snapshotId, written: (JSON.parse(deps.journal.detail(key)!) as { written: number }).written, people: next.scores.size };
}
