import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from './pir.ts';

const names = ['openfeed-demo', 'lookout-checker'];

test('a community report is labelled as one, whatever number the table holds', () => {
  assert.equal(sourceLabel('community', 0, names), 'community report');
  assert.equal(sourceLabel('community', 7, names), 'community report');
});

test('a registered source is shown by name: the index is the 1-based position in the registry', () => {
  assert.equal(sourceLabel('feed', 1, names), 'openfeed-demo');
  assert.equal(sourceLabel('checker', 2, names), 'lookout-checker');
});

test('without names, or past the end of the list, it falls back to the number instead of guessing', () => {
  assert.equal(sourceLabel('checker', 2), 'source #2');
  assert.equal(sourceLabel('checker', 2, []), 'source #2');
  assert.equal(sourceLabel('verifier', 9, names), 'source #9');
});
