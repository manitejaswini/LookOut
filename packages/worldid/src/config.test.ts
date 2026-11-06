import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VERIFY_BASE_URL, HUMAN_ACTION, loadConfig } from './config.ts';
import { SIGNING_KEY } from './fixtures.ts';

const good = { NEXT_PUBLIC_WORLD_APP_ID: 'app_abc123', NEXT_PUBLIC_WORLD_RP_ID: 'rp_abc123', RP_SIGNING_KEY: SIGNING_KEY };

test('a complete environment loads, and the environment defaults to production (safe by default)', () => {
  const r = loadConfig(good);
  assert.ok(r.ok);
  assert.equal(r.config.environment, 'production');
  assert.equal(r.config.action, HUMAN_ACTION);
  assert.equal(r.config.verifyBaseUrl, DEFAULT_VERIFY_BASE_URL);
  assert.equal(r.config.signingKeyHex, SIGNING_KEY);
});

test('staging and sandbox must be asked for explicitly, in any letter case', () => {
  for (const e of ['staging', 'STAGING', 'sandbox']) {
    const r = loadConfig({ ...good, WORLD_ID_ENVIRONMENT: e });
    assert.ok(r.ok);
    assert.equal(r.config.environment, e.toLowerCase());
  }
});

test('a 0x prefix on the signing key is accepted and removed', () => {
  const r = loadConfig({ ...good, RP_SIGNING_KEY: `0x${SIGNING_KEY}` });
  assert.ok(r.ok);
  assert.equal(r.config.signingKeyHex, SIGNING_KEY);
});

test('missing variables are listed by NAME only', () => {
  const r = loadConfig({});
  assert.ok(!r.ok);
  assert.deepEqual(r.missing.sort(), ['NEXT_PUBLIC_WORLD_APP_ID', 'NEXT_PUBLIC_WORLD_RP_ID', 'RP_SIGNING_KEY']);
  assert.ok(!loadConfig({ ...good, NEXT_PUBLIC_WORLD_APP_ID: '   ' }).ok, 'blank counts as missing');
});

test('malformed values give plain problems that never repeat the value, especially the secret', () => {
  const badKey = 'not-a-real-key-but-secret-looking-zzzz';
  const r = loadConfig({ NEXT_PUBLIC_WORLD_APP_ID: 'banana', NEXT_PUBLIC_WORLD_RP_ID: 'rp-1', RP_SIGNING_KEY: badKey, WORLD_ID_ENVIRONMENT: 'prod' });
  assert.ok(!r.ok);
  assert.equal(r.problems.length, 4);
  const text = JSON.stringify(r);
  for (const leaked of ['banana', 'rp-1', badKey, 'prod"']) assert.equal(text.includes(leaked), false, leaked);
});

test('the verify endpoint can be overridden for tests, and the action is not configurable', () => {
  const r = loadConfig({ ...good, WORLD_ID_VERIFY_BASE_URL: 'https://stub.test/verify', WORLD_ID_ACTION: 'hijack' });
  assert.ok(r.ok);
  assert.equal(r.config.verifyBaseUrl, 'https://stub.test/verify');
  assert.equal(r.config.action, HUMAN_ACTION, 'only the code decides what the server signs and accepts');
});
