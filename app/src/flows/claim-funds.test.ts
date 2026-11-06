import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAddress } from 'viem/accounts';
import { bytesToHex } from 'viem';
import { bountyIdFor, createPayment, ephemeralFor, generateKeys, metaAddress } from '@lookout/stealth';
import { ClaimError, findBounties, isLinkedDestination, sweepBounty, type ClaimPorts } from './claim-flow.ts';
import { loadFunds, type FundsPorts, type SavedReport } from './funds-flow.ts';

const PAYER = new Uint8Array(32).fill(7);
const keys = generateKeys();
const meta = metaAddress(keys);
const reportId = 'a'.repeat(32);
const pay = createPayment(meta, ephemeralFor(PAYER, reportId)); // what the panel does
const FRESH = '0x' + '9f'.repeat(20);
const MAIN = '0x' + '11'.repeat(20);
const ETH = 10n ** 18n;

function ports(over: Partial<ClaimPorts> = {}) {
  const sent: { key: string; to: string; wei: bigint; gasPrice: bigint }[] = [];
  const balances = new Map<string, bigint>([[pay.stealthAddress.toLowerCase(), 5n * 10n ** 14n]]);
  const p: ClaimPorts = {
    announcements: async (id) => (id === reportId ? [{ reportId, ephemeralPublicKey: pay.ephemeralPublicKey }] : []),
    balance: async (a) => balances.get(a.toLowerCase()) ?? 0n,
    gasPrice: async () => 2_000_000_000n,
    sendFrom: async (k, to, wei, gasPrice) => (sent.push({ key: bytesToHex(k), to, wei, gasPrice }), balances.set(pay.stealthAddress.toLowerCase(), 0n), { hash: '0xhash' }),
    ...over,
  };
  return { p, sent, balances };
}

test('the reporter finds the one-time address with their OWN keys, and nobody else can', async () => {
  const { p } = ports();
  const found = await findBounties(p, [reportId, 'b'.repeat(32), reportId], keys);
  assert.equal(found.length, 1, 'duplicates collapse and reports with no bounty yield nothing');
  assert.equal(found[0].stealthAddress, pay.stealthAddress);
  assert.equal(found[0].balanceWei, 5n * 10n ** 14n);
  const stranger = await findBounties(p, [reportId], generateKeys());
  assert.notEqual(stranger[0].stealthAddress, pay.stealthAddress, 'another reporter computes a different, empty address');
  assert.equal(stranger[0].balanceWei, 0n);
});

test('a malformed announcement does not hide the good ones', async () => {
  const { p } = ports({ announcements: async () => [{ reportId, ephemeralPublicKey: '0x1234' }, { reportId, ephemeralPublicKey: pay.ephemeralPublicKey }] });
  assert.equal((await findBounties(p, [reportId], keys)).length, 1);
});

test('SWEEP: the one-time key signs, the fee comes out of the bounty, and the destination gets the rest', async () => {
  const { p, sent } = ports();
  const [b] = await findBounties(p, [reportId], keys);
  const out = await sweepBounty(p, keys, b, FRESH, { knownWallets: [MAIN] });
  assert.equal(out.hash, '0xhash');
  assert.equal(sent.length, 1);
  const fee = 2_000_000_000n * 21_000n;
  assert.equal(out.sentWei, 5n * 10n ** 14n - fee);
  assert.equal(sent[0].wei + fee, 5n * 10n ** 14n, 'balance = sent + fee, nothing left behind');
  assert.equal(sent[0].gasPrice, 2_000_000_000n);
  assert.equal(sent[0].to, FRESH);
  // the key used really controls the one-time address
  assert.equal(privateKeyToAddress(sent[0].key as `0x${string}`).toLowerCase(), pay.stealthAddress.toLowerCase());
});

test('PRIVACY: sending the bounty to the reporter wallet is refused unless the person accepts the link', async () => {
  const { p, sent } = ports();
  const [b] = await findBounties(p, [reportId], keys);
  await assert.rejects(sweepBounty(p, keys, b, MAIN.toUpperCase().replace('0X', '0x'), { knownWallets: [MAIN] }), (e) => e instanceof ClaimError && e.code === 'linked-destination');
  assert.equal(sent.length, 0);
  await sweepBounty(p, keys, b, MAIN, { knownWallets: [MAIN], allowLinked: true });
  assert.equal(sent.length, 1);
  assert.equal(isLinkedDestination(FRESH, [MAIN]), false);
});

test('bad destinations, an empty address, a bounty smaller than the fee, and a failed send are all explained', async () => {
  const { p } = ports();
  const [b] = await findBounties(p, [reportId], keys);
  for (const d of ['', '0x123', '0x' + '0'.repeat(40), b.stealthAddress]) {
    await assert.rejects(sweepBounty(p, keys, b, d), (e) => e instanceof ClaimError && e.code === 'bad-destination', d);
  }
  const empty = ports({ balance: async () => 0n });
  await assert.rejects(sweepBounty(empty.p, keys, b, FRESH), (e) => e instanceof ClaimError && e.code === 'nothing-to-claim');
  const tiny = ports({ balance: async () => 1_000n });
  await assert.rejects(sweepBounty(tiny.p, keys, b, FRESH), (e) => e instanceof ClaimError && e.code === 'too-small');
  const broken = ports({ sendFrom: async () => { throw new Error('nonce too low'); } });
  await assert.rejects(sweepBounty(broken.p, keys, b, FRESH), (e) => e instanceof ClaimError && e.code === 'send-failed' && /nonce/.test(e.message));
});

test('the opaque bounty id the escrow records cannot be recomputed without the payer secret', () => {
  assert.notEqual(bountyIdFor(PAYER, reportId), bountyIdFor(new Uint8Array(32).fill(8), reportId));
});

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
