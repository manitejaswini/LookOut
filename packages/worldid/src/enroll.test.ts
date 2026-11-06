import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollReviewer } from './enroll.ts';
import { SqliteSeatStore } from './store.ts';
import { WorldIdError } from './verify.ts';
import { HUMAN_1, HUMAN_2, WALLET_A, WALLET_B, config, fakeWorld, payload } from './fixtures.ts';

const setup = () => ({ store: new SqliteSeatStore(), world: fakeWorld() });
const enroll = (s: ReturnType<typeof setup>, p: unknown, wallet: string) =>
  enrollReviewer({ payload: p, wallet }, { config, store: s.store, fetchImpl: s.world.fetchImpl });

test('SUCCESS: a verified human gets a reviewer seat', async () => {
  const s = setup();
  const r = await enroll(s, payload({ wallet: WALLET_A }), WALLET_A);
  assert.deepEqual(r, { status: 'enrolled', wallet: WALLET_A, seats: 1 });
  assert.equal(s.store.hasSeat(WALLET_A, config.action), true);
});

test('ALTERNATIVE PATH: the same human with a second wallet is refused, one human one seat', async () => {
  const s = setup();
  await enroll(s, payload({ wallet: WALLET_A, nullifier: HUMAN_1 }), WALLET_A);
  const second = await enroll(s, payload({ wallet: WALLET_B, nullifier: HUMAN_1 }), WALLET_B);
  assert.equal(second.status, 'human_already_enrolled');
  assert.equal(second.seats, 1);
  assert.equal(s.store.hasSeat(WALLET_B, config.action), false);
});

test('the same human retrying with the same wallet is not an error', async () => {
  const s = setup();
  await enroll(s, payload({ wallet: WALLET_A }), WALLET_A);
  assert.equal((await enroll(s, payload({ wallet: WALLET_A }), WALLET_A)).status, 'already_seated');
});

test('a different human cannot take over a wallet that already has a seat', async () => {
  const s = setup();
  await enroll(s, payload({ wallet: WALLET_A, nullifier: HUMAN_1 }), WALLET_A);
  assert.equal((await enroll(s, payload({ wallet: WALLET_A, nullifier: HUMAN_2 }), WALLET_A)).status, 'wallet_taken');
});

test('two different humans each get their own seat', async () => {
  const s = setup();
  await enroll(s, payload({ wallet: WALLET_A, nullifier: HUMAN_1 }), WALLET_A);
  const r = await enroll(s, payload({ wallet: WALLET_B, nullifier: HUMAN_2 }), WALLET_B);
  assert.equal(r.status, 'enrolled');
  assert.equal(r.seats, 2);
});

test('REPLAY: a proof made for wallet A cannot be used to seat wallet B, and the store is untouched', async () => {
  const s = setup();
  await assert.rejects(enroll(s, payload({ wallet: WALLET_A }), WALLET_B), (e: unknown) => e instanceof WorldIdError && e.code === 'signal_mismatch');
  assert.equal(s.store.count(config.action), 0);
});

test('a refused proof never creates or probes a seat: the store is only touched after every check passes', async () => {
  const s = setup();
  const bad = [
    payload({ environment: 'production' }),
    payload({ identifier: 'selfie' }),
    payload({ protocol_version: '3.0' }),
    payload({ nullifier: '0x' + 'ff'.repeat(32) }),
  ];
  for (const p of bad) await assert.rejects(enroll(s, p, WALLET_A), WorldIdError);
  const rejectedByWorld = setup();
  rejectedByWorld.world = fakeWorld({ status: 400, body: { code: 'invalid_proof' } });
  await assert.rejects(enroll(rejectedByWorld, payload(), WALLET_A), WorldIdError);
  assert.equal(s.store.count(config.action), 0);
  assert.equal(rejectedByWorld.store.count(config.action), 0);
});

test('a bad wallet is refused before World is asked anything', async () => {
  const s = setup();
  await assert.rejects(enroll(s, payload(), '0x123'), (e: unknown) => e instanceof WorldIdError && e.code === 'bad_wallet');
  assert.equal(s.world.calls.length, 0);
});

test('the wallet is normalised, so upper and lower case are the same seat', async () => {
  const s = setup();
  await enroll(s, payload({ wallet: WALLET_A }), WALLET_A.toUpperCase().replace('0X', '0x'));
  assert.equal(s.store.hasSeat(WALLET_A, config.action), true);
  assert.equal((await enroll(s, payload({ wallet: WALLET_A }), WALLET_A)).status, 'already_seated');
});
