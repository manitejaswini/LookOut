import './safe-errors.mjs';
// DEMO ONLY. Plays the part of a trusted source: writes a block verdict about a target, as the registered `lookout-checker`.
//
//   npm run demo:flag -- my-test.example          a domain
//   npm run demo:flag -- 0x1234...                an address
//
// Use it right AFTER filing a report on that target, so the operator sees a trusted source corroborate it. The verdict says
// "DEMO FIXTURE" and expires on its own after 6 hours. Never use this to flag a real site.

import { existsSync } from 'node:fs';
import { createArkivClients, createVerdict } from '@lookout/arkiv';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) { console.error('Need ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env'); process.exit(1); }

const value = process.argv[2];
if (!value) { console.error('usage: npm run demo:flag -- <domain or 0x address>'); process.exit(1); }
const kind = /^0x[0-9a-fA-F]{40}$/.test(value) ? 'address' : 'domain';

const { writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
let lastError;
for (let i = 1; i <= 5; i++) {
  try {
    const out = await createVerdict(writer, { kind, value, sourceType: 'checker', sourceId: 'lookout-checker', level: 'block', proofHash: `0x${'11'.repeat(32)}`, reason: 'DEMO FIXTURE: stands in for a real finding' });
    console.log(`flagged ${kind} ${value} as the demo checker (entity ${out.entityKey.slice(0, 14)}…)`);
    process.exit(0);
  } catch (e) { lastError = e; await new Promise((r) => setTimeout(r, 4000)); } // the operator writes from the same wallet, so a collision is possible
}
throw lastError;
