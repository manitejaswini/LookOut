// Attack simulation (PRD "Testing"): fresh and farmed wallets flag a legitimate domain.
// Runs the real client, hashing and scoring against a fake indexer that serves the attacker's
// reports. Exits non-zero if any attack that must stay at warn gets further.
//   npm run attack
import assert from 'node:assert/strict';
import { createClient } from '@lookout/client';
import type { LookupResponse } from '@lookout/client';
import { CONFIG, fakeReports, targetHash } from '@lookout/core';
import type { Signal, Verdict } from '@lookout/core';

const TARGET = 'orbit-bridge.app'; // a legitimate project
const HASH = targetHash('domain', TARGET);

const signal = (sourceType: Signal['sourceType'], weight: number, note: string): Signal => ({
  entityId: `ark_${sourceType}_x`, sourceType, sourceId: 'attacker-controlled', level: 'block', weight, ageSeconds: 60, note,
});

interface Scenario {
  name: string;
  body: Omit<LookupResponse, 'snapshotId'>;
  wallets: number;
  must: Verdict | 'not-block';
  why: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: '1,000 fresh wallets (rep 0)',
    body: { disputed: false, signals: fakeReports(1000, 0) },
    wallets: 1000, must: 'warn', why: 'every report weighs 0',
  },
  {
    name: '1,000 wallets, half of cap',
    body: { disputed: false, signals: fakeReports(1000, CONFIG.REP_CAP / 2) },
    wallets: 1000, must: 'warn', why: 'one source type, however many reports',
  },
  {
    name: '1,000 farmed wallets (full rep)',
    body: { disputed: false, signals: fakeReports(1000, CONFIG.REP_CAP) },
    wallets: 1000, must: 'warn', why: 'community alone can never reach two types',
  },
  {
    name: '1,000 fresh + owner attestation',
    body: { disputed: true, signals: [...fakeReports(1000, 0), signal('verifier', 0.2, 'owner attestation')] },
    wallets: 1000, must: 'warn', why: 'dispute keeps it at warn, never auto-cleared',
  },
  {
    name: '1,000 farmed + weak outside signal',
    body: { disputed: false, signals: [...fakeReports(1000, CONFIG.REP_CAP), signal('feed', CONFIG.THRESHOLD - 0.01, 'weak feed hit')] },
    wallets: 1000, must: 'warn', why: 'second type is below the strong threshold',
  },
  {
    name: 'KNOWN LIMIT: 1 farmed wallet + a real feed listing',
    body: { disputed: false, signals: [...fakeReports(1, CONFIG.REP_CAP), signal('feed', 1, 'legit site wrongly on an open feed')] },
    wallets: 1, must: 'block', why: 'two independent strong types is what block means; the owner must dispute',
  },
];

const client = (body: Scenario['body']) =>
  createClient({
    indexerUrl: 'http://fake-indexer',
    fetch: (async (url: string) => {
      assert(url.endsWith(`targetHash=${HASH}`), 'client must query by hash only');
      return { ok: true, status: 200, json: async () => ({ snapshotId: 'snap-sim', ...body }) } as Response;
    }) as unknown as typeof fetch,
  });

let failed = 0;
console.log(`Target: ${TARGET} (legitimate). Deposit per report: ${CONFIG.DEPOSIT_ETH} ETH. Threshold ${CONFIG.THRESHOLD}, ${CONFIG.MIN_STRONG_TYPES} strong types to block.\n`);
console.log('verdict  expected  ok   deposits at risk  scenario');
for (const s of SCENARIOS) {
  const r = await client(s.body).checkTarget(TARGET);
  const ok = s.must === 'not-block' ? r.verdict !== 'block' : r.verdict === s.must;
  if (!ok) failed++;
  const deposits = `${(s.wallets * CONFIG.DEPOSIT_ETH).toFixed(2)} ETH`;
  console.log(`${r.verdict.padEnd(8)} ${String(s.must).padEnd(9)} ${ok ? 'yes ' : 'NO  '} ${deposits.padEnd(17)} ${s.name}  (${s.why})`);
}
console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nAll scenarios behaved as designed.');
process.exit(failed ? 1 : 0);
