import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, type RepEvent } from '@lookout/core';
import { memoryJournal } from './journal.ts';
import { mirrorDeposits, mirrorSettlements } from './mirror.ts';
import { addEvents, lastCheckpoint, runCheckpoint } from './checkpoint-job.ts';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const rid = (n: number) => n.toString(16).padStart(32, '0');
const TX = '0x' + 'ab'.repeat(32);

function fakeArkiv() {
  const created: Record<string, unknown>[] = [];
  const patched: { key: string; set: Record<string, unknown> }[] = [];
  return {
    created, patched,
    writer: {
      async createEntity(_s: unknown, v: Record<string, unknown>) { created.push(v); return { entityKey: `0x${created.length.toString(16).padStart(64, '0')}`, txHash: TX, expiresAt: 0 }; },
      async extendEntity() { return { expiresAt: 0 }; },
      async patchEntity(_s: unknown, key: string, a: { set: Record<string, unknown> }) { patched.push({ key, set: a.set }); },
    },
  };
}
const dep = (n: number, reporter = A) => ({ reporter: reporter as `0x${string}`, reportId: rid(n), amount: 10n ** 16n, txHash: TX as `0x${string}`, blockNumber: BigInt(n) });
const settled = (n: number, kind: 'confirmed' | 'rejected' | 'reclaimed', reporter = A) => ({ kind, reporter: reporter as `0x${string}`, reportId: rid(n), txHash: TX as `0x${string}`, blockNumber: BigInt(n) });

test('each deposit is mirrored once, even if the job runs again', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  assert.deepEqual(await mirrorDeposits({ arkiv: a.writer, journal }, [dep(1), dep(2)]), { created: 2, skipped: 0 });
  assert.deepEqual(await mirrorDeposits({ arkiv: a.writer, journal }, [dep(1), dep(2), dep(3)]), { created: 1, skipped: 2 });
  assert.equal(a.created.length, 3);
  assert.equal(a.created[0].status, 'locked');
});

test('settlements patch the right stake, once: confirmed and reclaimed are returned, rejected is slashed', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  await mirrorDeposits({ arkiv: a.writer, journal }, [dep(1), dep(2), dep(3)]);
  const r = await mirrorSettlements({ arkiv: a.writer, journal }, [settled(1, 'confirmed'), settled(2, 'rejected'), settled(3, 'reclaimed')]);
  assert.deepEqual(r, { updated: 3, skipped: 0, unknown: 0 });
  assert.deepEqual(a.patched.map((p) => p.set.status), ['returned', 'slashed', 'returned']);
  const again = await mirrorSettlements({ arkiv: a.writer, journal }, [settled(1, 'confirmed')]);
  assert.deepEqual(again, { updated: 0, skipped: 1, unknown: 0 });
  assert.equal(a.patched.length, 3);
});

test('a settlement whose deposit was never mirrored is left for the next run, not guessed at', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  assert.deepEqual(await mirrorSettlements({ arkiv: a.writer, journal }, [settled(9, 'confirmed')]), { updated: 0, skipped: 0, unknown: 1 });
  await mirrorDeposits({ arkiv: a.writer, journal }, [dep(9)]);
  assert.equal((await mirrorSettlements({ arkiv: a.writer, journal }, [settled(9, 'confirmed')])).updated, 1);
});

test('the same report id from two reporters is two different stakes', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  assert.equal((await mirrorDeposits({ arkiv: a.writer, journal }, [dep(1, A), dep(1, B)])).created, 2);
});

const ev = (wallet: string, kind: RepEvent['kind'], at: number, ref: string): RepEvent => ({ wallet, kind, at, ref });

test('a checkpoint is computed and published, and the next one builds on it and decays it', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  addEvents(journal, [ev(A, 'report_confirmed', 100, 'r1'), ev(B, 'report_rejected', 100, 'r2')]);
  const first = await runCheckpoint({ arkiv: a.writer, journal, now: () => 1000 });
  assert.equal(first.snapshotId, 'rep-1000');
  assert.equal(first.written, 1, 'B is at zero and is not written');
  assert.equal(lastCheckpoint(journal)?.scores.get(A), CONFIG.REP_CONFIRM_GAIN);

  const half = CONFIG.REP_HALF_LIFE_DAYS * 86_400;
  addEvents(journal, [ev(A, 'report_confirmed', 1500, 'r3')]);
  await runCheckpoint({ arkiv: a.writer, journal, now: () => 1000 + half });
  const score = lastCheckpoint(journal)!.scores.get(A)!;
  assert.ok(Math.abs(score - (CONFIG.REP_CONFIRM_GAIN / 2 + CONFIG.REP_CONFIRM_GAIN)) < 0.01, `score ${score}`);
});

test('an event added twice counts once, and used events are dropped from the pending list', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  const e = ev(A, 'report_confirmed', 100, 'r1');
  addEvents(journal, [e]); addEvents(journal, [e]);
  await runCheckpoint({ arkiv: a.writer, journal, now: () => 1000 });
  assert.equal(lastCheckpoint(journal)?.scores.get(A), CONFIG.REP_CONFIRM_GAIN);
  assert.equal(JSON.parse(journal.detail('checkpoint:events')!).length, 0);
});

test('re-running the same checkpoint does not publish it twice', async () => {
  const a = fakeArkiv(); const journal = memoryJournal();
  addEvents(journal, [ev(A, 'report_confirmed', 100, 'r1')]);
  await runCheckpoint({ arkiv: a.writer, journal, now: () => 1000 });
  const written = a.created.length;
  await runCheckpoint({ arkiv: a.writer, journal, now: () => 1000 });
  assert.equal(a.created.length, written);
});
