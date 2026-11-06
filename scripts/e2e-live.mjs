import './safe-errors.mjs';
// End-to-end on the LIVE networks (Arkiv Rabdi + the Sepolia escrow). No votes: a trusted source decides.
//
//   A  a verified human's report is corroborated by a trusted source: confirmed, and the deposit AND a bounty are credited to the
//      reporter, who claims them from the escrow; reputation published
//   B  a report nobody corroborates: refunded when the window closes, no bounty, nothing forfeited
//   C  copying a target a trusted source ALREADY flagged: refunded at once, no bounty
//
//   node scripts/e2e-live.mjs --i-know-this-fakes-world-id        (a few minutes)
//
// The reporter is a throwaway wallet funded from the deployer. "Verified human" is FAKED in the local seat database for the
// recording, because there is only one real World ID: never use that flag against a real deployment. Never prints a key.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { eq } from '@arkiv-network/sdk/query';
import { addr } from '@arkiv-network/sdk/schema';
import { CONFIG, encodeReportPayload } from '@lookout/core';
import { SCHEMAS, createArkivClients, createReport, createVerdict, newReportId, redactSecrets } from '@lookout/arkiv';
import { createEscrow } from '@lookout/escrow';
import { HUMAN_ACTION, SqliteSeatStore } from '@lookout/worldid';

if (!process.argv.includes('--i-know-this-fakes-world-id')) { console.error('Refusing: this marks the throwaway reporter as a verified human WITHOUT World ID. Add --i-know-this-fakes-world-id to confirm this is a demo.'); process.exit(1); }
const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS, ESCROW_RPC_URL } = process.env;
for (const [k, v] of Object.entries({ ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS })) {
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
let failed = false;
const ok = (label, detail = '') => console.log(`  ok   ${label.padEnd(66)} ${detail}`);
const check = (cond, label, detail = '') => { if (cond) ok(label, detail); else { failed = true; console.error(`  FAIL ${label} ${detail}`); } };

const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const sep = createPublicClient({ chain: sepolia, transport });
const deployer = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const deployerSepolia = createWalletClient({ account: privateKeyToAccount(ARKIV_PRIVATE_KEY), chain: sepolia, transport });

// a throwaway reporter, kept on disk so a failed run never strands its keys or funds
const keyFile = join(homedir(), '.lookout', 'e2e-reporter.json');
mkdirSync(join(homedir(), '.lookout'), { recursive: true });
const saved = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')) : null;
const reporterKey = saved?.key ?? generatePrivateKey();
if (!saved) writeFileSync(keyFile, JSON.stringify({ key: reporterKey }));
const reporterAccount = privateKeyToAccount(reporterKey);
const reporter = reporterAccount.address.toLowerCase();
const rep = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: reporterKey });
const reporterEscrow = createEscrow({ address: ESCROW_ADDRESS, publicClient: sep, walletClient: createWalletClient({ account: reporterAccount, chain: sepolia, transport }) });
const operatorEscrow = createEscrow({ address: ESCROW_ADDRESS, publicClient: sep });

console.log('0. setup: a throwaway reporter, funded, and marked as a verified human (FAKE, demo only)');
const need = CONFIG.DEPOSIT_ETH * 3 + 0.004;
const bal = await sep.getBalance({ address: reporterAccount.address });
if (bal < parseEther(String(need))) {
  const hash = await deployerSepolia.sendTransaction({ to: reporterAccount.address, value: parseEther(String(need)) - bal });
  await sep.waitForTransactionReceipt({ hash });
}
if ((await rep.publicClient.getBalance({ address: reporterAccount.address })) < parseEther('0.003')) {
  const hash = await deployer.walletClient.sendTransaction({ to: reporterAccount.address, value: parseEther('0.004') });
  await deployer.publicClient.waitForTransactionReceipt({ hash });
}
const seats = new SqliteSeatStore(process.env.WORLDID_DB ?? join(homedir(), '.lookout', 'worldid', 'worldid.sqlite'));
seats.enroll('demo_fake_nullifier_e2e_reporter', reporter, HUMAN_ACTION);
seats.close();
ok('reporter funded and listed as a verified human', reporter.slice(0, 10) + '…');

const rand = () => newReportId().slice(0, 8);

// the operator and this script both write from the deployer wallet, and two simultaneous transactions can collide: retry
async function withRetry(label, fn, tries = 6) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      console.log(`       (${label} collided or failed, retrying ${i}/${tries - 1})`);
      await sleep(4000);
    }
  }
}

async function file(domain) {
  const reportId = newReportId();
  await reporterEscrow.lockDeposit(reportId);
  const out = await createReport(rep.writer, { kind: 'domain', value: domain, category: 'drainer', reportId, payload: encodeReportPayload({ kind: 'domain', value: domain }) });
  return { reportId, entityKey: out.entityKey };
}

const PORT = 8791;
const operator = spawn(process.execPath, ['services/operator/src/cli.ts', '--demo', '--window', '45', '--every', '4', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
operator.stdout.on('data', (d) => { log += d; });
operator.stderr.on('data', (d) => { if (!/Experimental|trace-warnings/.test(String(d))) log += d; });
const api = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const waitFor = async (what, fn, ms = 240_000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const r = await fn(); if (r) return r; } catch { /* the service may still be starting */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n--- operator log ---\n${redactSecrets(log.slice(-1500))}`);
    await sleep(3000);
  }
};
const statusOf = async (reportId) => (await api(`/reports?reportId=${reportId}`)).reports[0];

try {
  console.log('A. a verified human reports a target, and a trusted source corroborates it');
  const domain = `lookout-e2e-${rand()}.example`;
  const a = await file(domain);
  ok('deposit locked and report posted, with the plain target', a.reportId.slice(0, 8) + '…');
  const waiting = await waitFor('the operator to see the report', () => statusOf(a.reportId));
  check(waiting.state === 'waiting', 'the operator is waiting for corroboration', `decide by ${new Date(waiting.decideBy * 1000).toISOString().slice(11, 19)}`);
  check((await operatorEscrow.deposit(reporter, a.reportId)).status === 'locked', 'the deposit is still locked while it waits');

  await withRetry('the checker verdict', () => createVerdict(deployer.writer, { kind: 'domain', value: domain, sourceType: 'checker', sourceId: 'lookout-checker', level: 'block', proofHash: `0x${'11'.repeat(32)}`, reason: 'DEMO FIXTURE: stands in for a real finding' }));
  ok('the trusted checker flags the same target, AFTER the report');
  const confirmed = await waitFor('the report to be confirmed', async () => { const s = await statusOf(a.reportId); return s?.state === 'confirmed' ? s : null; });
  check(confirmed.evidence.some((e) => e.sourceId === 'lookout-checker'), 'confirmed on the checker evidence', JSON.stringify(confirmed.evidence));
  check(confirmed.bounty === 'paid', 'the verified human is paid a bounty');

  check((await operatorEscrow.deposit(reporter, a.reportId)).status === 'returned', 'the deposit is returned in the escrow contract');
  const owed = await operatorEscrow.claimable(reporter);
  const deposit = parseEther(String(CONFIG.DEPOSIT_ETH));
  const bounty = parseEther(String(CONFIG.BOUNTY_ETH));
  check(owed >= deposit + bounty, 'the deposit AND the bounty are waiting for the reporter in the escrow', formatEther(owed) + ' ETH');
  // balances are read AT the claim's own block, so a public RPC that lags a block behind cannot hide the change
  const claimTx = await reporterEscrow.claim();
  const before = await sep.getBalance({ address: reporterAccount.address, blockNumber: claimTx.blockNumber - 1n });
  const after = await sep.getBalance({ address: reporterAccount.address, blockNumber: claimTx.blockNumber });
  check(after - before > deposit + bounty - parseEther('0.0005'), 'the reporter claims both with one transaction, to the wallet that filed the report', `+${formatEther(after - before)} ETH after gas`);

  console.log('B. a report nobody corroborates is refunded when the window closes, never forfeited');
  const b = await file(`lookout-e2e-${rand()}.example`);
  const refunded = await waitFor('the refund', async () => { const s = await statusOf(b.reportId); return s?.state === 'refunded' ? s : null; }, 200_000);
  check(refunded.reason === 'not-corroborated', 'refunded because nothing corroborated it', refunded.reason);
  check(refunded.bounty === 'none', 'no bounty');
  check((await operatorEscrow.claimable(reporter)) >= parseEther(String(CONFIG.DEPOSIT_ETH)), 'the deposit is claimable');
  check((await operatorEscrow.deposit(reporter, b.reportId)).status === 'refunded', 'the deposit is refunded, not forfeited, in the contract');

  console.log('C. copying a target a trusted source already flagged earns nothing');
  const c = await file(domain); // the same target as A, which the checker already flagged
  const copy = await waitFor('the copy to be refunded', async () => { const s = await statusOf(c.reportId); return s?.state === 'refunded' ? s : null; }, 120_000);
  check(copy.reason === 'already-flagged', 'refunded as already flagged, with no bounty', `${copy.reason} / ${copy.bounty}`);

  console.log('D. reputation and the stake mirror on Arkiv');
  let stakes = [];
  for (let i = 0; i < 20 && !(stakes.length && stakes.every((x) => val(x.status) === 'returned')); i++) {
    stakes = (await deployer.publicClient.select({ status: true }).from(SCHEMAS.stake).where(eq('reportId', a.reportId)).fetch()).entities;
    if (!(stakes.length && stakes.every((x) => val(x.status) === 'returned'))) await sleep(4000);
  }
  check(stakes.length === 1, 'exactly one Arkiv stake entity exists for the report (the mirror never duplicates)', String(stakes.length));
  check(stakes.length > 0 && stakes.every((x) => val(x.status) === 'returned'), 'the Arkiv stake entity mirrors the escrow outcome', stakes.map((x) => String(val(x.status))).join(','));
  let repRow;
  for (let i = 0; i < 40 && !repRow; i++) {
    repRow = (await deployer.publicClient.select({ score: true, snapshotId: true }).from(SCHEMAS.reputation).where(eq('wallet', addr(reporter))).fetch()).entities[0];
    if (!repRow) await sleep(5000);
  }
  check(!!repRow && Number(val(repRow.score)) >= CONFIG.HUMAN_BASE_REP, 'a reputation checkpoint carries the verified human at or above the floor', `score ${val(repRow?.score)}`);
  console.log(`\nbounty and deposits settled. The reporter's key file is ${keyFile} (a throwaway testnet wallet).`);
} catch (e) {
  failed = true;
  console.error(`\nFAILED: ${redactSecrets(String(e.message))}`);
} finally {
  operator.kill();
}
console.log(failed ? '\nSOME CHECKS FAILED' : '\nall end-to-end checks passed');
process.exit(failed ? 1 : 0);
