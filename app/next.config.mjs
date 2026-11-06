import { readFileSync } from 'node:fs';

// The indexers a client trusts to publish snapshot roots come from the same registry file the indexer uses,
// so there is one list. It is public addresses only. Baked into the client bundle at build time.
const registry = JSON.parse(readFileSync(new URL('../services/indexer/registry.json', import.meta.url), 'utf8'));
const sourceNames = (registry.sources ?? []).map((s) => s.sourceId);
const trustedIndexers = (registry.indexers ?? []).map((i) => ({ indexerId: i.indexerId, address: String(i.address).toLowerCase() }));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // workspace packages are shipped as TypeScript source
  transpilePackages: ['@lookout/core', '@lookout/client', '@lookout/arkiv', '@lookout/pir', '@lookout/worldid'],
  env: { NEXT_PUBLIC_TRUSTED_INDEXERS: JSON.stringify(trustedIndexers), NEXT_PUBLIC_SOURCES: JSON.stringify(sourceNames) },
};
export default nextConfig;
