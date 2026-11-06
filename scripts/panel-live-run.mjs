// Live run of the panel pieces that were only tested with fakes, against Arkiv Rabdi and the Sepolia escrow:
//   A  Arkiv block source (current block, a real block hash, a future block is null)
//   B  Arkiv vote reader (commit, then reveal by patch, read back both)
//   C  reputation checkpoint: published by the job, read back by the INDEXER's reader and checkpoint rules
//   D  stake mirror, driven by the REAL deposit events of the deployed Sepolia escrow
//   E  the round driver end to end on real blocks: seed block, draw, commit, reveal, ruling
// Uses the throwaway wallet in .env. Never prints a key. Everything expires on its own.
//   node scripts/panel-live-run.mjs

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { eq } from '@arkiv-network/sdk/query';
import { caseIdFor, commitVote, newSalt, targetHash } from '@lookout/core';
import { SCHEMAS, createArkivClients, createRuling, createVote, revealVote } from '@lookout/arkiv';
import { createEscrow } from '@lookout/escrow';
import { arkivReaderClient, loadRegistry, readAll, readCheckpoint } from '@lookout/indexer';
import {
  addEvents, arkivBlockSource, arkivVoteReader, createDriver, memoryJournal, mirrorDeposits, mirrorSettlements, rulingPayload, runCheckpoint,
} from '@lookout/panel';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS, ESCROW_RPC_URL } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY || !ESCROW_ADDRESS) { console.error('Need ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY and ESCROW_ADDRESS in .env'); process.exit(1); }

const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const me = address.toLowerCase();
const before = await publicClient.getBalance({ address });
const ok = (label, detail = '') => console.log(`  ok   ${label.padEnd(46)} ${detail}`);
const fail = (label, detail = '') => { console.error(`  FAIL ${label} ${detail}`); process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
const check = (cond, label, detail) => (cond ? ok(label, detail) : fail(label, detail));

console.log(`wallet ${address.slice(0, 8)}…`);

/* A -------------------------------------------------------------------- */
console.log('A. block source');
const blocks = arkivBlockSource(publicClient);
const now = await blocks.currentBlock();
const h = await blocks.blockHash(now);
check(Number.isInteger(now) && now > 0, 'current block', String(now));
check(/^0x[0-9a-f]{64}$/.test(h ?? ''), 'hash of the current block', (h ?? 'null').slice(0, 14) + '…');
check((await blocks.blockHash(now + 100_000)) === null, 'a block in the future is null');

/* B -------------------------------------------------------------------- */
console.log('B. vote reader');
const readVotes = arkivVoteReader(publicClient);
const caseB = randomBytes(8).toString('hex');
const salt = newSalt();
const commitHash = commitVote({ caseId: caseB, outcome: 'block', salt, juror: me });
const vote = await createVote(writer, { caseId: caseB, commitHash });
let rows = [];
for (let i = 0; i < 10 && rows.length === 0; i++) { rows = await readVotes(caseB); if (!rows.length) await sleep(2000); }
check(rows.length === 1 && rows[0].juror === me, 'commitment read back, juror is the creator');
check(rows[0]?.commitHash === commitHash && rows[0]?.outcome === undefined, 'commit has no outcome yet');
check(rows[0]?.createdAt > 1_700_000_000, 'createdAt is a real block time', String(rows[0]?.createdAt));
await revealVote(writer, { entityKey: vote.entityKey, caseId: caseB, juror: me, outcome: 'block', salt, commitHash });
rows = await readVotes(caseB);
check(rows[0]?.outcome === 'block' && rows[0]?.salt === salt, 'reveal read back', `outcome=${rows[0]?.outcome}`);

/* C -------------------------------------------------------------------- */
console.log('C. reputation checkpoint, read by the indexer');
const journal = memoryJournal();
const fakeWallet = '0x' + randomBytes(20).toString('hex');
const at = Math.floor(Date.now() / 1000);
addEvents(journal, [{ wallet: fakeWallet, kind: 'report_confirmed', at: at - 5, ref: 'live-run' }]);
const cp = await runCheckpoint({ arkiv: writer, journal, now: () => at });
check(cp.written === 1, 'checkpoint published', cp.snapshotId);
const reader = arkivReaderClient(publicClient);
let found = null;
for (let i = 0; i < 10 && !found; i++) {
  const rep = (await readAll(reader, 'reputation')).map((row) => ({ ...row, kind: 'reputation' }));
  const c = readCheckpoint(rep, loadRegistry());
  if (c?.snapshotId === cp.snapshotId) found = c;
  else await sleep(2000);
}
check(!!found, 'indexer reads the new checkpoint as the newest');
check(found?.scores[fakeWallet] === 10, 'score matches the rules (10 for one confirmed report)', String(found?.scores[fakeWallet]));
check(found?.ignored === 0, 'no row ignored (every row came from a registered indexer)', String(found?.ignored));

/* D -------------------------------------------------------------------- */
console.log('D. stake mirror from the real Sepolia deposits');
const sep = createPublicClient({ chain: sepolia, transport: http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') });
const escrow = createEscrow({ address: ESCROW_ADDRESS, publicClient: sep });
const FROM = 12078577n; // the deploy block
const deposits = await escrow.depositEvents(FROM);
const settled = await escrow.settledEvents(FROM);
check(deposits.length >= 1, 'real Deposited events found on Sepolia', String(deposits.length));
const mj = memoryJournal();
const m1 = await mirrorDeposits({ arkiv: writer, journal: mj }, deposits);
check(m1.created === deposits.length, 'each deposit mirrored as a stake entity', JSON.stringify(m1));
const m2 = await mirrorSettlements({ arkiv: writer, journal: mj }, settled);
check(m2.updated === settled.length && m2.unknown === 0, 'each settlement patched its stake', JSON.stringify(m2));
const first = deposits[0];
let stakeRow;
for (let i = 0; i < 10 && !stakeRow; i++) {
  stakeRow = (await publicClient.select({ status: true, amountWei: true, escrowTx: true }).from(SCHEMAS.stake).where(eq('reportId', first.reportId)).fetch()).entities[0];
  if (!stakeRow) await sleep(2000);
}
check(!!stakeRow && String(val(stakeRow.amountWei)) === '10000000000000000', 'stake entity matches the on-chain deposit amount');
check(val(stakeRow?.escrowTx) === first.txHash.toLowerCase(), 'stake entity points at the real Sepolia transaction');
check(val(stakeRow?.status) === 'returned', 'status follows the escrow outcome (confirmed -> returned)', String(val(stakeRow?.status)));

/* E -------------------------------------------------------------------- */
console.log('E. round driver on real Arkiv blocks');
const th = targetHash('domain', 'lookout-live-run.example');
const caseId = caseIdFor(th, '0x' + randomBytes(32).toString('hex'));
const reporter = '0x' + randomBytes(20).toString('hex');
const settles = [];
const dj = memoryJournal();
const driver = createDriver({
  journal: dj,
  now: () => Math.floor(Date.now() / 1000),
  currentBlock: blocks.currentBlock,
  blockHash: blocks.blockHash,
  candidates: async () => [{ wallet: me, rep: 0, stakeWei: 0n, nullifier: 'live-run' }],
  readVotes,
  settle: async (c, t) => {
    const out = await createRuling(writer, { caseId: c.caseId, kind: c.kind, value: c.value, outcome: t.outcome, payload: rulingPayload(c, t) });
    settles.push({ c, t, out });
    return { status: 'settled', result: t.outcome === 'block' ? 'confirmed' : 'rejected', did: ['ruling'], repEvents: [] };
  },
}, { commitSeconds: 14, revealSeconds: 14, panelSize: 1, quorum: 1, minStakeWei: 0n, minRep: 0, seedDelayBlocks: 3, maxRounds: 2 });

await driver.open({ caseId, reportId: '1'.repeat(32), reporter, kind: 'domain', value: 'lookout-live-run.example', exclude: [reporter] });
const salt2 = newSalt();
let voteKey = null;
let revealed = false;
const deadline = Date.now() + 150_000;
let last = '';
while (Date.now() < deadline) {
  const res = await driver.tick();
  const s = driver.get(caseId);
  if (s.phase !== last) { console.log(`       phase -> ${s.phase}${s.note ? ` (${s.note})` : ''}`); last = s.phase; }
  if (res[0]?.error) fail('driver error', res[0].error);
  if (s.phase === 'commit' && !voteKey) {
    const hash = commitVote({ caseId, outcome: 'block', salt: salt2, juror: me });
    voteKey = (await createVote(writer, { caseId, commitHash: hash })).entityKey;
    console.log('       juror committed');
  }
  if (s.phase === 'reveal' && voteKey && !revealed) {
    await revealVote(writer, { entityKey: voteKey, caseId, juror: me, outcome: 'block', salt: salt2, commitHash: commitVote({ caseId, outcome: 'block', salt: salt2, juror: me }) });
    revealed = true;
    console.log('       juror revealed');
  }
  if (s.phase === 'settled' || s.phase === 'unresolved') break;
  await sleep(2000);
}
const fin = driver.get(caseId);
check(fin.phase === 'settled' && fin.result === 'confirmed', 'case settled, outcome block means the report is confirmed', `${fin.phase}/${fin.result}`);
check(fin.jurors?.length === 1 && fin.jurors[0] === me && !fin.jurors.includes(reporter), 'the drawn juror is the only eligible wallet, never the reporter');
const seedAgain = await blocks.blockHash(fin.openedBlock + 3);
check(seedAgain === fin.seed, 'anyone can re-read the seed: it is the hash of block opened+3', fin.seed?.slice(0, 14) + '…');
let ruling;
for (let i = 0; i < 10 && !ruling; i++) {
  ruling = (await publicClient.select({ outcome: true, targetHash: true }).from(SCHEMAS.ruling).where(eq('caseId', caseId)).fetch()).entities[0];
  if (!ruling) await sleep(2000);
}
check(val(ruling?.outcome) === 'block' && val(ruling?.targetHash) === th, 'ruling entity is on Arkiv with the right target and outcome');
const payload = settles[0] && JSON.parse(new TextDecoder().decode(rulingPayload(settles[0].c, settles[0].t)));
check(payload?.seed === fin.seed && payload?.jurors?.[0] === me && payload?.counts?.block === 1, 'ruling payload carries seed, jurors and counts');

const spent = before - (await publicClient.getBalance({ address }));
console.log(`\n${process.exitCode ? 'SOME CHECKS FAILED' : 'all live checks passed'}. cost ${Number(spent) / 1e18} tGLM`);
