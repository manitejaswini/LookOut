import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSignal } from '@worldcoin/idkit-core';
import { canonicalNullifier, normalizeWallet, verifyProofOfHuman, WorldIdError } from './verify.ts';
import { HUMAN_1, SIGNING_KEY, WALLET_A, WALLET_B, config, fakeWorld, payload } from './fixtures.ts';

const verify = (p: unknown, world = fakeWorld(), wallet = WALLET_A, cfg = config) =>
  verifyProofOfHuman({ payload: p, wallet, config: cfg, fetchImpl: world.fetchImpl });

async function refused(p: unknown, code: string, world = fakeWorld(), wallet = WALLET_A, cfg = config) {
  await assert.rejects(verify(p, world, wallet, cfg), (e: unknown) => e instanceof WorldIdError && e.code === code, code);
  return world;
}

/* ---------- the happy path ---------- */

test('a valid proof of human is accepted and returns the canonical nullifier', async () => {
  const world = fakeWorld();
  const out = await verify(payload(), world);
  assert.match(out.nullifier, /^nil_[0-9a-f]{64}$/);
  assert.equal(out.issuerSchemaId, 1);
  assert.equal(out.expiresAtMin, 1756166400);
});

test('it forwards the payload to World unchanged except for the expected environment, and never sends the signing key', async () => {
  const world = fakeWorld();
  const p = payload();
  await verify(p, world);
  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0].url, 'https://verify.test/api/v4/verify/rp_testrp123');
  assert.equal(world.calls[0].init.method, 'POST');
  assert.deepEqual(world.calls[0].body, { ...p, environment: 'staging' });
  assert.equal(JSON.stringify(world.calls[0]).includes(SIGNING_KEY), false, 'the RP signing key must never leave the server');
});

/* ---------- refused before World is even asked ---------- */

test('a proof for the wrong environment is refused, in both directions, without calling World', async () => {
  const w1 = await refused(payload({ environment: 'production' }), 'wrong_environment');
  assert.equal(w1.calls.length, 0);
  // a production server must refuse a staging (simulator) proof
  const w2 = await refused(payload({ environment: 'staging' }), 'wrong_environment', fakeWorld(), WALLET_A, { ...config, environment: 'production' });
  assert.equal(w2.calls.length, 0);
});

test('a proof for a different action is refused', async () => {
  const w = await refused(payload({ action: 'some-other-action' }), 'wrong_action');
  assert.equal(w.calls.length, 0);
});

test('legacy 3.0 proofs are refused, because they would give the same human a second nullifier', async () => {
  for (const v of ['3.0', '', undefined]) {
    const p = payload();
    if (v === undefined) delete p.protocol_version; else p.protocol_version = v;
    await refused(p, 'wrong_protocol');
  }
});

test('only the Proof of Human credential is accepted: not orb legacy, selfie, passport or an empty response', async () => {
  for (const identifier of ['orb', 'selfie', 'passport', 'mnc', 'document', '']) await refused(payload({ identifier }), 'wrong_credential');
  await refused(payload({ responses: [] }), 'wrong_credential');
  await refused(payload({ responses: 'nope' }), 'wrong_credential');
  await refused(payload({ issuer_schema_id: 9303 }), 'wrong_credential', fakeWorld());
});

test('a credential list that includes proof_of_human among others is fine, and only that item is used', async () => {
  const p = payload({ responses: [
    { identifier: 'selfie', signal_hash: hashSignal(WALLET_A), nullifier: HUMAN_1, issuer_schema_id: 1 },
    { identifier: 'proof_of_human', signal_hash: hashSignal(WALLET_A), nullifier: HUMAN_1, issuer_schema_id: 1 },
  ] });
  assert.match((await verify(p)).nullifier, /^nil_/);
});

test('the proof must be bound to THIS wallet: a proof made for another wallet cannot seat this one', async () => {
  const forB = payload({ wallet: WALLET_B });
  const w = await refused(forB, 'signal_mismatch', fakeWorld(), WALLET_A);
  assert.equal(w.calls.length, 0, 'refused locally, World is not even asked');
  await refused(payload({ signal_hash: undefined }), 'signal_mismatch');
  await refused(payload({ signal_hash: 'not-a-hash' }), 'signal_mismatch');
  await refused(payload({ signal_hash: '0x0' }), 'signal_mismatch', fakeWorld(), WALLET_A);
});

test('the wallet binding does not depend on address letter case', async () => {
  const upper = WALLET_A.toUpperCase().replace('0X', '0x');
  assert.match((await verify(payload({ wallet: WALLET_A }), fakeWorld(), upper)).nullifier, /^nil_/);
});

test('nullifier: hex and decimal spellings of the same number are the same human, and bad values are refused', async () => {
  const dec = BigInt(HUMAN_1).toString(10);
  const upperHex = HUMAN_1.toUpperCase().replace('0X', '0x');
  const short = '0x' + BigInt(HUMAN_1).toString(16); // no leading zeros to pad here, same value
  const a = canonicalNullifier(HUMAN_1);
  assert.equal(canonicalNullifier(dec), a, 'decimal (the SDK type documents decimal)');
  assert.equal(canonicalNullifier(upperHex), a);
  assert.equal(canonicalNullifier(short), a);
  for (const bad of [undefined, null, 42, '', 'abc', '0x', '0xzz', `0x${'ff'.repeat(32)}`, '-5', '1.5']) {
    assert.throws(() => canonicalNullifier(bad), (e: unknown) => e instanceof WorldIdError && e.code === 'bad_nullifier', String(bad));
  }
  // and through the whole check
  await refused(payload({ nullifier: '0x' + 'ff'.repeat(32) }), 'bad_nullifier');
});

test('a payload that is not an object is refused', async () => {
  for (const p of [null, undefined, 'proof', 42, [], true]) await refused(p, 'bad_payload');
});

/* ---------- World says no ---------- */

test("when World rejects the proof, the seat is refused and World's reason is passed on", async () => {
  await assert.rejects(verify(payload(), fakeWorld({ status: 400, body: { code: 'invalid_proof' } })), (e: unknown) => e instanceof WorldIdError && e.code === 'verification_failed' && /invalid_proof/.test(e.message));
  await refused(payload(), 'verification_failed', fakeWorld({ body: { success: false, environment: 'staging' } }));
  await refused(payload(), 'verification_failed', fakeWorld({ body: { environment: 'staging' } }));
  await refused(payload(), 'verification_failed', fakeWorld({ body: 'not json at all' }));
  await refused(payload(), 'verification_failed', fakeWorld({ status: 500, body: { success: true, environment: 'staging' } }));
});

test('World confirming the wrong environment is refused (checked on the response as well as the payload)', async () => {
  await refused(payload(), 'verification_failed', fakeWorld({ body: { success: true, environment: 'production' } }));
});

test('an unreachable verifier is a 502-style error, distinct from a bad proof', async () => {
  await assert.rejects(verify(payload(), fakeWorld({ throws: true })), (e: unknown) => e instanceof WorldIdError && e.code === 'verifier_unreachable' && e.status === 502);
});

/* ---------- wallets ---------- */

test('normalizeWallet lowercases a good address and refuses everything else', () => {
  assert.equal(normalizeWallet('0x37324A0CC17959Ee99233c8552e741519983573E'), WALLET_A);
  assert.equal(normalizeWallet(`  ${WALLET_A}  `), WALLET_A);
  for (const bad of [undefined, null, 5, '', '0x123', WALLET_A.slice(2), `${WALLET_A}00`, '0xZZ324a0cc17959ee99233c8552e741519983573e']) {
    assert.throws(() => normalizeWallet(bad), (e: unknown) => e instanceof WorldIdError && e.code === 'bad_wallet', String(bad));
  }
});
