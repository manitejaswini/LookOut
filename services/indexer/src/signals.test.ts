import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTarget, targetHash } from '@lookout/core';
import { buildTargets, toScoringInput } from './signals.ts';
import {
  ADDR, H, PROOF, attestation, checkerVerdict, feedVerdict, freshWallet, registry, report, ruling, timing, verdict,
} from './fixtures.ts';
import type { StoredEntity } from './types.ts';

const run = (entities: StoredEntity[], hash = H) => {
  const { targets, dropped } = buildTargets(entities, timing, registry);
  return { result: scoreTarget(toScoringInput(targets.get(hash), timing)), targets, dropped };
};

/* ---------- the demo scenarios ---------- */

test('fake airdrop: a reputable report, an open feed and our checker with proof give BLOCK from three source types', () => {
  const { result } = run([report(ADDR.rep82), feedVerdict(), checkerVerdict(true)]);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.reasons.map((r) => r.sourceType).sort(), ['checker', 'community', 'feed']);
  assert.match(result.headline, /Re-checkable proof: matches a drainer bytecode pattern \(lookout-checker\)/);
});

test('two strong source types without proof are enough for BLOCK', () => {
  const { result } = run([report(ADDR.rep82), feedVerdict()]);
  assert.equal(result.verdict, 'block');
  assert.equal(result.strongTypes, 2);
});

test('the attack: 1,000 fresh wallets reporting a site can only WARN, never block', () => {
  const reports = Array.from({ length: 1000 }, (_, i) => report(freshWallet(i)));
  const { result } = run(reports);
  assert.equal(result.verdict, 'warn');
  assert.equal(result.strongTypes, 0);
  assert.equal(result.typeScores.community, 0);
});

test('even 1,000 maximum-reputation wallets in ONE source type cannot block', () => {
  const reports = Array.from({ length: 1000 }, (_, i) => report(i % 2 ? ADDR.rep100 : ADDR.rep82, H, { key: `0x${(i + 5000).toString(16).padStart(64, '0')}` }));
  const { result } = run(reports);
  assert.equal(result.verdict, 'warn');
  assert.equal(result.strongTypes, 1);
});

test('a target nobody has flagged is UNKNOWN, never safe', () => {
  const { result } = run([], targetHash('domain', 'my-local-bakery.in'));
  assert.equal(result.verdict, 'unknown');
  assert.match(result.headline, /not the same as safe/i);
});

/* ---------- trusted writers ---------- */

test('a verdict from a wallet that is not a registered source is ignored', () => {
  const stranger = verdict(ADDR.stranger, { sourceType: 'checker', sourceId: 'lookout-checker', proofHash: PROOF });
  const { result, dropped } = run([stranger]);
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(dropped.map((d) => d.reason), ['untrusted verdict writer']);
});

test('a registered wallet cannot pose as a different source or type', () => {
  const asOtherSource = verdict(ADDR.checker, { sourceType: 'checker', sourceId: 'openfeed-demo' });
  const asOtherType = verdict(ADDR.checker, { sourceType: 'feed', sourceId: 'lookout-checker' });
  const { result, dropped } = run([asOtherSource, asOtherType]);
  assert.equal(result.verdict, 'unknown');
  assert.equal(dropped.length, 2);
});

test('a verdict with a bad level is dropped, and a bad target hash is dropped', () => {
  const badLevel = verdict(ADDR.feed, { sourceType: 'feed', sourceId: 'openfeed-demo', level: 'maybe' });
  const badTarget = report(ADDR.rep82, 'not-a-hash');
  const { dropped } = run([badLevel, badTarget]);
  assert.deepEqual(dropped.map((d) => d.reason).sort(), ['bad target hash', 'bad verdict fields']);
});

test('expired entities are ignored', () => {
  const { result, dropped } = run([feedVerdict({ expires: timing.currentBlock }), checkerVerdict(true, { expires: timing.currentBlock - 5 })]);
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(dropped.map((d) => d.reason), ['expired', 'expired']);
});

/* ---------- attestations (placeholder allowlist) ---------- */

test('an attestation from a wallet that is not a recognised attester is ignored', () => {
  const { result, dropped } = run([report(ADDR.rep82), attestation(ADDR.stranger)]);
  assert.equal(result.disputed, false);
  assert.ok(dropped.some((d) => d.reason === 'attester not recognised'));
});

test('a recognised attester marks the target DISPUTED, which downgrades nothing by itself', () => {
  const warnOnly = run([report(freshWallet(1)), attestation(ADDR.attester)]);
  assert.equal(warnOnly.result.verdict, 'warn');
  assert.equal(warnOnly.result.disputed, true);

  // the owner cannot clear a flag that has re-checkable proof: it still blocks, and it is marked disputed
  const withProof = run([checkerVerdict(true), attestation(ADDR.attester)]);
  assert.equal(withProof.result.verdict, 'block');
  assert.equal(withProof.result.disputed, true);
});

test("an attester's `confirmed` claim does not dispute anything", () => {
  const { result } = run([report(ADDR.rep82), attestation(ADDR.attester, 'confirmed')]);
  assert.equal(result.disputed, false);
});

/* ---------- rulings ---------- */

test('a panel ruling of block blocks on its own', () => {
  const { result } = run([ruling(ADDR.panel, 'block')]);
  assert.equal(result.verdict, 'block');
});

test('a panel ruling of clear overrides block signals', () => {
  const { result } = run([feedVerdict(), checkerVerdict(true), ruling(ADDR.panel, 'clear')]);
  assert.equal(result.verdict, 'unknown');
  assert.match(result.headline, /cleared/i);
});

test('a ruling from anyone but the panel wallet is ignored', () => {
  const { result, dropped } = run([ruling(ADDR.stranger, 'block')]);
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(dropped.map((d) => d.reason), ['ruling not from the panel']);
});

test('the newest ruling wins, whatever order the entities come in', () => {
  const older = ruling(ADDR.panel, 'clear', H, { created: 90_000, key: `0x${'a'.repeat(64)}` });
  const newer = ruling(ADDR.panel, 'block', H, { created: 95_000, key: `0x${'b'.repeat(64)}` });
  assert.equal(run([older, newer]).result.verdict, 'block');
  assert.equal(run([newer, older]).result.verdict, 'block');
});

test('with no panel configured, no ruling counts', () => {
  const noPanel = { ...registry, panel: null };
  const { targets } = buildTargets([ruling(ADDR.panel, 'block')], timing, noPanel);
  assert.equal(targets.size, 0);
});

/* ---------- details the UI and the snapshot rely on ---------- */

test('age is worked out from blocks: 1,000 blocks at 2 s is 2,000 s', () => {
  const { result } = run([feedVerdict({ created: 99_000 })]);
  assert.equal(result.reasons[0].ageSeconds, 2000);
});

test('community reports get sourceIdx 0, registered sources get their 1-based position', () => {
  const { targets } = run([report(ADDR.rep82), feedVerdict(), checkerVerdict(true)]);
  const idx = Object.fromEntries(targets.get(H)!.signals.map((s) => [s.sourceId.startsWith('0x') ? 'community' : s.sourceId, s.sourceIdx]));
  assert.deepEqual(idx, { community: 0, 'openfeed-demo': 1, 'lookout-checker': 2 });
});

test('the entity key is carried through as the reason entityId, so a user can inspect it on Arkiv', () => {
  const e = checkerVerdict(true);
  const { result } = run([e]);
  assert.equal(result.reasons[0].entityId, e.key);
});
