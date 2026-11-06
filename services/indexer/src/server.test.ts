import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { targetHash } from '@lookout/core';
import { buildTargets } from './signals.ts';
import { startServer } from './server.ts';
import type { IndexState } from './lookup.ts';
import { ADDR, DOMAIN, attestation, checkerVerdict, feedVerdict, registry, report, timing, verdict } from './fixtures.ts';

function stateFrom(entities: Parameters<typeof buildTargets>[0]): IndexState {
  const { targets, dropped } = buildTargets(entities, timing, registry);
  return { targets, dropped, timing, entityCount: entities.length, syncedAt: 1 };
}

async function withServer(state: IndexState | null, fn: (base: string) => Promise<void>) {
  const server = await startServer(() => state, { port: 0 });
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const airdrop = () => stateFrom([report(ADDR.rep82), feedVerdict(), checkerVerdict(true), attestation(ADDR.attester)]);

test('GET /lookup returns the block verdict for the fake airdrop, with reasons and entity ids', async () => {
  await withServer(airdrop(), async (base) => {
    const res = await fetch(`${base}/lookup?kind=domain&value=${encodeURIComponent(`https://${DOMAIN}/claim`)}`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown> & { reasons: { entityId: string; sourceType: string }[] };
    assert.equal(body.verdict, 'block');
    assert.equal(body.disputed, true);
    assert.equal(body.targetHash, targetHash('domain', DOMAIN));
    assert.equal(body.reasons.length, 3);
    assert.match(body.reasons[0].entityId, /^0x[0-9a-f]{64}$/);
  });
});

test('the plain lookup says honestly that it is not private and not verified', async () => {
  await withServer(airdrop(), async (base) => {
    const body = await (await fetch(`${base}/lookup?kind=domain&value=${DOMAIN}`)).json() as Record<string, unknown>;
    assert.equal(body.private, false);
    assert.equal(body.verified, false);
    assert.equal(body.snapshotId, 'plain-100000');
  });
});

test('an unlisted target is unknown, never safe', async () => {
  await withServer(airdrop(), async (base) => {
    const body = await (await fetch(`${base}/lookup?kind=domain&value=my-local-bakery.in`)).json() as Record<string, unknown>;
    assert.equal(body.verdict, 'unknown');
    assert.deepEqual(body.reasons, []);
  });
});

test('addresses and contracts are looked up too, and checksum case does not matter', async () => {
  const addr = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
  const h = targetHash('address', addr);
  const state = stateFrom([report(ADDR.rep82, h), verdict(ADDR.feed, { sourceType: 'feed', sourceId: 'openfeed-demo', target: h })]);
  await withServer(state, async (base) => {
    for (const [kind, value] of [['address', addr], ['contract', addr.toUpperCase().replace('0X', '0x')]]) {
      const body = await (await fetch(`${base}/lookup?kind=${kind}&value=${value}`)).json() as { verdict: string; targetHash: string };
      assert.equal(body.verdict, 'block', kind);
      assert.equal(body.targetHash, h, kind);
    }
  });
});

test('bad input is a 400 with a message, never a crash', async () => {
  await withServer(airdrop(), async (base) => {
    for (const q of ['kind=website&value=a.example', 'kind=domain&value=localhost', 'kind=domain&value=', 'kind=address&value=0x123', 'value=a.example']) {
      const res = await fetch(`${base}/lookup?${q}`);
      assert.equal(res.status, 400, q);
      assert.ok(typeof (await res.json() as { error: string }).error === 'string');
    }
  });
});

test('only GET is allowed, unknown paths are 404, and CORS lets the demo UI call it', async () => {
  await withServer(airdrop(), async (base) => {
    assert.equal((await fetch(`${base}/lookup?kind=domain&value=a.example`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const ok = await fetch(`${base}/lookup?kind=domain&value=a.example`);
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
  });
});

test('/health reports sync status, and before the first sync lookups are a 503', async () => {
  await withServer(airdrop(), async (base) => {
    const h = await (await fetch(`${base}/health`)).json() as Record<string, unknown>;
    assert.equal(h.ok, true);
    assert.equal(h.targets, 1);
    assert.equal(h.block, 100_000);
  });
  await withServer(null, async (base) => {
    assert.equal((await fetch(`${base}/lookup?kind=domain&value=a.example`)).status, 503);
    assert.equal((await (await fetch(`${base}/health`)).json() as { ok: boolean }).ok, false);
  });
});

test('it listens on loopback by default, not on every interface', async () => {
  const server = await startServer(() => null, { port: 0 });
  try {
    assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
  } finally {
    server.close();
  }
});
