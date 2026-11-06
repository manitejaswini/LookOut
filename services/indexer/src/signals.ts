import { reportWeight, verifyOwnerProof, type ScoringInput, type Signal } from '@lookout/core';
import { findSource, reputationOf, sourceIdx, type Registry } from './registry.ts';
import type { BlockTiming, StoredEntity } from './types.ts';

/**
 * Turns stored entities into what scoring needs, per target. This is where the trusted-writer rules live
 * (arkiv/schema.md, "Trusted writers"). Every check uses `creator`, never `owner`.
 */

const HEX32 = /^0x[0-9a-f]{64}$/;

/** One accepted signal with the extra fields the snapshot needs. */
export interface AcceptedSignal {
  entityKey: string;
  sourceType: 'community' | 'feed' | 'checker' | 'verifier';
  sourceId: string;
  sourceIdx: number; // 0 = community report
  level: 'block' | 'warn';
  weight: number;
  createdBlock: number;
  note: string;
  hasProof: boolean;
}

export interface TargetView {
  targetHash: string;
  signals: AcceptedSignal[];
  disputed: boolean;
  proof?: string;
  ruling?: 'block' | 'clear';
}

export type DropReason =
  | 'expired'
  | 'bad target hash'
  | 'untrusted verdict writer'
  | 'bad verdict fields'
  | 'attester not recognised'
  | 'ruling not from the operator'
  | 'bad ruling outcome'
  | 'superseded ruling';

export interface Dropped {
  key: string;
  kind: string;
  reason: DropReason;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function buildTargets(
  entities: StoredEntity[],
  timing: BlockTiming,
  registry: Registry,
): { targets: Map<string, TargetView>; dropped: Dropped[] } {
  const targets = new Map<string, TargetView>();
  const dropped: Dropped[] = [];
  const rulingBlock = new Map<string, number>(); // targetHash -> createdBlock of the newest accepted ruling

  const view = (hash: string): TargetView => {
    let t = targets.get(hash);
    if (!t) targets.set(hash, (t = { targetHash: hash, signals: [], disputed: false }));
    return t;
  };

  for (const e of entities) {
    const drop = (reason: DropReason) => dropped.push({ key: e.key, kind: e.kind, reason });
    if (e.expiresBlock <= timing.currentBlock) { drop('expired'); continue; }
    const hash = e.attrs.targetHash;
    if (!hash || !HEX32.test(hash)) { drop('bad target hash'); continue; }

    if (e.kind === 'report') {
      // anyone may report. A fresh wallet has reputation 0, so its report weighs 0 and can only warn
      const weight = reportWeight(reputationOf(registry, e.creator));
      view(hash).signals.push({
        entityKey: e.key, sourceType: 'community', sourceId: short(e.creator), sourceIdx: 0, level: 'block',
        weight, createdBlock: e.createdBlock, note: `report: ${e.attrs.category ?? 'unspecified'}`, hasProof: false,
      });
    } else if (e.kind === 'verdict') {
      const { sourceType, sourceId, level, proofHash, reason } = e.attrs;
      const src = findSource(registry, e.creator, sourceType ?? '', sourceId ?? '');
      if (!src) { drop('untrusted verdict writer'); continue; }
      if (level !== 'block' && level !== 'warn') { drop('bad verdict fields'); continue; }
      const idx = sourceIdx(registry, src.sourceId);
      view(hash).signals.push({
        entityKey: e.key, sourceType: src.sourceType, sourceId: src.sourceId, sourceIdx: idx, level,
        weight: 1, createdBlock: e.createdBlock, note: reason ?? '', hasProof: !!proofHash && HEX32.test(proofHash),
      });
    } else if (e.kind === 'attestation') {
      // A dispute counts if its writer is allowlisted, OR it carries a valid owner proof: a signature made with the flagged
      // address's own key (core/owner-proof.ts). The proof is pure maths, so every indexer decides the same way.
      const allowlisted = registry.attesters.includes(e.creator);
      const proved = e.attrs.claim === 'legit' && verifyOwnerProof({ targetHash: hash, creator: e.creator }, e.attrs.payload).ok;
      if (!allowlisted && !proved) { drop('attester not recognised'); continue; }
      if (e.attrs.claim === 'legit') view(hash).disputed = true;
    } else if (e.kind === 'ruling') {
      if (registry.operator === null || e.creator !== registry.operator) { drop('ruling not from the operator'); continue; }
      const outcome = e.attrs.outcome;
      if (outcome !== 'block' && outcome !== 'clear') { drop('bad ruling outcome'); continue; }
      const t = view(hash);
      const newest = rulingBlock.get(hash) ?? -1;
      if (e.createdBlock >= newest) {
        if (newest >= 0) dropped.push({ key: e.key, kind: e.kind, reason: 'superseded ruling' });
        rulingBlock.set(hash, e.createdBlock);
        t.ruling = outcome;
      } else drop('superseded ruling');
    }
  }

  // the proof text for the verdict screen comes from the strongest proof-carrying verdict
  const proofSource = new Map<string, string>();
  for (const e of entities) {
    if (e.kind !== 'verdict' || e.expiresBlock <= timing.currentBlock) continue;
    const t = targets.get(e.attrs.targetHash ?? '');
    const s = t?.signals.find((x) => x.entityKey === e.key);
    if (t && s?.hasProof && !proofSource.has(t.targetHash)) proofSource.set(t.targetHash, `${e.attrs.reason || 'proof supplied by the source'} (${s.sourceId})`);
  }
  for (const [hash, text] of proofSource) targets.get(hash)!.proof = text;

  return { targets, dropped };
}

/** The input scoreTarget wants, with ages worked out from block numbers. */
export function toScoringInput(t: TargetView | undefined, timing: BlockTiming): ScoringInput {
  if (!t) return { signals: [], disputed: false };
  const signals: Signal[] = t.signals.map((s) => ({
    entityId: s.entityKey,
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    level: s.level,
    weight: s.weight,
    ageSeconds: Math.max(0, (timing.currentBlock - s.createdBlock) * timing.blockDuration),
    note: s.note,
  }));
  return { signals, disputed: t.disputed, proof: t.proof, ruling: t.ruling };
}
