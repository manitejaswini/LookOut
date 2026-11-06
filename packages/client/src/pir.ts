import { combine, queryPair } from '@lookout/pir';
import {
  FLAG_DISPUTED, FLAG_PROOF, FLAG_RULING_BLOCK, FLAG_RULING_CLEAR, BUCKET_SIZE, bountyKey, candidates, findRecord,
  keyFromHex, rootOf, verifyBucket, verifyTable,
} from '@lookout/snapshot';
import { emptyTarget, scoreTarget, targetHash } from '@lookout/core';
import type { CheckResult, Signal, TargetKind } from '@lookout/core';
import { LookupError, inferKind } from './client.ts';

/**
 * Private lookup. The client sends each PIR server a random-looking bit vector, never the target,
 * and always asks for BOTH candidate buckets so a hit and a miss look identical on the wire.
 * Answers are checked against a hash table, and the table against roots published on Arkiv.
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

const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));

interface Fetched {
  snapshotId: string;
  verified: boolean;
  buckets: Uint8Array[]; // the two candidate buckets, verified against the table
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

  async function viaPair(pair: PirPair, key: Uint8Array): Promise<Fetched> {
    const [la, lb] = await Promise.all([
      json<{ snapshotId: string; root: string; bucketCount: number }>(`${pair.a}/snapshot/latest`),
      json<{ snapshotId: string; root: string; bucketCount: number }>(`${pair.b}/snapshot/latest`),
    ]);
    if (la.snapshotId !== lb.snapshotId || la.root !== lb.root) throw new VerificationError('the two servers disagree about the latest snapshot');

    const cacheKey = `${pair.a}|${la.snapshotId}|${la.root}`;
    let hashes = tableCache.get(cacheKey);
    if (!hashes) {
      let res: Response;
      try { res = await doFetch(`${pair.a}/snapshot/${encodeURIComponent(la.snapshotId)}/hashes`); } catch (e) { throw new LookupError(`hash table unreachable: ${(e as Error).message}`); }
      if (!res.ok) throw new LookupError(`hash table returned ${res.status}`);
      hashes = new Uint8Array(await res.arrayBuffer());
      if (hashes.length !== la.bucketCount * 32 || rootOf(hashes) !== la.root) throw new VerificationError('hash table does not match the root the server announced');
      tableCache.set(cacheKey, hashes);
    }

    let verified = false;
    if (opts.publishedRoots) {
      const roots = await opts.publishedRoots(la.snapshotId);
      if (!verifyTable(hashes, roots)) throw new VerificationError('hash table does not match any root published on Arkiv');
      verified = true;
    }

    const order = candidates(key, la.bucketCount);
    if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) order.reverse();
    const buckets: Uint8Array[] = [];
    for (const index of order) {
      const { a, b } = queryPair(index, la.bucketCount);
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
      if (!verifyBucket(hashes, index, bucket)) throw new VerificationError(`bucket ${index} does not match the hash table (a server tampered or the tables differ)`);
      buckets.push(bucket);
    }
    return { snapshotId: la.snapshotId, verified, buckets };
  }

  async function fetchBuckets(key: Uint8Array): Promise<Fetched> {
    if (opts.pairs.length === 0) throw new LookupError('no PIR server pairs configured');
    const failures: string[] = [];
    for (const pair of opts.pairs) {
      try { return await viaPair(pair, key); } catch (e) { failures.push(`${pair.a} + ${pair.b}: ${(e as Error).message}`); }
    }
    throw new VerificationError(`every PIR server pair failed. ${failures.join(' | ')}`);
  }

  async function checkTarget(value: string, kind: TargetKind = inferKind(value)): Promise<CheckResult> {
    const key = keyFromHex(targetHash(kind, value)); // throws on malformed input, before any request
    const { snapshotId, verified, buckets } = await fetchBuckets(key);
    const hit = findRecord(key, 'target', buckets);
    const t = emptyTarget(value, kind);
    if (hit && hit.kind === 'target') {
      const nowSec = Math.floor(now() / 1000);
      const signals: Signal[] = hit.signals.map((s) => ({
        entityId: s.entityKey, sourceType: s.sourceType, sourceId: s.entityKey, level: s.level, weight: s.weight,
        ageSeconds: Math.max(0, nowSec - s.createdAt), note: '',
      }));
      t.signals = signals;
      t.disputed = (hit.flags & FLAG_DISPUTED) !== 0;
      if (hit.flags & FLAG_PROOF) t.proof = 'checker proof attached to the verdict entity';
      if (hit.flags & FLAG_RULING_BLOCK) t.ruling = 'block';
      else if (hit.flags & FLAG_RULING_CLEAR) t.ruling = 'clear';
    }
    return { ...scoreTarget(t), snapshotId, verified };
  }

  /** Reporter side of a stealth bounty: look up your own reportId, privately. */
  async function findBounty(reportId: string) {
    const key = bountyKey(reportId);
    const { snapshotId, verified, buckets } = await fetchBuckets(key);
    const hit = findRecord(key, 'bounty', buckets);
    return hit && hit.kind === 'bounty' ? { tier: hit.tier, ephemeralPublicKey: hit.ephemeralPublicKey, snapshotId, verified } : null;
  }

  return { checkTarget, findBounty };
}

export type PirClient = ReturnType<typeof createPirClient>;
