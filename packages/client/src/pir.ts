import { combine, queryPair } from '@lookout/pir';
import {
  BUCKET_SIZE, FLAG, bucketHash, bucketIndexes, findRecord, scoreTarget, tableRoot, targetHash,
} from '@lookout/core';
import type { CheckResult, ScoringInput, Signal, TargetKind } from '@lookout/core';
import { LookupError, inferKind } from './client.ts';

/**
 * Private lookup. The client sends each PIR server a random-looking bit vector, never the target,
 * and always asks for BOTH candidate buckets so a hit and a miss look identical on the wire.
 * Answers are checked against a hash table, and the table against roots published on Arkiv.
 * Table layout and protocol: arkiv/snapshot-format.md (Dev A owns it, packages/core/src/snapshot.ts).
 */
export interface PirPair { a: string; b: string }

export interface PirOptions {
  /** Independent operator pairs, tried in order. A pair that fails verification is skipped. */
  pairs: PirPair[];
  /**
   * Roots published as `snapshot` entities on Arkiv for a snapshot id. Without this the client can
   * still check answers against the servers' own table, but it cannot claim `verified: true`.
   */
  publishedRoots?: (snapshotId: string) => Promise<string[]>;
  fetch?: typeof fetch;
  now?: () => number; // epoch ms, for tests
}

export class VerificationError extends LookupError {}

/**
 * What the client is doing, as it happens, so a UI can show the real steps. The vectors are the
 * exact bytes sent to each server, which only this device ever pairs together.
 */
export type PirEvent =
  | { type: 'hashed' }
  | { type: 'snapshot'; snapshotId: string; root: string }
  | { type: 'table'; matchedPublishedRoot: boolean }
  | { type: 'query'; round: number; rounds: number; a: Uint8Array; b: Uint8Array }
  | { type: 'combined'; round: number; rounds: number }
  | { type: 'bucket-verified'; round: number; rounds: number }
  | { type: 'retry'; pair: PirPair; reason: string }
  | { type: 'scored' };

export type OnPirEvent = (e: PirEvent) => void;

const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));

interface Latest { snapshotId: string; root: string; bucketCount: number }
interface Fetched {
  snapshotId: string;
  verified: boolean;
  buckets: [Uint8Array, Uint8Array]; // the two candidate buckets, each verified against the table
}

export function createPirClient(opts: PirOptions) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const tableCache = new Map<string, Uint8Array>(); // `${baseA}|${snapshotId}|${root}` -> hash table

  const json = async <T>(url: string): Promise<T> => {
    let res: Response;
    try { res = await doFetch(url); } catch (e) { throw new LookupError(`${url} unreachable: ${(e as Error).message}`); }
    if (!res.ok) throw new LookupError(`${url} returned ${res.status}`);
    return (await res.json()) as T;
  };

  async function viaPair(pair: PirPair, hash: string, emit: OnPirEvent): Promise<Fetched> {
    const [la, lb] = await Promise.all([json<Latest>(`${pair.a}/snapshot/latest`), json<Latest>(`${pair.b}/snapshot/latest`)]);
    if (la.snapshotId !== lb.snapshotId || la.root !== lb.root || la.bucketCount !== lb.bucketCount) {
      throw new VerificationError('the two servers disagree about the latest snapshot');
    }
    emit({ type: 'snapshot', snapshotId: la.snapshotId, root: la.root });

    const cacheKey = `${pair.a}|${la.snapshotId}|${la.root}`;
    let hashes = tableCache.get(cacheKey);
    if (!hashes) {
      let res: Response;
      try { res = await doFetch(`${pair.a}/snapshot/${encodeURIComponent(la.snapshotId)}/hashes`); } catch (e) { throw new LookupError(`hash table unreachable: ${(e as Error).message}`); }
      if (!res.ok) throw new LookupError(`hash table returned ${res.status}`);
      hashes = new Uint8Array(await res.arrayBuffer());
      if (hashes.length !== la.bucketCount * 32 || tableRoot(la.snapshotId, la.bucketCount, hashes) !== la.root) {
        throw new VerificationError('hash table does not match the root the server announced');
      }
      tableCache.set(cacheKey, hashes);
    }

    let verified = false;
    if (opts.publishedRoots) {
      const roots = (await opts.publishedRoots(la.snapshotId)).map((r) => r.toLowerCase());
      if (!roots.includes(la.root.toLowerCase())) throw new VerificationError('hash table does not match any root published on Arkiv');
      verified = true;
    }
    emit({ type: 'table', matchedPublishedRoot: verified });

    const order = bucketIndexes(hash, la.bucketCount);
    if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) order.reverse(); // do not always ask for the same one first
    const buckets: Uint8Array[] = [];
    for (const index of order) {
      const { a, b } = queryPair(index, la.bucketCount);
      emit({ type: 'query', round: buckets.length, rounds: order.length, a, b });
      const ask = async (base: string, v: Uint8Array) => {
        let res: Response;
        try {
          res = await doFetch(`${base}/pir/query`, { method: 'POST', body: JSON.stringify({ snapshotId: la.snapshotId, vector: b64(v) }) });
        } catch (e) { throw new LookupError(`${base} unreachable: ${(e as Error).message}`); }
        if (!res.ok) throw new LookupError(`${base} returned ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
      const [ra, rb] = await Promise.all([ask(pair.a, a), ask(pair.b, b)]);
      if (ra.length !== BUCKET_SIZE || rb.length !== BUCKET_SIZE) throw new VerificationError('a server returned a wrong-sized answer');
      const bucket = combine(ra, rb);
      emit({ type: 'combined', round: buckets.length, rounds: order.length });
      const want = hashes.subarray(index * 32, (index + 1) * 32);
      if (!bucketHash(index, bucket).every((v, k) => v === want[k])) {
        throw new VerificationError(`bucket ${index} does not match the hash table (a server tampered or the tables differ)`);
      }
      emit({ type: 'bucket-verified', round: buckets.length, rounds: order.length });
      buckets.push(bucket);
    }
    return { snapshotId: la.snapshotId, verified, buckets: [buckets[0], buckets[1]] };
  }

  async function fetchBuckets(hash: string, emit: OnPirEvent): Promise<Fetched> {
    if (opts.pairs.length === 0) throw new LookupError('no PIR server pairs configured');
    const failures: string[] = [];
    for (const pair of opts.pairs) {
      try { return await viaPair(pair, hash, emit); } catch (e) {
        const reason = (e as Error).message;
        failures.push(`${pair.a} + ${pair.b}: ${reason}`);
        emit({ type: 'retry', pair, reason });
      }
    }
    throw new VerificationError(`every PIR server pair failed. ${failures.join(' | ')}`);
  }

  async function checkTarget(value: string, kind: TargetKind = inferKind(value), onEvent: OnPirEvent = () => {}): Promise<CheckResult> {
    const hash = targetHash(kind, value); // throws on malformed input, before any request
    onEvent({ type: 'hashed' });
    const { snapshotId, verified, buckets } = await fetchBuckets(hash, onEvent);
    const hit = findRecord(hash, buckets[0], buckets[1]);
    const input: ScoringInput = { signals: [], disputed: false };
    if (hit) {
      const nowSec = Math.floor(now() / 1000);
      const signals: Signal[] = hit.signals.map((s) => ({
        entityId: s.entityKey,
        sourceType: s.sourceType,
        sourceId: `source #${s.sourceIdx}`, // the registry that maps an index to a name is not shipped to clients yet
        level: s.level,
        weight: s.weight,
        ageSeconds: Math.max(0, nowSec - s.createdAt),
        note: '',
      }));
      input.signals = signals;
      input.disputed = (hit.flags & FLAG.disputed) !== 0;
      if (hit.flags & FLAG.proof) input.proof = 'checker proof attached to the verdict entity';
      if (hit.flags & FLAG.rulingBlock) input.ruling = 'block';
      else if (hit.flags & FLAG.rulingClear) input.ruling = 'clear';
    }
    const scored = { ...scoreTarget(input), snapshotId, verified };
    onEvent({ type: 'scored' });
    return scored;
  }

  return { checkTarget };
}

export type PirClient = ReturnType<typeof createPirClient>;
