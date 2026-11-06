// Demo agent: wants to pay three targets, asks Lookout first, aborts on block.
// Runs against a local fake indexer so it works with no services: `npm run demo -w @lookout/agent-tool`.
// Pass INDEXER_URL=http://localhost:8787 to use a real one instead.
import { createClient } from '@lookout/client';
import type { LookupResponse } from '@lookout/client';
import { targetHash } from '@lookout/core';
import type { Signal } from '@lookout/core';
import { guardTransfer } from './tool.ts';

const s = (sourceType: Signal['sourceType']): Signal => ({
  entityId: `ark_${sourceType}`, sourceType, sourceId: 'demo', level: 'block', weight: 1, ageSeconds: 30, note: '',
});
const SCAM = targetHash('domain', 'claim-arbitrum-airdrop.xyz');
const fakeIndexer = (async (url: string) => {
  const h = new URL(url).searchParams.get('targetHash');
  const body: LookupResponse = { snapshotId: 'snap-demo', disputed: false, signals: h === SCAM ? [s('feed'), s('checker')] : [] };
  return { ok: true, status: 200, json: async () => body } as Response;
}) as unknown as typeof fetch;

const client = process.env.INDEXER_URL
  ? createClient({ indexerUrl: process.env.INDEXER_URL })
  : createClient({ indexerUrl: 'http://fake', fetch: fakeIndexer });

for (const task of [
  { say: 'Pay 1.2 ETH to the airdrop claim page', value: 'claim-arbitrum-airdrop.xyz' },
  { say: 'Pay 0.002 ETH to the corner bakery', value: 'my-local-bakery.in' },
  { say: 'Pay 5 ETH to a mistyped address', value: '0x123' },
]) {
  const { call, decision } = await guardTransfer(client, { value: task.value });
  console.log(`\nAgent: ${task.say}`);
  console.log('  check_target ->', JSON.stringify(call.ok ? { verdict: call.result.verdict, verified: call.result.verified } : call));
  console.log(`  decision: ${decision.action.toUpperCase()}. ${decision.reason}`);
}
