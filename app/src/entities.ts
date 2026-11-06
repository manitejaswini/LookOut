import type { ArkivEntity, EntityKind } from '@lookout/core';

/** What the indexer's GET /entities returns (services/indexer/src/entities.ts). Times are unix seconds. */
interface IndexerEntity {
  key: string;
  kind: EntityKind;
  creator: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
  attrs: Record<string, string>;
  notCounted?: string;
}
interface IndexerEntityList { block: number; syncedAt: number; total: number; entities: IndexerEntity[] }

export interface LiveEntities {
  block: number;
  syncedAt: number; // ms
  total: number;
  entities: (ArkivEntity & { notCounted?: string })[];
}

const short = (hex: string) => (hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex);

/** Long hashes make the table unreadable, so they are shortened. Everything else is shown as stored. */
const attrText = (attrs: Record<string, string>) =>
  Object.entries(attrs)
    .map(([k, v]) => `${k}=${/^0x[0-9a-f]{16,}$/i.test(v) ? short(v) : v}`)
    .join(' ');

export async function fetchEntities(indexerUrl: string, signal?: AbortSignal): Promise<LiveEntities> {
  const res = await fetch(`${indexerUrl.replace(/\/+$/, '')}/entities?limit=200`, { signal });
  if (!res.ok) throw new Error(`indexer returned ${res.status}`);
  const body = (await res.json()) as IndexerEntityList;
  return {
    block: body.block,
    syncedAt: body.syncedAt,
    total: body.total,
    entities: body.entities.map((e) => ({
      id: short(e.key),
      kind: e.kind,
      owner: short(e.owner),
      attr: attrText(e.attrs),
      expiresAt: e.expiresAt * 1000,
      ...(e.notCounted ? { notCounted: e.notCounted } : {}),
    })),
  };
}
