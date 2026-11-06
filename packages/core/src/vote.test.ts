import test from 'node:test';
import assert from 'node:assert/strict';
import { commitVote, newSalt, verifyReveal, type Commitment } from './vote.ts';

const J1 = '0x37324a0cc17959ee99233c8552e741519983573e';
const J2 = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
const c: Commitment = { caseId: '0123456789abcdef', outcome: 'block', salt: 'ab'.repeat(16), juror: J1 };

test('a commitment is a 32-byte hash, stable, and independent of address letter case', () => {
  const h = commitVote(c);
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(commitVote(c), h);
  assert.equal(commitVote({ ...c, juror: J1.toUpperCase().replace('0X', '0x') }), h);
});

test('the hash is pinned, so every implementation agrees (changing it breaks every reveal in flight)', () => {
  // Produced by this implementation, so it guards against accidental drift. It is not an independent check.
  // The hash primitive itself was checked against the known keccak256("") vector (see target.test.ts).
  assert.equal(commitVote(c), '0xbfe7e8192cf6846215734de17a09c6e4b225b5e69c0f014caa28c1d374d186d2');
});

test('the commitment hides the vote: block and clear give unrelated hashes, and the salt changes everything', () => {
  const block = commitVote(c);
  const clear = commitVote({ ...c, outcome: 'clear' });
  assert.notEqual(block, clear);
  assert.notEqual(commitVote({ ...c, salt: 'cd'.repeat(16) }), block);
});

test('it binds the case and the juror: it cannot be replayed in another case or copied by another juror', () => {
  const h = commitVote(c);
  assert.notEqual(commitVote({ ...c, caseId: 'fedcba9876543210' }), h);
  assert.notEqual(commitVote({ ...c, juror: J2 }), h);
});

test('a reveal verifies only when outcome, salt, case and juror all match the commitment', () => {
  const h = commitVote(c);
  assert.equal(verifyReveal(h, c), true);
  assert.equal(verifyReveal(h.toUpperCase().replace('0X', '0x'), c), true, 'hex case does not matter');
  assert.equal(verifyReveal(h, { ...c, outcome: 'clear' }), false, 'switching the vote after seeing others');
  assert.equal(verifyReveal(h, { ...c, salt: 'cd'.repeat(16) }), false);
  assert.equal(verifyReveal(h, { ...c, juror: J2 }), false);
  assert.equal(verifyReveal(h, { ...c, caseId: 'fedcba9876543210' }), false);
});

test('malformed input is refused on commit, and is simply "no" on reveal', () => {
  for (const bad of [{ caseId: 'xyz' }, { outcome: 'maybe' as never }, { salt: 'short' }, { salt: 'AB'.repeat(16) }, { juror: '0x123' }]) {
    assert.throws(() => commitVote({ ...c, ...bad }), Error, JSON.stringify(bad));
    assert.equal(verifyReveal(commitVote(c), { ...c, ...bad }), false);
  }
});

test('newSalt makes 128 random bits as 32 hex digits, fresh each time', () => {
  const a = newSalt(), b = newSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(commitVote({ ...c, salt: a }).length, 66, 'a generated salt is always acceptable');
});
