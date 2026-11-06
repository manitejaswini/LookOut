import { asc, gt } from '@arkiv-network/sdk/query';
import { key as keyValue } from '@arkiv-network/sdk/schema';
import { SCHEMAS } from '@lookout/arkiv';
import type { BlockTiming, IndexedKind, RawRow, ReaderClient } from './types.ts';
import { INDEXED_KINDS } from './types.ts';
import { epochOf } from './snapshot.ts';

/** Arkiv returns at most 100 rows per page (MAX_LIMIT, checked in packages/arkiv). */
export const PAGE_SIZE = 100;

/** The columns each kind needs. Only the `attestation` payload (the owner's proof of control) is read: nothing else uses a payload yet. */
export const FIELDS: Record<IndexedKind, string[]> = {
  report: ['reportId', 'targetHash', 'targetKind', 'category'],
  verdict: ['targetHash', 'sourceType', 'sourceId', 'level', 'proofHash', 'reason'],
  attestation: ['targetHash', 'claim', 'payload'],
  ruling: ['caseId', 'targetHash', 'outcome'],
  reputation: ['wallet', 'snapshotId', 'score'],
};

/** A column comes back as { type, value } and a system field as a plain value. Flatten both to a string. */
const plain = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  // a `bytes` column comes back as raw bytes: keep it as 0x hex so it fits the string-valued attributes
  if (v instanceof Uint8Array) return `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (typeof v === 'object' && 'value' in (v as object)) return plain((v as { value: unknown }).value);
  return String(v);
};

export function normalizeRow(kind: IndexedKind, row: Record<string, unknown>): RawRow {
  const attrs: Record<string, string> = {};
  for (const f of FIELDS[kind]) {
    const v = plain(row[f]);
    if (v !== undefined) attrs[f] = v;
  }
  return {
    key: String(row.$key).toLowerCase(),
    creator: String(row.$creator).toLowerCase(),
    owner: String(row.$owner).toLowerCase(),
    createdBlock: Number(row.$createdAt),
    expiresBlock: Number(row.$expiresAt),
    attrs,
  };
}

/* The Arkiv SDK's query builder types are very deep, so this adapter is deliberately loose. It is covered by
   the live `npm run indexer:sync` run, and everything above it is tested against a fake ReaderClient. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

export function arkivReaderClient(publicClient: AnyPublicClient): ReaderClient {
  return {
    async getBlockTiming(): Promise<BlockTiming> {
      const t = await publicClient.getBlockTiming();
      return { currentBlock: Number(t.currentBlock), currentBlockTime: Number(t.currentBlockTime), blockDuration: Number(t.blockDuration) };
    },
    async getBlockTime(block) {
      const b = await publicClient.getBlock({ blockNumber: BigInt(block) });
      return Number(b.timestamp);
    },
    async fetchPage(kind, afterKey) {
      const select: Record<string, true> = Object.fromEntries(
        ['$key', '$creator', '$owner', '$createdAt', '$expiresAt', ...FIELDS[kind]].map((f) => [f, true as const]),
      );
      let q = publicClient.select(select).from(SCHEMAS[kind]);
      // key-based paging never repeats or skips rows, unlike offsets (Arkiv docs, "Paginate Results")
      if (afterKey) q = q.where(gt('$key', keyValue(afterKey as `0x${string}`)));
      const { entities } = await q.orderBy(asc('$key')).limit(PAGE_SIZE).fetch();
      return (entities as Record<string, unknown>[]).map((e) => normalizeRow(kind, e));
    },
  };
}

/** Reads every unexpired entity of one kind. Arkiv skips expired entities itself. */
export async function readAll(reader: ReaderClient, kind: IndexedKind): Promise<RawRow[]> {
  const all: RawRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100_000; page++) {
    const rows = await reader.fetchPage(kind, after);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
    after = rows[rows.length - 1].key;
  }
  throw new Error(`readAll(${kind}): too many pages, refusing to loop forever`);
}

export interface SyncResult {
  counts: Record<IndexedKind, number>;
  total: number;
  timing: BlockTiming;
}

/** Reads everything and replaces the store in one transaction. This full read IS the "rebuild from Arkiv" path. */
export async function syncStore(
  store: { replaceAll(rows: { kind: IndexedKind; row: RawRow }[], timing: BlockTiming, epoch?: BlockTiming): void },
  reader: ReaderClient,
): Promise<SyncResult> {
  const timing = await reader.getBlockTiming();
  const rows: { kind: IndexedKind; row: RawRow }[] = [];
  const counts = { report: 0, verdict: 0, attestation: 0, ruling: 0 } as Record<IndexedKind, number>;
  for (const kind of INDEXED_KINDS) {
    const got = await readAll(reader, kind);
    counts[kind] = got.length;
    for (const row of got) rows.push({ kind, row });
  }
  const epochBlock = epochOf(timing.currentBlock);
  const epochTime = epochBlock === timing.currentBlock ? timing.currentBlockTime : await reader.getBlockTime(epochBlock);
  const epoch: BlockTiming = { currentBlock: epochBlock, currentBlockTime: epochTime, blockDuration: timing.blockDuration };
  store.replaceAll(rows, timing, epoch);
  return { counts, total: rows.length, timing };
}
