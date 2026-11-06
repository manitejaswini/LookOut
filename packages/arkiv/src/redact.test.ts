import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, safeMessage } from './redact.ts';

test('an Arkiv access key in a URL or message is removed', () => {
  const key = 'ark_live_' + 'A1b2C3d4E5'.repeat(4);
  const msg = `The request took too long to respond.\n URL: https://rpc.rabdi.db-chain.testnet.arkiv.network/${key}\n key=${key}`;
  const out = redactSecrets(msg);
  assert.ok(!out.includes(key));
  assert.ok(!out.includes('A1b2C3d4E5'));
  assert.match(out, /ark_\*\*\*/);
});

test('a long token in a URL path is removed even without the ark_ prefix', () => {
  const out = redactSecrets('GET https://rpc.example.com/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg failed');
  assert.ok(!out.includes('Zm9vYmFy'));
});

test('ordinary text, transaction hashes and addresses are left alone', () => {
  const text = `tx 0x${'ab'.repeat(32)} to 0x${'cd'.repeat(20)} failed: execution reverted`;
  assert.equal(redactSecrets(text), text);
});

test('safeMessage works on errors and plain values', () => {
  const key = 'ark_test_' + 'Z9y8X7w6V5'.repeat(4);
  assert.ok(!safeMessage(new Error(`boom ${key}`)).includes(key));
  assert.ok(!safeMessage(`boom ${key}`).includes(key));
});
