import { asc, eq, gt } from '@arkiv-network/sdk/query';
import { key as keyValue } from '@arkiv-network/sdk/schema';
import { SCHEMAS } from '@lookout/arkiv';
import type { Candidate } from '@lookout/core';
import type { Escrow } from '@lookout/escrow';
import type { SeatStore } from '@lookout/worldid';
import type { VoteRow } from './driver.ts';
import type { AttestationRow, ReportRow } from './cases.ts';

/**
 * The real-world side of the driver's ports. Each is small and takes what it needs as an argument.
 * `candidatesFrom` is unit tested. `arkivVoteReader` and `arkivBlockSource` talk to live Arkiv and are covered only by the
 * live run (the SDK's query types are too deep to fake faithfully), so treat them as untested until that run.
 */

/**
 * Who may be drawn: everyone with a World ID seat, who has enough stake in escrow (and is not unstaking), with their
 * checkpointed reputation. A wallet with no seat is never a candidate, however much it has staked.
 */
export async function candidatesFrom(opts: {
  seats: Pick<SeatStore, 'seats'>;
  action: string;
  escrow: Pick<Escrow, 'stakeOf'>;
  /** the latest reputation checkpoint, lowercase wallet to score */
  reputation: () => ReadonlyMap<string, number> | Record<string, number>;
}): Promise<Candidate[]> {
  const rep = opts.reputation();
  const repOf = (w: string) => (rep instanceof Map ? rep.get(w) : (rep as Record<string, number>)[w]) ?? 0;
  const out: Candidate[] = [];
  for (const seat of opts.seats.seats(opts.action)) {
    const w = seat.wallet.toLowerCase();
    const s = await opts.escrow.stakeOf(w);
    if (!s.eligible) continue; // below the minimum, or unstaking
    out.push({ wallet: w, rep: repOf(w), stakeWei: s.amount, nullifier: seat.nullifier });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

/** The Arkiv chain's block numbers and hashes, for the draw seed. */
export function arkivBlockSource(publicClient: AnyPublicClient) {
  return {
    currentBlock: async (): Promise<number> => Number((await publicClient.getBlockTiming()).currentBlock),
    blockHash: async (block: number): Promise<string | null> => {
      try {
        const b = await publicClient.getBlock({ blockNumber: BigInt(block) });
        return b?.hash ? String(b.hash).toLowerCase() : null;
      } catch {
        return null; // that block does not exist yet
      }
    },
  };
}

const plain = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'object' && 'value' in (v as object)) return plain((v as { value: unknown }).value);
  return String(v);
};

/** Every `vote` entity of a case, with the time it was created. A reveal is the same entity with outcome and salt set. */
export function arkivVoteReader(publicClient: AnyPublicClient) {
  const times = new Map<number, number>();
  const timeOf = async (block: number) => {
    if (!times.has(block)) times.set(block, Number((await publicClient.getBlock({ blockNumber: BigInt(block) })).timestamp));
    return times.get(block)!;
  };
  return async (caseId: string): Promise<VoteRow[]> => {
    const rows: VoteRow[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { entities } = await (publicClient.select({ $creator: true, $createdAt: true, caseId: true, commitHash: true, outcome: true, salt: true }) as any)
      .from(SCHEMAS.vote).where(eq('caseId', caseId)).orderBy(asc('$key')).limit(100).fetch();
    for (const e of entities as Record<string, unknown>[]) {
      const outcome = plain(e.outcome);
      rows.push({
        juror: String(e.$creator).toLowerCase(), commitHash: String(plain(e.commitHash)).toLowerCase(), createdAt: await timeOf(Number(e.$createdAt)),
        ...(outcome === 'block' || outcome === 'clear' ? { outcome, salt: plain(e.salt) } : {}),
      });
    }
    return rows;
  };
}

/* ------------------------------ reading cases ------------------------------ */

const bytesOf = (v: unknown): Uint8Array | undefined => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v;
  if (x instanceof Uint8Array) return x;
  if (typeof x === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(x)) return Uint8Array.from((x.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)));
  return undefined;
};
const hexOf = (b: Uint8Array | undefined) => (b ? `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` : undefined);

/**
 * Every live `report` and `attestation` with its payload, for planCases. Pages by key so nothing repeats or is skipped.
 * Like the other Arkiv adapters here, it is covered by the live run (scripts/panel-live-run.mjs) and not by unit tests.
 */
export function arkivCaseSource(publicClient: AnyPublicClient) {
  async function pages(schema: unknown, fields: Record<string, true>): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    let after: string | undefined;
    for (let i = 0; i < 1000; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (publicClient.select({ $key: true, $creator: true, ...fields }) as any).from(schema);
      if (after) q = q.where(gt('$key', keyValue(after as `0x${string}`)));
      const { entities } = await q.orderBy(asc('$key')).limit(100).fetch();
      all.push(...(entities as Record<string, unknown>[]));
      if (entities.length < 100) return all;
      after = String((entities as Record<string, unknown>[])[entities.length - 1].$key);
    }
    throw new Error('too many pages, refusing to loop forever');
  }

  return {
    async reports(): Promise<ReportRow[]> {
      const rows = await pages(SCHEMAS.report, { reportId: true, targetHash: true, payload: true });
      return rows.map((e) => ({
        key: String(e.$key).toLowerCase(), creator: String(e.$creator).toLowerCase(), reportId: String(plain(e.reportId)), targetHash: String(plain(e.targetHash)).toLowerCase(),
        payload: bytesOf(e.payload),
      }));
    },
    async attestations(): Promise<AttestationRow[]> {
      const rows = await pages(SCHEMAS.attestation, { targetHash: true, claim: true, payload: true });
      return rows.map((e) => ({
        key: String(e.$key).toLowerCase(), creator: String(e.$creator).toLowerCase(), targetHash: String(plain(e.targetHash)).toLowerCase(),
        claim: String(plain(e.claim)), payload: hexOf(bytesOf(e.payload)),
      }));
    },
  };
}
