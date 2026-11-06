import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult } from '@lookout/core';
import { createClient, inferKind, LookupError } from './client.ts';

// What Dev A's indexer returns from GET /lookup: a CheckResult plus `private: false` and the hash.
const result = (over: Partial<CheckResult> = {}): CheckResult & { private: false; targetHash: string } => ({
  verdict: 'unknown', disputed: false, reasons: [], snapshotId: 'plain-123', verified: false,
  headline: 'No signal found.', typeScores: {}, strongTypes: 0, private: false, targetHash: '0xabc', ...over,
});
const fakeFetch = (body: unknown, seen: string[] = [], status = 200) =>
  (async (url: string) => {
    seen.push(url);
    return { ok: status === 200, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;

test('asks the indexer by kind and value (this path is NOT private)', async () => {
  const seen: string[] = [];
  const c = createClient({ indexerUrl: 'http://idx/', fetch: fakeFetch(result(), seen) });
  await c.checkTarget('Evil.Example.com');
  assert.equal(seen[0], 'http://idx/lookup?kind=domain&value=Evil.Example.com');
});

test('the indexer-side fields are stripped, the result is a plain CheckResult', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(result({ verdict: 'block' })) });
  const r = await c.checkTarget('scam.xyz');
  assert.equal(r.verdict, 'block');
  assert.ok(!('private' in r) && !('targetHash' in r));
});

test('a plain lookup is never reported as verified, whatever the server says', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(result({ verified: true })) });
  assert.equal((await c.checkTarget('nothing.example')).verified, false);
});

test('values are URL-encoded', async () => {
  const seen: string[] = [];
  await createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(result(), seen) }).checkTarget('https://a.example/x?y=1&z=2');
  assert.ok(seen[0].endsWith('value=https%3A%2F%2Fa.example%2Fx%3Fy%3D1%26z%3D2'));
});

test('indexer failures surface as LookupError', async () => {
  const down = createClient({ indexerUrl: 'http://idx', fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  await assert.rejects(down.checkTarget('a.example'), LookupError);
  const bad = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(result(), [], 500) });
  await assert.rejects(bad.checkTarget('a.example'), LookupError);
});

test('malformed targets are rejected before any request', async () => {
  const seen: string[] = [];
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(result(), seen) });
  await assert.rejects(c.checkTarget('not a target'));
  await assert.rejects(c.checkTarget('0x123'));
  assert.equal(seen.length, 0);
});

test('inferKind', () => {
  assert.equal(inferKind('0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08'), 'address');
  assert.equal(inferKind('foo.xyz'), 'domain');
});
