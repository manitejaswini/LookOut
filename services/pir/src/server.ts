import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Snapshot } from '@lookout/core';
import { answer } from '@lookout/pir';

/**
 * One PIR server (A or B). It holds the bucket table and answers XOR queries. It never receives
 * the target, only a random-looking bit vector. Per arkiv/snapshot-format.md the log holds the snapshot id,
 * the vector length and a short hash of the vector, never the vector itself and never the request body.
 */
export interface PirServerOptions {
  name: string;
  snapshots: Map<string, Snapshot>;
  latest: string;
  /** Called with one line per query. Defaults to console. */
  log?: (line: string) => void;
}

const MAX_BODY = 64 * 1024;

export function createPirServer(opts: PirServerOptions): Server & { recent: string[] } {
  const recent: string[] = [];
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} [${opts.name}] ${line}`;
    recent.push(stamped);
    if (recent.length > 200) recent.shift();
    (opts.log ?? console.log)(stamped);
  };

  const send = (res: ServerResponse, status: number, body: string | Uint8Array, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type,
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
      connection: 'close',
    });
    res.end(body);
  };
  const fail = (res: ServerResponse, status: number, error: string) => send(res, status, JSON.stringify({ error }));

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      let tooBig = false;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (tooBig) return; // keep draining so the 413 can be delivered, store nothing more
        if (size > MAX_BODY) { tooBig = true; chunks.length = 0; reject(new Error('body too large')); } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (req.method === 'GET' && url.pathname === '/snapshot/latest') {
        const s = opts.snapshots.get(opts.latest)!;
        return send(res, 200, JSON.stringify({ snapshotId: s.snapshotId, root: s.root, bucketCount: s.bucketCount }));
      }
      const hashes = url.pathname.match(/^\/snapshot\/([^/]+)\/hashes$/);
      if (req.method === 'GET' && hashes) {
        const s = opts.snapshots.get(decodeURIComponent(hashes[1]));
        return s ? send(res, 200, s.hashes, 'application/octet-stream') : fail(res, 404, 'unknown snapshot');
      }
      if (req.method === 'GET' && url.pathname === '/log') return send(res, 200, JSON.stringify({ server: opts.name, lines: recent }));
      if (req.method === 'POST' && url.pathname === '/pir/query') {
        const raw = await readBody(req); // a too-large body throws here and becomes a 413 below
        let body: { snapshotId?: unknown; vector?: unknown };
        try { body = JSON.parse(raw); } catch { return fail(res, 400, 'bad request body'); }
        if (typeof body.snapshotId !== 'string' || typeof body.vector !== 'string') return fail(res, 400, 'need snapshotId and vector');
        const s = opts.snapshots.get(body.snapshotId);
        if (!s) return fail(res, 404, 'unknown snapshot');
        const vector = new Uint8Array(Buffer.from(body.vector, 'base64'));
        let out: Uint8Array;
        try { out = answer(s.buckets, s.bucketCount, vector); } catch (e) { return fail(res, 400, (e as Error).message); }
        const ones = vector.reduce((n, b) => n + b.toString(2).replace(/0/g, '').length, 0);
        log(`query snapshot=${s.snapshotId} vector_bytes=${vector.length} vector_fp=${bytesToHex(keccak_256(vector).slice(0, 6))} bits_set=${ones}/${s.bucketCount}`);
        return send(res, 200, out, 'application/octet-stream');
      }
      return fail(res, 404, 'not found');
    } catch (e) {
      return fail(res, e instanceof Error && e.message === 'body too large' ? 413 : 500, (e as Error).message);
    }
  }) as Server & { recent: string[] };
  server.recent = recent;
  return server;
}
