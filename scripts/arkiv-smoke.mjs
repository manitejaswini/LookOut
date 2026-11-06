// First live check against the Arkiv Rabdi testnet, using the throwaway test wallet in .env.
//
//   npm run arkiv:smoke
//
// What it does (each step is independent, a failure in one does not stop the next):
//   1. creates ONE test `report` entity (a reserved .example domain, nothing real)
//   2. reads it back through an indexed attribute and checks owner, creator and expiry
//   3. extends it (this answers: does extendEntity work on a readonly entity?)
//   4. tries to patch it (this should FAIL, proving the readonly flag is enforced)
//   5. reports the gas cost in tGLM
// It never prints a key. The test entity expires on its own after 24 hours.

import { existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { and, eq } from '@arkiv-network/sdk/query';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { SCHEMAS, LIFETIMES, CREATION_FLAGS } from '@lookout/arkiv';
import { targetHash } from '@lookout/core';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) {
  console.error('Need ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env (see .env.example)');
  process.exit(1);
}

const chain = rabdi({ accessKey: ARKIV_ACCESS_KEY });
const account = privateKeyToAccount(ARKIV_PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ chain, transport: http(), account });

const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x), 2);
const tglm = (wei) => (Number(wei) / 1e18).toString();
const step = (n, title) => console.log(`\n[${n}] ${title}`);
const fail = (e) => console.log('    FAILED:', e?.constructor?.name, '-', String(e?.shortMessage ?? e?.message ?? e).split('\n')[0]);

const before = await publicClient.getBalance({ address: account.address });
console.log('wallet', account.address, '| balance', tglm(before), 'tGLM');

const reportId = randomBytes(16).toString('hex'); // 128-bit client-generated id, see arkiv/schema.md
const hash = targetHash('domain', 'lookout-smoke-test.example');
let entityKey;

step(1, 'create a test report');
try {
  const out = await walletClient.createEntity(
    SCHEMAS.report,
    { reportId, targetHash: hash, targetKind: 'domain', category: 'other' },
    { expiration: LIFETIMES.report(), flags: CREATION_FLAGS.report },
  );
  entityKey = out.entityKey;
  console.log('    entityKey :', out.entityKey);
  console.log('    txHash    :', out.txHash);
  console.log('    expiresAt :', String(out.expiresAt), '(block)');
} catch (e) { fail(e); }

step(2, 'read it back by an indexed attribute (targetHash + reportId)');
try {
  const { entities } = await publicClient
    .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, reportId: true, targetHash: true, targetKind: true, category: true })
    .from(SCHEMAS.report)
    .where(and(eq('targetHash', hash), eq('reportId', reportId)))
    .fetch();
  console.log('    found     :', entities.length, 'entity');
  if (entities[0]) {
    const e = entities[0];
    console.log('    $creator is our wallet :', String(e.$creator).toLowerCase() === account.address.toLowerCase());
    console.log('    $owner is our wallet   :', String(e.$owner).toLowerCase() === account.address.toLowerCase());
    const { currentBlock } = await publicClient.getBlockTiming();
    console.log('    blocks until expiry    :', String(BigInt(e.$expiresAt) - BigInt(currentBlock)), '(expected about 43,200 = 24h)');
    console.log('    attributes             :', show({ reportId: e.reportId, targetKind: e.targetKind, category: e.category }));
  }
} catch (e) { fail(e); }

step(3, 'extendEntity on a READONLY entity (open question in arkiv/schema.md)');
try {
  const out = await walletClient.extendEntity({ entityKey, expiration: ExpirationTime.fromHours(48) });
  console.log('    WORKS. new expiresAt:', String(out.expiresAt), '-> verdict refresh by extension is possible');
} catch (e) { fail(e); console.log('    -> verdict refresh by extendEntity would NOT work; the design needs a change'); }

step(4, 'patchEntity on the readonly entity (should be rejected)');
try {
  await walletClient.patchEntity(SCHEMAS.report, entityKey, { set: { category: 'drainer' } });
  console.log('    UNEXPECTED: patch succeeded, so the readonly flag is NOT enforced');
} catch (e) { console.log('    rejected, as expected:', e?.constructor?.name); }

const after = await publicClient.getBalance({ address: account.address });
step(5, 'cost');
console.log('    balance after :', tglm(after), 'tGLM');
console.log('    spent         :', tglm(before - after), 'tGLM for the steps above');
