/** The entity kinds an indexer reads. `stake`, `vote`, `reputation`, `snapshot` and `bounty` are not needed to build signals yet. */
export const INDEXED_KINDS = ['report', 'verdict', 'attestation', 'ruling'] as const;
export type IndexedKind = (typeof INDEXED_KINDS)[number];

/** One entity as read from Arkiv, with column values flattened to plain strings. */
export interface RawRow {
  key: string; // lowercase 0x + 64 hex
  creator: string; // lowercase. Authorization always uses this, never `owner`, which can be transferred
  owner: string; // lowercase
  createdBlock: number;
  expiresBlock: number;
  attrs: Record<string, string>;
}

export interface BlockTiming {
  currentBlock: number;
  /** unix seconds of the current block */
  currentBlockTime: number;
  /** seconds per block, 2 on Rabdi */
  blockDuration: number;
}

/** What the indexer needs from Arkiv. A fake with this shape is used in tests. */
export interface ReaderClient {
  getBlockTiming(): Promise<BlockTiming>;
  /** one page (at most 100 rows) of a kind, ordered by $key, starting after `afterKey` */
  fetchPage(kind: IndexedKind, afterKey?: string): Promise<RawRow[]>;
}

export interface StoredEntity extends RawRow {
  kind: IndexedKind;
}
