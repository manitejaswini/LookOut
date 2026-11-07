/**
 * World ID configuration for Lookout's one trust moment: joining the reviewer panel.
 * Everything comes from environment variables. The signing key is the ONLY secret, and it never leaves the server.
 *
 *   NEXT_PUBLIC_WORLD_APP_ID   app_xxxxx   from the Developer Portal (public)
 *   NEXT_PUBLIC_WORLD_RP_ID    rp_xxxxx    from the Developer Portal (public)
 *   RP_SIGNING_KEY             32-byte hex from the Developer Portal (SECRET, server only)
 *   WORLD_ID_ENVIRONMENT       production (default) | staging | sandbox
 *   WORLD_ID_ALLOW_LEGACY      optional: accept World ID 3.0 (legacy) proofs as well as 4.0. Default true, see below
 *   WORLD_ID_ACTION            optional: the action name registered in the Developer Portal (default lookout-verified-human-v1)
 *
 * `production` is the default on purpose: a deployment that forgets to set it rejects test proofs instead of accepting them.
 * Use `staging` only while testing with the World ID simulator.
 */

/** The action scopes what a proof is for. One human gets one verified-human wallet per action. */
export const HUMAN_ACTION = 'lookout-verified-human-v1';

/**
 * The action this deployment uses. World ID only accepts an action that is REGISTERED for the app in the Developer Portal, so the
 * name has to match what was registered there. WORLD_ID_ACTION sets it from the SERVER's environment (never from a request), and
 * everything that reads or writes verified humans (this config, the seat store, the operator) must use this one function.
 */
export function resolveAction(env: Record<string, string | undefined> = process.env): string {
  const v = env.WORLD_ID_ACTION?.trim();
  return v && /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(v) ? v : HUMAN_ACTION;
}

export type WorldEnvironment = 'production' | 'staging' | 'sandbox';

export interface WorldIdConfig {
  appId: `app_${string}`;
  rpId: string;
  /** hex without 0x prefix. SECRET */
  signingKeyHex: string;
  environment: WorldEnvironment;
  action: string;
  /**
   * Accept World ID 3.0 (legacy) proofs as well as 4.0. World App returns a legacy proof to people whose credential has not moved to
   * 4.0, so refusing them locks real people out. The cost, stated plainly: a human has a different nullifier under 3.0 and 4.0, so one
   * person who holds BOTH could verify two wallets. A person with a 4.0 credential always gets a 4.0 proof, so doing this takes effort.
   * Set WORLD_ID_ALLOW_LEGACY=false to require 4.0 only.
   */
  allowLegacy: boolean;
  /** POST {verifyBaseUrl}/{rpId} */
  verifyBaseUrl: string;
}

export type ConfigResult =
  | { ok: true; config: WorldIdConfig }
  /** names of missing variables and plain-language problems. Never contains a value, so it is safe to show. */
  | { ok: false; missing: string[]; problems: string[] };

export const DEFAULT_VERIFY_BASE_URL = 'https://developer.world.org/api/v4/verify';

const ENVIRONMENTS: readonly string[] = ['production', 'staging', 'sandbox'];

export function loadConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const missing: string[] = [];
  const problems: string[] = [];
  const get = (name: string) => {
    const v = env[name]?.trim();
    if (!v) missing.push(name);
    return v;
  };

  const appId = get('NEXT_PUBLIC_WORLD_APP_ID');
  const rpId = get('NEXT_PUBLIC_WORLD_RP_ID');
  const rawKey = get('RP_SIGNING_KEY');
  const environment = (env.WORLD_ID_ENVIRONMENT?.trim() || 'production').toLowerCase();

  if (appId && !/^app_[A-Za-z0-9]+$/.test(appId)) problems.push('NEXT_PUBLIC_WORLD_APP_ID should look like app_xxxxx');
  if (rpId && !/^rp_[A-Za-z0-9]+$/.test(rpId)) problems.push('NEXT_PUBLIC_WORLD_RP_ID should look like rp_xxxxx');
  if (rawKey && !/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) problems.push('RP_SIGNING_KEY should be 32 bytes of hex (64 characters)');
  if (!ENVIRONMENTS.includes(environment)) problems.push('WORLD_ID_ENVIRONMENT must be production, staging or sandbox');

  if (missing.length || problems.length) return { ok: false, missing, problems };
  return {
    ok: true,
    config: {
      appId: appId as `app_${string}`,
      rpId: rpId!,
      signingKeyHex: rawKey!.replace(/^0x/, ''),
      environment: environment as WorldEnvironment,
      action: resolveAction(env),
      allowLegacy: !['false', '0', 'no', 'off'].includes((env.WORLD_ID_ALLOW_LEGACY ?? '').trim().toLowerCase()),
      verifyBaseUrl: env.WORLD_ID_VERIFY_BASE_URL?.trim() || DEFAULT_VERIFY_BASE_URL,
    },
  };
}
