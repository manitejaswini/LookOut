import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';
import { createLimiter, handleRpSignature, handleSeat, handleStatus, handleVerify, type HandlerDeps } from './handlers.ts';
import { SqliteSeatStore } from './store.ts';
import { HUMAN_1, HUMAN_2, SIGNING_KEY, WALLET_A, WALLET_B, config, fakeWorld, payload } from './fixtures.ts';

const ENV = {
  NEXT_PUBLIC_WORLD_APP_ID: config.appId,
  NEXT_PUBLIC_WORLD_RP_ID: config.rpId,
  RP_SIGNING_KEY: SIGNING_KEY,
  WORLD_ID_ENVIRONMENT: 'staging',
  WORLD_ID_VERIFY_BASE_URL: config.verifyBaseUrl,
};

function deps(over: Partial<HandlerDeps> = {}, env: Record<string, string | undefined> = ENV): HandlerDeps & { store: () => SqliteSeatStore } {
  const store = new SqliteSeatStore();
  return { config: () => loadConfig(env), store: () => store, fetchImpl: fakeWorld().fetchImpl, ownsWallet: () => true, ...over } as HandlerDeps & { store: () => SqliteSeatStore };
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (path: string) => new Request(`http://localhost${path}`);

const verifyBody = (wallet: string, nullifier = HUMAN_1) => ({ wallet, idkitResponse: payload({ wallet, nullifier }) });

/* ---------- status and signing ---------- */

test('status: unconfigured names the missing variables and never echoes a value', async () => {
  const secretish = 'ab'.repeat(32);
  const d = deps({}, { RP_SIGNING_KEY: secretish });
  const res = await handleStatus(get('/api/worldid/status'), d);
  const body = await res.json() as { configured: boolean; missing: string[] };
  assert.equal(body.configured, false);
  assert.deepEqual(body.missing.sort(), ['NEXT_PUBLIC_WORLD_APP_ID', 'NEXT_PUBLIC_WORLD_RP_ID']);
  assert.equal(JSON.stringify(body).includes(secretish), false);
});

test('status: configured reports the environment, the fixed action and the seat count', async () => {
  const d = deps();
  const body = await (await handleStatus(get('/'), d)).json() as Record<string, unknown>;
  assert.deepEqual(body, { configured: true, environment: 'staging', action: 'lookout-verified-human-v1', seats: 0 });
});

test('rp-signature: returns a signed RP context, and the action is fixed on the server (a client-supplied one is ignored)', async () => {
  const res = await handleRpSignature(post('/api/worldid/rp-signature', { action: 'steal-the-airdrop' }), deps());
  assert.equal(res.status, 200);
  const body = await res.json() as { rp_context: Record<string, unknown>; app_id: string; action: string; environment: string };
  assert.equal(body.action, 'lookout-verified-human-v1', 'the client cannot choose what the server signs');
  assert.equal(body.app_id, config.appId);
  assert.equal(body.environment, 'staging');
  assert.equal(body.rp_context.rp_id, config.rpId);
  assert.match(String(body.rp_context.signature), /^0x[0-9a-f]{130}$/);
  assert.equal(typeof body.rp_context.nonce, 'string');
  assert.equal(Number(body.rp_context.expires_at) - Number(body.rp_context.created_at), 300);
});

test('rp-signature: the secret signing key never appears in a response', async () => {
  const d = deps();
  for (const res of [await handleRpSignature(post('/', {}), d), await handleStatus(get('/'), d), await handleSeat(get(`/?wallet=${WALLET_A}`), d)]) {
    assert.equal((await res.text()).includes(SIGNING_KEY), false);
  }
});

test('rp-signature: every signature is fresh (a new nonce each time)', async () => {
  const d = deps();
  const a = await (await handleRpSignature(post('/', {}), d)).json() as { rp_context: { nonce: string; signature: string } };
  const b = await (await handleRpSignature(post('/', {}), d)).json() as { rp_context: { nonce: string; signature: string } };
  assert.notEqual(a.rp_context.nonce, b.rp_context.nonce);
  assert.notEqual(a.rp_context.signature, b.rp_context.signature);
});

test('every handler says 503 not_configured, with the missing names, when World ID is not set up', async () => {
  const d = deps({}, {});
  for (const res of [await handleRpSignature(post('/', {}), d), await handleVerify(post('/', verifyBody(WALLET_A)), d), await handleSeat(get(`/?wallet=${WALLET_A}`), d)]) {
    assert.equal(res.status, 503);
    const body = await res.json() as { error: string; missing: string[] };
    assert.equal(body.error, 'not_configured');
    assert.ok(body.missing.includes('RP_SIGNING_KEY'));
  }
});

/* ---------- the three outcomes of the pitch, through HTTP ---------- */

test('SUCCESS over HTTP: a verified human is seated and /seat shows it', async () => {
  const d = deps();
  const res = await handleVerify(post('/api/worldid/verify', verifyBody(WALLET_A)), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: 'enrolled', wallet: WALLET_A, seats: 1 });
  const seat = await (await handleSeat(get(`/api/worldid/seat?wallet=${WALLET_A}`), d)).json();
  assert.deepEqual(seat, { wallet: WALLET_A, seated: true, seats: 1 });
  const other = await (await handleSeat(get(`/api/worldid/seat?wallet=${WALLET_B}`), d)).json();
  assert.deepEqual(other, { wallet: WALLET_B, seated: false, seats: 1 });
});

test('ALREADY ENROLLED over HTTP: the same human with a second wallet gets a 409 and a clear message', async () => {
  const d = deps();
  await handleVerify(post('/v', verifyBody(WALLET_A, HUMAN_1)), d);
  const res = await handleVerify(post('/v', verifyBody(WALLET_B, HUMAN_1)), d);
  assert.equal(res.status, 409);
  const body = await res.json() as { error: string; message: string; seats: number };
  assert.equal(body.error, 'human_already_enrolled');
  assert.match(body.message, /One human, one wallet/);
  assert.equal(body.seats, 1);
});

test('a wallet that belongs to someone else is a 409 wallet_taken', async () => {
  const d = deps();
  await handleVerify(post('/v', verifyBody(WALLET_A, HUMAN_1)), d);
  const res = await handleVerify(post('/v', verifyBody(WALLET_A, HUMAN_2)), d);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'wallet_taken');
});

test('NO CREDENTIAL / REJECTED PROOF over HTTP: a 400 with a code, and no seat is created', async () => {
  const world = fakeWorld({ status: 400, body: { code: 'invalid_proof' } });
  const d = deps({ fetchImpl: world.fetchImpl });
  const res = await handleVerify(post('/v', verifyBody(WALLET_A)), d);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'verification_failed');
  assert.equal(d.store().count(config.action), 0);

  const wrongCredential = await handleVerify(post('/v', { wallet: WALLET_A, idkitResponse: payload({ identifier: 'selfie' }) }), d);
  assert.equal(((await wrongCredential.json()) as { error: string }).error, 'wrong_credential');
});

test('an unreachable verifier is a 502, so the client knows to retry', async () => {
  const d = deps({ fetchImpl: fakeWorld({ throws: true }).fetchImpl });
  const res = await handleVerify(post('/v', verifyBody(WALLET_A)), d);
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { error: string }).error, 'verifier_unreachable');
});

test('no response ever contains a nullifier', async () => {
  const d = deps();
  const texts: string[] = [];
  texts.push(await (await handleVerify(post('/v', verifyBody(WALLET_A, HUMAN_1)), d)).text());
  texts.push(await (await handleVerify(post('/v', verifyBody(WALLET_B, HUMAN_1)), d)).text());
  texts.push(await (await handleSeat(get(`/?wallet=${WALLET_A}`), d)).text());
  texts.push(await (await handleStatus(get('/'), d)).text());
  const secrets = [HUMAN_1, HUMAN_1.slice(2), BigInt(HUMAN_1).toString(10), 'nil_'];
  for (const t of texts) for (const s of secrets) assert.equal(t.includes(s), false, `leaked ${s.slice(0, 12)}`);
});

/* ---------- bad requests ---------- */

test('bad JSON, a non-object body, a missing proof and an oversized body are 400s that change nothing', async () => {
  const d = deps();
  for (const body of ['{not json', '"just a string"', 'null', JSON.stringify({ wallet: WALLET_A }), JSON.stringify({ wallet: WALLET_A, idkitResponse: 'x'.repeat(70_000) })]) {
    const res = await handleVerify(post('/v', body), d);
    assert.equal(res.status, 400, body.slice(0, 30));
  }
  assert.equal(d.store().count(config.action), 0);
});

test('seat lookup refuses a missing or malformed wallet', async () => {
  const d = deps();
  for (const q of ['', '?wallet=', '?wallet=0x123', '?wallet=nope']) assert.equal((await handleSeat(get(`/api/worldid/seat${q}`), d)).status, 400, q);
});

test('responses are never cached', async () => {
  const res = await handleStatus(get('/'), deps());
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

/* ---------- rate limiting ---------- */

test('the limiter allows a burst up to the limit, then refuses, then recovers after the window', () => {
  let t = 0;
  const allow = createLimiter(3, 1000, () => t);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => allow('1.2.3.4')), [true, true, true, false, false]);
  assert.equal(allow('9.9.9.9'), true, 'other clients are unaffected');
  t = 1001;
  assert.equal(allow('1.2.3.4'), true, 'a new window starts');
});

test('verify and rp-signature are rate limited per client and answer 429', async () => {
  const d = deps({ limiter: { rpSignature: createLimiter(2, 60_000), verify: createLimiter(1, 60_000) } });
  const withIp = (path: string, body: unknown, ip: string) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) });
  assert.equal((await handleRpSignature(withIp('/', {}, '5.5.5.5'), d)).status, 200);
  assert.equal((await handleRpSignature(withIp('/', {}, '5.5.5.5'), d)).status, 200);
  assert.equal((await handleRpSignature(withIp('/', {}, '5.5.5.5'), d)).status, 429);
  assert.equal((await handleRpSignature(withIp('/', {}, '6.6.6.6'), d)).status, 200, 'another client is fine');
  assert.equal((await handleVerify(withIp('/', verifyBody(WALLET_A), '5.5.5.5'), d)).status, 200);
  assert.equal((await handleVerify(withIp('/', verifyBody(WALLET_B, HUMAN_2), '5.5.5.5'), d)).status, 429);
});

/* ---------- wallet ownership: the person must hold the key ---------- */

import { privateKeyToAccount } from 'viem/accounts';
import { humanMessage } from '@lookout/core';

const keyed = privateKeyToAccount(('0x' + '88'.repeat(32)) as `0x${string}`);
const keyedWallet = keyed.address.toLowerCase();

test('WALLET OWNERSHIP over HTTP: with the real check, a missing or wrong signature is refused and the human is NOT recorded', async () => {
  const d = deps({ ownsWallet: undefined });
  const body = { wallet: keyedWallet, idkitResponse: payload({ wallet: keyedWallet }) };
  const none = await handleVerify(post('/api/worldid/verify', body), d);
  assert.equal(none.status, 400);
  assert.equal(((await none.json()) as { error: string }).error, 'wallet_not_proven');

  const stranger = privateKeyToAccount(('0x' + '99'.repeat(32)) as `0x${string}`);
  const wrongSig = await stranger.signMessage({ message: humanMessage(keyedWallet, config.action) });
  assert.equal((await handleVerify(post('/api/worldid/verify', { ...body, signature: wrongSig }), d)).status, 400);
  assert.equal(d.store().count(config.action), 0, 'nothing was recorded');
});

test('WALLET OWNERSHIP over HTTP: the wallet signing its own message is accepted, and a signature for another action is not', async () => {
  const d = deps({ ownsWallet: undefined });
  const body = { wallet: keyedWallet, idkitResponse: payload({ wallet: keyedWallet }) };
  const forOtherAction = await keyed.signMessage({ message: humanMessage(keyedWallet, 'some-other-action') });
  assert.equal((await handleVerify(post('/api/worldid/verify', { ...body, signature: forOtherAction }), d)).status, 400);
  const good = await keyed.signMessage({ message: humanMessage(keyedWallet, config.action) });
  const res = await handleVerify(post('/api/worldid/verify', { ...body, signature: good }), d);
  assert.equal(res.status, 200);
  assert.equal(d.store().count(config.action), 1);
});
