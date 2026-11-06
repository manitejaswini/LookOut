// End-to-end on the LIVE networks (Arkiv Rabdi + the Sepolia escrow), with the demo jurors from scripts/demo-jurors.mjs:
//
//   report with a locked deposit -> panel opens the case -> 3 jurors commit hidden votes -> reveal -> ruling -> deposit settled,
//   bounty paid to a stealth address only the reporter can find -> stake mirrored on Arkiv -> reputation updated
//
//   node scripts/e2e-live.mjs        (about 5 minutes: the demo rounds are 90 s each)
//
// Prerequisites: npm run panel:keys, npm run demo:jurors -- setup --i-know-these-are-fake-seats. Never prints a key.
import './safe-errors.mjs';

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, formatEther, http } from 'viem';
import { sepolia } from 'viem/chains';
import { eq } from '@arkiv-network/sdk/query';
import { CONFIG, encodeReportPayload } from '@lookout/core';
import { SCHEMAS, createArkivClients, createReport, newReportId, redactSecrets } from '@lookout/arkiv';
import { createEscrow } from '@lookout/escrow';
import { bountyIdFor, generateKeys, metaAddress, parseMetaAddress, payerEncryptionPublicKey, sealMetaAddress, stealthAddressFor } from '@lookout/stealth';
import { createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS, ESCROW_RPC_URL, PANEL_PAYER_SECRET, PANEL_ENC_SECRET } = process.env;
for (const [k, v] of Object.entries({ ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS, PANEL_PAYER_SECRET, PANEL_ENC_SECRET })) {
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
}
const hex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
let failed = false;
const ok = (label, detail = '') => console.log(`  ok   ${label.padEnd(58)} ${detail}`);
const check = (cond, label, detail = '') => { if (cond) ok(label, detail); else { failed = true; console.error(`  FAIL ${label} ${detail}`); } };

const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const sep = createPublicClient({ chain: sepolia, transport });
const escrow = createEscrow({ address: ESCROW_ADDRESS, publicClient: sep, walletClient: createWalletClient({ account: privateKeyToAccount(ARKIV_PRIVATE_KEY), chain: sepolia, transport }) });
const reporter = address.toLowerCase();

console.log('1. a report with a locked deposit');
const keys = generateKeys();
const meta = metaAddress(keys);
const reportId = newReportId();
const domain = `lookout-e2e-${reportId.slice(0, 8)}.example`;
const dep = await escrow.lockDeposit(reportId);
ok('deposit locked on Sepolia', dep.hash.slice(0, 14) + '…');
const sealed = sealMetaAddress(meta, payerEncryptionPublicKey(hex(PANEL_ENC_SECRET)), reportId);
const rep = await createReport(writer, { kind: 'domain', value: domain, category: 'drainer', reportId, payload: encodeReportPayload({ kind: 'domain', value: domain, sealed }) });
ok('report posted on Arkiv with the plain target and a sealed bounty address', rep.entityKey.slice(0, 14) + '…');

console.log('2. the panel service opens the case');
const PORT = 8791;
const panel = spawn(process.execPath, ['services/panel/src/cli.ts', '--demo', '--every', '4', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
panel.stdout.on('data', (d) => { log += d; });
panel.stderr.on('data', (d) => { if (!/Experimental|trace-warnings/.test(String(d))) log += d; });
const api = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const waitFor = async (what, fn, ms = 240_000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const r = await fn(); if (r) return r; } catch { /* the service may still be starting */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n--- panel log ---\n${log.slice(-1500)}`);
    await sleep(3000);
  }
};
const run = (args) => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, ['scripts/demo-jurors.mjs', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { if (!/Experimental|trace-warnings/.test(String(d))) out += d; });
  c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(redactSecrets(out)))));
});

try {
  const findCase = async () => (await api('/cases')).cases.find((c) => c.reportId === reportId);
  const opened = await waitFor('the case to open', async () => { const c = await findCase(); return c; });
  ok('case opened from the report', `${opened.caseId} (${opened.target.value})`);
  check(opened.target.value === domain, 'the case carries the plain target from the report payload');
  check(opened.type === 'report', 'it is a report case');

  const inCommit = await waitFor('the commit round', async () => { const c = await findCase(); return c.phase === 'commit' ? c : null; });
  ok('seed block passed, three jurors drawn', inCommit.jurors.map((j) => j.slice(0, 8)).join(' '));
  check(inCommit.jurors.length === 3 && !inCommit.jurors.includes(reporter), 'the reporter is not on the panel');
  const seedAgain = await publicClient.getBlock({ blockNumber: BigInt(inCommit.openedBlock + 3) });
  check(inCommit.seed === String(seedAgain.hash).toLowerCase(), 'the draw seed is the hash of block opened+3 (anyone can re-check)');

  console.log('3. hidden votes, then reveals');
  console.log((await run(['vote', '--case', inCommit.caseId, '--votes', 'block,block,clear'])).trim().split('\n').map((l) => `       ${l}`).join('\n'));
  await waitFor('the reveal round', async () => (await findCase()).phase === 'reveal');
  ok('commit round closed, reveal round open');
  console.log((await run(['reveal', '--case', inCommit.caseId])).trim().split('\n').map((l) => `       ${l}`).join('\n'));

  console.log('4. ruling and settlement');
  const done = await waitFor('the case to settle', async () => { const c = await findCase(); return c.phase === 'settled' ? c : null; });
  check(done.result === 'confirmed', 'two block votes beat one clear: the report is confirmed', String(done.result));

  const d = await escrow.deposit(reporter, reportId);
  check(d.status === 'returned', 'the deposit is returned in the escrow contract', d.status);
  const claimable = await escrow.claimable(reporter);
  check(claimable >= 10n ** 15n, 'the refund is claimable by the reporter', formatEther(claimable) + ' ETH');

  const bountyId = bountyIdFor(hex(PANEL_PAYER_SECRET), reportId);
  check(await escrow.bountyPaid(bountyId), 'the bounty was paid, recorded under an opaque id');

  let bountyRow;
  for (let i = 0; i < 10 && !bountyRow; i++) {
    bountyRow = (await publicClient.select({ amountTier: true, payload: true }).from(SCHEMAS.bounty).where(eq('reportId', reportId)).fetch()).entities[0];
    if (!bountyRow) await sleep(2000);
  }
  check(!!bountyRow, 'a bounty announcement is on Arkiv');
  const R = `0x${Buffer.from(val(bountyRow.payload)).toString('hex')}`;
  const { spendingPub } = parseMetaAddress(meta);
  const stealth = stealthAddressFor(keys.viewingKey, spendingPub, R);
  const balance = await sep.getBalance({ address: stealth });
  check(balance === 5n * 10n ** 14n, 'the reporter finds the stealth address with their own keys, and it holds the bounty', `${stealth.slice(0, 10)}… ${formatEther(balance)} ETH`);
  check(stealth.toLowerCase() !== reporter, 'the bounty did not go to the reporter wallet');

  const logs = await sep.getLogs({ address: ESCROW_ADDRESS, fromBlock: dep.blockNumber });
  const sawReporter = logs.some((l) => l.topics.some((t) => t.toLowerCase().endsWith(stealth.slice(2).toLowerCase())) && l.topics.some((t) => t.toLowerCase().endsWith(reporter.slice(2))));
  check(!sawReporter, 'no escrow log ties the stealth address to the reporter');

  let ruling;
  for (let i = 0; i < 10 && !ruling; i++) {
    ruling = (await publicClient.select({ outcome: true }).from(SCHEMAS.ruling).where(eq('caseId', done.caseId)).fetch()).entities[0];
    if (!ruling) await sleep(2000);
  }
  check(val(ruling?.outcome) === 'block', 'the ruling is published on Arkiv', String(val(ruling?.outcome)));

  const demo = JSON.parse(readFileSync(join(process.env.LOOKOUT_DATA_DIR ?? join(homedir(), '.lookout'), 'demo-jurors.json'), 'utf8'));
  const loser = privateKeyToAccount(demo.jurors[2].key).address; // the third juror voted clear, against the majority
  const losers = await escrow.stakeOf(loser);
  check(losers.amount < 5n * 10n ** 15n, 'the juror who voted against the majority was slashed', `${formatEther(losers.amount)} ETH left of 0.005`);

  console.log('5. the stake mirror and the reputation checkpoint');
  let stake;
  for (let i = 0; i < 15 && val(stake?.status) !== 'returned'; i++) {
    stake = (await publicClient.select({ status: true, amountWei: true }).from(SCHEMAS.stake).where(eq('reportId', reportId)).fetch()).entities[0];
    if (val(stake?.status) !== 'returned') await sleep(4000);
  }
  check(val(stake?.status) === 'returned', 'the Arkiv stake entity mirrors the escrow outcome', String(val(stake?.status)));
  console.log(`\nbounty and deposit settled. cost to the reporter wallet: gas only, deposit refunded (claim it with the escrow claim()).`);
} catch (e) {
  failed = true;
  console.error(`\nFAILED: ${redactSecrets(String(e.message))}`);
} finally {
  panel.kill();
}
console.log(failed ? '\nSOME CHECKS FAILED' : '\nall end-to-end checks passed');
process.exit(failed ? 1 : 0);
