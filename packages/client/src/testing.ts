import { answer } from '@lookout/pir';
import type { Snapshot } from '@lookout/core';

/**
 * In-memory PIR operators for tests and scripts: a `fetch` that behaves like any number of PIR servers
 * (one per base URL), each holding `snap`, running the real XOR maths, and recording every request.
 * No network. The real servers are in services/pir; this is the same protocol without the sockets.
 */
export interface FakeWorldOptions {
  tamper?: Set<string>; // base URLs whose answers are corrupted
  wrongRoot?: Set<string>; // base URLs that announce a different root
  bad?: Set<string>; // base URLs that answer 500
}

export interface SeenRequest { method: string; path: string; body: string }

export function fakePirWorld(snap: Snapshot, opts: FakeWorldOptions = {}) {
  const seen = new Map<string, SeenRequest[]>();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const base = u.origin;
    (seen.get(base) ?? seen.set(base, []).get(base)!).push({ method: init?.method ?? 'GET', path: u.pathname, body: String(init?.body ?? '') });
    const ok = (body: BodyInit | Uint8Array, type = 'application/json') => new Response(body as BodyInit, { status: 200, headers: { 'content-type': type } });
    if (opts.bad?.has(base)) return new Response('', { status: 500 });
    if (u.pathname === '/snapshot/latest') {
      return ok(JSON.stringify({ snapshotId: snap.snapshotId, root: opts.wrongRoot?.has(base) ? '0xbad' : snap.root, bucketCount: snap.bucketCount }));
    }
    if (u.pathname === `/snapshot/${snap.snapshotId}/hashes`) return ok(snap.hashes, 'application/octet-stream');
    if (u.pathname === '/pir/query') {
      const { vector } = JSON.parse(String(init!.body));
      const out = answer(snap.buckets, snap.bucketCount, new Uint8Array(Buffer.from(vector, 'base64')));
      if (opts.tamper?.has(base)) out[10] ^= 0xff;
      return ok(out, 'application/octet-stream');
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, seen };
}
