// Tests the trust-layer writers with a fake client. No network, no key, no gas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { targetHash } from '@lookout/core';
import { SCHEMAS } from './schemas.ts';
import {
  createBounty, createReputation, createRuling, createStake, publishReputationCheckpoint, setStakeStatus,
  type TrustWriter,
} from './trust-writers.ts';

const blocks = (e: unknown) => BigInt((e as { minLifetime: bigint | string | number }).minLifetime);
const plain = (v: unknown): unknown => (v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v);

type Call = { method: string; args: unknown[] };
function fake() {
  const calls: Call[] = [];
  const client: TrustWriter = {
    async createEntity(schema, values, options) {
      calls.push({ method: 'createEntity', args: [schema, values, options] });
      return { entityKey: `0x${'ab'.repeat(32)}`, txHash: `0x${'cd'.repeat(32)}`, expiresAt: 1234n };
    },
    async extendEntity(args) { calls.push({ method: 'extendEntity', args: [args] }); return { expiresAt: 5678n }; },
    async patchEntity(schema, entityKey, args) { calls.push({ method: 'patchEntity', args: [schema, entityKey, args] }); return {}; },
  };
  return { client, calls };
}
const created = (calls: Call[]) => {
  const c = calls.find((x) => x.method === 'createEntity')!;
  return { schema: c.args[0], values: c.args[1] as Record<string, unknown>, options: c.args[2] as { expiration: unknown; flags: { readonly?: boolean } } };
};

const REPORT_ID = '0123456789abcdef0123456789abcdef';
const CASE_ID = '0123456789abcdef';
const TX = `0x${'12'.repeat(32)}`;
const KEY = `0x${'ef'.repeat(32)}`;
const JUROR = '0x37324a0cc17959ee99233c8552e741519983573e';

/* ---------- stake ---------- */

test('createStake writes a LOCKED stake, not readonly (its status changes), with a 30 day lifetime', async () => {
  const { client, calls } = fake();
  await createStake(client, { reportId: REPORT_ID, amountWei: 10_000_000_000_000_000n, escrowTx: TX });
  const { schema, values, options } = created(calls);
  assert.equal(schema, SCHEMAS.stake);
  assert.equal(values.status, 'locked');
  assert.equal(plain(values.amountWei), 10_000_000_000_000_000n);
  assert.equal(values.reportId, REPORT_ID);
  assert.equal(options.flags.readonly, undefined, 'a stake must stay patchable');
  assert.equal(blocks(options.expiration), 1_296_000n);
});

test('createStake refuses bad input before anything is sent', async () => {
  const { client, calls } = fake();
  const ok = { reportId: REPORT_ID, amountWei: 1n, escrowTx: TX };
  await assert.rejects(createStake(client, { ...ok, reportId: 'nope' }), /reportId/);
  await assert.rejects(createStake(client, { ...ok, amountWei: 0n }), /positive/);
  await assert.rejects(createStake(client, { ...ok, amountWei: -5n }), /positive/);
  await assert.rejects(createStake(client, { ...ok, amountWei: 5 as never }), /positive/);
  await assert.rejects(createStake(client, { ...ok, amountWei: 1n << 256n }), /positive/);
  await assert.rejects(createStake(client, { ...ok, escrowTx: '0x123' }), /escrowTx/);
  assert.equal(calls.length, 0);
});

test('setStakeStatus patches a locked stake to returned or slashed, and nothing else', async () => {
  const { client, calls } = fake();
  await setStakeStatus(client, { entityKey: KEY, from: 'locked', to: 'returned' });
  await setStakeStatus(client, { entityKey: KEY, from: 'locked', to: 'slashed' });
  assert.deepEqual(calls.map((c) => c.method), ['patchEntity', 'patchEntity']);
  assert.deepEqual((calls[0].args[2] as { set: unknown }).set, { status: 'returned' });
  assert.equal(calls[0].args[0], SCHEMAS.stake);
  await assert.rejects(setStakeStatus(client, { entityKey: KEY, from: 'returned' as never, to: 'slashed' }), /only a locked stake/);
  await assert.rejects(setStakeStatus(client, { entityKey: KEY, from: 'locked', to: 'locked' as never }), /status/);
  await assert.rejects(setStakeStatus(client, { entityKey: '0x12', from: 'locked', to: 'returned' }), /entityKey/);
  assert.equal(calls.length, 2, 'the refused ones never reached the client');
});

/* ---------- ruling ---------- */

test('createRuling writes a readonly ruling with a 90 day lifetime, the normalised target hash and the evidence payload', async () => {
  const { client, calls } = fake();
  const payload = new TextEncoder().encode('{"jurors":5}');
  const out = await createRuling(client, { caseId: CASE_ID, kind: 'domain', value: 'HTTPS://Orbit-Bridge.app/x', outcome: 'clear', payload });
  const { schema, values, options } = created(calls);
  assert.equal(schema, SCHEMAS.ruling);
  assert.equal(values.targetHash, targetHash('domain', 'orbit-bridge.app'));
  assert.equal(out.targetHash, values.targetHash);
  assert.equal(values.outcome, 'clear');
  assert.deepEqual(values.payload, payload);
  assert.equal(options.flags.readonly, true);
  assert.equal(blocks(options.expiration), 3_888_000n);
});

test('createRuling refuses a bad outcome, case id, target or an oversized payload', async () => {
  const { client, calls } = fake();
  const ok = { caseId: CASE_ID, kind: 'domain' as const, value: 'a.example', outcome: 'block' as const };
  await assert.rejects(createRuling(client, { ...ok, outcome: 'maybe' as never }), /outcome/);
  await assert.rejects(createRuling(client, { ...ok, caseId: 'bad' }), /caseId/);
  await assert.rejects(createRuling(client, { ...ok, value: 'localhost' }), /invalid domain/);
  await assert.rejects(createRuling(client, { ...ok, payload: new Uint8Array(128 * 1024 + 1) }), /128 KiB/);
  assert.equal(calls.length, 0);
});

/* ---------- reputation ---------- */

test('createReputation writes a readonly score as a typed decimal for a lowercased wallet', async () => {
  const { client, calls } = fake();
  await createReputation(client, { wallet: JUROR.toUpperCase().replace('0X', '0x'), snapshotId: 'rep-001', score: 12.3456789 });
  const { schema, values, options } = created(calls);
  assert.equal(schema, SCHEMAS.reputation);
  // the SDK's addr() type stores the checksummed spelling, so readers compare case-insensitively (the indexer lowercases)
  assert.equal(String(plain(values.wallet)).toLowerCase(), JUROR);
  assert.equal(plain(values.score), '12.345679', 'six decimals');
  assert.equal(values.snapshotId, 'rep-001');
  assert.equal(options.flags.readonly, true);
  assert.equal(blocks(options.expiration), 604_800n);
});

test('createReputation refuses a negative, infinite, NaN or absurd score and a bad wallet or id', async () => {
  const { client, calls } = fake();
  const ok = { wallet: JUROR, snapshotId: 'rep-001', score: 1 };
  for (const score of [-1, Infinity, NaN, 1e10]) await assert.rejects(createReputation(client, { ...ok, score }), /score/);
  await assert.rejects(createReputation(client, { ...ok, wallet: '0x123' }), /wallet/);
  await assert.rejects(createReputation(client, { ...ok, snapshotId: 'bad id!' }), /snapshotId/);
  assert.equal(calls.length, 0);
});

test('publishReputationCheckpoint writes the non-zero scores in a stable order and skips zeros', async () => {
  const { client, calls } = fake();
  const w1 = '0x1111111111111111111111111111111111111111';
  const w2 = '0x2222222222222222222222222222222222222222';
  const w3 = '0x3333333333333333333333333333333333333333';
  const out = await publishReputationCheckpoint(client, 'rep-001', new Map([[w3, 5], [w1, 10], [w2, 0]]));
  assert.deepEqual(out, { written: 2, skipped: 1 });
  assert.deepEqual(calls.map((c) => plain((c.args[1] as { wallet: unknown }).wallet)), [w1, w3]);
});

/* ---------- bounty ---------- */

test('createBounty writes the 33-byte compressed key as the only payload, readonly, with a 60 day lifetime', async () => {
  const { client, calls } = fake();
  const R = `02${'ab'.repeat(32)}`;
  await createBounty(client, { reportId: REPORT_ID, amountTier: 3, ephemeralPublicKey: `0x${R}` });
  const { schema, values, options } = created(calls);
  assert.equal(schema, SCHEMAS.bounty);
  assert.equal(values.amountTier, 3);
  assert.equal((values.payload as Uint8Array).length, 33);
  assert.equal((values.payload as Uint8Array)[0], 0x02);
  assert.equal(options.flags.readonly, true);
  assert.equal(blocks(options.expiration), 2_592_000n);
  // bytes work the same as hex
  await createBounty(client, { reportId: REPORT_ID, amountTier: 0, ephemeralPublicKey: Uint8Array.from(R.match(/../g)!.map((h) => parseInt(h, 16))) });
  assert.equal(calls.length, 2);
});

test('createBounty refuses anything that is not a compressed key, a tier outside 0 to 255, or a bad report id', async () => {
  const { client, calls } = fake();
  const good = `03${'cd'.repeat(32)}`;
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: 1, ephemeralPublicKey: `04${'cd'.repeat(32)}` }), /compressed/);
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: 1, ephemeralPublicKey: '0x1234' }), /33 bytes/);
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: 1, ephemeralPublicKey: new Uint8Array(32) }), /33 bytes/);
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: 256, ephemeralPublicKey: good }), /amountTier/);
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: -1, ephemeralPublicKey: good }), /amountTier/);
  await assert.rejects(createBounty(client, { reportId: REPORT_ID, amountTier: 1.5, ephemeralPublicKey: good }), /amountTier/);
  await assert.rejects(createBounty(client, { reportId: 'nope', amountTier: 1, ephemeralPublicKey: good }), /reportId/);
  assert.equal(calls.length, 0);
});
