import test from 'node:test';
import assert from 'node:assert/strict';
import { targetHash } from '@lookout/core';
import { buildTargets, parseRegistry, type IndexState, type StoredEntity } from '@lookout/indexer';
import { checkDomain } from './domain.ts';
import { verifyProof, evidenceBytes, evidenceHash } from './evidence.ts';
import { anyOf, indexFlagSource, StaticFlagSource } from './flags.ts';
import type { HopFetcher, HopResult } from './http.ts';
import { followRedirects } from './redirects.ts';

/** A fake web: url -> response, and a log of every URL actually requested. */
function fakeWeb(pages: Record<string, HopResult | Error>) {
  const requested: string[] = [];
  const fetchHop: HopFetcher = async (url) => {
    requested.push(url);
    const r = pages[url];
    if (r === undefined) throw new Error(`ENOTFOUND ${url}`);
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchHop, requested };
}

const flags = new StaticFlagSource({
  domains: [{ value: 'drainer-landing.example', source: 'demo list entry' }],
  addresses: [{ value: '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08', source: 'demo list entry' }],
});
const now = () => new Date('2026-11-06T12:00:00.000Z');

/* ---------- redirect following ---------- */

test('followRedirects walks relative redirects and stops at a page that does not redirect', async () => {
  const { fetchHop } = fakeWeb({
    'https://a.example/': { status: 301, location: '/step2' },
    'https://a.example/step2': { status: 302, location: 'https://b.example/landing' },
    'https://b.example/landing': { status: 200 },
  });
  const r = await followRedirects('https://a.example/', fetchHop);
  assert.deepEqual(r.chain.map((h) => [h.url, h.status]), [['https://a.example/', 301], ['https://a.example/step2', 302], ['https://b.example/landing', 200]]);
  assert.equal(r.finalUrl, 'https://b.example/landing');
  assert.equal(r.loop, false);
});

test('followRedirects detects a loop instead of spinning', async () => {
  const { fetchHop } = fakeWeb({
    'https://a.example/': { status: 302, location: 'https://b.example/' },
    'https://b.example/': { status: 302, location: 'https://a.example/' },
  });
  const r = await followRedirects('https://a.example/', fetchHop);
  assert.equal(r.loop, true);
  assert.equal(r.chain.length, 2);
});

test('followRedirects stops at the hop limit and says so', async () => {
  const pages: Record<string, HopResult> = {};
  for (let i = 0; i < 20; i++) pages[`https://h${i}.example/`] = { status: 302, location: `https://h${i + 1}.example/` };
  const r = await followRedirects('https://h0.example/', fakeWeb(pages).fetchHop, 5);
  assert.equal(r.truncated, true);
  assert.equal(r.chain.length, 6, 'the start plus 5 hops');
});

test('followRedirects refuses a redirect to a private address or a bad scheme, and never requests it', async () => {
  for (const evil of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/admin', 'http://[::1]/', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.example/']) {
    const { fetchHop, requested } = fakeWeb({ 'https://a.example/': { status: 302, location: evil } });
    const r = await followRedirects('https://a.example/', fetchHop);
    assert.match(r.stoppedBy ?? '', /redirect refused|bad redirect/, evil);
    assert.deepEqual(requested, ['https://a.example/'], `${evil} must not be requested`);
  }
});

test('followRedirects follows a meta refresh as well as an HTTP redirect', async () => {
  const { fetchHop } = fakeWeb({
    'https://a.example/': { status: 200, metaRefresh: 'https://b.example/x' },
    'https://b.example/x': { status: 200 },
  });
  assert.equal((await followRedirects('https://a.example/', fetchHop)).finalUrl, 'https://b.example/x');
});

/* ---------- the domain check ---------- */

test('a site that redirects to a flagged domain is a FINDING, with re-checkable evidence', async () => {
  const { fetchHop } = fakeWeb({
    'https://claim-airdrop.example/': { status: 302, location: 'https://drainer-landing.example/connect' },
    'https://drainer-landing.example/connect': { status: 200 },
  });
  const { finding, notes } = await checkDomain('https://CLAIM-airdrop.example/promo', { fetchHop, flags, now });
  assert.ok(finding);
  assert.equal(finding.kind, 'redirect-to-flagged');
  assert.equal(finding.targetKind, 'domain');
  assert.equal(finding.value, 'claim-airdrop.example');
  assert.match(finding.reason, /redirects to flagged domain drainer-landing\.example/);
  assert.ok(new TextEncoder().encode(finding.reason).length <= 128);
  assert.equal(finding.evidence.matchedHop, 'https://drainer-landing.example/connect');
  assert.equal(finding.evidence.checkedAt, '2026-11-06T12:00:00.000Z');
  assert.deepEqual((finding.evidence.chain as { status: number }[]).map((h) => h.status), [302, 200]);
  assert.ok((finding.evidence.limits as string[]).some((l) => /JavaScript/.test(l)), 'the evidence states what it cannot see');
  assert.ok(notes.some((n) => n.startsWith('FOUND')));
  // anyone can recompute the hash from the evidence and confirm it was not altered
  assert.equal(verifyProof(evidenceBytes(finding.evidence), evidenceHash(finding.evidence)), true);
});

test('a redirect whose URL carries a flagged address is also a finding', async () => {
  const addr = '0x5FD9A1E4B7C3920B6A8E1D04C7F23B9A6E5D1C08';
  const { fetchHop } = fakeWeb({
    'https://mint-now.example/': { status: 302, location: `https://wallet-connect.example/approve?spender=${addr}` },
    [`https://wallet-connect.example/approve?spender=${addr}`]: { status: 200 },
  });
  const { finding } = await checkDomain('mint-now.example', { fetchHop, flags, now });
  assert.equal(finding?.evidence.matchedAs, 'address');
  assert.equal(finding?.evidence.matchedValue, addr.toLowerCase());
});

test('no redirect, or a redirect to an unflagged site, is NOT a finding (and is not a clearance)', async () => {
  const plain = await checkDomain('quiet.example', { fetchHop: fakeWeb({ 'https://quiet.example/': { status: 200 } }).fetchHop, flags, now });
  assert.equal(plain.finding, null);
  const elsewhere = await checkDomain('shop.example', {
    fetchHop: fakeWeb({ 'https://shop.example/': { status: 301, location: 'https://www.shop.example/' }, 'https://www.shop.example/': { status: 200 } }).fetchHop,
    flags, now,
  });
  assert.equal(elsewhere.finding, null);
  assert.ok(elsewhere.notes.some((n) => /no hop led to a flagged destination/.test(n)));
});

test('a site that merely redirects to itself over https is not flagged even if it is on the list', async () => {
  const selfFlags = new StaticFlagSource({ domains: [{ value: 'listed.example', source: 'demo list entry' }] });
  const { fetchHop } = fakeWeb({
    'https://listed.example/': { status: 302, location: 'https://listed.example/home' },
    'https://listed.example/home': { status: 200 },
  });
  assert.equal((await checkDomain('listed.example', { fetchHop, flags: selfFlags, now })).finding, null);
});

test('if https fails it falls back to http and notes it', async () => {
  const { fetchHop } = fakeWeb({
    'http://old.example/': { status: 302, location: 'http://drainer-landing.example/' },
    'http://drainer-landing.example/': { status: 200 },
  });
  const { finding, notes } = await checkDomain('old.example', { fetchHop, flags, now });
  assert.ok(finding);
  assert.ok(notes.some((n) => /https failed/.test(n)));
});

test('a redirect into a private address is refused, never requested, and is not a finding', async () => {
  const { fetchHop, requested } = fakeWeb({ 'https://sneaky.example/': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } });
  const { finding, notes } = await checkDomain('sneaky.example', { fetchHop, flags, now });
  assert.equal(finding, null);
  assert.ok(notes.some((n) => /redirect refused/.test(n)));
  assert.deepEqual(requested, ['https://sneaky.example/']);
});

test('a domain that does not resolve at all is no finding and does not throw', async () => {
  const { finding, notes } = await checkDomain('gone.example', { fetchHop: fakeWeb({}).fetchHop, flags, now });
  assert.equal(finding, null);
  assert.ok(notes.some((n) => /stopped/.test(n)));
});

test('junk input is rejected before any request', async () => {
  const web = fakeWeb({});
  await assert.rejects(checkDomain('localhost', { fetchHop: web.fetchHop, flags, now }), /invalid domain/);
  assert.deepEqual(web.requested, []);
});

/* ---------- flag sources ---------- */

test('a flag list entry without a source is refused, so nothing unsourced can cause a block', () => {
  assert.throws(() => new StaticFlagSource({ domains: [{ value: 'x.example', source: '' }] }), /no source/);
  assert.throws(() => new StaticFlagSource({ addresses: [{ value: 'nope', source: 'a source' }] }));
});

test('the static list normalises what it is asked about', () => {
  assert.ok(flags.isFlagged('domain', 'HTTPS://Drainer-Landing.example/path'));
  assert.ok(flags.isFlagged('address', '0x5FD9A1E4B7C3920B6A8E1D04C7F23B9A6E5D1C08'));
  assert.equal(flags.isFlagged('domain', 'fine.example'), undefined);
  assert.equal(flags.isFlagged('domain', 'not a domain'), undefined, 'junk is simply not flagged');
});

test('Lookout can flag a destination it already blocks, via the indexer state', () => {
  const registry = parseRegistry({ sources: [{ sourceId: 'lookout-checker', sourceType: 'checker', address: `0x${'1'.repeat(40)}` }], attesters: [], panel: null, reputation: {} });
  const timing = { currentBlock: 1000, currentBlockTime: 1_800_000_000, blockDuration: 2 };
  const hash = targetHash('domain', 'blocked-by-lookout.example');
  const entities: StoredEntity[] = [{
    key: `0x${'a'.repeat(64)}`, kind: 'verdict', creator: `0x${'1'.repeat(40)}`, owner: `0x${'1'.repeat(40)}`, createdBlock: 900, expiresBlock: 5000,
    attrs: { targetHash: hash, sourceType: 'checker', sourceId: 'lookout-checker', level: 'block', proofHash: `0x${'11'.repeat(32)}` },
  }];
  const { targets, dropped } = buildTargets(entities, timing, registry);
  const state: IndexState = { targets, dropped, entities, timing, epoch: timing, epochTargets: targets, entityCount: 1, syncedAt: 1 };
  const src = indexFlagSource(state);
  assert.match(src.isFlagged('domain', 'blocked-by-lookout.example') ?? '', /blocked by Lookout/);
  assert.equal(src.isFlagged('domain', 'something-else.example'), undefined);
  assert.ok(anyOf(flags, src).isFlagged('domain', 'blocked-by-lookout.example'), 'combined sources');
  assert.ok(anyOf(flags, src).isFlagged('domain', 'drainer-landing.example'), 'combined sources, first list');
});
