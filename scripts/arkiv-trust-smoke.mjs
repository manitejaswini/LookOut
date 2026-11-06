// Live check of the trust-layer writers on Rabdi, with the throwaway test wallet in .env.
//
//   node scripts/arkiv-trust-smoke.mjs
//
// Writes one of each: stake (then patches its status), vote (then reveals it by patching), ruling, reputation, bounty.
// Everything is about the reserved `lookout-trust-smoke.example` domain and fake ids, and expires on its own.
// It never prints a key. The indexer ignores all of it (the test wallet is not the escrow writer, panel or a juror).

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { eq } from '@arkiv-network/sdk/query';
import { commitVote, newSalt } from '@lookout/core';
import {
  SCHEMAS, createArkivClients, createBounty, createReputation, createRuling, createStake, createVote, revealVote, setStakeStatus,
} from '@lookout/arkiv';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) { console.error('Need ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env'); process.exit(1); }

const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const before = await publicClient.getBalance({ address });
const reportId = randomBytes(16).toString('hex');
const caseId = randomBytes(8).toString('hex');
const ok = (label, detail = '') => console.log(`  ok   ${label.padEnd(34)} ${detail}`);
const read = async (kind, field, value, select) =>
  (await publicClient.select({ $key: true, ...select }).from(SCHEMAS[kind]).where(eq(field, value)).fetch()).entities;
const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

console.log(`wallet ${address.slice(0, 8)}…  reportId ${reportId.slice(0, 8)}…  caseId ${caseId}`);

// stake: created locked, then patched to returned
const stake = await createStake(writer, { reportId, amountWei: 1_000_000_000_000_000n, escrowTx: `0x${'12'.repeat(32)}` });
ok('stake created (locked)', stake.entityKey.slice(0, 12) + '…');
await setStakeStatus(writer, { entityKey: stake.entityKey, from: 'locked', to: 'returned' });
const s = (await read('stake', 'reportId', reportId, { status: true, amountWei: true }))[0];
ok('stake patched', `status=${val(s.status)} amountWei=${val(s.amountWei)}`);
if (val(s.status) !== 'returned' || String(val(s.amountWei)) !== '1000000000000000') throw new Error('stake round trip failed');

// vote: commit, then reveal by patching
const salt = newSalt();
const commitHash = commitVote({ caseId, outcome: 'block', salt, juror: address });
const vote = await createVote(writer, { caseId, commitHash });
const hidden = (await read('vote', 'caseId', caseId, { commitHash: true, outcome: true, salt: true }))[0];
ok('vote committed', `outcome hidden: ${val(hidden.outcome) === undefined ? 'yes' : 'NO'}`);
if (val(hidden.outcome) !== undefined || val(hidden.salt) !== undefined) throw new Error('a committed vote must not reveal its outcome');
await revealVote(writer, { entityKey: vote.entityKey, caseId, juror: address, outcome: 'block', salt, commitHash });
const shown = (await read('vote', 'caseId', caseId, { commitHash: true, outcome: true, salt: true }))[0];
ok('vote revealed', `outcome=${val(shown.outcome)}, commitHash unchanged: ${val(shown.commitHash) === commitHash}`);
if (val(shown.outcome) !== 'block' || val(shown.commitHash) !== commitHash) throw new Error('vote reveal failed');

// ruling
const payload = new TextEncoder().encode(JSON.stringify({ note: 'live smoke test, not a real case' }));
const ruling = await createRuling(writer, { caseId, kind: 'domain', value: 'lookout-trust-smoke.example', outcome: 'clear', payload });
const r = (await read('ruling', 'caseId', caseId, { outcome: true }))[0];
ok('ruling created', `outcome=${val(r.outcome)} ${ruling.entityKey.slice(0, 12)}…`);

// reputation: a typed decimal and a typed address
await createReputation(writer, { wallet: address, snapshotId: `smoke-${caseId}`, score: 12.5 });
const rep = (await read('reputation', 'snapshotId', `smoke-${caseId}`, { wallet: true, score: true }))[0];
ok('reputation created', `score=${val(rep.score)} wallet matches: ${String(val(rep.wallet)).toLowerCase() === address.toLowerCase()}`);
if (Number(val(rep.score)) !== 12.5) throw new Error('reputation score round trip failed');

// bounty: the generator point of secp256k1 is a valid compressed key to use as a stand-in
const G = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
await createBounty(writer, { reportId, amountTier: 2, ephemeralPublicKey: G });
const b = (await read('bounty', 'reportId', reportId, { amountTier: true }))[0];
ok('bounty created', `amountTier=${val(b.amountTier)}`);

const after = await publicClient.getBalance({ address });
console.log(`\nall five kinds written and read back. cost ${(Number(before - after) / 1e18).toString()} tGLM`);
