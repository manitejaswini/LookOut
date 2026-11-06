// The operator: node services/operator/src/cli.ts <command>
//
//   (no command)                         run the service: mirror, resolve reports, track disputes, publish reputation
//   --once                               one pass, then exit
//   disputes                             owner disputes with a valid proof, waiting for a ruling
//   rule <address> <clear|block> <why>   publish a ruling on a wallet address. `clear` overturns the flags. The reason is PUBLIC.
//   reject <reporter> <reportId>         forfeit a report's deposit to the bounty pool. The ONLY way a deposit is ever forfeited.
//
// Configuration comes from the repo-root .env and is never printed: ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY (the operator wallet, which
// is also the escrow resolver), ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK, and optionally ESCROW_RPC_URL, WORLDID_DB, LOOKOUT_DATA_DIR.

import { installErrorScrubbing } from '@lookout/arkiv';
installErrorScrubbing();

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createArkivClients, safeMessage, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import { caseIdFor, targetHash } from '@lookout/core';
import { createEscrow } from '@lookout/escrow';
import { loadRegistry } from '@lookout/indexer';
import { HUMAN_ACTION, SqliteSeatStore } from '@lookout/worldid';
import { arkivEvidenceSource, arkivReportSource, arkivStakeFinder } from './adapters.ts';
import { sqliteJournal } from './journal.ts';
import { addEvents } from './checkpoint-job.ts';
import { listDisputes } from './reports.ts';
import { createOperatorApi, createOperatorService } from './service.ts';
import { rejectReport, ruleOnTarget } from './settle.ts';

const envPath = new URL('../../../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const has = (flag: string) => process.argv.includes(flag);
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && ['--every', '--port', '--window'].includes(all[i - 1])));

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
  return v;
};

const dataDir = process.env.LOOKOUT_DATA_DIR ?? join(homedir(), '.lookout');
const journalPath = join(dataDir, 'operator', 'journal.sqlite');
mkdirSync(dirname(journalPath), { recursive: true });
const journal = sqliteJournal(journalPath);

const { publicClient: arkivPublic, writer } = createArkivClients({ accessKey: need('ARKIV_ACCESS_KEY'), privateKey: need('ARKIV_PRIVATE_KEY') as `0x${string}` });
const account = privateKeyToAccount(need('ARKIV_PRIVATE_KEY') as `0x${string}`);
const transport = http(process.env.ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const sepoliaPublic = createPublicClient({ chain: sepolia, transport });
const escrowAddress = need('ESCROW_ADDRESS') as `0x${string}`;
const escrow = createEscrow({ address: escrowAddress, publicClient: sepoliaPublic, walletClient: createWalletClient({ account, chain: sepolia, transport }) });

const now = () => Math.floor(Date.now() / 1000);

// the people World ID has bound to a wallet. Read fresh each time, so a new verification counts on the next pass.
const seats = new SqliteSeatStore(process.env.WORLDID_DB ?? join(dataDir, 'worldid', 'worldid.sqlite'));
const humans = (): ReadonlySet<string> => new Set(seats.wallets(HUMAN_ACTION).map((w) => w.toLowerCase()));

const registry = loadRegistry();
const source = arkivReportSource(arkivPublic);
const demo = has('--demo');

const resolver = {
  arkiv: writer as EntityWriter, escrow, journal, now, humans,
  evidence: arkivEvidenceSource(arkivPublic, registry),
  // --demo shortens the wait for a source to corroborate a report, so a recording does not need a week. --window <seconds> sets it exactly
  ...(arg('--window') ? { windowSeconds: Number(arg('--window')) } : demo ? { windowSeconds: 600 } : {}),
};

const service = createOperatorService({
  journal, resolver, source,
  planPorts: { deposit: (reporter, reportId) => escrow.deposit(reporter, reportId) },
  escrow, escrowFromBlock: BigInt(process.env.ESCROW_DEPLOY_BLOCK ?? 0), latestEscrowBlock: () => sepoliaPublic.getBlockNumber(),
  arkiv: writer as EntityWriter & TrustWriter, now, checkpointEverySeconds: demo ? 120 : 3600, humans,
  findStakes: arkivStakeFinder(arkivPublic, account.address),
});

const [command] = positional;

if (command === 'disputes') {
  const { disputes } = listDisputes(await source.attestations());
  if (disputes.length === 0) console.log('no owner disputes with a valid proof');
  for (const d of disputes) console.log(`${d.caseId}  owner ${d.owner}  dispute ${d.entityKey.slice(0, 14)}…  ruling: node services/operator/src/cli.ts rule ${d.owner} clear "<reason>"`);
  seats.close();
} else if (command === 'rule') {
  const [, address, outcome, ...why] = positional;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '') || (outcome !== 'clear' && outcome !== 'block')) {
    console.error('usage: rule <0x address> <clear|block> <reason>');
    process.exit(1);
  }
  const hash = targetHash('address', address);
  // the ruling answers the newest valid dispute about this address, or stands alone if there is none
  const { disputes } = listDisputes(await source.attestations());
  const trigger = disputes.find((d) => d.targetHash === hash)?.entityKey ?? `0x${'00'.repeat(32)}`;
  const out = await ruleOnTarget({ arkiv: writer as EntityWriter, now }, { kind: 'address', value: address, outcome, reason: why.join(' '), triggerKey: trigger, targetHash: hash });
  console.log(`ruling published: ${outcome} for ${address} (case ${out.caseId}, ${out.entityKey.slice(0, 14)}…). The reason is public.`);
  seats.close();
} else if (command === 'reject') {
  const [, reporter, reportId] = positional;
  if (!/^0x[0-9a-fA-F]{40}$/.test(reporter ?? '') || !/^[0-9a-f]{32}$/.test(reportId ?? '')) {
    console.error('usage: reject <reporter 0x address> <reportId, 32 hex digits>');
    process.exit(1);
  }
  const out = await rejectReport({ escrow, journal, now }, { key: `manual:${reportId}`, reportId, reporter });
  addEvents(journal, out.repEvents);
  console.log(out.did.length ? `rejected: the deposit goes to the bounty pool` : 'nothing to do: already settled');
  seats.close();
} else {
  const port = Number(arg('--port', '8790'));
  const every = Number(arg('--every', '10')) * 1000;
  let last = '';
  const pass = async () => {
    const r = await service.tick();
    const line = JSON.stringify({ mirrored: r.mirrored, resolved: r.resolved && { ...r.resolved, skipped: r.resolved.skipped.length }, disputes: r.disputes, checkpoint: r.checkpoint?.snapshotId, errors: r.errors });
    if (line !== last) { console.log(`[${new Date().toISOString()}] ${line}`); last = line; }
  };
  console.log(`operator wallet ${account.address}, escrow ${escrowAddress}, ${demo ? 'DEMO timing' : 'real timing'}`);
  if (has('--once')) {
    await pass();
    seats.close();
  } else {
    createOperatorApi(service).listen(port, '127.0.0.1', () => console.log(`API on http://127.0.0.1:${port} (read only: /reports, /disputes, /status)`));
    await pass();
    setInterval(() => pass().catch((e) => console.error('pass failed:', safeMessage(e))), every);
  }
  void caseIdFor;
}
