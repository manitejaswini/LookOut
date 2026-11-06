import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetHash } from '@lookout/core';
import type { Signal } from '@lookout/core';
import { createClient, inferKind, LookupError, type LookupResponse } from './client.ts';

const sig = (sourceType: Signal['sourceType'], weight: number): Signal => ({
  entityId: `e-${sourceType}`, sourceType, sourceId: 's', level: 'block', weight, ageSeconds: 10, note: '',
});

const fakeFetch = (body: LookupResponse, seen: string[] = [], status = 200) =>
  (async (url: string) => {
    seen.push(url);
    return { ok: status === 200, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;

const body = (over: Partial<LookupResponse> = {}): LookupResponse =>
  ({ snapshotId: 'snap-9', disputed: false, signals: [], ...over });

test('queries by the target hash, never the raw target', async () => {
  const seen: string[] = [];
  const c = createClient({ indexerUrl: 'http://idx/', fetch: fakeFetch(body(), seen) });
  await c.checkTarget('Evil.Example.com');
  assert.equal(seen[0], `http://idx/lookup?targetHash=${targetHash('domain', 'evil.example.com')}`);
  assert.ok(!seen[0].includes('evil'));
});

test('two strong source types block, and the snapshot id comes from the indexer', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body({ signals: [sig('feed', 1), sig('checker', 1)] })) });
  const r = await c.checkTarget('scam.xyz');
  assert.equal(r.verdict, 'block');
  assert.equal(r.snapshotId, 'snap-9');
});

test('a plain lookup is never reported as verified', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body()) });
  assert.equal((await c.checkTarget('nothing.example')).verified, false);
});

test('no signals is unknown, not safe', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body()) });
  assert.equal((await c.checkTarget('nothing.example')).verdict, 'unknown');
});

test('disputed flag and ruling pass through to scoring', async () => {
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body({ disputed: true, signals: [sig('community', 0)] })) });
  const r = await c.checkTarget('orbit.app');
  assert.equal(r.disputed, true);
  assert.equal(r.verdict, 'warn');
  const c2 = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body({ ruling: 'block' })) });
  assert.equal((await c2.checkTarget('0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08')).verdict, 'block');
});

test('indexer failures surface as LookupError', async () => {
  const down = createClient({ indexerUrl: 'http://idx', fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  await assert.rejects(down.checkTarget('a.example'), LookupError);
  const bad = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body(), [], 500) });
  await assert.rejects(bad.checkTarget('a.example'), LookupError);
});

test('malformed targets are rejected before any request', async () => {
  const seen: string[] = [];
  const c = createClient({ indexerUrl: 'http://idx', fetch: fakeFetch(body(), seen) });
  await assert.rejects(c.checkTarget('not a target'));
  assert.equal(seen.length, 0);
});

test('inferKind', () => {
  assert.equal(inferKind('0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08'), 'address');
  assert.equal(inferKind('foo.xyz'), 'domain');
});
