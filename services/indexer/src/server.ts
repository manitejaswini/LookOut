import { createServer, type Server } from 'node:http';
import { ENUMS } from '@lookout/arkiv';
import type { TargetKind } from '@lookout/core';
import { lookup, type IndexState } from './lookup.ts';

/**
 * TEMPORARY plain lookup endpoint, replaced by PIR in Phase 4.
 *
 *   GET /lookup?kind=domain&value=example.com   -> the CheckResult JSON (private: false, verified: false)
 *   GET /health                                 -> sync status
 *
 * It is NOT private by design: the caller tells it the target. For that reason it binds to 127.0.0.1 by default
 * and never logs a request URL or query string. Do not expose it publicly.
 */
export function startServer(getState: () => IndexState | null, opts: { port?: number; host?: string } = {}): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*', // the demo UI runs on another local port
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const state = getState();

    if (url.pathname === '/health') {
      return send(200, state
        ? { ok: true, entities: state.entityCount, targets: state.targets.size, dropped: state.dropped.length, block: state.timing.currentBlock, syncedAt: state.syncedAt }
        : { ok: false, error: 'not synced yet' });
    }

    if (url.pathname === '/lookup') {
      if (!state) return send(503, { error: 'not synced yet' });
      const kind = url.searchParams.get('kind') ?? '';
      const value = url.searchParams.get('value') ?? '';
      if (!(ENUMS.targetKind as readonly string[]).includes(kind)) return send(400, { error: `kind must be one of ${ENUMS.targetKind.join(', ')}` });
      try {
        return send(200, lookup(state, kind as TargetKind, value));
      } catch (e) {
        return send(400, { error: e instanceof Error ? e.message : 'invalid target' });
      }
    }

    return send(404, { error: 'not found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', () => resolve(server));
  });
}
