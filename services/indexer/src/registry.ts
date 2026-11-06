import { readFileSync } from 'node:fs';

/**
 * The indexer's trust configuration. Arkiv says who CREATED an entity, not whether they were ALLOWED to,
 * so every indexer applies the same rules from the same list (arkiv/schema.md, "Trusted writers").
 *
 * - sources:    wallets allowed to write verdicts, each tied to ONE sourceId and sourceType.
 *               A source's position (plus one) is its `sourceIdx` in the snapshot. 0 means "community report".
 * - attesters:  PLACEHOLDER allowlist of wallets whose attestations are honoured. Real proof of control
 *               (deployer signature, ENS, DNS) is still an open question, so until it exists an attestation
 *               from anyone else is ignored.
 * - indexers:   wallets allowed to publish `snapshot` roots, each tied to ONE indexerId. A client trusts a table only if
 *               its root was published by one of these (arkiv/snapshot-format.md, "Publishing on Arkiv").
 * - operator:      the one wallet whose rulings count. null means no rulings are honoured.
 * - reputation: the reputation checkpoint, address -> score. Unknown wallets are 0, so a fresh wallet weighs 0.
 *               All indexers must use the same checkpoint or their snapshot roots will differ.
 */
export interface RegistrySource {
  sourceId: string;
  sourceType: 'feed' | 'checker' | 'verifier';
  address: string; // lowercase
}

export interface RegistryIndexer {
  indexerId: string;
  address: string; // lowercase
}

export interface Registry {
  sources: RegistrySource[];
  indexers: RegistryIndexer[];
  attesters: string[]; // lowercase
  operator: string | null; // lowercase
  reputation: Record<string, number>; // lowercase address -> score
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOURCE_TYPES = ['feed', 'checker', 'verifier'] as const;

function address(name: string, v: unknown): string {
  if (typeof v !== 'string' || !ADDRESS.test(v)) throw new Error(`registry: ${name} must be a 0x address, got ${JSON.stringify(v)}`);
  return v.toLowerCase();
}

export function parseRegistry(input: unknown): Registry {
  if (typeof input !== 'object' || input === null) throw new Error('registry: expected an object');
  const j = input as Record<string, unknown>;

  const rawSources = Array.isArray(j.sources) ? j.sources : [];
  const seen = new Set<string>();
  const sources = rawSources.map((s, i): RegistrySource => {
    const o = (s ?? {}) as Record<string, unknown>;
    const sourceType = o.sourceType;
    if (!(SOURCE_TYPES as readonly unknown[]).includes(sourceType)) throw new Error(`registry: sources[${i}].sourceType must be feed, checker or verifier`);
    if (typeof o.sourceId !== 'string' || !o.sourceId) throw new Error(`registry: sources[${i}].sourceId is required`);
    if (seen.has(o.sourceId)) throw new Error(`registry: duplicate sourceId ${o.sourceId}`);
    seen.add(o.sourceId);
    return { sourceId: o.sourceId, sourceType: sourceType as RegistrySource['sourceType'], address: address(`sources[${i}].address`, o.address) };
  });
  if (sources.length >= 65535) throw new Error('registry: too many sources for a 2-byte sourceIdx');

  const seenIndexers = new Set<string>();
  const indexers = (Array.isArray(j.indexers) ? j.indexers : []).map((x, i): RegistryIndexer => {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.indexerId !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(o.indexerId)) throw new Error(`registry: indexers[${i}].indexerId must be 1 to 64 of a-z 0-9 . _ -`);
    if (seenIndexers.has(o.indexerId)) throw new Error(`registry: duplicate indexerId ${o.indexerId}`);
    seenIndexers.add(o.indexerId);
    return { indexerId: o.indexerId, address: address(`indexers[${i}].address`, o.address) };
  });

  const attesters = (Array.isArray(j.attesters) ? j.attesters : []).map((a, i) => address(`attesters[${i}]`, a));
  const operator = j.operator == null ? null : address('operator', j.operator);

  const reputation: Record<string, number> = {};
  for (const [a, score] of Object.entries((j.reputation ?? {}) as Record<string, unknown>)) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) throw new Error(`registry: reputation for ${a} must be a number >= 0`);
    reputation[address('reputation key', a)] = score;
  }
  return { sources, indexers, attesters, operator, reputation };
}

export function loadRegistry(path: string | URL = new URL('../registry.json', import.meta.url)): Registry {
  return parseRegistry(JSON.parse(readFileSync(path, 'utf8')));
}

/** The source this wallet is registered as, if it is allowed to write a verdict with this type and id. */
export function findSource(reg: Registry, creator: string, sourceType: string, sourceId: string): RegistrySource | undefined {
  const c = creator.toLowerCase();
  return reg.sources.find((s) => s.address === c && s.sourceType === sourceType && s.sourceId === sourceId);
}

/** 1-based position in the source list. 0 is reserved for community reports. Returns -1 if not registered. */
export function sourceIdx(reg: Registry, sourceId: string): number {
  const i = reg.sources.findIndex((s) => s.sourceId === sourceId);
  return i < 0 ? -1 : i + 1;
}

export const reputationOf = (reg: Registry, wallet: string): number => reg.reputation[wallet.toLowerCase()] ?? 0;
