// Checker command line. DRY RUN by default: it reports what it finds and writes nothing.
//
//   npm run check -- domain some-site.xyz
//   npm run check -- contract 0x... [--chain-rpc https://...]
//   npm run check -- domain some-site.xyz --publish      write (or refresh) a verdict on Arkiv with the test wallet
//
// Environment (repo-root .env, never printed):
//   ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY   only needed for --publish
//   ETH_RPC_URL                           an Ethereum JSON-RPC endpoint, needed for `contract`
//   FLAG_LIST / DRAINER_LIST              paths to override services/workers/lists/*.json
// Flagged destinations also include everything Lookout already blocks, if the indexer cache has been synced.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createArkivClients } from '@lookout/arkiv';
import { loadRegistry, loadState, Store } from '@lookout/indexer';
import { checkContract, parseDrainerList, rpcCodeSource } from './contract.ts';
import { checkDomain, type CheckOutcome } from './domain.ts';
import { anyOf, indexFlagSource, StaticFlagSource, type FlagSource } from './flags.ts';
import { fetchHop } from './http.ts';
import { findExistingVerdict, findingToVerdict, publishFinding } from './publish.ts';

const envPath = new URL('../../../../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const argv = process.argv.slice(2);
const publish = argv.includes('--publish');
const rpcFlag = argv.indexOf('--chain-rpc');
const rpcUrl = rpcFlag >= 0 ? argv[rpcFlag + 1] : process.env.ETH_RPC_URL;
const [command, target] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--chain-rpc');

const listPath = (env: string | undefined, file: string) => env ?? fileURLToPath(new URL(`../../lists/${file}`, import.meta.url));

function flagSource(): FlagSource {
  const sources: FlagSource[] = [new StaticFlagSource(JSON.parse(readFileSync(listPath(process.env.FLAG_LIST, 'flagged.json'), 'utf8')))];
  // also treat anything Lookout already blocks as flagged, when a synced indexer cache exists
  const dbPath = process.env.INDEXER_DB ?? fileURLToPath(new URL('../../../indexer/data/index.sqlite', import.meta.url));
  if (existsSync(dbPath)) {
    const store = new Store(dbPath);
    const state = loadState(store, loadRegistry());
    store.close();
    if (state) sources.push(indexFlagSource(state));
  }
  return anyOf(...sources);
}

if (!command || !target || !['domain', 'contract'].includes(command)) {
  console.error('usage: check <domain|contract> <value> [--publish] [--chain-rpc <url>]');
  process.exit(1);
}

let outcome: CheckOutcome;
if (command === 'domain') {
  outcome = await checkDomain(target, { fetchHop, flags: flagSource() });
} else {
  if (!rpcUrl) {
    console.error('A contract check needs an Ethereum RPC URL: set ETH_RPC_URL in .env or pass --chain-rpc <url>');
    process.exit(1);
  }
  const drainers = parseDrainerList(JSON.parse(readFileSync(listPath(process.env.DRAINER_LIST, 'drainers.json'), 'utf8')));
  outcome = await checkContract(target, { code: rpcCodeSource(rpcUrl), drainers });
}

for (const n of outcome.notes) console.log(' -', n);

if (!outcome.finding) {
  console.log('\nNo proof found. That is NOT a clearance: the checker only reports what it can prove.');
} else {
  const f = outcome.finding;
  console.log(`\nFINDING: ${f.kind}\n  target : ${f.targetKind} ${f.value}\n  reason : ${f.reason}\n  proofHash: ${findingToVerdict(f).proofHash}`);
  if (!publish) {
    console.log('\nDry run, nothing written. Add --publish to post this verdict to Arkiv.');
  } else {
    const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
    if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) {
      console.error('--publish needs ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env');
      process.exit(1);
    }
    const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY as `0x${string}` });
    const registered = loadRegistry().sources.some((s) => s.sourceId === 'lookout-checker' && s.address === address.toLowerCase());
    if (!registered) console.warn('WARNING: this wallet is not the registered lookout-checker in services/indexer/registry.json, so indexers will ignore the verdict.');
    const existing = await findExistingVerdict(publicClient, f, address);
    const out = await publishFinding(writer, f, existing);
    console.log(`\n${out.action}: ${out.entityKey}${out.expiresAt ? ` (expires at block ${out.expiresAt})` : ''}`);
  }
}
