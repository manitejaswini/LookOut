// Step 1: assert every Arkiv limit that arkiv/schema.md relies on against the REAL SDK constants.
// The docs were read through a summarising tool, so this is the check that the numbers are right.
// If a test here fails after an SDK upgrade, arkiv/schema.md needs a review before anything else.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECIMAL_SCALE, ExpirationTime, InvalidExpiryError, MAX_ATTRIBUTES, MAX_BYTES_LENGTH, MAX_ENTITY_BYTES,
  MAX_LIFETIME, MAX_NAME_BYTES, MAX_STRING_BYTES, SCHEMA_ATTRIBUTE, SYSTEM_FIELDS,
} from '@arkiv-network/sdk';
import { MAX_LIMIT } from '@arkiv-network/sdk/query';
import { str, InvalidValueError } from '@arkiv-network/sdk/schema';
import { rabdi } from '@arkiv-network/sdk/chains';

const blocks = (e: unknown) => BigInt((e as { minLifetime: bigint | string | number }).minLifetime);

test('entity limits match what the schema doc assumes', () => {
  assert.equal(MAX_ATTRIBUTES, 32, 'attributes per entity (31 once a named schema adds its tag)');
  assert.equal(MAX_NAME_BYTES, 32, 'attribute name length in bytes');
  assert.equal(MAX_STRING_BYTES, 128, 'a str value is at most 128 UTF-8 bytes');
  assert.equal(MAX_BYTES_LENGTH, 128 * 1024, 'one bytes value is at most 128 KiB');
  assert.equal(MAX_ENTITY_BYTES, 128 * 1024, 'all bytes in one create or patch share 128 KiB');
  assert.equal(DECIMAL_SCALE, 18, 'dec has 18 decimal places');
});

test('query page size is 100 rows', () => {
  assert.equal(MAX_LIMIT, 100);
});

test('the schema tag attribute and the system fields we filter on exist', () => {
  assert.equal(SCHEMA_ATTRIBUTE, 'arkiv.schema');
  for (const f of ['$key', '$owner', '$creator', '$expiresAt']) assert.ok((SYSTEM_FIELDS as readonly string[]).includes(f), f);
});

test('lifetime: 2-second blocks, maximum 7,884,000 blocks (about 182.5 days)', () => {
  assert.equal(MAX_LIFETIME, 7_884_000n, 'MAX_LIFETIME is a bigint');
  assert.equal(blocks(ExpirationTime.fromSeconds(2)), 1n, 'one block is 2 seconds');
  assert.throws(() => ExpirationTime.fromSeconds(3), InvalidExpiryError, 'half a block is rejected');
  const days = (Number(MAX_LIFETIME) * 2) / 86_400;
  assert.ok(Math.abs(days - 182.5) < 0.01, `${days} days`);
});

test('the block counts quoted in arkiv/schema.md are right', () => {
  assert.equal(blocks(ExpirationTime.fromHours(24)), 43_200n, 'report: 24 hours');
  assert.equal(blocks(ExpirationTime.fromHours(6)), 10_800n, 'verdict: 6 hours');
  assert.equal(blocks(ExpirationTime.fromDays(30)), 1_296_000n, 'attestation: 30 days');
  assert.equal(blocks(ExpirationTime.fromDays(90)), 3_888_000n, 'ruling: 90 days');
  assert.equal(blocks(ExpirationTime.max()), BigInt(MAX_LIFETIME));
});

test('a lifetime over the maximum is not rejected when built, only when sent (so our own tests must check it)', () => {
  assert.ok(blocks(ExpirationTime.fromDays(400)) > BigInt(MAX_LIFETIME));
});

test('str: 128 bytes fit, 129 do not. A 0x-prefixed 32-byte hash is 66 bytes and fits', () => {
  assert.doesNotThrow(() => str('x'.repeat(128)));
  assert.throws(() => str('x'.repeat(129)), InvalidValueError);
  assert.equal(`0x${'a'.repeat(64)}`.length, 66);
  assert.ok(66 <= MAX_STRING_BYTES);
});

test('the Rabdi testnet: chain id 7794095, and an access key avoids the public rate-limited endpoint', () => {
  const chain = rabdi({ accessKey: 'test-key-not-real' });
  assert.equal(chain.id, 7_794_095);
  assert.equal(chain.name, 'Rabdi');
});
