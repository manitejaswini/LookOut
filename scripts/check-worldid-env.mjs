// Checks app/.env.local for World ID without ever printing a secret.
//
//   node scripts/check-worldid-env.mjs [expected signer address]
//
// If you pass the signer address shown in the World Developer Portal, it also confirms that RP_SIGNING_KEY is the key
// that belongs to that address (an Ethereum address is derived from the key, so a mismatch means the wrong key was pasted).

import { existsSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

const file = new URL('../app/.env.local', import.meta.url);
if (!existsSync(file)) { console.log('app/.env.local does not exist'); process.exit(1); }
process.loadEnvFile(file);

const v = (n) => (process.env[n] ?? '').trim();
const appId = v('NEXT_PUBLIC_WORLD_APP_ID'), rpId = v('NEXT_PUBLIC_WORLD_RP_ID'), key = v('RP_SIGNING_KEY'), env = v('WORLD_ID_ENVIRONMENT');

const ok = (cond, text) => console.log(cond ? '  ok   ' : '  FIX  ', text);
console.log('app/.env.local');
ok(/^app_[A-Za-z0-9]+$/.test(appId), `NEXT_PUBLIC_WORLD_APP_ID  ${appId ? `set, starts with "${appId.slice(0, 4)}", ${appId.length} characters` : 'EMPTY'}`);
ok(/^rp_[A-Za-z0-9]+$/.test(rpId), `NEXT_PUBLIC_WORLD_RP_ID   ${rpId ? `set, starts with "${rpId.slice(0, 3)}", ${rpId.length} characters` : 'EMPTY'}`);
const keyOk = /^(0x)?[0-9a-fA-F]{64}$/.test(key);
ok(keyOk, `RP_SIGNING_KEY           ${key ? `set, ${key.replace(/^0x/, '').length} hex characters (need 64)` : 'EMPTY'}`);
ok(['production', 'staging', 'sandbox', ''].includes(env.toLowerCase()), `WORLD_ID_ENVIRONMENT      ${env || '(empty, will default to production)'}`);

const expected = process.argv[2];
if (expected && keyOk) {
  const derived = privateKeyToAccount(`0x${key.replace(/^0x/, '')}`).address;
  const match = derived.toLowerCase() === expected.toLowerCase();
  console.log(match
    ? `\nThe signing key matches the signer address ${expected}. Right key.`
    : `\nMISMATCH: the signing key in the file does NOT belong to ${expected}.\n  The address it produces starts ${derived.slice(0, 8)}…${derived.slice(-4)}. The wrong key was probably pasted.`);
} else if (expected) {
  console.log('\nCannot compare the signer address yet: the signing key is missing or malformed.');
}
