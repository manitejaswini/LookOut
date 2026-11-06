// Runs the panel service: node services/panel/src/cli.ts [--once] [--every 10] [--port 8790] [--demo]
//
// Reads its configuration from the repo-root .env (never printed): ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY (the panel wallet,
// which is also the escrow resolver), ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK, PANEL_PAYER_SECRET and PANEL_ENC_SECRET
// (create them with `npm run panel:keys`), and optionally ESCROW_RPC_URL, WORLDID_DB, LOOKOUT_DATA_DIR.
//
// --demo   short rounds for a recording: 90 s to commit, 90 s to reveal, a panel of 3 (quorum 2), seed block 3 blocks later.
//          Without it the rounds are the real ones from core/config.ts.
import { installErrorScrubbing } from '@lookout/arkiv';
installErrorScrubbing();

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createArkivClients, safeMessage, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import { CONFIG } from '@lookout/core';
import { createEscrow } from '@lookout/escrow';
import { openMetaAddress, payerEncryptionPublicKey } from '@lookout/stealth';
import { SqliteSeatStore } from '@lookout/worldid';
import { REVIEWER_ACTION } from '@lookout/worldid';
import { arkivBlockSource, arkivCaseSource, arkivVoteReader, candidatesFrom } from './adapters.ts';
import { createDriver, DEFAULT_DRIVER_CONFIG, type DriverConfig } from './driver.ts';
import { sqliteJournal } from './journal.ts';
import { addEvents, lastCheckpoint } from './checkpoint-job.ts';
import { createPanelApi, createPanelService } from './service.ts';
import { settleCase } from './settle.ts';

const envPath = new URL('../../../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const has = (flag: string) => process.argv.includes(flag);

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k} in .env.${k.startsWith('PANEL_') ? ' Run: npm run panel:keys' : ''}`); process.exit(1); }
  return v;
};
const secret = (k: string) => Uint8Array.from(Buffer.from(need(k), 'hex'));

const dataDir = process.env.LOOKOUT_DATA_DIR ?? join(homedir(), '.lookout');
const journalPath = join(dataDir, 'panel', 'journal.sqlite');
mkdirSync(dirname(journalPath), { recursive: true });
const journal = sqliteJournal(journalPath);

const { publicClient: arkivPublic, writer } = createArkivClients({ accessKey: need('ARKIV_ACCESS_KEY'), privateKey: need('ARKIV_PRIVATE_KEY') as `0x${string}` });
const account = privateKeyToAccount(need('ARKIV_PRIVATE_KEY') as `0x${string}`);
const transport = http(process.env.ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const sepoliaPublic = createPublicClient({ chain: sepolia, transport });
const escrowAddress = need('ESCROW_ADDRESS') as `0x${string}`;
const escrow = createEscrow({ address: escrowAddress, publicClient: sepoliaPublic, walletClient: createWalletClient({ account, chain: sepolia, transport }) });

const payerSecret = secret('PANEL_PAYER_SECRET');
const encSecret = secret('PANEL_ENC_SECRET');

const demo = has('--demo');
const cfg: DriverConfig = {
  ...DEFAULT_DRIVER_CONFIG,
  minStakeWei: parseEther(String(CONFIG.REVIEWER_STAKE_ETH)),
  commitSeconds: demo ? 90 : CONFIG.VOTE_DAYS * 86_400 * 0.6,
  revealSeconds: demo ? 90 : CONFIG.VOTE_DAYS * 86_400 * 0.4,
  panelSize: demo ? 3 : 5,
  quorum: demo ? 2 : 3,
  seedDelayBlocks: demo ? 3 : 10,
};

const seats = new SqliteSeatStore(process.env.WORLDID_DB ?? join(dataDir, 'worldid', 'worldid.sqlite'));
const blocks = arkivBlockSource(arkivPublic);
const now = () => Math.floor(Date.now() / 1000);
const stake = parseEther(String(CONFIG.REVIEWER_STAKE_ETH));

const settleDeps = {
  arkiv: writer as EntityWriter, escrow, journal, stealthPayerSecret: payerSecret, now,
  slashLoserWei: stake / 10n, slashNonRevealWei: stake / 5n, bountyTier: 1,
};

const driver = createDriver({
  journal, now, currentBlock: blocks.currentBlock, blockHash: blocks.blockHash,
  candidates: () => candidatesFrom({ seats, action: REVIEWER_ACTION, escrow, reputation: () => lastCheckpoint(journal)?.scores ?? new Map() }),
  readVotes: arkivVoteReader(arkivPublic),
  settle: async (c, t) => {
    const out = await settleCase(settleDeps, c, t);
    addEvents(journal, out.repEvents); // feeds the next reputation checkpoint
    return out;
  },
}, cfg);

const service = createPanelService({
  journal, driver, caseSource: arkivCaseSource(arkivPublic),
  planPorts: {
    deposit: (reporter, reportId) => escrow.deposit(reporter, reportId),
    openSealed: (blob, reportId) => { try { return openMetaAddress(blob, encSecret, reportId); } catch { return null; } },
  },
  escrow, escrowFromBlock: BigInt(process.env.ESCROW_DEPLOY_BLOCK ?? 0), latestEscrowBlock: () => sepoliaPublic.getBlockNumber(),
  arkiv: writer as EntityWriter & TrustWriter, now, checkpointEverySeconds: demo ? 120 : 3600,
});

const port = Number(arg('--port', '8790'));
const every = Number(arg('--every', '10')) * 1000;
let last = '';

async function pass() {
  const r = await service.tick();
  const line = JSON.stringify({
    mirrored: r.mirrored, newCases: r.opened?.new, openCases: r.opened?.total,
    skipped: r.opened?.skipped.length, phases: r.cases?.map((c) => `${c.id.slice(0, 6)}:${c.phase}`), checkpoint: r.checkpoint?.snapshotId, errors: r.errors,
  });
  if (line !== last) { console.log(`[${new Date().toISOString()}] ${line}`); last = line; }
}

console.log(`panel wallet ${account.address}, escrow ${escrowAddress}, ${demo ? 'DEMO timing (90 s rounds)' : 'real timing'}, payer encryption key ${payerEncryptionPublicKey(encSecret)}`);
if (has('--once')) {
  await pass();
  seats.close();
} else {
  createPanelApi(service).listen(port, '127.0.0.1', () => console.log(`API on http://127.0.0.1:${port} (read only: /cases, /cases/:id, /status)`));
  await pass();
  setInterval(() => pass().catch((e) => console.error('pass failed:', safeMessage(e))), every);
}
