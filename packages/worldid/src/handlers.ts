import { signRequest } from '@worldcoin/idkit-core/signing';
import { loadConfig, type ConfigResult } from './config.ts';
import { enrollReviewer } from './enroll.ts';
import type { SeatStore } from './store.ts';
import { normalizeWallet, WorldIdError } from './verify.ts';

/**
 * HTTP handlers as plain Request -> Response functions, so they are tested without Next and mounted by thin route files.
 *
 *   GET  /api/worldid/status        is World ID configured? (names of missing variables only, never a value)
 *   POST /api/worldid/rp-signature  signs a proof request. The ACTION IS FIXED SERVER-SIDE, never taken from the client
 *   POST /api/worldid/verify        { wallet, idkitResponse } -> verify the proof, grant or refuse the seat
 *   GET  /api/worldid/seat?wallet=  does this wallet hold a seat? plus the seat count. Never returns a nullifier
 */

export interface HandlerDeps {
  config: () => ConfigResult;
  store: () => SeatStore;
  fetchImpl?: typeof fetch;
  /** per-client rate limiter. Omit to disable (tests) */
  limiter?: { rpSignature: Limiter; verify: Limiter };
}

export type Limiter = (key: string) => boolean;

/** A small fixed-window limiter. In memory, so it limits one server process. Enough to stop a loop hammering World. */
export function createLimiter(max: number, windowMs: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return (key) => {
    const t = now();
    const h = hits.get(key);
    if (!h || t >= h.resetAt) {
      hits.set(key, { n: 1, resetAt: t + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

const MAX_BODY_BYTES = 64 * 1024; // a World ID proof is a few KB

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const fail = (status: number, error: string, message: string) => json({ error, message }, status);

const clientKey = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new WorldIdError('bad_payload', 'request body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new WorldIdError('bad_payload', 'body must be JSON');
  }
}

function notConfigured(c: Extract<ConfigResult, { ok: false }>): Response {
  return json({ error: 'not_configured', message: 'World ID is not configured on this server', missing: c.missing, problems: c.problems }, 503);
}

export const defaultDeps = (over: Partial<HandlerDeps> & Pick<HandlerDeps, 'store'>): HandlerDeps => ({
  config: () => loadConfig(),
  limiter: { rpSignature: createLimiter(30, 60_000), verify: createLimiter(10, 60_000) },
  ...over,
});

export async function handleStatus(_req: Request, deps: HandlerDeps): Promise<Response> {
  const c = deps.config();
  if (!c.ok) return json({ configured: false, missing: c.missing, problems: c.problems });
  return json({ configured: true, environment: c.config.environment, action: c.config.action, seats: deps.store().count(c.config.action) });
}

export async function handleRpSignature(req: Request, deps: HandlerDeps): Promise<Response> {
  const c = deps.config();
  if (!c.ok) return notConfigured(c);
  if (deps.limiter && !deps.limiter.rpSignature(clientKey(req))) return fail(429, 'rate_limited', 'too many requests, slow down');
  // the client may send an action, but it is IGNORED: the server only ever signs its own fixed action
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: c.config.signingKeyHex, action: c.config.action });
  return json({
    rp_context: { rp_id: c.config.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
    app_id: c.config.appId,
    action: c.config.action,
    environment: c.config.environment,
  });
}

export async function handleVerify(req: Request, deps: HandlerDeps): Promise<Response> {
  const c = deps.config();
  if (!c.ok) return notConfigured(c);
  if (deps.limiter && !deps.limiter.verify(clientKey(req))) return fail(429, 'rate_limited', 'too many requests, slow down');
  try {
    const body = (await readJson(req)) as { wallet?: unknown; idkitResponse?: unknown } | null;
    if (!body || typeof body !== 'object') throw new WorldIdError('bad_payload', 'body must be an object');
    const result = await enrollReviewer(
      { payload: body.idkitResponse, wallet: body.wallet },
      { config: c.config, store: deps.store(), fetchImpl: deps.fetchImpl },
    );
    // a second wallet from the same human, or a wallet that belongs to someone else, is a real refusal, not an error
    if (result.status === 'human_already_enrolled') {
      return json({ error: 'human_already_enrolled', message: 'This human already holds a reviewer seat with another wallet. One human, one seat.', ...result }, 409);
    }
    if (result.status === 'wallet_taken') {
      return json({ error: 'wallet_taken', message: 'This wallet already holds a seat for a different person.', ...result }, 409);
    }
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof WorldIdError) return fail(e.status, e.code, e.message);
    return fail(500, 'internal_error', 'something went wrong, nothing was changed');
  }
}

export async function handleSeat(req: Request, deps: HandlerDeps): Promise<Response> {
  const c = deps.config();
  if (!c.ok) return notConfigured(c);
  try {
    const wallet = normalizeWallet(new URL(req.url).searchParams.get('wallet'));
    const store = deps.store();
    return json({ wallet, seated: store.hasSeat(wallet, c.config.action), seats: store.count(c.config.action) });
  } catch (e) {
    if (e instanceof WorldIdError) return fail(e.status, e.code, e.message);
    return fail(500, 'internal_error', 'something went wrong');
  }
}
