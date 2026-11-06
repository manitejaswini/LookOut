// Shared test fixtures. Not a test file itself (no .test.ts suffix), so the runner does not execute it.

import { targetHash } from '@lookout/core';
import { parseRegistry, type Registry } from './registry.ts';
import type { BlockTiming, StoredEntity } from './types.ts';

export const timing: BlockTiming = { currentBlock: 100_000, currentBlockTime: 1_800_000_000, blockDuration: 2 };

export const ADDR = {
  checker: '0x1111111111111111111111111111111111111111',
  feed: '0x2222222222222222222222222222222222222222',
  verifier: '0x3333333333333333333333333333333333333333',
  attester: '0x4444444444444444444444444444444444444444',
  panel: '0x5555555555555555555555555555555555555555',
  rep82: '0x6666666666666666666666666666666666666666',
  rep100: '0x7777777777777777777777777777777777777777',
  stranger: '0x8888888888888888888888888888888888888888',
};

export const registry: Registry = parseRegistry({
  sources: [
    { sourceId: 'openfeed-demo', sourceType: 'feed', address: ADDR.feed },
    { sourceId: 'lookout-checker', sourceType: 'checker', address: ADDR.checker },
    { sourceId: 'partner-verifier', sourceType: 'verifier', address: ADDR.verifier },
  ],
  attesters: [ADDR.attester],
  panel: ADDR.panel,
  reputation: { [ADDR.rep82]: 82, [ADDR.rep100]: 100 },
});

export const DOMAIN = 'claim-arbitrum-airdrop.xyz';
export const H = targetHash('domain', DOMAIN);

let counter = 0;
export const nextKey = () => `0x${(++counter).toString(16).padStart(64, '0')}`;

const base = (kind: StoredEntity['kind'], creator: string, attrs: Record<string, string>, o: { created?: number; expires?: number; key?: string } = {}): StoredEntity => ({
  key: o.key ?? nextKey(),
  kind,
  creator,
  owner: creator,
  createdBlock: o.created ?? 99_000,
  expiresBlock: o.expires ?? 200_000,
  attrs,
});

type Opts = { created?: number; expires?: number; key?: string };

export const report = (creator: string, target = H, o: Opts & { category?: string } = {}) =>
  base('report', creator, { reportId: '0'.repeat(32), targetHash: target, targetKind: 'domain', category: o.category ?? 'drainer' }, o);

export const verdict = (
  creator: string,
  v: { sourceType: string; sourceId: string; level?: string; proofHash?: string; reason?: string; target?: string },
  o: Opts = {},
) =>
  base('verdict', creator, {
    targetHash: v.target ?? H, sourceType: v.sourceType, sourceId: v.sourceId, level: v.level ?? 'block',
    ...(v.proofHash ? { proofHash: v.proofHash } : {}), ...(v.reason ? { reason: v.reason } : {}),
  }, o);

export const attestation = (creator: string, claim = 'legit', target = H, o: Opts = {}) =>
  base('attestation', creator, { targetHash: target, claim }, o);

export const ruling = (creator: string, outcome: string, target = H, o: Opts = {}) =>
  base('ruling', creator, { caseId: 'c'.repeat(16), targetHash: target, outcome }, o);

export const PROOF = `0x${'11'.repeat(32)}`;
export const feedVerdict = (o: Opts = {}) => verdict(ADDR.feed, { sourceType: 'feed', sourceId: 'openfeed-demo' }, o);
export const checkerVerdict = (withProof = true, o: Opts = {}) =>
  verdict(ADDR.checker, { sourceType: 'checker', sourceId: 'lookout-checker', proofHash: withProof ? PROOF : undefined, reason: 'matches a drainer bytecode pattern' }, o);

/** a distinct address for fresh-wallet simulations */
export const freshWallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
