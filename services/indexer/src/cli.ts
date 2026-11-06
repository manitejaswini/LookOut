// Indexer command line.
//
//   npm run indexer:sync                          read Arkiv (Rabdi) into the local SQLite cache
//   npm run lookup -w @lookout/indexer -- domain example.com
//   npm run snapshot -w @lookout/indexer          build the PIR table and print its root
//   npm run indexer:serve                         sync every 30 s and serve the TEMPORARY plain /lookup
//
// Reads ARKIV_ACCESS_KEY from the gitignored .env. It only reads from Arkiv, and never prints a key.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENUMS, createArkivReader } from '@lookout/arkiv';
import type { TargetKind } from '@lookout/core';
import { lookup, loadState, type IndexState } from './lookup.ts';
import { arkivReaderClient, syncStore } from './reader.ts';
import { loadRegistry } from './registry.ts';
import { startServer } from './server.ts';
import { buildEpochSnapshot } from './snapshot.ts';
import { Store } from './store.ts';

const envPath = new URL('../../../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const dbPath = process.env.INDEXER_DB ?? fileURLToPath(new URL('../data/index.sqlite', import.meta.url));
const [command, ...args] = process.argv.slice(2);

function reader() {
  const accessKey = process.env.ARKIV_ACCESS_KEY;
  if (!accessKey) {
    console.error('ARKIV_ACCESS_KEY is missing from .env (see .env.example)');
    process.exit(1);
  }
  return arkivReaderClient(createArkivReader({ accessKey }));
}

async function sync(store: Store) {
  const r = await syncStore(store, reader());
  console.log(`synced ${r.total} entities at block ${r.timing.currentBlock}:`, r.counts);
}

function need(store: Store): IndexState {
  const state = loadState(store, loadRegistry());
  if (!state) {
    console.error('Nothing synced yet. Run: npm run indexer:sync');
    process.exit(1);
  }
  return state;
}

const store = new Store(dbPath);

try {
  if (command === 'sync') {
    await sync(store);
    const state = need(store);
    const reasons = new Map<string, number>();
    for (const d of state.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    console.log(`${state.targets.size} targets with signals; ${state.dropped.length} entities not counted`, reasons.size ? Object.fromEntries(reasons) : '');
  } else if (command === 'lookup') {
    const [kind, ...rest] = args;
    if (!(ENUMS.targetKind as readonly string[]).includes(kind ?? '') || rest.length === 0) {
      console.error(`usage: lookup <${ENUMS.targetKind.join('|')}> <value>`);
      process.exit(1);
    }
    console.log(JSON.stringify(lookup(need(store), kind as TargetKind, rest.join(' ')), null, 2));
  } else if (command === 'snapshot') {
    const state = need(store);
    const snap = buildEpochSnapshot(state);
    console.log('snapshotId  :', snap.snapshotId);
    console.log('bucketCount :', snap.bucketCount, `(${(snap.buckets.length / 1024 / 1024).toFixed(0)} MiB table, ${(snap.hashes.length / 1024).toFixed(0)} KiB hashes)`);
    console.log('root        :', snap.root);
  } else if (command === 'serve') {
    await sync(store);
    let state = need(store);
    const everyMs = Number(process.env.INDEXER_SYNC_SECONDS ?? 30) * 1000;
    const timer = setInterval(async () => {
      try {
        await sync(store);
        state = need(store);
      } catch (e) {
        console.error('sync failed, keeping the previous data:', e instanceof Error ? e.message : e);
      }
    }, everyMs);
    const port = Number(process.env.INDEXER_PORT ?? 8787);
    const server = await startServer(() => state, { port });
    console.log(`plain lookup (NOT private) on http://127.0.0.1:${port}/lookup?kind=domain&value=example.com`);
    process.on('SIGINT', () => { clearInterval(timer); server.close(); store.close(); process.exit(0); });
  } else {
    console.error('commands: sync | lookup <kind> <value> | snapshot | serve');
    process.exit(1);
  }
} finally {
  if (command !== 'serve') store.close();
}
