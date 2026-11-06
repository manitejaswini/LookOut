// Turns the indexer's synced cache into files the PIR servers load:
//   npm run indexer:sync                              read Arkiv into the indexer's SQLite cache
//   npm run from-indexer -w @lookout/pir-server       build the snapshot with the indexer's own builder
//   npm run start -w @lookout/pir-server -- --dir data --port 8801 --name A     (and 8802 / B)
//
// Both servers must load identical files. For the real two-operator setup, copy the output directory to
// the second operator rather than running this twice (two syncs can land on different blocks and differ).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store, buildEpochSnapshot, defaultDbPath, loadRegistry, loadState } from '@lookout/indexer';
import { saveSnapshot } from './store.ts';

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const db = arg('--db', process.env.INDEXER_DB ?? defaultDbPath());
const out = arg('--out', fileURLToPath(new URL('../data', import.meta.url)));

if (!existsSync(db)) {
  console.error(`no indexer cache at ${db}. Run: npm run indexer:sync`);
  process.exit(1);
}
const state = loadState(new Store(db), loadRegistry());
if (!state) {
  console.error('nothing synced yet. Run: npm run indexer:sync');
  process.exit(1);
}
const snap = buildEpochSnapshot(state);
saveSnapshot(out, snap);
console.log(`snapshot ${snap.snapshotId}: ${state.epochTargets.size} targets, ${snap.bucketCount} buckets, root ${snap.root}`);
console.log(`written to ${out}`);
