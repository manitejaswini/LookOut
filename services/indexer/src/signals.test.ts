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

test('an operator ruling of block blocks on its own', () => {
  const { result } = run([ruling(ADDR.operator, 'block')]);
  assert.equal(result.verdict, 'block');
});

test('an operator ruling of clear overrides block signals', () => {
  const { result } = run([feedVerdict(), checkerVerdict(true), ruling(ADDR.operator, 'clear')]);
  assert.equal(result.verdict, 'unknown');
  assert.match(result.headline, /cleared/i);
});

test('a ruling from anyone but the operator wallet is ignored', () => {
  const { result, dropped } = run([ruling(ADDR.stranger, 'block')]);
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(dropped.map((d) => d.reason), ['ruling not from the operator']);
});

test('the newest ruling wins, whatever order the entities come in', () => {
  const older = ruling(ADDR.operator, 'clear', H, { created: 90_000, key: `0x${'a'.repeat(64)}` });
  const newer = ruling(ADDR.operator, 'block', H, { created: 95_000, key: `0x${'b'.repeat(64)}` });
  assert.equal(run([older, newer]).result.verdict, 'block');
  assert.equal(run([newer, older]).result.verdict, 'block');
});

test('with no operator configured, no ruling counts', () => {
  const noOperator = { ...registry, operator: null };
  const { targets } = buildTargets([ruling(ADDR.operator, 'block')], timing, noOperator);
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

/* ---------- attestations with an owner proof ---------- */

import { privateKeyToAccount } from 'viem/accounts';
import { disputeMessage } from '@lookout/core';

const ownerAcct = privateKeyToAccount(('0x' + '33'.repeat(32)) as `0x${string}`);
const ownerHash = targetHash('address', ownerAcct.address);
const proven = async (creator: string, signer = ownerAcct, hash = ownerHash, claim = 'legit') => {
  const sig = await signer.signMessage({ message: disputeMessage(hash) });
  const e = attestation(creator, claim, hash);
  e.attrs.payload = sig;
  return e;
};
const flagged = (hash: string) => [verdict(ADDR.feed, { sourceType: 'feed', sourceId: 'openfeed-demo', target: hash }), verdict(ADDR.checker, { sourceType: 'checker', sourceId: 'lookout-checker', target: hash })];

test('OWNER PROOF: the owner of a flagged address marks it DISPUTED with no allowlist, and it still does not clear the flag', async () => {
  const { result } = run([...flagged(ownerHash), await proven(ownerAcct.address)], ownerHash);
  assert.equal(result.disputed, true);
  assert.equal(result.verdict, 'block', 'a dispute alone never clears a flag, only an operator ruling can');
});

test('OWNER PROOF: nobody else can dispute for the owner, even replaying the owner signature', async () => {
  const stranger = privateKeyToAccount(('0x' + '44'.repeat(32)) as `0x${string}`);
  const mine = run([...flagged(ownerHash), await proven(stranger.address, stranger)], ownerHash);
  assert.equal(mine.result.disputed, false, "a stranger's own signature proves nothing about this address");
  assert.ok(mine.dropped.some((d) => d.reason === 'attester not recognised'));

  const replay = run([...flagged(ownerHash), await proven(stranger.address, ownerAcct)], ownerHash);
  assert.equal(replay.result.disputed, false, 'the owner signature, published by someone else, is useless');
});

test('OWNER PROOF: a dispute with no proof, or with a garbled one, is ignored', async () => {
  const bare = attestation(ownerAcct.address, 'legit', ownerHash);
  const garbled = await proven(ownerAcct.address);
  garbled.attrs.payload = garbled.attrs.payload.slice(0, 20) + '00' + garbled.attrs.payload.slice(22);
  for (const a of [bare, garbled]) assert.equal(run([...flagged(ownerHash), a], ownerHash).result.disputed, false);
});

test('OWNER PROOF: a `confirmed` claim never counts as a dispute, proof or not', async () => {
  assert.equal(run([...flagged(ownerHash), await proven(ownerAcct.address, ownerAcct, ownerHash, 'confirmed')], ownerHash).result.disputed, false);
});
