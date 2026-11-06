import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { buildTargets } from './signals.ts';
import { startServer } from './server.ts';
import { listEntities } from './entities.ts';
import type { IndexState } from './lookup.ts';
import { ADDR, attestation, checkerVerdict, feedVerdict, registry, report, timing } from './fixtures.ts';

function stateFrom(entities: Parameters<typeof buildTargets>[0]): IndexState {
  const { targets, dropped } = buildTargets(entities, timing, registry);
  return { targets, dropped, entities, timing, entityCount: entities.length, syncedAt: 1 };
}
const state = () => stateFrom([report(ADDR.rep82), feedVerdict(), checkerVerdict(true), attestation(ADDR.attester)]);

test('times are converted from blocks using the block time, and expiry is in the future for live entities', () => {
  const list = listEntities(state());
  assert.equal(list.block, timing.currentBlock);
  for (const e of list.entities) {
    assert.ok(e.createdAt <= timing.currentBlockTime, `${e.kind} created in the past`);
    assert.ok(e.expiresAt > e.createdAt, `${e.kind} expires after it is created`);
  }
  const r = list.entities.find((e) => e.kind === 'report')!;
  const raw = state().entities.find((e) => e.kind === 'report')!;
  assert.equal(r.expiresAt, timing.currentBlockTime + (raw.expiresBlock - timing.currentBlock) * timing.blockDuration);
});

test('newest first, filtered by kind, and the limit is clamped', () => {
  const list = listEntities(state());
  const created = list.entities.map((e) => e.createdAt);
  assert.deepEqual(created, [...created].sort((a, b) => b - a));
  assert.ok(listEntities(state(), { kind: 'verdict' }).entities.every((e) => e.kind === 'verdict'));
  assert.equal(listEntities(state(), { limit: 1 }).entities.length, 1);
  assert.equal(listEntities(state(), { limit: 0 }).entities.length, 1);
  assert.equal(listEntities(state(), { limit: 99999 }).total, list.total);
});

test('an entity the indexer does not count says why', () => {
  const s = stateFrom([report(ADDR.rep82), attestation('0x00000000000000000000000000000000000000aa')]);
  const flagged = listEntities(s).entities.filter((e) => e.notCounted);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].kind, 'attestation');
  assert.match(flagged[0].notCounted!, /attester not recognised/);
});

test('GET /entities serves the list and rejects an unknown kind', async () => {
  const server = await startServer(() => state(), { port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await (await fetch(`${base}/entities?kind=report`)).json() as { entities: { kind: string }[] };
    assert.ok(ok.entities.length >= 1 && ok.entities.every((e) => e.kind === 'report'));
    assert.equal((await fetch(`${base}/entities?kind=nope`)).status, 400);
  } finally { server.close(); }
});

test('GET /entities says so when nothing is synced yet', async () => {
  const server = await startServer(() => null, { port: 0 });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/entities`)).status, 503);
  } finally { server.close(); }
});
