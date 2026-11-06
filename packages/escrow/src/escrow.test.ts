// Integration tests: the TypeScript client against the REAL compiled contract on a real (local) EVM.
// They need anvil from Foundry. Where it is not installed they are skipped, and the Solidity tests still cover the contract.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEther } from 'viem';
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
let address: `0x${string}`;

const as = (who: LocalChain['accounts'][number]): Escrow => createEscrow({ address, publicClient: chain.publicClient, walletClient: who.wallet });
const id = (n: number) => n.toString(16).padStart(32, '0');
const refusal = (code: string) => (e: unknown) => e instanceof EscrowError && e.code === code;

before(async () => {
  if (!HAVE_ANVIL) return;
  chain = await startLocalChain();
  [resolver, alice, bob] = [chain.accounts[0], chain.accounts[1], chain.accounts[2]];
  ({ address } = await deployEscrow({
    publicClient: chain.publicClient, walletClient: resolver.wallet, resolver: resolver.address, depositWei: DEPOSIT, bountyWei: BOUNTY, resolveWindow: WINDOW,
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

test('LIFECYCLE: a rejected report funds the pool, then a confirmed one gets its deposit AND a bounty back, claimed in one go', { skip }, async () => {
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

  // a trusted source corroborated it: the resolver confirms WITH a bounty
  await r.confirm(alice.address, id(1), true);
  assert.equal((await a.deposit(alice.address, id(1))).status, 'returned');
  assert.equal(await a.claimable(alice.address), DEPOSIT + BOUNTY, 'both are waiting for her');
  assert.equal(await r.bountyPool(), DEPOSIT - BOUNTY, 'the pool paid the bounty');
  const settled = await a.settledEvents(0n);
  assert.deepEqual(settled.map((s) => [s.kind, s.reportId, s.bountyWei]), [['rejected', id(2), 0n], ['confirmed', id(1), BOUNTY]], 'in block order, with the bounty on the confirmation');

  // Alice claims it all in one transfer
  const before = await chain.publicClient.getBalance({ address: alice.address });
  const claim = await a.claim();
  const after = await chain.publicClient.getBalance({ address: alice.address });
  assert.ok(claim.gasUsed > 0n);
  const gained = after - before;
  assert.ok(gained <= DEPOSIT + BOUNTY && DEPOSIT + BOUNTY - gained < parseEther('0.001'), `deposit and bounty arrived, less a small gas cost (gained ${gained})`);
});

test('a confirmation WITHOUT a bounty returns only the deposit, and a pool too small to pay never blocks the deposit coming back', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  await a.lockDeposit(id(3));
  const poolBefore = await r.bountyPool();
  await r.confirm(alice.address, id(3), false);
  assert.equal(await r.bountyPool(), poolBefore, 'no bounty asked for, none paid');
  await a.claim();

  // the pool now holds one bounty's worth. Two confirmations that both ask for a bounty: the second finds the pool empty
  await a.lockDeposit(id(4));
  await a.lockDeposit(id(5));
  await r.confirm(alice.address, id(4), true);
  await r.confirm(alice.address, id(5), true);
  const owed = await a.claimable(alice.address);
  assert.equal(owed, 2n * DEPOSIT + BOUNTY, 'both deposits came back, and only the ONE bounty the pool could afford was paid');
  assert.equal(await r.bountyPool(), 0n);
  await a.claim();
  const t = await a.totals();
  assert.equal(await a.balance(), t.locked + t.claimable + t.pool, 'still exactly solvent');
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
  const blockBefore = await chain.publicClient.getBlockNumber();
  await assert.rejects(a.lockDeposit(id(10)), refusal('AlreadyExists'));
  await assert.rejects(a.confirm(alice.address, id(10), true), refusal('NotResolver'));
  await assert.rejects(a.refund(alice.address, id(10)), refusal('NotResolver'));
  await assert.rejects(a.claim(), refusal('NothingToClaim'));
  await assert.rejects(r.confirm(alice.address, id(99), false), refusal('NotLocked'));
  // every refused call above was caught by the simulation, so no gas was spent on any of them
  assert.equal((await chain.publicClient.getBlockNumber()) - blockBefore, 0n, 'not one of the refused calls was mined: the simulation caught them all');
});

test('RECLAIM: a reporter can take the deposit back only after the window, and then the resolver can no longer decide', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  await a.lockDeposit(id(20));
  await assert.rejects(a.reclaim(id(20)), refusal('TooEarly'));
  await chain.increaseTime(Number(WINDOW));
  await a.reclaim(id(20));
  assert.equal((await a.deposit(alice.address, id(20))).status, 'reclaimed');
  await assert.rejects(r.confirm(alice.address, id(20), true), refusal('NotLocked'));
  await a.claim();
});

test('REFUND: the deposit goes back with no bounty, and it is a settlement event the Arkiv mirror can follow', { skip }, async () => {
  const a = as(alice), r = as(resolver);
  await a.fundPool(parseEther('1')); // so a missing bounty cannot be blamed on an empty pool
  await a.lockDeposit(id(30));
  const poolBefore = await r.bountyPool();
  await r.refund(alice.address, id(30));
  assert.equal((await a.deposit(alice.address, id(30))).status, 'refunded');
  assert.equal(await r.bountyPool(), poolBefore, 'no bounty for a refund');
  const settled = await a.settledEvents(0n);
  assert.ok(settled.some((e) => e.kind === 'refunded' && e.reportId === id(30) && e.bountyWei === 0n));
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
