// Demo agent: wants to pay three targets, asks Lookout first, aborts on block.
// Runs with no services (in-memory PIR servers): `npm run demo -w @lookout/agent-tool`.
// Pass INDEXER_URL=http://localhost:8787 to use the plain indexer instead.
import { createClient, createPirClient, fakePirWorld } from '@lookout/client';
import { FLAG, buildSnapshot, targetHash, type TargetRecord } from '@lookout/core';
import { guardTransfer } from './tool.ts';

// With no services running, the agent talks to two in-memory PIR servers holding a tiny snapshot, through
// the real private-lookup client. INDEXER_URL=http://localhost:8787 uses Dev A's plain indexer instead.
const sig = (sourceType: 'feed' | 'checker', sourceIdx: number, n: number) => ({
  sourceType, level: 'block' as const, weight: 1, sourceIdx, createdAt: Math.floor(Date.now() / 1000) - 30, entityKey: `0x${n.toString(16).padStart(64, '0')}`,
});
const records: TargetRecord[] = [
  { targetHash: targetHash('domain', 'claim-arbitrum-airdrop.xyz'), flags: FLAG.proof, signals: [sig('feed', 1, 1), sig('checker', 2, 2)] },
];
const snap = buildSnapshot('snap-demo', records, 256);
const world = fakePirWorld(snap);

const client = process.env.INDEXER_URL
  ? createClient({ indexerUrl: process.env.INDEXER_URL })
  : createPirClient({ pairs: [{ a: 'http://server-a.demo', b: 'http://server-b.demo' }], fetch: world.fetch });

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
