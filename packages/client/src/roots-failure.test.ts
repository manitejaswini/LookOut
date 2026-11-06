import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, targetHash, type TargetRecord } from '@lookout/core';
import { createPirClient, rootsFailureMessage, VerificationError } from './pir.ts';
import { fakePirWorld } from './testing.ts';

// What happens when Arkiv, the thing that vouches for the table, cannot be read. Found live: Arkiv's keyless endpoint answered
// ANON_COST_LIMITED once its small query budget was used up, and the wallet page froze instead of saying so.

const N = 256;
const NOW_MS = 1_700_001_000_000;
const rec: TargetRecord = {
  targetHash: targetHash('domain', 'scam.xyz'), flags: 0,
  signals: [{ sourceType: 'feed', level: 'block', weight: 1, sourceIdx: 1, createdAt: NOW_MS / 1000 - 60, entityKey: `0x${'1'.repeat(64)}` }],
};
const SNAP = buildSnapshot('snap-t', [rec], N);
const PAIR = { a: 'http://a1.test', b: 'http://b1.test' };

const make = (publishedRoots: (id: string) => Promise<string[]>, extra: { rootsTimeoutMs?: number } = {}) =>
  createPirClient({ pairs: [PAIR], fetch: fakePirWorld(SNAP).fetch, now: () => NOW_MS, publishedRoots, ...extra });

test('when Arkiv cannot be read, the answer is WITHHELD: no verdict, never "verified"', async () => {
  const c = make(async () => { throw new Error('HTTP request failed.'); });
  await assert.rejects(c.checkTarget('scam.xyz'), (e: unknown) => e instanceof VerificationError && /withheld/.test((e as Error).message));
});

test('an exhausted anonymous budget is named, with what to do about it', async () => {
  const c = make(async () => { throw Object.assign(new Error('HTTP request failed.'), { details: '{"error":"ANON_COST_LIMITED"}' }); });
  await assert.rejects(c.checkTarget('scam.xyz'), /anonymous query budget/);
  assert.match(rootsFailureMessage(new Error('Status: 429 Too Many Requests')), /anonymous query budget/);
});

test('an Arkiv read that never answers is cut off, instead of freezing the page', async () => {
  const c = make(() => new Promise<string[]>(() => {}), { rootsTimeoutMs: 40 });
  const t0 = Date.now();
  await assert.rejects(c.checkTarget('scam.xyz'), /did not answer in time/);
  assert.ok(Date.now() - t0 < 2000, 'it gave up quickly');
});

test('a successful read of the roots is remembered, so a page of lookups costs ONE Arkiv query', async () => {
  let calls = 0;
  const c = make(async () => { calls++; return [SNAP.root]; });
  for (let i = 0; i < 4; i++) assert.equal((await c.checkTarget('scam.xyz')).verified, true);
  assert.equal(calls, 1);
});

test('a FAILED read is not remembered: the next lookup tries again and can succeed', async () => {
  let calls = 0;
  const c = make(async () => { calls++; if (calls === 1) throw new Error('flaky'); return [SNAP.root]; });
  await assert.rejects(c.checkTarget('scam.xyz'), VerificationError);
  const ok = await c.checkTarget('scam.xyz');
  assert.equal(ok.verified, true);
  assert.equal(calls, 2);
});

test('a root Arkiv does not vouch for is still refused, and refusals are not cached as approvals', async () => {
  let calls = 0;
  const c = make(async () => { calls++; return [`0x${'ab'.repeat(32)}`]; });
  await assert.rejects(c.checkTarget('scam.xyz'), /does not match any root published on Arkiv/);
  await assert.rejects(c.checkTarget('scam.xyz'), /does not match any root published on Arkiv/);
  assert.equal(calls, 2, 'asked again each time, since a wrong answer could later be corrected by a new publication');
});

test('an EMPTY answer from Arkiv (nothing published yet) is not cached either', async () => {
  let calls = 0;
  const c = make(async () => { calls++; return calls === 1 ? [] : [SNAP.root]; });
  await assert.rejects(c.checkTarget('scam.xyz'), /does not match any root/);
  assert.equal((await c.checkTarget('scam.xyz')).verified, true);
});
