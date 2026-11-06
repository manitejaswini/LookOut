import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rootOf, type Snapshot } from '@lookout/snapshot';

/** On disk: <dir>/<snapshotId>/{buckets.bin,hashes.bin,meta.json} and <dir>/latest (the id). */
export interface StoredSnapshot extends Snapshot { snapshotId: string }

export function saveSnapshot(dir: string, snapshotId: string, snap: Snapshot, makeLatest = true): void {
  if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) throw new Error('bad snapshot id');
  const d = join(dir, snapshotId);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'buckets.bin'), snap.buckets);
  writeFileSync(join(d, 'hashes.bin'), snap.hashes);
  writeFileSync(join(d, 'meta.json'), JSON.stringify({ snapshotId, bucketCount: snap.bucketCount, root: snap.root }, null, 2));
  if (makeLatest) writeFileSync(join(dir, 'latest'), snapshotId);
}

/** Loads every snapshot in the directory and re-derives each root, so a damaged file is refused at start. */
export function loadSnapshots(dir: string): { snapshots: Map<string, StoredSnapshot>; latest: string } {
  const snapshots = new Map<string, StoredSnapshot>();
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const meta = JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8'));
    const buckets = new Uint8Array(readFileSync(join(dir, id, 'buckets.bin')));
    const hashes = new Uint8Array(readFileSync(join(dir, id, 'hashes.bin')));
    if (rootOf(hashes) !== meta.root) throw new Error(`snapshot ${id}: hashes.bin does not match its root`);
    snapshots.set(id, { snapshotId: id, bucketCount: meta.bucketCount, buckets, hashes, root: meta.root });
  }
  const latestFile = join(dir, 'latest');
  const latest = existsSync(latestFile) ? readFileSync(latestFile, 'utf8').trim() : [...snapshots.keys()].sort().at(-1) ?? '';
  if (!snapshots.has(latest)) throw new Error(`no snapshot found in ${dir}`);
  return { snapshots, latest };
}
