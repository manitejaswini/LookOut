import test from 'node:test';
import assert from 'node:assert/strict';
import { caseIdFor } from './case-id.ts';
import { targetHash } from './target.ts';

const H = targetHash('domain', 'evil-site.example');

test('a case id is 16 lowercase hex digits, stable, and different per trigger', () => {
  const id = caseIdFor(H, '0x' + '11'.repeat(32));
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(id, caseIdFor(H.toUpperCase().replace('0X', '0x'), '0x' + '11'.repeat(32)));
  assert.notEqual(id, caseIdFor(H, '0x' + '22'.repeat(32)));
});
