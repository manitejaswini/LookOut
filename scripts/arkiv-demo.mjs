// Live end-to-end check of the real writers on Rabdi, using the throwaway test wallet in .env.
//
//   npm run arkiv:demo
//
// Writes one report, one verdict and one attestation for a reserved .example domain, refreshes the
// verdict, and reads all three back by targetHash. It never prints a key.
import './safe-errors.mjs';

import { existsSync } from 'node:fs';
import { eq } from '@arkiv-network/sdk/query';
import { targetHash } from '@lookout/core';
import { SCHEMAS, createArkivClients, createAttestation, createReport, createVerdict, refreshVerdict } from '@lookout/arkiv';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY) {
  console.error('Need ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env (see .env.example)');
  process.exit(1);
}

const { address, publicClient, writer } = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const DOMAIN = 'lookout-demo-airdrop.example';
const hash = targetHash('domain', DOMAIN);
const before = await publicClient.getBalance({ address });
console.log('wallet', address, '| target', DOMAIN, '\ntargetHash', hash);

const report = await createReport(writer, { kind: 'domain', value: DOMAIN, category: 'drainer' });
console.log('\nreport      ', report.entityKey, '| reportId', report.reportId);

const verdict = await createVerdict(writer, {
  kind: 'domain', value: DOMAIN, sourceType: 'checker', sourceId: 'lookout-checker', level: 'block',
  proofHash: `0x${'11'.repeat(32)}`, reason: 'demo: matches a drainer bytecode pattern',
});
console.log('verdict     ', verdict.entityKey);

const attestation = await createAttestation(writer, { kind: 'domain', value: DOMAIN, claim: 'legit' });
console.log('attestation ', attestation.entityKey);

const refreshed = await refreshVerdict(writer, verdict.entityKey);
console.log('\nverdict refreshed, new expiresAt block:', refreshed.expiresAt);

console.log('\nread back by targetHash (an indexed attribute):');
for (const kind of ['report', 'verdict', 'attestation']) {
  const { entities } = await publicClient
    .select({ $key: true, $creator: true, $expiresAt: true })
    .from(SCHEMAS[kind])
    .where(eq('targetHash', hash))
    .fetch();
  const mine = entities.filter((e) => String(e.$creator).toLowerCase() === address.toLowerCase());
  console.log(`  ${kind.padEnd(12)} found ${entities.length}, created by our wallet: ${mine.length}`);
}

const after = await publicClient.getBalance({ address });
console.log('\nspent', (Number(before - after) / 1e18).toString(), 'tGLM');
