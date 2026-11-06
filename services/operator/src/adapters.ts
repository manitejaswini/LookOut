import { asc, eq, gt } from '@arkiv-network/sdk/query';
import { key as keyValue } from '@arkiv-network/sdk/schema';
import { SCHEMAS } from '@lookout/arkiv';
import type { Corroboration } from '@lookout/core';
import { findSource, type Registry } from '@lookout/indexer';
import type { AttestationRow, ReportRow } from './reports.ts';

/**
 * The Arkiv side of the operator's inputs. Both are small and take the client they need as an argument.
 * The SDK's query types are too deep to fake faithfully, so these are covered by the live run (scripts/operator-live-run.mjs)
 * and not by unit tests. Everything that DECIDES something is elsewhere and is unit tested.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

const plain = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'object' && 'value' in (v as object)) return plain((v as { value: unknown }).value);
  return String(v);
};

const bytesOf = (v: unknown): Uint8Array | undefined => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v;
  if (x instanceof Uint8Array) return x;
  if (typeof x === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(x)) return Uint8Array.from((x.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
  return undefined;
};
const hexOf = (b: Uint8Array | undefined) => (b ? `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` : undefined);

/** Unix seconds of a block, exactly as the chain recorded it. Cached: a block's time never changes. */
function blockClock(publicClient: AnyPublicClient) {
  const cache = new Map<number, number>();
  return async (block: number) => {
    if (!cache.has(block)) cache.set(block, Number((await publicClient.getBlock({ blockNumber: BigInt(block) })).timestamp));
    return cache.get(block)!;
  };
}

/** Pages through every live entity of a schema by key, so nothing repeats or is skipped. */
async function readAll(publicClient: AnyPublicClient, schema: unknown, fields: Record<string, true>, where?: unknown): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (let i = 0; i < 1000; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (publicClient.select({ $key: true, $creator: true, $createdAt: true, ...fields }) as any).from(schema);
    if (where) q = q.where(where);
    if (after) q = q.where(gt('$key', keyValue(after as `0x${string}`)));
    const { entities } = await q.orderBy(asc('$key')).limit(100).fetch();
    all.push(...(entities as Record<string, unknown>[]));
    if (entities.length < 100) return all;
    after = String((entities as Record<string, unknown>[])[entities.length - 1].$key);
  }
  throw new Error('too many pages, refusing to loop forever');
}

/** Every live `report` and `attestation` with its payload. */
export function arkivReportSource(publicClient: AnyPublicClient) {
  const timeOf = blockClock(publicClient);
  return {
    async reports(): Promise<ReportRow[]> {
      const rows = await readAll(publicClient, SCHEMAS.report, { reportId: true, targetHash: true, payload: true });
      return Promise.all(rows.map(async (e) => ({
        key: String(e.$key).toLowerCase(), creator: String(e.$creator).toLowerCase(), reportId: String(plain(e.reportId)),
        targetHash: String(plain(e.targetHash)).toLowerCase(), createdAt: await timeOf(Number(e.$createdAt)), payload: bytesOf(e.payload),
      })));
    },
    async attestations(): Promise<AttestationRow[]> {
      const rows = await readAll(publicClient, SCHEMAS.attestation, { targetHash: true, claim: true, payload: true });
      return Promise.all(rows.map(async (e) => ({
        key: String(e.$key).toLowerCase(), creator: String(e.$creator).toLowerCase(), targetHash: String(plain(e.targetHash)).toLowerCase(),
        claim: String(plain(e.claim)), createdAt: await timeOf(Number(e.$createdAt)), payload: hexOf(bytesOf(e.payload)),
      })));
    },
  };
}

/**
 * What the TRUSTED sources have said about a target. Only verdicts written by a wallet that the registry lists for that exact
 * source type and id count (services/indexer/registry.json): anyone can write a verdict entity, so who wrote it is what matters.
 * `createdAt` is when the verdict was FIRST written (a refresh extends its life but does not change this).
 */
export function arkivEvidenceSource(publicClient: AnyPublicClient, registry: Registry) {
  const timeOf = blockClock(publicClient);
  return {
    async signalsFor(targetHash: string): Promise<Corroboration[]> {
      const rows = await readAll(publicClient, SCHEMAS.verdict, { targetHash: true, sourceType: true, sourceId: true, level: true }, eq('targetHash', targetHash));
      const out: Corroboration[] = [];
      for (const e of rows) {
        const creator = String(e.$creator).toLowerCase();
        const sourceType = String(plain(e.sourceType));
        const sourceId = String(plain(e.sourceId));
        const level = String(plain(e.level));
        const src = findSource(registry, creator, sourceType, sourceId);
        if (!src || (level !== 'block' && level !== 'warn')) continue;
        out.push({ sourceType: src.sourceType, sourceId: src.sourceId, level, creator, entityKey: String(e.$key).toLowerCase(), createdAt: await timeOf(Number(e.$createdAt)) });
      }
      return out;
    },
  };
}

/** The `stake` entities this wallet already created for a report, so the mirror never writes a second one. */
export function arkivStakeFinder(publicClient: AnyPublicClient, creator: string) {
  const me = creator.toLowerCase();
  return async (reportId: string): Promise<string[]> => {
    const rows = await readAll(publicClient, SCHEMAS.stake, { reportId: true }, eq('reportId', reportId));
    return rows.filter((e) => String(e.$creator).toLowerCase() === me).map((e) => String(e.$key).toLowerCase()).sort();
  };
}
