import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFrom } from './adapters.ts';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const D = '0x' + 'd'.repeat(40); // has stake but no seat

const seats = { seats: () => [{ wallet: A, nullifier: 'nA' }, { wallet: B, nullifier: 'nB' }, { wallet: C, nullifier: 'nC' }] };
const escrow = {
  async stakeOf(w: string) {
    const table: Record<string, { amount: bigint; eligible: boolean }> = {
      [A]: { amount: 2n, eligible: true }, [B]: { amount: 5n, eligible: false } /* unstaking */, [C]: { amount: 3n, eligible: true }, [D]: { amount: 9n, eligible: true },
    };
    return { ...(table[w] ?? { amount: 0n, eligible: false }), unlockAt: 0n };
  },
};

test('candidates are seated reviewers with eligible stake, carrying stake, reputation and nullifier', async () => {
  const c = await candidatesFrom({ seats, action: 'x', escrow, reputation: () => new Map([[A, 12.5]]) });
  assert.deepEqual(c, [
    { wallet: A, rep: 12.5, stakeWei: 2n, nullifier: 'nA' },
    { wallet: C, rep: 0, stakeWei: 3n, nullifier: 'nC' },
  ]);
});

test('stake without a seat never makes a candidate, and an unstaking reviewer is out', async () => {
  const c = await candidatesFrom({ seats, action: 'x', escrow, reputation: () => ({}) });
  assert.ok(!c.some((x) => x.wallet === D), 'D is staked but has no World ID seat');
  assert.ok(!c.some((x) => x.wallet === B), 'B is unstaking');
});

test('reputation can be given as a plain object too, and seat wallets are matched in lowercase', async () => {
  const upper = { seats: () => [{ wallet: '0x' + 'A'.repeat(40), nullifier: 'n' }] };
  const c = await candidatesFrom({ seats: upper, action: 'x', escrow, reputation: () => ({ [A]: 7 }) });
  assert.equal(c[0].rep, 7);
});
