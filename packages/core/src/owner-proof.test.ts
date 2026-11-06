import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { disputeMessage, humanMessage, recoverSigner, verifyOwnerProof, verifyWalletOwnership } from './owner-proof.ts';
import { targetHash } from './target.ts';

const owner = privateKeyToAccount(('0x' + '11'.repeat(32)) as `0x${string}`);
const other = privateKeyToAccount(('0x' + '22'.repeat(32)) as `0x${string}`);
const H = targetHash('address', owner.address);
const sign = (acct: typeof owner, hash = H) => acct.signMessage({ message: disputeMessage(hash) });

test('the signature recovers the same address a real wallet signed with', async () => {
  const sig = await owner.signMessage({ message: 'hello' });
  assert.equal(recoverSigner('hello', sig), owner.address.toLowerCase());
  assert.notEqual(recoverSigner('hello!', sig), owner.address.toLowerCase(), 'a different message recovers a different address');
});

test('the owner of the flagged address can prove it, and the target is recovered from the signature', async () => {
  const r = verifyOwnerProof({ targetHash: H, creator: owner.address }, await sign(owner));
  assert.deepEqual(r, { ok: true, address: owner.address.toLowerCase() });
});

test('someone else cannot dispute for the owner, even with their own valid signature', async () => {
  const r = verifyOwnerProof({ targetHash: H, creator: other.address }, await sign(other));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not the flagged address/);
});

test('a published owner signature cannot be replayed by another wallet as its own dispute', async () => {
  const sig = await sign(owner);
  const r = verifyOwnerProof({ targetHash: H, creator: other.address }, sig);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not written by the signer/);
});

test('a signature over a different target does not prove this one', async () => {
  const otherHash = targetHash('address', other.address);
  const sigForOther = await sign(owner, otherHash); // owner signs a dispute about a different address
  const r = verifyOwnerProof({ targetHash: H, creator: owner.address }, sigForOther);
  assert.equal(r.ok, false);
});

test('missing, malformed and tampered proofs are refused without throwing', async () => {
  const good = await sign(owner);
  const bad = ['', undefined, '0x12', 'nope', '0x' + '00'.repeat(65), '0x' + 'ff'.repeat(65)];
  for (const b of bad) assert.equal(verifyOwnerProof({ targetHash: H, creator: owner.address }, b).ok, false, String(b));
  const flipped = good.slice(0, 10) + (good[10] === '0' ? '1' : '0') + good.slice(11);
  assert.equal(verifyOwnerProof({ targetHash: H, creator: owner.address }, flipped).ok, false, 'one changed hex digit');
});

test('address and contract targets share one hash, and only a wallet with a key can ever sign for it', async () => {
  // the hash does not depend on the kind, so an EOA's proof covers its address whichever way it was reported
  assert.equal(targetHash('contract', owner.address), H);
  // a deployed contract has no private key, so nobody can produce a valid signature for its address: it cannot be disputed this way
  const contractLike = targetHash('contract', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08');
  const r = verifyOwnerProof({ targetHash: contractLike, creator: owner.address }, await sign(owner, contractLike));
  assert.equal(r.ok, false);
});

test('a domain is never proved by a signature, because its hash is not an address hash', async () => {
  const d = targetHash('domain', 'example.com');
  const r = verifyOwnerProof({ targetHash: d, creator: owner.address }, await sign(owner, d));
  assert.equal(r.ok, false);
});

test('the message is fixed, so a signature cannot be reused for another purpose', () => {
  assert.equal(disputeMessage(H.toUpperCase().replace('0X', '0x')), disputeMessage(H));
  assert.match(disputeMessage(H), /^Lookout dispute v0\ntarget: 0x[0-9a-f]{64}\nclaim: legit$/);
});

test('WALLET OWNERSHIP: only the wallet itself can sign for it, for this action only', async () => {
  const sig = await owner.signMessage({ message: humanMessage(owner.address, 'act-1') });
  assert.equal(verifyWalletOwnership(owner.address, 'act-1', sig), true);
  assert.equal(verifyWalletOwnership(owner.address.toUpperCase().replace('0X', '0x'), 'act-1', sig), true, 'case does not matter');
  assert.equal(verifyWalletOwnership(other.address, 'act-1', sig), false, 'someone else cannot claim this wallet');
  assert.equal(verifyWalletOwnership(owner.address, 'act-2', sig), false, 'a signature for one action is useless for another');
  for (const bad of [undefined, '', '0x12', 'nope']) assert.equal(verifyWalletOwnership(owner.address, 'act-1', bad), false);
});
