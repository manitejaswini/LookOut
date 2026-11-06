import { eq } from '@arkiv-network/sdk/query';
import { SCHEMAS } from './schemas.ts';

/**
 * Reading the roots indexers published on Arkiv. Browser-safe on purpose (no Node imports): a wallet page uses
 * this to check what PIR servers serve against something the servers do not control. Import it as
 * `@lookout/arkiv/roots`, not from the package root, which also holds the Node-only writers.
 */
export interface PublishedRoot {
  snapshotId: string;
  rootHash: string;
  bucketCount: number;
  indexerId: string;
  /** who created the entity. Trust always checks this, never `owner` */
  creator: string;
  entityKey: string;
}

export interface TrustedIndexer {
  indexerId: string;
  address: string;
}

/** The roots a client may accept: published by a trusted indexer, under that indexer's own id, and agreed by enough of them. */
export function trustedRoots(rows: PublishedRoot[], trusted: TrustedIndexer[], minIndexers = 1): string[] {
  const allowed = new Map(trusted.map((t) => [t.indexerId, t.address.toLowerCase()]));
  const byRoot = new Map<string, Set<string>>();
  for (const r of rows) {
    if (allowed.get(r.indexerId) !== r.creator.toLowerCase()) continue; // wrong wallet, or not a trusted indexer
    if (!/^0x[0-9a-f]{64}$/i.test(r.rootHash)) continue;
    const root = r.rootHash.toLowerCase();
    (byRoot.get(root) ?? byRoot.set(root, new Set()).get(root)!).add(r.indexerId);
  }
  return [...byRoot].filter(([, who]) => who.size >= minIndexers).map(([root]) => root).sort();
}

const plain = (v: unknown): unknown => (v && typeof v === 'object' && 'value' in (v as object) ? plain((v as { value: unknown }).value) : v);

/* The SDK's query builder types are very deep, so this adapter is deliberately loose, like the indexer's reader.
   It is covered by the live run (npm run indexer:publish), and everything else is tested with fakes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

/** Every `snapshot` entity for one snapshot id, whoever wrote it. Filter with trustedRoots before believing any. */
export async function readSnapshotRows(publicClient: AnyPublicClient, snapshotId: string): Promise<PublishedRoot[]> {
  const select = Object.fromEntries(['$key', '$creator', 'snapshotId', 'rootHash', 'bucketCount', 'indexerId'].map((f) => [f, true as const]));
  const { entities } = await publicClient.select(select).from(SCHEMAS.snapshot).where(eq('snapshotId', snapshotId)).limit(100).fetch();
  return (entities as Record<string, unknown>[]).map((e) => ({
    snapshotId: String(plain(e.snapshotId)),
    rootHash: String(plain(e.rootHash)).toLowerCase(),
    bucketCount: Number(plain(e.bucketCount)),
    indexerId: String(plain(e.indexerId)),
    creator: String(e.$creator).toLowerCase(),
    entityKey: String(e.$key).toLowerCase(),
  }));
}

/** The `publishedRoots` function the PIR client wants, backed by Arkiv. */
export function arkivRootsSource(opts: { publicClient: AnyPublicClient; trusted: TrustedIndexer[]; minIndexers?: number }) {
  return async (snapshotId: string): Promise<string[]> =>
    trustedRoots(await readSnapshotRows(opts.publicClient, snapshotId), opts.trusted, opts.minIndexers ?? 1);
}
