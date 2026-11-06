// Shared test fixtures. Not a test file (no .test.ts suffix), so the runner does not execute it.

import { hashSignal } from '@worldcoin/idkit-core';
import { REVIEWER_ACTION, type WorldIdConfig } from './config.ts';

export const SIGNING_KEY = 'ab'.repeat(32);

export const config: WorldIdConfig = {
  appId: 'app_testapp123',
  rpId: 'rp_testrp123',
  signingKeyHex: SIGNING_KEY,
  environment: 'staging',
  action: REVIEWER_ACTION,
  verifyBaseUrl: 'https://verify.test/api/v4/verify',
};

export const WALLET_A = '0x37324a0cc17959ee99233c8552e741519983573e';
export const WALLET_B = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';

// valid values in the World ID field (they start with 0x04 like the docs example)
export const HUMAN_1 = '0x04e5f6a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d';
export const HUMAN_2 = '0x0511223344556677889900aabbccddeeff00112233445566778899aabbccddee';

export interface PayloadOptions {
  wallet?: string;
  nullifier?: string;
  environment?: string;
  action?: string;
  protocol_version?: string;
  identifier?: string;
  issuer_schema_id?: number;
  signal_hash?: string | undefined;
  responses?: unknown;
}

/** An IDKit 4.0 proof-of-human response, shaped like the integration guide's example. */
export function payload(o: PayloadOptions = {}): Record<string, unknown> {
  return {
    protocol_version: o.protocol_version ?? '4.0',
    nonce: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    action: o.action ?? REVIEWER_ACTION,
    environment: o.environment ?? 'staging',
    responses: o.responses ?? [
      {
        identifier: o.identifier ?? 'proof_of_human',
        signal_hash: 'signal_hash' in o ? o.signal_hash : hashSignal(o.wallet ?? WALLET_A),
        proof: ['0x1a2b', '0x3c4d', '0x5e6f', '0x7a8b', '0x9c0d'],
        nullifier: o.nullifier ?? HUMAN_1,
        issuer_schema_id: o.issuer_schema_id ?? 1,
        expires_at_min: 1756166400,
      },
    ],
  };
}

export interface FakeWorld {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit; body: Record<string, unknown> }[];
}

/** A stand-in for World's verify endpoint. */
export function fakeWorld(reply: { status?: number; body?: unknown; throws?: boolean } = {}): FakeWorld {
  const calls: FakeWorld['calls'] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (reply.throws) throw new Error('ECONNREFUSED');
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? { success: true, environment: 'staging' }), {
      status: reply.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
