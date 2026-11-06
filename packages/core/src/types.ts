export type TargetKind = 'domain' | 'address' | 'contract';
export type SourceType = 'community' | 'feed' | 'checker' | 'verifier' | 'ruling';
export type Verdict = 'block' | 'warn' | 'unknown';

export interface Signal {
  entityId: string;
  sourceType: SourceType;
  sourceId: string;
  level: 'block' | 'warn';
  weight: number; // 0..1, already reputation-scaled for community reports
  ageSeconds: number;
  note: string;
}

/** Everything the scoring rule needs. An indexer has only a target hash, so it builds this and nothing more. */
export interface ScoringInput {
  signals: Signal[];
  disputed: boolean;
  proof?: string; // re-checkable proof, if any
  ruling?: 'block' | 'clear';
}

/** A target as the demo UI shows it: the scoring input plus display text. */
export interface Target extends ScoringInput {
  kind: TargetKind;
  value: string;
  title: string;
  blurb: string; // what the mock wallet screen says the user is doing
}

export interface CheckResult {
  verdict: Verdict;
  disputed: boolean;
  reasons: Pick<Signal, 'sourceType' | 'sourceId' | 'level' | 'entityId' | 'ageSeconds'>[];
  snapshotId: string;
  verified: boolean;
  // extras for the UI
  headline: string;
  typeScores: Partial<Record<SourceType, number>>;
  strongTypes: number;
}

export type EntityKind =
  | 'report' | 'verdict' | 'attestation' | 'stake'
  | 'ruling' | 'reputation' | 'snapshot';

export interface ArkivEntity {
  id: string;
  kind: EntityKind;
  owner: string;
  attr: string; // plaintext attributes, shown as on Arkiv
  expiresAt: number; // epoch ms
}
