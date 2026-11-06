// Tests the writers' logic with a fake client. No network, no key, no gas.
// The live behaviour (a real write and read back) is checked by `npm run arkiv:smoke` and `npm run arkiv:demo`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { targetHash } from '@lookout/core';
import { SCHEMAS } from './schemas.ts';
import { createAttestation, createReport, createVerdict, refreshVerdict, type EntityWriter } from './writers.ts';

const blocks = (e: unknown) => BigInt((e as { minLifetime: bigint | string | number }).minLifetime);

type Call = { method: string; args: unknown[] };

function fakeClient() {
  const calls: Call[] = [];
  const client: EntityWriter = {
    async createEntity(schema, values, options) {
      calls.push({ method: 'createEntity', args: [schema, values, options] });
      return { entityKey: `0x${'ab'.repeat(32)}`, txHash: `0x${'cd'.repeat(32)}`, expiresAt: 1234n };
    },
    async extendEntity(args) {
      calls.push({ method: 'extendEntity', args: [args] });
      return { expiresAt: 5678n };
    },
  };
  return { client, calls };
}

const lastCreate = (calls: Call[]) => {
  const c = calls.at(-1)!;
  return { schema: c.args[0], values: c.args[1] as Record<string, unknown>, options: c.args[2] as { expiration: unknown; flags: { readonly?: boolean } } };
};

/* ---------- report ---------- */

test('createReport: writes the report schema, a normalised target hash, 24h lifetime and the readonly flag', async () => {
  const { client, calls } = fakeClient();
  const out = await createReport(client, { kind: 'domain', value: 'HTTPS://Claim-Arbitrum-Airdrop.xyz/mint?x=1', category: 'drainer' });
  const { schema, values, options } = lastCreate(calls);
  assert.equal(schema, SCHEMAS.report);
  assert.equal(values.targetHash, targetHash('domain', 'claim-arbitrum-airdrop.xyz'));
  assert.equal(values.targetKind, 'domain');
  assert.equal(values.category, 'drainer');
  assert.match(String(values.reportId), /^[0-9a-f]{32}$/);
  assert.equal('payload' in values, false, 'an omitted optional column is left out');
  assert.equal(blocks(options.expiration), 43_200n);
  assert.equal(options.flags.readonly, true);
  assert.equal(out.reportId, values.reportId);
  assert.equal(out.expiresAt, '1234');
});

test('createReport: each report gets its own random id, and a supplied id is kept', async () => {
  const { client } = fakeClient();
  const a = await createReport(client, { kind: 'domain', value: 'a.example', category: 'other' });
  const b = await createReport(client, { kind: 'domain', value: 'a.example', category: 'other' });
  assert.notEqual(a.reportId, b.reportId);
  const c = await createReport(client, { kind: 'domain', value: 'a.example', category: 'other', reportId: '0123456789abcdef0123456789abcdef' });
  assert.equal(c.reportId, '0123456789abcdef0123456789abcdef');
});

test('createReport: bad input is rejected before anything is sent', async () => {
  const { client, calls } = fakeClient();
  const base = { kind: 'domain' as const, value: 'ok.example', category: 'other' as const };
  await assert.rejects(createReport(client, { ...base, category: 'scammy' as never }), /category/);
  await assert.rejects(createReport(client, { ...base, kind: 'website' as never }), /targetKind/);
  await assert.rejects(createReport(client, { ...base, value: 'localhost' }), /invalid domain/);
  await assert.rejects(createReport(client, { kind: 'address', value: '0x123', category: 'other' }), /invalid address/);
  await assert.rejects(createReport(client, { ...base, reportId: 'NOT-HEX' }), /reportId/);
  assert.equal(calls.length, 0, 'nothing reached the client');
});

test('createReport: an address and a contract produce the same hash', async () => {
  const { client, calls } = fakeClient();
  const a = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
  await createReport(client, { kind: 'address', value: a, category: 'drainer' });
  await createReport(client, { kind: 'contract', value: a.toUpperCase().replace('0X', '0x'), category: 'drainer' });
  assert.equal((calls[0].args[1] as Record<string, unknown>).targetHash, (calls[1].args[1] as Record<string, unknown>).targetHash);
});

/* ---------- verdict ---------- */

test('createVerdict: writes the verdict schema with a 6h lifetime and the readonly flag', async () => {
  const { client, calls } = fakeClient();
  await createVerdict(client, {
    kind: 'domain', value: 'claim-arbitrum-airdrop.xyz', sourceType: 'checker', sourceId: 'lookout-checker', level: 'block',
    proofHash: `0x${'11'.repeat(32)}`, reason: 'matches a known drainer bytecode pattern',
  });
  const { schema, values, options } = lastCreate(calls);
  assert.equal(schema, SCHEMAS.verdict);
  assert.equal(values.sourceType, 'checker');
  assert.equal(values.level, 'block');
  assert.equal(values.proofHash, `0x${'11'.repeat(32)}`);
  assert.equal(values.reason, 'matches a known drainer bytecode pattern');
  assert.equal(blocks(options.expiration), 10_800n);
  assert.equal(options.flags.readonly, true);
});

test('createVerdict: a community report or a ruling is not a verdict source', async () => {
  const { client, calls } = fakeClient();
  const base = { kind: 'domain' as const, value: 'ok.example', sourceId: 's', level: 'warn' as const };
  await assert.rejects(createVerdict(client, { ...base, sourceType: 'community' as never }), /sourceType/);
  await assert.rejects(createVerdict(client, { ...base, sourceType: 'ruling' as never }), /sourceType/);
  assert.equal(calls.length, 0);
});

test('createVerdict: rejects a bad level, an empty or oversized sourceId, a bad proofHash and a long reason', async () => {
  const { client, calls } = fakeClient();
  const base = { kind: 'domain' as const, value: 'ok.example', sourceType: 'feed' as const, sourceId: 'openfeed', level: 'block' as const };
  await assert.rejects(createVerdict(client, { ...base, level: 'maybe' as never }), /level/);
  await assert.rejects(createVerdict(client, { ...base, sourceId: '' }), /sourceId/);
  await assert.rejects(createVerdict(client, { ...base, sourceId: 'x'.repeat(129) }), /sourceId/);
  await assert.rejects(createVerdict(client, { ...base, proofHash: '0xABC' }), /proofHash/);
  await assert.rejects(createVerdict(client, { ...base, proofHash: `0x${'AA'.repeat(32)}` }), /proofHash/, 'uppercase hex is not canonical');
  await assert.rejects(createVerdict(client, { ...base, reason: 'é'.repeat(65) }), /reason/, '65 two-byte characters are 130 bytes');
  assert.equal(calls.length, 0);
  // exactly 128 bytes is fine
  await createVerdict(client, { ...base, reason: 'é'.repeat(64) });
  assert.equal(calls.length, 1);
});

test('refreshVerdict: extends by a full 6h verdict lifetime', async () => {
  const { client, calls } = fakeClient();
  const key = `0x${'ab'.repeat(32)}`;
  const out = await refreshVerdict(client, key);
  assert.equal(calls[0].method, 'extendEntity');
  const args = calls[0].args[0] as { entityKey: string; expiration: unknown };
  assert.equal(args.entityKey, key);
  assert.equal(blocks(args.expiration), 10_800n);
  assert.equal(out.expiresAt, '5678');
  await assert.rejects(refreshVerdict(client, '0x12'), /entityKey/);
});

/* ---------- attestation ---------- */

test('createAttestation: writes the attestation schema with a 30 day lifetime and the readonly flag', async () => {
  const { client, calls } = fakeClient();
  const proof = new TextEncoder().encode('deployer-signature-bytes');
  await createAttestation(client, { kind: 'domain', value: 'orbit-bridge.app', claim: 'legit', payload: proof });
  const { schema, values, options } = lastCreate(calls);
  assert.equal(schema, SCHEMAS.attestation);
  assert.equal(values.claim, 'legit');
  assert.equal(values.targetHash, targetHash('domain', 'orbit-bridge.app'));
  assert.deepEqual(values.payload, proof);
  assert.equal(blocks(options.expiration), 1_296_000n);
  assert.equal(options.flags.readonly, true);
  await assert.rejects(createAttestation(client, { kind: 'domain', value: 'orbit-bridge.app', claim: 'honest' as never }), /claim/);
});

test('the writers never ask for permissionless extension', async () => {
  const { client, calls } = fakeClient();
  await createReport(client, { kind: 'domain', value: 'a.example', category: 'other' });
  await createVerdict(client, { kind: 'domain', value: 'a.example', sourceType: 'feed', sourceId: 'f', level: 'warn' });
  await createAttestation(client, { kind: 'domain', value: 'a.example', claim: 'legit' });
  for (const c of calls) assert.equal('permissionlessExtension' in ((c.args[2] as { flags: object }).flags ?? {}), false);
});
