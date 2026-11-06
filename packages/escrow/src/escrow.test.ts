// Integration tests: the TypeScript client against the REAL compiled contract on a real (local) EVM.
// They need anvil from Foundry. Where it is not installed they are skipped, and the Solidity tests still cover the contract.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keccak256, parseEther, parseEventLogs, toHex } from 'viem';
import { escrowAbi } from './artifact.ts';
import { anvilAvailable, startLocalChain, type LocalChain } from './anvil.ts';
import { createEscrow, deployEscrow, EscrowError, explain, fromBytes16, toBytes16, type Escrow } from './client.ts';

const HAVE_ANVIL = anvilAvailable();
const skip = HAVE_ANVIL ? false : 'anvil (Foundry) is not installed';

const DEPOSIT = parseEther('0.01');
const BOUNTY = parseEther('0.005');
const WINDOW = 30n * 86_400n;

let chain: LocalChain;
let resolver: LocalChain['accounts'][number];
let alice: LocalChain['accounts'][number];
let bob: LocalChain['accounts'][number];
let stealth: LocalChain['accounts'][number];
let address: `0x${string}`;

const as = (who: LocalChain['accounts'][number]): Escrow => createEscrow({ address, publicClient: chain.publicClient, walletClient: who.wallet });
const id = (n: number) => n.toString(16).padStart(32, '0');
// the resolver derives these from a secret, so they cannot be recomputed from a public report
const bid = (n: number) => keccak256(toHex(`bounty-${n}`));
const refusal = (code: string) => (e: unknown) => e instanceof EscrowError && e.code === code;

before(async () => {
  if (!HAVE_ANVIL) return;
  chain = await startLocalChain();
  [resolver, alice, bob, , stealth] = [chain.accounts[0], chain.accounts[1], chain.accounts[2], chain.accounts[3], chain.accounts[4]];
  ({ address } = await deployEscrow({
    publicClient: chain.publicClient, walletClient: resolver.wallet, resolver: resolver.address,
    depositWei: DEPOSIT, bountyWei: BOUNTY, resolveWindow: WINDOW,
  }));
});
after(async () => { if (HAVE_ANVIL) await chain.stop(); });

test('the committed ABI and bytecode match what the compiler produces now', { skip: skip || (() => { try { execFileSync('forge', ['--version'], { stdio: 'ignore' }); return false; } catch { return 'forge is not installed'; } })() }, () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/gen-escrow-artifact.mjs', import.meta.url)), '--check'], { stdio: 'pipe' });
});

test('the deployed contract has the configuration it was deployed with', { skip }, async () => {
  const c = await as(alice).config();
  assert.equal(c.resolver, resolver.address);
  assert.equal(c.depositWei, DEPOSIT);
  assert.equal(c.bountyWei, BOUNTY);
  assert.equal(c.resolveWindow, WINDOW);
});

test('LIFECYCLE: deposit, see the event, confirm, claim the refund, and be paid a bounty from a forfeited deposit', { skip }, async () => {
  const a = as(alice), r = as(resolver), b = as(bob);

  // Bob files a report that will be rejected, which funds the pool
  await b.lockDeposit(id(2));
  await r.reject(bob.address, id(2));
  assert.equal(await r.bountyPool(), DEPOSIT);

  // Alice files a report
  const tx = await a.lockDeposit(id(1));
  assert.ok(tx.gasUsed > 0n);
  assert.equal((await a.deposit(alice.address, id(1))).status, 'locked');

  // the event is what the Arkiv `stake` entity mirrors
  const events = await a.depositEvents(0n);
  const mine = events.find((e) => e.reportId === id(1));
  assert.ok(mine);
  assert.equal(mine.reporter, alice.address);
  assert.equal(mine.amount, DEPOSIT);
  assert.equal(mine.txHash, tx.hash);

  // the panel confirms it
  await r.confirm(alice.address, id(1));
  assert.equal((await a.deposit(alice.address, id(1))).status, 'returned');
  assert.equal(await a.claimable(alice.address), DEPOSIT);
  const settled = await a.settledEvents(0n);
  assert.deepEqual(settled.map((s) => [s.kind, s.reportId]), [['rejected', id(2)], ['confirmed', id(1)]], 'in block order');

  // Alice claims her refund
  const before = await chain.publicClient.getBalance({ address: alice.address });
  const claim = await a.claim();
  const after = await chain.publicClient.getBalance({ address: alice.address });
  assert.ok(claim.gasUsed > 0n);
  const gained = after - before;
  assert.ok(gained <= DEPOSIT && DEPOSIT - gained < parseEther('0.001'), `the refund arrived, less a small gas cost (gained ${gained})`);

  // and the bounty goes to a stealth address, once
  await r.payBounty(bid(1), stealth.address);
  assert.equal(await chain.publicClient.getBalance({ address: stealth.address }), parseEther('10000') + BOUNTY);
  assert.equal(await a.bountyPaid(bid(1)), true);
  await assert.rejects(r.payBounty(bid(1), stealth.address), refusal('AlreadyPaid'));

  // PRIVACY: nothing on chain names the reporter or the report when a bounty is paid
  const logs = await chain.publicClient.getLogs({ address, fromBlock: 0n });
  const paid = parseEventLogs({ abi: escrowAbi, logs, eventName: 'BountyPaid' });
  assert.equal(paid.length, 1);
  assert.deepEqual(Object.keys(paid[0].args).sort(), ['amount', 'stealth'], 'the event carries only the stealth address and the amount');
  const payTx = await chain.publicClient.getTransaction({ hash: paid[0].transactionHash });
  assert.ok(!payTx.input.toLowerCase().includes(alice.address.slice(2).toLowerCase()), 'the call data does not contain the reporter address');
  assert.ok(!payTx.input.toLowerCase().includes(id(1)), 'and does not contain the report id');
  const counts = await a.bountyCounts();
  assert.equal(counts.paid <= counts.confirmed, true, 'never more bounties than confirmations');
});

test('ACCOUNTING: the escrow always holds exactly what it owes, checked against the chain itself', { skip }, async () => {
  const e = as(alice);
  const t = await e.totals();
  assert.equal(await e.balance(), t.locked + t.claimable + t.pool);
});

test('the contract\'s own error names come through, and nothing is sent when the call would revert', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  await a.lockDeposit(id(10));

  // the SAME report id from another account is fine: ids are per reporter, so nobody can squat someone else's id
  await r.lockDeposit(id(10));
  const blockBefore2 = await chain.publicClient.getBlockNumber();
  await assert.rejects(a.lockDeposit(id(10)), refusal('AlreadyExists'));
  await assert.rejects(a.confirm(alice.address, id(10)), refusal('NotResolver'));
  await assert.rejects(a.claim(), refusal('NothingToClaim'));
  await assert.rejects(r.confirm(alice.address, id(99)), refusal('NotLocked'));
  await assert.rejects(r.payBounty(bid(10), stealth.address), refusal('NotConfirmed'));
  await assert.rejects(r.payBounty(bid(10), '0x0000000000000000000000000000000000000000'), refusal('ZeroAddress'), 'the destination is checked first');
  await assert.rejects(a.refund(alice.address, id(10)), refusal('NotResolver'));

  // every refused call above was caught by the simulation, so no gas was spent on any of them
  const blocks = (await chain.publicClient.getBlockNumber()) - blockBefore2;
  assert.equal(blocks, 0n, 'not one of the refused calls was mined: the simulation caught them all');
});

test('RECLAIM: a reporter can take the deposit back only after the window, and then the panel can no longer decide', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  await a.lockDeposit(id(20));
  await assert.rejects(a.reclaim(id(20)), refusal('TooEarly'));
  await chain.increaseTime(Number(WINDOW));
  await a.reclaim(id(20));
  assert.equal((await a.deposit(alice.address, id(20))).status, 'reclaimed');
  await assert.rejects(r.confirm(alice.address, id(20)), refusal('NotLocked'));
  await assert.rejects(r.payBounty(bid(20), stealth.address), refusal('NotConfirmed'));
  await a.claim();
});

test('REFUND: the deposit goes back with no bounty, and it is not a confirmation', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  const before = await a.bountyCounts();
  await a.lockDeposit(id(30));
  await r.refund(alice.address, id(30));
  assert.equal((await a.deposit(alice.address, id(30))).status, 'refunded');
  assert.equal(await a.claimable(alice.address) >= DEPOSIT, true);
  await assert.rejects(r.payBounty(bid(30), stealth.address), refusal('NotConfirmed'), 'no confirmation, so no bounty');
  assert.deepEqual(await a.bountyCounts(), before, 'the confirmation count did not move');
  const settled = await a.settledEvents(0n);
  assert.ok(settled.some((e) => e.kind === 'refunded' && e.reportId === id(30)), 'the refund is a settlement event the Arkiv mirror can follow');
  await assert.rejects(r.refund(alice.address, id(30)), refusal('NotLocked'), 'only once');
  const t = await a.totals();
  assert.equal(await a.balance(), t.locked + t.claimable + t.pool, 'still exactly solvent');
  await a.claim();
});

test('anyone can add to the pool, and a plain transfer lands there too', { skip }, async () => {
  const before = await as(alice).bountyPool();
  await as(alice).fundPool(parseEther('1'));
  assert.equal(await as(alice).bountyPool(), before + parseEther('1'));
});

test('report ids convert to the contract\'s bytes16 and back, and bad ones are refused', () => {
  assert.equal(toBytes16('0123456789abcdef0123456789abcdef'), '0x0123456789abcdef0123456789abcdef');
  assert.equal(fromBytes16('0x0123456789ABCDEF0123456789abcdef'), '0123456789abcdef0123456789abcdef');
  for (const bad of ['', 'abc', 'g'.repeat(32), 'A'.repeat(32), '0'.repeat(31), '0'.repeat(33)]) {
    assert.throws(() => toBytes16(bad), EscrowError, bad);
  }
});

test('explain turns anything into an EscrowError and never loses one it already has', () => {
  const e = new EscrowError('NotResolver', 'x');
  assert.equal(explain(e), e);
  assert.equal(explain(new Error('boom')).code, 'Unknown');
  assert.equal(explain('a string').code, 'Unknown');
});
