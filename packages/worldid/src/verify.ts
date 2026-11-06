import { hashSignal, Nullifier } from '@worldcoin/idkit-core';
import type { WorldIdConfig } from './config.ts';

/**
 * Server-side verification of a World ID proof of human, for ONE purpose: granting a reviewer seat.
 *
 * What the server checks, cheapest first, before it ever calls World:
 *   1. the payload is a World ID 4.0 response for OUR action and OUR environment (a staging proof is refused in production)
 *   2. it is a proof_of_human credential, nothing weaker (no selfie check, no legacy orb proof)
 *   3. it is bound to THIS wallet: the proof's signal hash must equal hashSignal(wallet), so a proof made for one wallet
 *      cannot be replayed to seat another
 *   4. the nullifier is a valid value in the World ID field
 * Then it forwards the payload to World's verify endpoint and requires success. Whether the human is NEW is decided by the
 * seat store (one nullifier per action), not here: World verifies a proof is valid, it does not say the proof is unused.
 */

export type WorldIdErrorCode =
  | 'bad_payload'
  | 'bad_wallet'
  | 'wrong_environment'
  | 'wrong_action'
  | 'wrong_protocol'
  | 'wrong_credential'
  | 'signal_mismatch'
  | 'bad_nullifier'
  | 'verification_failed'
  | 'verifier_unreachable';

const STATUS: Record<WorldIdErrorCode, number> = {
  bad_payload: 400,
  bad_wallet: 400,
  wrong_environment: 400,
  wrong_action: 400,
  wrong_protocol: 400,
  wrong_credential: 400,
  signal_mismatch: 400,
  bad_nullifier: 400,
  verification_failed: 400,
  verifier_unreachable: 502,
};

export class WorldIdError extends Error {
  code: WorldIdErrorCode;
  status: number;
  constructor(code: WorldIdErrorCode, message: string) {
    super(message);
    this.name = 'WorldIdError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function normalizeWallet(wallet: unknown): string {
  if (typeof wallet !== 'string' || !WALLET.test(wallet.trim())) throw new WorldIdError('bad_wallet', 'wallet must be a 0x address (40 hex digits)');
  return wallet.trim().toLowerCase();
}

/**
 * One canonical key per human per action. The SDK types say a v4 nullifier is a DECIMAL string, while the integration
 * guide's example shows hex, so both are accepted. Case, leading zeros and the notation do not change the key.
 */
export function canonicalNullifier(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorldIdError('bad_nullifier', 'the proof has no nullifier');
  const s = raw.trim();
  let value: bigint;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(s)) value = BigInt(s);
    else if (/^[0-9]+$/.test(s)) value = BigInt(s);
    else throw new Error('format');
  } catch {
    throw new WorldIdError('bad_nullifier', 'the nullifier is not a number');
  }
  try {
    return Nullifier.fromHex(`0x${value.toString(16).padStart(64, '0')}`).toCanonicalString();
  } catch {
    throw new WorldIdError('bad_nullifier', 'the nullifier is outside the World ID field');
  }
}

interface ProofResponse {
  identifier?: unknown;
  signal_hash?: unknown;
  nullifier?: unknown;
  issuer_schema_id?: unknown;
  expires_at_min?: unknown;
}

interface Payload {
  protocol_version?: unknown;
  action?: unknown;
  environment?: unknown;
  responses?: unknown;
}

export interface VerifiedHuman {
  /** canonical, action-scoped. Unlinkable across apps. This is what "one human" means to Lookout */
  nullifier: string;
  issuerSchemaId: number;
  expiresAtMin?: number;
}

const PROOF_OF_HUMAN = 'proof_of_human';
const PROOF_OF_HUMAN_SCHEMA_ID = 1; // documented: 1 = proof_of_human
const VERIFY_TIMEOUT_MS = 10_000;

export async function verifyProofOfHuman(args: {
  payload: unknown;
  wallet: string;
  config: WorldIdConfig;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedHuman> {
  const { config } = args;
  const wallet = normalizeWallet(args.wallet);
  const p = args.payload as Payload | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new WorldIdError('bad_payload', 'the proof payload is missing');

  // 1. protocol, environment and action
  if (typeof p.protocol_version !== 'string' || !p.protocol_version.startsWith('4')) {
    throw new WorldIdError('wrong_protocol', 'only World ID 4.0 proofs are accepted (legacy proofs would give a second nullifier per human)');
  }
  if (p.environment !== config.environment) {
    throw new WorldIdError('wrong_environment', `this server only accepts ${config.environment} proofs`);
  }
  if (p.action !== config.action) throw new WorldIdError('wrong_action', 'the proof was made for a different action');

  // 2. the credential
  const responses = Array.isArray(p.responses) ? (p.responses as ProofResponse[]) : [];
  const item = responses.find((r) => r && typeof r === 'object' && r.identifier === PROOF_OF_HUMAN);
  if (!item || (item.issuer_schema_id !== undefined && item.issuer_schema_id !== PROOF_OF_HUMAN_SCHEMA_ID)) {
    throw new WorldIdError('wrong_credential', 'a Proof of Human credential is required');
  }

  // 3. bound to this wallet
  let signalOk = false;
  try {
    signalOk = typeof item.signal_hash === 'string' && BigInt(item.signal_hash) === BigInt(hashSignal(wallet));
  } catch {
    signalOk = false;
  }
  if (!signalOk) throw new WorldIdError('signal_mismatch', 'the proof is not bound to this wallet');

  // 4. the nullifier
  const nullifier = canonicalNullifier(item.nullifier);

  // 5. World's own check. The payload is forwarded as received, only with our expected environment set.
  const doFetch = args.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${config.verifyBaseUrl}/${encodeURIComponent(config.rpId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(p as object), environment: config.environment }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    throw new WorldIdError('verifier_unreachable', 'could not reach the World ID verifier, try again');
  }
  let body: { success?: unknown; environment?: unknown; code?: unknown; detail?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* a non-JSON body is treated as a failure below */
  }
  if (!res.ok || body.success !== true || body.environment !== config.environment) {
    const why = typeof body.code === 'string' ? body.code : typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`;
    throw new WorldIdError('verification_failed', `World ID did not accept the proof (${why.slice(0, 80)})`);
  }

  return {
    nullifier,
    issuerSchemaId: PROOF_OF_HUMAN_SCHEMA_ID,
    expiresAtMin: typeof item.expires_at_min === 'number' ? item.expires_at_min : undefined,
  };
}
