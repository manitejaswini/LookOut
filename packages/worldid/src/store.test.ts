import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSeatStore } from './store.ts';
import { WALLET_A, WALLET_B } from './fixtures.ts';

const ACTION = 'lookout-reviewer-seat-v1';
const H1 = 'nil_' + '1'.repeat(64);
const H2 = 'nil_' + '2'.repeat(64);
const WALLET_C = '0x1111111111111111111111111111111111111111';

test('a new human with a new wallet gets a seat', () => {
  const s = new SqliteSeatStore();
  assert.equal(s.enroll(H1, WALLET_A, ACTION), 'enrolled');
  assert.equal(s.hasSeat(WALLET_A, ACTION), true);
  assert.equal(s.hasSeat(WALLET_B, ACTION), false);
  assert.equal(s.count(ACTION), 1);
});

test('the same human with the same wallet again is a harmless retry, not a second seat', () => {
  const s = new SqliteSeatStore();
  s.enroll(H1, WALLET_A, ACTION);
  assert.equal(s.enroll(H1, WALLET_A, ACTION), 'already_seated');
  assert.equal(s.count(ACTION), 1);
});

test('ONE HUMAN, ONE SEAT: the same human cannot take a second seat with another wallet', () => {
  const s = new SqliteSeatStore();
  s.enroll(H1, WALLET_A, ACTION);
  assert.equal(s.enroll(H1, WALLET_B, ACTION), 'human_already_enrolled');
  assert.equal(s.hasSeat(WALLET_B, ACTION), false, 'the second wallet got nothing');
  assert.equal(s.count(ACTION), 1);
});

test('two humans cannot share a wallet', () => {
  const s = new SqliteSeatStore();
  s.enroll(H1, WALLET_A, ACTION);
  assert.equal(s.enroll(H2, WALLET_A, ACTION), 'wallet_taken');
  assert.equal(s.count(ACTION), 1);
});

test('different humans with different wallets each get a seat, and the pool lists wallets oldest first', () => {
  let t = 100;
  const s = new SqliteSeatStore(':memory:', () => t++);
  s.enroll(H1, WALLET_B, ACTION);
  s.enroll(H2, WALLET_A, ACTION);
  s.enroll('nil_' + '3'.repeat(64), WALLET_C, ACTION);
  assert.equal(s.count(ACTION), 3);
  assert.deepEqual(s.wallets(ACTION), [WALLET_B, WALLET_A, WALLET_C]);
});

test('seats are per action: the same human can hold a seat under another action', () => {
  const s = new SqliteSeatStore();
  s.enroll(H1, WALLET_A, ACTION);
  assert.equal(s.enroll(H1, WALLET_A, 'another-action'), 'enrolled');
  assert.equal(s.count(ACTION), 1);
  assert.equal(s.count('another-action'), 1);
});

test('the rule is enforced by the database itself: a second connection to the same file cannot break it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-worldid-'));
  const file = join(dir, 'seats.sqlite');
  const one = new SqliteSeatStore(file);
  const two = new SqliteSeatStore(file); // a second server process, in effect
  try {
    assert.equal(one.enroll(H1, WALLET_A, ACTION), 'enrolled');
    assert.equal(two.enroll(H1, WALLET_B, ACTION), 'human_already_enrolled', 'the other connection sees the first seat');
    assert.equal(two.enroll(H2, WALLET_A, ACTION), 'wallet_taken');
    assert.equal(two.count(ACTION), 1);
  } finally {
    one.close();
    two.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seats survive a restart (the file is the source of truth)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-worldid-'));
  const file = join(dir, 'nested', 'seats.sqlite'); // the folder does not exist yet and is created
  try {
    const first = new SqliteSeatStore(file);
    first.enroll(H1, WALLET_A, ACTION);
    first.close();
    const second = new SqliteSeatStore(file);
    assert.equal(second.hasSeat(WALLET_A, ACTION), true);
    assert.equal(second.enroll(H1, WALLET_B, ACTION), 'human_already_enrolled');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the store holds no personal data: only nullifier, wallet, action and a time', () => {
  const s = new SqliteSeatStore();
  s.enroll(H1, WALLET_A, ACTION);
  const cols = (s as unknown as { db: { prepare(sql: string): { all(): { name: string }[] } } }).db.prepare('PRAGMA table_info(seats)').all().map((c) => c.name);
  assert.deepEqual(cols.sort(), ['action', 'enrolled_at', 'nullifier', 'wallet']);
});
