import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET_SIZE, bucketHash, tableRoot, type Snapshot } from '@lookout/core';

/** On disk: <dir>/<snapshotId>/{buckets.bin,hashes.bin,meta.json} and <dir>/latest (the id). */
export function saveSnapshot(dir: string, snap: Snapshot, makeLatest = true): void {
  if (!/^[A-Za-z0-9._-]+$/.test(snap.snapshotId)) throw new Error('bad snapshot id');
  const d = join(dir, snap.snapshotId);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'buckets.bin'), snap.buckets);
  writeFileSync(join(d, 'hashes.bin'), snap.hashes);
  writeFileSync(join(d, 'meta.json'), JSON.stringify({ snapshotId: snap.snapshotId, bucketCount: snap.bucketCount, root: snap.root }, null, 2));
  if (makeLatest) writeFileSync(join(dir, 'latest'), snap.snapshotId);
}

/**
 * Loads every snapshot in the directory and refuses damaged ones: the root is re-derived from the hash
 * table, and every bucket is re-hashed against it, so a server never starts serving a table that clients
 * would reject.
 */
export function loadSnapshots(dir: string): { snapshots: Map<string, Snapshot>; latest: string } {
  const snapshots = new Map<string, Snapshot>();
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const meta = JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8'));
    const buckets = new Uint8Array(readFileSync(join(dir, id, 'buckets.bin')));
    const hashes = new Uint8Array(readFileSync(join(dir, id, 'hashes.bin')));
    if (buckets.length !== meta.bucketCount * BUCKET_SIZE || hashes.length !== meta.bucketCount * 32) throw new Error(`snapshot ${id}: file sizes do not match bucketCount`);
    if (tableRoot(meta.snapshotId, meta.bucketCount, hashes) !== meta.root) throw new Error(`snapshot ${id}: hashes.bin does not match its root`);
    for (let i = 0; i < meta.bucketCount; i++) {
      const want = hashes.subarray(i * 32, (i + 1) * 32);
      const got = bucketHash(i, buckets.subarray(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE));
      if (!got.every((v, k) => v === want[k])) throw new Error(`snapshot ${id}: bucket ${i} does not match its hash`);
    }
    snapshots.set(id, { snapshotId: meta.snapshotId, bucketCount: meta.bucketCount, buckets, hashes, root: meta.root });
  }
  const latestFile = join(dir, 'latest');
  const latest = existsSync(latestFile) ? readFileSync(latestFile, 'utf8').trim() : [...snapshots.keys()].sort().at(-1) ?? '';
  if (!snapshots.has(latest)) throw new Error(`no snapshot found in ${dir}`);
  return { snapshots, latest };
}
