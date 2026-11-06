import type { ArkivEntity, Signal, Target } from '@lookout/core';
import { scoreTarget, emptyTarget } from '@lookout/core';

const sig = (
  entityId: string, sourceType: Signal['sourceType'], sourceId: string,
  level: Signal['level'], weight: number, ageSeconds: number, note: string,
): Signal => ({ entityId, sourceType, sourceId, level, weight, ageSeconds, note });

export const TARGETS: Target[] = [
  {
    kind: 'domain',
    value: 'claim-arbitrum-airdrop.xyz',
    title: 'Fake airdrop',
    blurb: 'Approve unlimited USDC spending to claim your airdrop',
    disputed: false,
    proof: 'contract matches a known drainer bytecode pattern',
    signals: [
      sig('ark_rp_91c2', 'community', '0x7a3f…c1d9', 'block', 0.82, 600, 'Victim report, drained 1.4 ETH'),
      sig('ark_vd_3e07', 'feed', 'openfeed-phishing', 'block', 1, 240, 'Listed on open phishing feed'),
      sig('ark_vd_88b1', 'checker', 'lookout-checker', 'block', 1, 95, 'Drainer bytecode pattern found'),
    ],
  },
  {
    kind: 'domain',
    value: 'uniswapp-rewards.io',
    title: 'Look-alike rewards page',
    blurb: 'Connect wallet and sign a Permit2 message',
    disputed: false,
    signals: [
      sig('ark_rp_52aa', 'community', '0x19be…44f0', 'block', 0.7, 1800, 'Typosquat of a known DEX'),
      sig('ark_rp_52ab', 'community', '0xc0de…0012', 'warn', 0.1, 1500, 'Looks suspicious'),
    ],
  },
  {
    kind: 'domain',
    value: 'orbit-bridge.app',
    title: 'Legitimate bridge, falsely flagged',
    blurb: 'Bridge 0.5 ETH to an L2',
    disputed: true,
    signals: [
      sig('ark_rp_sy01', 'community', '1,000 fresh wallets', 'block', 0, 3400, 'Coordinated flag, reputation 0'),
      sig('ark_at_7d20', 'verifier', 'owner-attestation', 'warn', 0.2, 1200, 'Owner attestation from deployer wallet'),
    ],
  },
  {
    kind: 'contract',
    value: '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08',
    title: 'Known drainer contract',
    blurb: 'Call setApprovalForAll on your NFT collection',
    disputed: false,
    ruling: 'block',
    signals: [
      sig('ark_rl_0c44', 'ruling', 'panel-case-17', 'block', 1, 86400, 'Panel ruled 4 to 1: scam'),
      sig('ark_vd_a2e5', 'checker', 'lookout-checker', 'block', 1, 90000, 'Matches drainer bytecode'),
    ],
  },
  {
    kind: 'domain',
    value: 'my-local-bakery.in',
    title: 'Corner bakery website',
    blurb: 'Pay 0.002 ETH for a pre-order',
    disputed: false,
    signals: [],
  },
];

export const findTarget = (raw: string): Target => {
  const v = raw.trim().toLowerCase();
  const hit = TARGETS.find((t) => t.value.toLowerCase() === v);
  if (hit) return hit;
  const kind = /^0x[0-9a-f]{40}$/.test(v) ? 'address' : 'domain';
  return emptyTarget(v, kind);
};

export const checkTarget = (raw: string) => scoreTarget(findTarget(raw));

export const STATS = [
  { value: '60%', label: 'of phishing domains live under 10 minutes', note: 'Why lists lag. Verify source before presenting.' },
  { value: '$83.9M', label: 'lost to EVM wallet drainers in 2025', note: 'Scam Sniffer. Down 83% on 2024.' },
  { value: '176M', label: 'onchain transactions by AI agents, May 2025 to Apr 2026', note: 'Agents are real signers.' },
];

export const FLOW = [
  ['Report', 'A reporter posts a scam report with a deposit. It is an Arkiv entity owned by their wallet and expires in 24 hours unless confirmed.'],
  ['Verdicts', 'Open feeds, our checker and other verifiers post signed verdict entities, each tagged with a source type.'],
  ['Index', 'Indexers read Arkiv, build a bucketed lookup table and publish its root hash as a snapshot entity.'],
  ['Check', 'Before signing, the wallet runs a private 2-server PIR lookup and verifies the answer against the Arkiv root.'],
  ['Dispute', 'The real owner posts an attestation from the deployer or ENS wallet. A blocking flag becomes a reviewer case.'],
  ['Settle', 'Staked, random reviewers vote hidden-then-reveal. Correct reporters get a stealth bounty. Wrong ones lose the deposit.'],
];

const now = Date.now();
const m = (min: number) => now + min * 60_000;
const h = (hrs: number) => now + hrs * 3_600_000;

export const SEED_ENTITIES: ArkivEntity[] = [
  { id: 'ark_rp_91c2', kind: 'report', owner: '0x7a3f…c1d9', attr: "targetKind=domain category=drainer", expiresAt: h(23.8) },
  { id: 'ark_vd_3e07', kind: 'verdict', owner: '0xfeed…0001', attr: 'sourceType=feed level=block', expiresAt: h(5.9) },
  { id: 'ark_vd_88b1', kind: 'verdict', owner: '0xcec4…77a2', attr: 'sourceType=checker level=block proof=0x9ab…', expiresAt: h(5.97) },
  { id: 'ark_at_7d20', kind: 'attestation', owner: '0x0b17…ens', attr: 'claim=legit target=orbit-bridge.app', expiresAt: h(24 * 29) },
  { id: 'ark_st_14f9', kind: 'stake', owner: '0xe5c0…w01', attr: 'status=locked reportId=91c2', expiresAt: h(24 * 8) },
  { id: 'ark_rl_0c44', kind: 'ruling', owner: '0xpa11…e100', attr: 'outcome=block caseId=17', expiresAt: h(24 * 89) },
  { id: 'ark_sn_0412', kind: 'snapshot', owner: '0xidx1…0a0a', attr: 'snapshotId=0412 buckets=16384', expiresAt: h(24 * 3) },
  { id: 'ark_rp_ex01', kind: 'report', owner: '0x3c9d…12ab', attr: 'targetKind=domain category=phishing', expiresAt: m(0.75) },
];
