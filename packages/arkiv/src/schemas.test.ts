// Step 2: the nine schemas in code must match arkiv/schema.md. These tests encode the doc's tables,
// so a drift between the two fails loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpirationTime, MAX_ATTRIBUTES, MAX_LIFETIME, MAX_NAME_BYTES } from '@arkiv-network/sdk';
import { isSchema, isValidAttributeName } from '@arkiv-network/sdk/schema';
import { CREATION_FLAGS, ENUMS, KINDS, LIFETIMES, SCHEMAS, VERDICT_REFRESH, schemaName, type Kind } from './index.ts';

type Col = { type: string; isIndexed: boolean; isOptional: boolean };
const cols = (k: Kind) => SCHEMAS[k].columns as unknown as Record<string, Col>;
const blocks = (e: unknown) => BigInt((e as { minLifetime: bigint | string | number }).minLifetime);

// The "Idx" column of every table in arkiv/schema.md
const INDEXED: Record<Kind, string[]> = {
  report: ['reportId', 'targetHash', 'targetKind', 'category'],
  verdict: ['targetHash', 'sourceType', 'sourceId', 'level'],
  attestation: ['targetHash', 'claim'],
  stake: ['reportId', 'status'],
  vote: ['caseId'],
  ruling: ['caseId', 'targetHash', 'outcome'],
  reputation: ['wallet', 'snapshotId'],
  snapshot: ['snapshotId', 'indexerId'],
  bounty: ['reportId'],
};

const OPTIONAL: Record<Kind, string[]> = {
  report: ['payload'],
  verdict: ['proofHash', 'reason', 'payload'],
  attestation: ['payload'],
  stake: [],
  vote: ['outcome', 'salt'],
  ruling: ['payload'],
  reputation: [],
  snapshot: [],
  bounty: [], // payload is required: a bounty without an ephemeral key is useless
};

test('there are exactly nine kinds, and each is a named schema lookout.v0.<kind>', () => {
  assert.equal(KINDS.length, 9);
  for (const k of KINDS) {
    const s = SCHEMAS[k];
    assert.ok(isSchema(s), k);
    assert.equal(s.name, schemaName(k));
    assert.equal(s.name, `lookout.v0.${k}`);
  }
});

test('column counts leave room for the schema tag, and every name is valid and short', () => {
  for (const k of KINDS) {
    const names = Object.keys(cols(k));
    assert.ok(names.length <= MAX_ATTRIBUTES - 1, `${k} has ${names.length} columns (31 allowed in a named schema)`);
    for (const n of names) {
      assert.ok(isValidAttributeName(n), `${k}.${n}`);
      assert.ok(new TextEncoder().encode(n).length <= MAX_NAME_BYTES, `${k}.${n}`);
    }
  }
});

test('indexed columns are exactly the ones the doc lists', () => {
  for (const k of KINDS) {
    const got = Object.entries(cols(k)).filter(([, c]) => c.isIndexed).map(([n]) => n).sort();
    assert.deepEqual(got, [...INDEXED[k]].sort(), k);
  }
});

test('optional columns are exactly the ones the doc lists', () => {
  for (const k of KINDS) {
    const got = Object.entries(cols(k)).filter(([, c]) => c.isOptional).map(([n]) => n).sort();
    assert.deepEqual(got, [...OPTIONAL[k]].sort(), k);
  }
});

test('payload is a bytes column and bytes are never indexed', () => {
  for (const k of KINDS) {
    for (const [n, c] of Object.entries(cols(k))) {
      if (c.type === 'bytes') assert.equal(c.isIndexed, false, `${k}.${n}`);
      if (n === 'payload') assert.equal(c.type, 'bytes', `${k}.payload`);
    }
  }
});

test('hash and id columns are str, wallets are addr, so queries match what the doc says', () => {
  for (const k of KINDS) {
    for (const [n, c] of Object.entries(cols(k))) {
      if (['targetHash', 'reportId', 'caseId', 'snapshotId'].includes(n)) assert.equal(c.type, 'str', `${k}.${n}`);
    }
  }
  assert.equal(cols('reputation').wallet.type, 'addr');
  assert.equal(cols('stake').amountWei.type, 'u256');
  assert.equal(cols('reputation').score.type, 'dec');
  assert.equal(cols('snapshot').bucketCount.type, 'i32');
});

test('creation flags: readonly everywhere except stake (status changes) and vote (reveal); extension is never permissionless', () => {
  for (const k of KINDS) {
    const want = k !== 'stake' && k !== 'vote';
    assert.equal(!!CREATION_FLAGS[k].readonly, want, k);
    assert.equal('permissionlessExtension' in CREATION_FLAGS[k], false, `${k} must not allow anyone to extend`);
  }
});

test('lifetimes, in blocks, match the doc and stay under the 182.5 day maximum', () => {
  const want: Record<Kind, bigint> = {
    report: 43_200n,        // 24 hours
    verdict: 10_800n,       // 6 hours
    attestation: 1_296_000n, // 30 days
    ruling: 3_888_000n,     // 90 days
    stake: 1_296_000n,      // 30 days (tune)
    vote: 302_400n,         // 7 days (tune)
    bounty: 2_592_000n,     // 60 days (tune)
    snapshot: 604_800n,     // 14 days (tune)
    reputation: 604_800n,   // 14 days (tune)
  };
  for (const k of KINDS) {
    assert.equal(blocks(LIFETIMES[k]()), want[k], k);
    assert.ok(blocks(LIFETIMES[k]()) <= BigInt(MAX_LIFETIME), `${k} is over the maximum`);
  }
  assert.equal(blocks(VERDICT_REFRESH()), blocks(ExpirationTime.fromHours(6)), 'a refresh is a full 6 hours from now');
});

test('enumerations: no duplicates, and the values the doc lists', () => {
  for (const [name, values] of Object.entries(ENUMS)) assert.equal(new Set(values).size, values.length, name);
  assert.deepEqual([...ENUMS.targetKind], ['domain', 'address', 'contract']);
  assert.deepEqual([...ENUMS.level], ['block', 'warn']);
  assert.deepEqual([...ENUMS.claim], ['legit', 'confirmed']);
  assert.deepEqual([...ENUMS.stakeStatus], ['locked', 'returned', 'slashed']);
  assert.deepEqual([...ENUMS.outcome], ['block', 'clear']);
  assert.deepEqual([...ENUMS.sourceType], ['community', 'feed', 'checker', 'verifier', 'ruling']);
});
