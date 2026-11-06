import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  addressFromPrivateKey, bountyIdFor, checksumAddress, createPayment, ephemeralFor, generateKeys, metaAddress,
  parseMetaAddress, stealthAddressFor, stealthPrivateKey, sweepValue,
} from './stealth.ts';

const k = (label: string) => keccak_256(utf8ToBytes(label));
const KEYS = { spendingKey: k('lookout test spending key'), viewingKey: k('lookout test viewing key') };
const PAYER = k('lookout test payer secret');

// Pinned vectors. Also in arkiv/stealth-format.md. Changing them breaks every payer and claimer.
const V = {
  spendingKey: 'ad4797fdd0e060056341384abf268ba43f965951945e4243142801e0579cf8bc',
  viewingKey: '17b30f4ff50374205c9b807f9b143abb69a05c67790eb59f6b0080488ed53867',
  meta: 'st:eth:0x02432c0e3eb5b16469c2b996a486cb102e5ef8bed26ed952b49da563a797f8ee9a02f8493a7c42a5248c9cd967b728272141cbb8e75d228723d3268c7e4a4fc2d597',
  ephemeralSecret: 'c0d52a66dc6f8613d5caf44f80d6bb207f47a0609bb02c565e21abb5b00e2f65',
  ephemeralPublicKey: '0x03359ec24120361103f4d86d574dc521a02eb4514274b799a7dce633338e884fd5',
  stealthAddress: '0xb8007cb64a0a4b45a764249ca558daaebc7e3408',
  stealthPrivateKey: '926c56ae3e0b0d5716f718edf52e23f8db789acab2d74513ca6084c6ed41c24d',
};

test('pinned vectors', () => {
  assert.equal(bytesToHex(KEYS.spendingKey), V.spendingKey);
  assert.equal(bytesToHex(KEYS.viewingKey), V.viewingKey);
  assert.equal(metaAddress(KEYS), V.meta);
  const eph = ephemeralFor(PAYER, 'rep_0001');
  assert.equal(bytesToHex(eph), V.ephemeralSecret);
  const pay = createPayment(V.meta, eph);
  assert.equal(pay.ephemeralPublicKey, V.ephemeralPublicKey);
  assert.equal(pay.stealthAddress, V.stealthAddress);
  assert.equal(bytesToHex(stealthPrivateKey(KEYS, pay.ephemeralPublicKey)), V.stealthPrivateKey);
});

test('address derivation matches the well-known address of private key 1', () => {
  const one = new Uint8Array(32); one[31] = 1;
  assert.equal(addressFromPrivateKey(one), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  assert.equal(checksumAddress('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'), '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
});

test('payer and claimer agree: the claimer key controls the address the payer paid', () => {
  for (let i = 0; i < 20; i++) {
    const keys = generateKeys();
    const pay = createPayment(metaAddress(keys), ephemeralFor(PAYER, `rep_${i}`));
    const priv = stealthPrivateKey(keys, pay.ephemeralPublicKey);
    assert.equal(addressFromPrivateKey(priv), pay.stealthAddress);
    // the viewing key alone finds the same address but cannot produce the spend key
    assert.equal(stealthAddressFor(keys.viewingKey, parseMetaAddress(metaAddress(keys)).spendingPub, pay.ephemeralPublicKey), pay.stealthAddress);
  }
});

test('retry is idempotent: same payer secret and reportId give the same address', () => {
  const a = createPayment(V.meta, ephemeralFor(PAYER, 'rep_0001'));
  const b = createPayment(V.meta, ephemeralFor(PAYER, 'rep_0001'));
  assert.deepEqual(a, b);
});

test('different reports to the same reporter land on unlinkable addresses', () => {
  const a = createPayment(V.meta, ephemeralFor(PAYER, 'rep_0001'));
  const b = createPayment(V.meta, ephemeralFor(PAYER, 'rep_0002'));
  assert.notEqual(a.stealthAddress, b.stealthAddress);
  assert.notEqual(a.ephemeralPublicKey, b.ephemeralPublicKey);
});

test('a different reporter cannot derive the key', () => {
  const pay = createPayment(V.meta, ephemeralFor(PAYER, 'rep_0001'));
  const other = generateKeys();
  assert.notEqual(addressFromPrivateKey(stealthPrivateKey(other, pay.ephemeralPublicKey)), pay.stealthAddress);
});

test('meta-address parsing rejects junk', () => {
  for (const bad of ['', 'st:eth:0x', V.meta.slice(0, -2), V.meta.toUpperCase(), `st:eth:0x${'00'.repeat(66)}`, V.meta.replace('st:eth', 'st:btc')]) {
    assert.throws(() => parseMetaAddress(bad), bad.slice(0, 20));
  }
  assert.doesNotThrow(() => parseMetaAddress(V.meta));
});

test('sweep: the stealth address pays its own gas', () => {
  assert.equal(sweepValue(1_000_000_000_000_000n, 10_000_000_000n), 1_000_000_000_000_000n - 210_000_000_000_000n);
  assert.equal(sweepValue(100n, 10_000_000_000n), null);
  assert.equal(sweepValue(210_000_000_000_000n, 10_000_000_000n), null);
});

test('the bounty id is 32 bytes, stable per report, different per report and per payer, and not guessable from the report id', () => {
  const a = bountyIdFor(PAYER, 'rep_0001');
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.equal(a, bountyIdFor(PAYER, 'rep_0001'));
  assert.notEqual(a, bountyIdFor(PAYER, 'rep_0002'));
  assert.notEqual(a, bountyIdFor(new Uint8Array(32).fill(9), 'rep_0001'));
});
