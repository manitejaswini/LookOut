import test from 'node:test';
import assert from 'node:assert/strict';
import { findSource, loadRegistry, parseRegistry, reputationOf, sourceIdx } from './registry.ts';
import { ADDR, registry } from './fixtures.ts';

const good = { sources: [{ sourceId: 'a', sourceType: 'feed', address: ADDR.feed }], attesters: [], panel: null, reputation: {} };

test('a valid registry parses, and addresses are lowercased', () => {
  const r = parseRegistry({ ...good, attesters: ['0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa'], panel: ADDR.panel.toUpperCase().replace('0X', '0x') });
  assert.equal(r.attesters[0], '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(r.panel, ADDR.panel);
});

test('bad registries are rejected loudly', () => {
  assert.throws(() => parseRegistry(null), /expected an object/);
  assert.throws(() => parseRegistry({ ...good, sources: [{ ...good.sources[0], address: '0x123' }] }), /address/);
  assert.throws(() => parseRegistry({ ...good, sources: [{ ...good.sources[0], sourceType: 'community' }] }), /sourceType/);
  assert.throws(() => parseRegistry({ ...good, sources: [{ ...good.sources[0], sourceId: '' }] }), /sourceId/);
  assert.throws(() => parseRegistry({ ...good, sources: [good.sources[0], good.sources[0]] }), /duplicate sourceId/);
  assert.throws(() => parseRegistry({ ...good, reputation: { [ADDR.rep82]: -1 } }), /reputation/);
  assert.throws(() => parseRegistry({ ...good, reputation: { [ADDR.rep82]: 'high' } }), /reputation/);
  assert.throws(() => parseRegistry({ ...good, attesters: ['nope'] }), /attesters/);
});

test('findSource needs the wallet, the type AND the id to match, ignoring address case', () => {
  assert.ok(findSource(registry, ADDR.checker, 'checker', 'lookout-checker'));
  assert.ok(findSource(registry, ADDR.checker.toUpperCase().replace('0X', '0x'), 'checker', 'lookout-checker'));
  assert.equal(findSource(registry, ADDR.checker, 'feed', 'lookout-checker'), undefined);
  assert.equal(findSource(registry, ADDR.checker, 'checker', 'openfeed-demo'), undefined);
  assert.equal(findSource(registry, ADDR.stranger, 'checker', 'lookout-checker'), undefined);
});

test('sourceIdx is 1-based and 0 is left free for community reports', () => {
  assert.equal(sourceIdx(registry, 'openfeed-demo'), 1);
  assert.equal(sourceIdx(registry, 'lookout-checker'), 2);
  assert.equal(sourceIdx(registry, 'nobody'), -1);
});

test('an unknown wallet has reputation 0, so a fresh wallet weighs nothing', () => {
  assert.equal(reputationOf(registry, ADDR.stranger), 0);
  assert.equal(reputationOf(registry, ADDR.rep82.toUpperCase().replace('0X', '0x')), 82);
});

test('the committed registry.json parses and lists the demo checker and feed', () => {
  const r = loadRegistry();
  assert.ok(r.sources.some((s) => s.sourceId === 'lookout-checker' && s.sourceType === 'checker'));
  assert.ok(r.sources.some((s) => s.sourceId === 'openfeed-demo' && s.sourceType === 'feed'));
  assert.deepEqual(r.attesters, [], 'no attester is honoured until proof of control exists');
  assert.equal(r.panel, null);
});
