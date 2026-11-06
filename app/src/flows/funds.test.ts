import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunds, type FundsPorts, type SavedReport } from './funds-flow.ts';

const MAIN = '0x' + '11'.repeat(20);
const ETH = 10n ** 18n;

/* ------------------------------- funds ------------------------------- */

const R1: SavedReport = { reportId: '1'.repeat(32), kind: 'domain', value: 'one.example', at: 1 };
const R2: SavedReport = { reportId: '2'.repeat(32), kind: 'domain', value: 'two.example', at: 2 };
const R3: SavedReport = { reportId: '3'.repeat(32), kind: 'domain', value: 'three.example', at: 3 };
const DAY = 86_400n;

function fundsPorts(now: number, over: Partial<FundsPorts> = {}): FundsPorts {
  return {
    claimable: async () => 1n * ETH / 1000n,
    deposit: async (_a, id) => ({ status: id === R1.reportId ? 'returned' : 'locked', lockedAt: id === R3.reportId ? 0n : BigInt(now) }),
    resolveWindow: async () => 30n * DAY,
    now: () => now,
    ...over,
  };
}

test('FUNDS: what is owed, and which deposits can be reclaimed yet', async () => {
  const now = 100 * 86_400;
  const f = await loadFunds(fundsPorts(now), MAIN, [R1, R2, R3]);
  assert.equal(f.claimableWei, ETH / 1000n);
  const by = Object.fromEntries(f.deposits.map((d) => [d.reportId[0], d]));
  assert.equal(by['1'].status, 'returned');
  assert.match(by['1'].note, /returned to you/);
  assert.equal(by['2'].canReclaim, false, 'locked just now: the window has not passed');
  assert.match(by['2'].note, /30 day/);
  assert.equal(by['3'].canReclaim, true, 'locked long ago with no ruling: the reporter may take it back');
  assert.match(by['3'].note, /settled this in time/);
});

test('FUNDS: a deposit that cannot be read is skipped, not fatal, and a settled one is never reclaimable', async () => {
  const p = fundsPorts(1_000, { deposit: async (_a, id) => { if (id === R2.reportId) throw new Error('rpc'); return { status: 'slashed', lockedAt: 0n }; } });
  const f = await loadFunds(p, MAIN, [R1, R2, R3]);
  assert.deepEqual(f.deposits.map((d) => d.reportId[0]), ['1', '3']);
  assert.ok(f.deposits.every((d) => !d.canReclaim && d.reclaimableAt === null));
  assert.match(f.deposits[0].note, /bounty pool/);
});
