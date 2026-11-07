// Read-only: lists Lookout entities on Arkiv Rabdi, by schema, with who wrote them and when they expire.
//
//   npm run arkiv:query                 counts per schema, then the live verdicts
//   npm run arkiv:query -- report       list one kind (report | verdict | attestation | stake | ruling | reputation | snapshot)
//
// Needs ARKIV_ACCESS_KEY in .env. It sends nothing but read calls and never prints a key.
import './safe-errors.mjs';

import { existsSync } from 'node:fs';
import { createArkivReader, SCHEMAS } from '@lookout/arkiv';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY } = process.env;
if (!ARKIV_ACCESS_KEY) { console.error('Need ARKIV_ACCESS_KEY in .env'); process.exit(1); }

const client = createArkivReader({ accessKey: ARKIV_ACCESS_KEY });
const plain = (v) => (v && typeof v === 'object' && 'value' in v ? plain(v.value) : v);

async function rows(kind) {
  const { entities } = await client.select({ $key: true, $creator: true, $expiresAt: true }).from(SCHEMAS[kind]).limit(100).fetch();
  return entities;
}

const only = process.argv[2];
if (only) {
  if (!SCHEMAS[only]) { console.error(`unknown kind. One of: ${Object.keys(SCHEMAS).join(', ')}`); process.exit(1); }
  for (const e of await rows(only)) console.log(only, String(e.$key), 'creator', String(e.$creator), 'expiresAtBlock', String(plain(e.$expiresAt)));
} else {
  for (const kind of Object.keys(SCHEMAS)) {
    const list = await rows(kind);
    const writers = [...new Set(list.map((e) => String(e.$creator).toLowerCase()))];
    console.log(`${`lookout.v0.${kind}`.padEnd(24)} live: ${String(list.length).padStart(3)}   writers: ${writers.join(', ') || '-'}`);
  }
}
