import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMAS, type EntityWriter } from '@lookout/arkiv';
import { scoreTarget, targetHash } from '@lookout/core';
import { buildTargets, parseRegistry, toScoringInput, type StoredEntity } from '@lookout/indexer';
import type { Finding } from './domain.ts';
import { canonicalJson, evidenceBytes, evidenceHash, fit, verifyProof } from './evidence.ts';
import { BlockedUrlError } from './ssrf.ts';
import { fetchHop, parseMetaRefresh } from './http.ts';
import { CHECKER_SOURCE_ID, findingToVerdict, publishFinding } from './publish.ts';

const finding = (): Finding => ({
  kind: 'redirect-to-flagged',
  targetKind: 'domain',
  value: 'claim-airdrop.example',
  reason: 'redirects to flagged domain drainer-landing.example (demo list entry)',
  evidence: { version: 0, type: 'redirect-to-flagged', target: 'claim-airdrop.example', chain: [{ url: 'https://claim-airdrop.example/', status: 302 }] },
});

type Call = { method: string; args: unknown[] };
function fakeWriter() {
  const calls: Call[] = [];
  const writer: EntityWriter = {
    async createEntity(schema, values, options) {
      calls.push({ method: 'createEntity', args: [schema, values, options] });
      return { entityKey: `0x${'ab'.repeat(32)}`, txHash: `0x${'cd'.repeat(32)}`, expiresAt: 1234n };
    },
    async extendEntity(args) {
      calls.push({ method: 'extendEntity', args: [args] });
      return { expiresAt: 5678n };
    },
  };
  return { writer, calls };
}

/* ---------- evidence ---------- */

test('canonicalJson is order-independent, so the same evidence always hashes the same', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}', 'undefined fields are omitted');
  assert.equal(evidenceHash({ x: 1, y: 2 }), evidenceHash({ y: 2, x: 1 }));
  assert.match(evidenceHash({ x: 1 }), /^0x[0-9a-f]{64}$/);
});

test('verifyProof confirms the payload matches the proofHash and catches any alteration', () => {
  const ev = finding().evidence;
  const hash = evidenceHash(ev);
  assert.equal(verifyProof(evidenceBytes(ev), hash), true);
  assert.equal(verifyProof(evidenceBytes(ev), hash.toUpperCase().replace('0X', '0x')), true, 'hex case does not matter');
  assert.equal(verifyProof(evidenceBytes({ ...ev, target: 'someone-else.example' }), hash), false);
});

test('fit shortens text to 128 UTF-8 bytes without cutting a character in half', () => {
  assert.equal(fit('short'), 'short');
  const long = fit('é'.repeat(100));
  assert.ok(new TextEncoder().encode(long).length <= 128);
  assert.ok(long.endsWith('…'));
  assert.doesNotMatch(long, /�/);
  assert.ok(new TextEncoder().encode(fit('x'.repeat(500))).length <= 128);
});

/* ---------- finding -> verdict ---------- */

test('a finding becomes a block verdict from the registered checker, carrying its evidence as proof', () => {
  const f = finding();
  const v = findingToVerdict(f);
  assert.equal(v.sourceType, 'checker');
  assert.equal(v.sourceId, CHECKER_SOURCE_ID);
  assert.equal(v.level, 'block');
  assert.equal(v.kind, 'domain');
  assert.equal(v.proofHash, evidenceHash(f.evidence));
  assert.equal(verifyProof(v.payload!, v.proofHash!), true, 'anyone can verify the published payload against the published proofHash');
});

test('publishFinding creates one verdict through the real writer, readonly with a 6 hour lifetime', async () => {
  const { writer, calls } = fakeWriter();
  const out = await publishFinding(writer, finding());
  assert.equal(out.action, 'created');
  assert.equal(out.entityKey, `0x${'ab'.repeat(32)}`);
  assert.equal(calls.length, 1);
  const [schema, values, options] = calls[0].args as [unknown, Record<string, unknown>, { expiration: { minLifetime: bigint }; flags: { readonly: boolean } }];
  assert.equal(schema, SCHEMAS.verdict);
  assert.equal(values.targetHash, targetHash('domain', 'claim-airdrop.example'));
  assert.equal(values.sourceId, 'lookout-checker');
  assert.equal(BigInt(options.expiration.minLifetime), 10_800n);
  assert.equal(options.flags.readonly, true);
});

test('if the checker already has a verdict for the target, it REFRESHES it instead of writing a duplicate', async () => {
  const { writer, calls } = fakeWriter();
  const existing = `0x${'ef'.repeat(32)}`;
  const out = await publishFinding(writer, finding(), existing);
  assert.equal(out.action, 'refreshed');
  assert.equal(out.entityKey, existing);
  assert.deepEqual(calls.map((c) => c.method), ['extendEntity'], 'no new entity is created');
});

test('END TO END (offline): a verdict the checker writes is accepted by the indexer and BLOCKS the target', async () => {
  const checkerWallet = `0x${'1'.repeat(40)}`;
  const registry = parseRegistry({ sources: [{ sourceId: 'lookout-checker', sourceType: 'checker', address: checkerWallet }], attesters: [], panel: null, reputation: {} });

  // capture exactly what the checker would write to Arkiv
  const { writer, calls } = fakeWriter();
  await publishFinding(writer, finding());
  const values = calls[0].args[1] as Record<string, string>;

  // present it to the indexer the way the reader would, as an entity created by the registered checker wallet
  const entity: StoredEntity = {
    key: `0x${'ab'.repeat(32)}`, kind: 'verdict', creator: checkerWallet, owner: checkerWallet, createdBlock: 900, expiresBlock: 5000,
    attrs: { targetHash: values.targetHash, sourceType: values.sourceType, sourceId: values.sourceId, level: values.level, proofHash: values.proofHash, reason: values.reason },
  };
  const timing = { currentBlock: 1000, currentBlockTime: 1_800_000_000, blockDuration: 2 };
  const { targets, dropped } = buildTargets([entity], timing, registry);
  assert.deepEqual(dropped, []);
  const result = scoreTarget(toScoringInput(targets.get(targetHash('domain', 'claim-airdrop.example')), timing));
  assert.equal(result.verdict, 'block');
  assert.match(result.headline, /Re-checkable proof: redirects to flagged domain drainer-landing\.example/);

  // and a wallet that is NOT the registered checker cannot fake the same verdict
  const forged = buildTargets([{ ...entity, creator: `0x${'9'.repeat(40)}`, owner: `0x${'9'.repeat(40)}` }], timing, registry);
  assert.equal(forged.targets.size, 0);
  assert.deepEqual(forged.dropped.map((d) => d.reason), ['untrusted verdict writer']);
});

/* ---------- the real fetcher's guard (no network is touched: every case is refused first) ---------- */

test('parseMetaRefresh reads the common spellings', () => {
  assert.equal(parseMetaRefresh('<meta http-equiv="refresh" content="0; url=https://b.example/x">'), 'https://b.example/x');
  assert.equal(parseMetaRefresh("<META HTTP-EQUIV='Refresh' CONTENT='3;URL=\"https://b.example/y\"'>"), 'https://b.example/y');
  assert.equal(parseMetaRefresh('<meta http-equiv="refresh" content="5">'), undefined, 'a plain reload has no target');
  assert.equal(parseMetaRefresh('<meta charset="utf-8"><title>hi</title>'), undefined);
});

test('the real fetchHop refuses loopback, private, metadata, odd ports and non-http schemes', async () => {
  for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://example.com:8080/', 'ftp://example.com/', 'file:///etc/passwd', 'https://user:pw@example.com/', 'http://2130706433/']) {
    await assert.rejects(fetchHop(url), BlockedUrlError, url);
  }
});
