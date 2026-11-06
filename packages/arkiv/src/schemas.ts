import { addr, bytes, defineSchema, dec, i32, str, u256 } from '@arkiv-network/sdk/schema';
import { schemaName, type Kind } from './kinds.ts';

/**
 * The nine Lookout entity schemas. One-to-one with arkiv/schema.md: change both together.
 *
 *  - `.indexed()` columns are the ones an indexer filters on. Others are stored, selectable and sortable.
 *  - Hashes and ids are lowercase hex in a `str` (0x + 64 hex = 66 bytes, under the 128-byte limit).
 *  - `payload` is the optional un-indexed `bytes` column that stands in for a "payload", because Arkiv has none.
 *  - A named schema adds the indexed `arkiv.schema` tag, so we have 31 columns to use, not 32.
 */

const report = defineSchema(schemaName('report'), {
  reportId: str().indexed(),
  targetHash: str().indexed(),
  targetKind: str().indexed(),
  category: str().indexed(),
  payload: bytes().optional(), // evidence pointer and the reporter's encrypted stealth meta-address
});

const verdict = defineSchema(schemaName('verdict'), {
  targetHash: str().indexed(),
  sourceType: str().indexed(),
  sourceId: str().indexed(),
  level: str().indexed(),
  proofHash: str().optional(), // present only when the source has re-checkable proof
  reason: str().optional(), // short text, at most 128 bytes
  payload: bytes().optional(), // pointer to the proof
});

const attestation = defineSchema(schemaName('attestation'), {
  targetHash: str().indexed(),
  claim: str().indexed(),
  payload: bytes().optional(), // proof of control: deployer signature or ENS name
});

const stake = defineSchema(schemaName('stake'), {
  reportId: str().indexed(),
  status: str().indexed(), // changed with patchEntity: locked, returned, slashed
  amountWei: u256(),
  escrowTx: str(),
});

const ruling = defineSchema(schemaName('ruling'), {
  caseId: str().indexed(),
  targetHash: str().indexed(),
  outcome: str().indexed(),
  payload: bytes().optional(), // the operator's reasons, as JSON
});

const reputation = defineSchema(schemaName('reputation'), {
  wallet: addr().indexed(),
  snapshotId: str().indexed(),
  score: dec(),
});

const snapshot = defineSchema(schemaName('snapshot'), {
  snapshotId: str().indexed(),
  bucketCount: i32(),
  rootHash: str(),
  indexerId: str().indexed(),
});

const bounty = defineSchema(schemaName('bounty'), {
  reportId: str().indexed(),
  amountTier: i32(),
  payload: bytes(), // ephemeral public key, format in arkiv/stealth-format.md
});

export const SCHEMAS = { report, verdict, attestation, stake, ruling, reputation, snapshot, bounty } as const;

export const schemaOf = <K extends Kind>(kind: K): (typeof SCHEMAS)[K] => SCHEMAS[kind];
