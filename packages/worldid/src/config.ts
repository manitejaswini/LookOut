/**
 * World ID configuration for Lookout's one trust moment: joining the reviewer panel.
 * Everything comes from environment variables. The signing key is the ONLY secret, and it never leaves the server.
 *
 *   NEXT_PUBLIC_WORLD_APP_ID   app_xxxxx   from the Developer Portal (public)
 *   NEXT_PUBLIC_WORLD_RP_ID    rp_xxxxx    from the Developer Portal (public)
 *   RP_SIGNING_KEY             32-byte hex from the Developer Portal (SECRET, server only)
 *   WORLD_ID_ENVIRONMENT       production (default) | staging | sandbox
 *
 * `production` is the default on purpose: a deployment that forgets to set it rejects test proofs instead of accepting them.
 * Use `staging` only while testing with the World ID simulator.
 */

/** The action scopes what a proof is for. One human gets one verified-human wallet per action. */
export const HUMAN_ACTION = 'lookout-verified-human-v1';

export type WorldEnvironment = 'production' | 'staging' | 'sandbox';

export interface WorldIdConfig {
  appId: `app_${string}`;
  rpId: string;
  /** hex without 0x prefix. SECRET */
  signingKeyHex: string;
  environment: WorldEnvironment;
  action: string;
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
      action: HUMAN_ACTION,
      verifyBaseUrl: env.WORLD_ID_VERIFY_BASE_URL?.trim() || DEFAULT_VERIFY_BASE_URL,
    },
  };
}
