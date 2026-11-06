// Attack simulation (PRD "Testing"): fresh and farmed wallets flag a legitimate domain, and flood a real scam.
// Every scenario goes through the real thing end to end: signals -> snapshot table (with its 4-signal cap) ->
// two in-memory PIR servers -> the real private-lookup client -> the scoring rule.
// Exits non-zero if any attack that must stay at warn gets further, or hides a real block.
//   npm run attack
import { createPirClient, fakePirWorld } from '@lookout/client';
import {
  CONFIG, FLAG, buildSnapshot, reportWeight, targetHash,
  type SnapshotSignal, type SourceType, type TargetRecord, type Verdict,
} from '@lookout/core';

const TARGET = 'orbit-bridge.app'; // the one under attack in every scenario

let counter = 0;
const key = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
/** An entity key whose sort order we choose: attackers can grind keys, so assume the worst. */
const lowKey = () => key(++counter);
const highKey = () => key(0xf000_0000_0000 + ++counter);
const signal = (sourceType: SourceType, weight: number, entityKey: string, level: 'block' | 'warn' = 'block'): SnapshotSignal =>
  ({ sourceType, level, weight, sourceIdx: sourceType === 'community' ? 0 : 1, createdAt: Math.floor(Date.now() / 1000) - 60, entityKey });
const wallets = (n: number, rep: number, keyFor = lowKey): SnapshotSignal[] =>
  Array.from({ length: n }, () => signal('community', reportWeight(rep), keyFor()));

interface Scenario {
  name: string;
  flags?: number;
  signals: SnapshotSignal[];
  deposits: number; // reports filed, each puts CONFIG.DEPOSIT_ETH at risk
  must: Verdict;
  why: string;
}

const SCENARIOS: Scenario[] = [
  { name: '1,000 fresh wallets (rep 0)', signals: wallets(1000, 0), deposits: 1000, must: 'warn', why: 'every report weighs 0' },
  { name: '1,000 wallets, half of cap', signals: wallets(1000, CONFIG.REP_CAP / 2), deposits: 1000, must: 'warn', why: 'one source type, however many reports' },
  { name: '1,000 farmed wallets (full rep)', signals: wallets(1000, CONFIG.REP_CAP), deposits: 1000, must: 'warn', why: 'community alone can never reach two types' },
  {
    name: '1,000 fresh + owner attestation', flags: FLAG.disputed,
    signals: [...wallets(1000, 0), signal('verifier', 0.2, lowKey(), 'warn')], deposits: 1000, must: 'warn', why: 'dispute keeps it at warn, never auto-cleared',
  },
  {
    name: '1,000 farmed + weak outside signal',
    signals: [...wallets(1000, CONFIG.REP_CAP), signal('feed', CONFIG.THRESHOLD - 0.05, highKey())], deposits: 1000, must: 'warn', why: 'second type is below the strong threshold',
  },
  {
    name: 'FLOOD: 1,000 farmed wallets try to push a real scam\'s feed + checker signals out of the table',
    signals: [...wallets(1000, CONFIG.REP_CAP), signal('feed', 1, highKey()), signal('checker', 1, highKey())], deposits: 1000, must: 'block',
    why: 'the table keeps the strongest signal of every source type, so the flood cannot hide them',
  },
  {
    name: 'KNOWN LIMIT: 1 farmed wallet + a real feed listing',
    signals: [...wallets(1, CONFIG.REP_CAP), signal('feed', 1, highKey())], deposits: 1, must: 'block',
    why: 'two independent strong types is what block means; the owner must dispute',
  },
];

async function run(s: Scenario) {
  const rec: TargetRecord = { targetHash: targetHash('domain', TARGET), flags: s.flags ?? 0, signals: s.signals };
  const snap = buildSnapshot('snap-sim', [rec], 256);
  const world = fakePirWorld(snap);
  const client = createPirClient({ pairs: [{ a: 'http://a.sim', b: 'http://b.sim' }], fetch: world.fetch, publishedRoots: async () => [snap.root] });
  return client.checkTarget(TARGET);
}

let failed = 0;
console.log(`Target: ${TARGET}. Deposit per report: ${CONFIG.DEPOSIT_ETH} ETH. Threshold ${CONFIG.THRESHOLD}, ${CONFIG.MIN_STRONG_TYPES} strong types to block.\n`);
console.log('verdict  expected  ok   deposits at risk  scenario');
for (const s of SCENARIOS) {
  const r = await run(s);
  const ok = r.verdict === s.must;
  if (!ok) failed++;
  const deposits = `${(s.deposits * CONFIG.DEPOSIT_ETH).toFixed(2)} ETH`;
  console.log(`${r.verdict.padEnd(8)} ${s.must.padEnd(9)} ${ok ? 'yes ' : 'NO  '} ${deposits.padEnd(17)} ${s.name}  (${s.why})`);
}
console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nAll scenarios behaved as designed.');
process.exit(failed ? 1 : 0);
