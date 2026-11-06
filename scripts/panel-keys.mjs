// Creates the panel's two secrets once and stores them in .env. Never prints a secret.
//   PANEL_PAYER_SECRET  derives each report's one-time bounty address and the opaque bounty id the escrow records
//   PANEL_ENC_SECRET    opens the sealed bounty address a reporter attaches to a report
// The PUBLIC half of the encryption key is written to app/.env.local as NEXT_PUBLIC_PAYER_ENC_KEY, so the report form can seal to it.
//
//   node scripts/panel-keys.mjs
//
// Running it again changes nothing. To rotate, delete the two lines from .env first (reports sealed to the old key become unreadable).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { payerEncryptionPublicKey } from '@lookout/stealth';

const envPath = new URL('../.env', import.meta.url);
const appEnv = new URL('../app/.env.local', import.meta.url);
const read = (u) => (existsSync(u) ? readFileSync(u, 'utf8') : '');
const has = (text, k) => new RegExp(`^${k}=.+$`, 'm').test(text);
const get = (text, k) => text.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim();

let env = read(envPath);
let created = [];
for (const k of ['PANEL_PAYER_SECRET', 'PANEL_ENC_SECRET']) {
  if (!has(env, k)) {
    env = `${env.replace(/\s*$/, '')}\n${k}=${randomBytes(32).toString('hex')}\n`;
    created.push(k);
  }
}
if (created.length) writeFileSync(envPath, env);

const enc = Uint8Array.from(Buffer.from(get(env, 'PANEL_ENC_SECRET'), 'hex'));
const pub = payerEncryptionPublicKey(enc);

let app = read(appEnv);
if (has(app, 'NEXT_PUBLIC_PAYER_ENC_KEY')) app = app.replace(/^NEXT_PUBLIC_PAYER_ENC_KEY=.*$/m, `NEXT_PUBLIC_PAYER_ENC_KEY=${pub}`);
else app = `${app.replace(/\s*$/, '')}\nNEXT_PUBLIC_PAYER_ENC_KEY=${pub}\n`;
writeFileSync(appEnv, app);

console.log(created.length ? `created ${created.join(' and ')} in .env` : 'secrets already exist in .env, left unchanged');
console.log(`public encryption key (written to app/.env.local): ${pub}`);
