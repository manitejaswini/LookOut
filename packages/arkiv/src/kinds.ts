import type { SourceType, TargetKind } from '@lookout/core';

/** The seven entity kinds. Each one is its own named Arkiv schema, see arkiv/schema.md. */
export const KINDS = [
  'report', 'verdict', 'attestation', 'stake', 'ruling', 'reputation', 'snapshot',
] as const;
export type Kind = (typeof KINDS)[number];

/** Schema version lives in the name: introduce `lookout.v1.*` instead of editing v0. */
export const SCHEMA_VERSION = 'v0';
export const schemaName = (kind: Kind): string => `lookout.${SCHEMA_VERSION}.${kind}`;

/** Enumerations stored as `str` columns. */
export const ENUMS = {
  targetKind: ['domain', 'address', 'contract'] satisfies TargetKind[],
  category: ['drainer', 'phishing', 'impersonation', 'poisoning', 'other'],
  sourceType: ['community', 'feed', 'checker', 'verifier', 'ruling'] satisfies SourceType[],
  level: ['block', 'warn'],
  claim: ['legit', 'confirmed'],
  stakeStatus: ['locked', 'returned', 'slashed'],
  outcome: ['block', 'clear'],
} as const;

export type OutcomeKind = (typeof ENUMS.outcome)[number];
