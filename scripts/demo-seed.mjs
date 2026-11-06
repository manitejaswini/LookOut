// Keeps the DEMO fixtures on Arkiv alive, so a demo does not quietly turn from BLOCK into "unknown" when they expire.
//
//   npm run demo:seed                    create what is missing, renew what exists, then exit
//   npm run demo:seed -- --every 60      do that now and then every 60 minutes, until stopped (Ctrl+C)
//
// IMPORTANT: this is a DEMO FIXTURE, not detection. It writes only about the reserved domain below (a `.example`
// name that cannot resolve and belongs to nobody), and the verdict reasons say "DEMO FIXTURE". The real checker
// (`npm run check`) never claims anything it cannot prove, and is not what this script is.
//
// It uses the throwaway test wallet in .env, which is the registered `lookout-checker` and `openfeed-demo` source
// in services/indexer/registry.json. Nothing is printed that is secret.
import './safe-errors.mjs';

import { existsSync } from 'node:fs';
import { eq } from '@arkiv-network/sdk/query';
import { SCHEMAS, LIFETIMES, createArkivClients, createReport, createVerdict } from '@lookout/arkiv';
import { targetHash } from '@lookout/core';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) {
  console.error('Need ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env (see .env.example)');
  process.exit(1);
}

const DOMAIN = 'lookout-demo-airdrop.example';
// a reserved-looking address (0xbad0...0001) that belongs to nobody, for the Pay page demo: paying it shows a flag
const DEMO_ADDRESS = '0xbad0000000000000000000000000000000000001';
const everyArg = process.argv.indexOf('--every');
const everyMin = everyArg > -1 ? Number(process.argv[everyArg + 1]) : 0;
if (everyArg > -1 && !(everyMin >= 1)) { console.error('--every needs a number of minutes (1 or more)'); process.exit(1); }

const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const mine = (e) => String(e.$creator).toLowerCase() === address.toLowerCase();

async function find(kind, hash, extra = (e) => true) {
  // only a verdict has a sourceId column, and the SDK refuses to select a column the schema does not have
  const select = kind === 'verdict' ? { $key: true, $creator: true, sourceId: true } : { $key: true, $creator: true };
  const { entities } = await publicClient.select(select).from(SCHEMAS[kind]).where(eq('targetHash', hash)).fetch();
  return entities.filter(mine).filter(extra)[0];
}

/** renew the lifetime of an entity we already wrote, or create it */
async function ensure(label, kind, lookup, create) {
  const existing = await lookup();
  if (existing) {
    const out = await writer.extendEntity({ entityKey: String(existing.$key), expiration: LIFETIMES[kind]() });
    console.log(`  ${label.padEnd(26)} renewed   (expires at block ${out.expiresAt})`);
  } else {
    const out = await create();
    console.log(`  ${label.padEnd(26)} created   ${out.entityKey.slice(0, 12)}…`);
  }
}

async function seed(kind, value) {
  const hash = targetHash(kind, value);
  console.log(`[${new Date().toISOString()}] demo fixtures for ${value} (wallet ${address.slice(0, 8)}…)`);
  await ensure('report (community)', 'report', () => find('report', hash),
    () => createReport(writer, { kind, value, category: 'drainer' }));
  await ensure('verdict (lookout-checker)', 'verdict', () => find('verdict', hash, (e) => e.sourceId?.value === 'lookout-checker'),
    () => createVerdict(writer, {
      kind, value, sourceType: 'checker', sourceId: 'lookout-checker', level: 'block',
      proofHash: `0x${'11'.repeat(32)}`, reason: 'DEMO FIXTURE: stands in for a bytecode match, not a real finding',
    }));
  await ensure('verdict (openfeed-demo)', 'verdict', () => find('verdict', hash, (e) => e.sourceId?.value === 'openfeed-demo'),
    () => createVerdict(writer, {
      kind, value, sourceType: 'feed', sourceId: 'openfeed-demo', level: 'block',
      reason: 'DEMO FIXTURE: stands in for an open feed listing, not a real list',
    }));
}

async function run() {
  await seed('domain', DOMAIN);
  await seed('address', DEMO_ADDRESS);
}

await run();
if (everyMin) {
  console.log(`\nrenewing every ${everyMin} min. Ctrl+C to stop. Reports live 24h and verdicts 6h, so keep this under 300.`);
  if (everyMin > 300) console.warn('WARNING: longer than the 6 hour verdict lifetime, the verdicts will lapse between runs.');
  setInterval(() => run().catch((e) => console.error('renew failed, will retry:', e?.message ?? e)), everyMin * 60_000);
}
