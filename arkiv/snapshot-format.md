# Lookout snapshot format (v0)

This is the contract between Dev A (indexers, who **build** the table) and Dev B (PIR servers and client, who **serve and read** it). Dev A owns it. It is implemented and tested in `packages/core/src/snapshot.ts` (17 tests in `packages/core`, run with `npm test`). If this document and that code disagree, fix both in the same pull request.

The format is a decision made here, not something Arkiv defines. It follows the PRD ("Privacy design": about 16,000 buckets of 512 bytes, a bucket-hash table of about 512 KB, two-choice hashing, a root published on Arkiv).

## At a glance

| Item | Value |
| --- | --- |
| Bucket size | 512 bytes |
| Bucket count | 16,384 at demo scale (`bucketCount`, always a power of two, set per snapshot) |
| Table | `bucketCount x 512` bytes = **8 MiB**. Held identically by both PIR servers |
| Bucket-hash table | `bucketCount x 32` bytes = **512 KiB**. The client downloads all of it |
| Root | 32 bytes, published on Arkiv in the `lookout.v0.snapshot` entity |
| PIR query | `bucketCount / 8` bytes = **2,048 bytes** |
| PIR answer | 512 bytes |
| Hash function | Keccak-256 everywhere, same as `targetHash` |

## What a bucket holds

A bucket holds the signals the client needs to run the scoring rule locally, for every target that was placed in it. It does **not** hold raw targets: records are found by a fingerprint of `targetHash`.

```
bucket (512 bytes)
  u16        recordCount                (big endian)
  record[0] record[1] ... record[recordCount-1]
  zero padding up to 512 bytes          (usable record space: 510 bytes)

record
  8 bytes    fingerprint                 = targetHash[8..16]
  1 byte     flags                       bit0 disputed, bit1 proof, bit2 ruling=block, bit3 ruling=clear
  1 byte     signalCount                 0..4
  signal[signalCount]  (41 bytes each)

signal
  1 byte     sourceType                  0 community, 1 feed, 2 checker, 3 verifier, 4 ruling
  1 byte     level                       0 warn, 1 block
  1 byte     weight                      round(weight x 255), so quantised to 1/255
  2 bytes    sourceIdx                   index into the source registry (big endian)
  4 bytes    createdAt                   unix seconds (big endian)
  32 bytes   entityKey                   the Arkiv entity key, so the user can inspect the entity
```

All integers are big endian. A record is `10 + 41 x signalCount` bytes, so 51 to 174 bytes.

Rules for what goes in a record (these decide the bytes, so all indexers must follow them):
- A target keeps at most **4 signals**: the strongest by `weight`, ties broken by `entityKey` ascending. Others are dropped.
- `weight` is the final report weight the indexer computed from the reputation checkpoint (see "Dependencies" below). The client does **not** recompute reputation. It trusts the verified table.
- `flags.proof` is set if any signal has a `proofHash`. `flags.disputed` is set if an unexpired `attestation` exists for the target. `ruling` bits come from the latest unexpired `ruling`.
- Expired entities are not included. `createdAt` lets the client show "3 minutes ago".

## Where a target goes (two-choice hashing)

```
targetHash   32 bytes, see arkiv/schema.md
i1 = u32 big endian of targetHash[0..4]  & (bucketCount - 1)
i2 = u32 big endian of targetHash[4..8]  & (bucketCount - 1)
if i2 == i1:  i2 = (i1 + 1) & (bucketCount - 1)
```

A record is stored in **one** of the two buckets, and the client **always fetches both**. So a hit and a miss cost the same, and the servers cannot tell them apart.

Fingerprint bytes `8..16` are taken from a different slice than the index bytes `0..8`, so the fingerprint says nothing about where the record landed.

## How an indexer builds the table (deterministic)

Two indexers with the same input must produce **byte-identical** output, otherwise their roots differ and clients cannot verify.

1. Take every target with at least one signal, a flag or a ruling.
2. Sort the records by `targetHash` ascending (lowercase hex string order).
3. For each record, in that order: compute `i1` and `i2`. Pick the candidate bucket with **fewer bytes used**, ties going to `i1`. If the record does not fit in that bucket's 510 bytes, try the other one. If it fits neither, **fail**.
4. Append the record at the next free offset in the chosen bucket, and increment that bucket's `recordCount`.
5. Compute the bucket hashes and the root (next section).

A failure means the table is too full, and the fix is a larger `bucketCount` (a power of two) for the next snapshot. The indexer must not drop records silently. A snapshot's `bucketCount` is published in its entity, so changing it is safe.

## Hashes and the root

```
bucketHash[i] = keccak256( "lookout.bucket.v0" | u32be(i) | bucket[i] )      32 bytes
hashes        = bucketHash[0] | bucketHash[1] | ... | bucketHash[N-1]          N x 32 bytes
root          = keccak256( "lookout.root.v0" | snapshotId | u32be(N) | hashes )
```

`snapshotId` and `N` are UTF-8 string and integer inputs. The bucket hash includes its **index**, so a server cannot swap two valid buckets. The root includes the **snapshot id and size**, so a root cannot be replayed for a different snapshot.

Strings (`"lookout.bucket.v0"`, `snapshotId`) are UTF-8 bytes with no length prefix and no terminator.

## Publishing on Arkiv

Each indexer publishes a `lookout.v0.snapshot` entity (see `arkiv/schema.md`) with:

| Column | Value |
| --- | --- |
| `snapshotId` | for example `snap-0412` |
| `bucketCount` | `N` |
| `rootHash` | the root, `0x` + 64 hex |
| `indexerId` | which indexer |

Several independent indexers publish a root for the same `snapshotId`. A client accepts a table only if its computed root equals one of those published roots, and it should prefer the one most indexers agree on.

## PIR server endpoints

Both servers hold the same table and expose the same endpoints (PRD "PIR server endpoints", with the encoding made precise):

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /snapshot/latest` | none | JSON `{ "snapshotId": string, "bucketCount": number, "root": "0x..." }` |
| `GET /snapshot/:id/hashes` | none | `application/octet-stream`, exactly `N x 32` bytes |
| `POST /pir/query` | JSON `{ "snapshotId": string, "vector": base64 }` | `application/octet-stream`, exactly 512 bytes |

`vector` is `N / 8` bytes. Bit `j` of the vector is `(byte[j >> 3] >> (j & 7)) & 1`, meaning the **lowest bit of each byte is the lowest bucket index**. A set bit means "include bucket `j`". The server returns the XOR of all included buckets.

The server must not log the request body, the client IP together with a vector, or anything else that would help link queries. For the demo's "show the server logs" step, the logs show only the snapshot id and the vector length, plus a fingerprint of the vector for debugging (a hash, never the vector's meaning).

## What the client does

```
1. GET /snapshot/latest from both servers        -> snapshotId, bucketCount, root
2. check that root matches a root published on Arkiv, and that both servers agree
3. GET /snapshot/:id/hashes (from either)        -> hashes ; check tableRoot(snapshotId, N, hashes) == root
4. targetHash = ... ; [i1, i2] = bucketIndexes(targetHash, N)
5. for each of i1, i2 (independent random vectors):
       r        = N random bits
       r'       = r with bit i flipped
       bucket   = POST r to server A  XOR  POST r' to server B
       check bucketHash(i, bucket) == hashes[i]       (else retry with another server pair)
6. record = findRecord(targetHash, bucket1, bucket2)  (a miss means "unknown")
7. run scoreTarget on the decoded signals            -> block | warn | unknown
```

Reference code for steps 3 to 6 is in `snapshot.ts` (`bucketIndexes`, `bucketHash`, `tableRoot`, `findRecord`). The round-trip test `PIR round trip` in `snapshot.test.ts` runs exactly this with an inline XOR and passes.

## Capacity (measured)

The test `build: every one of 5000 targets is findable` and a measured sweep with the same code, at 16,384 buckets, found this many targets fit before the first overflow:

| Signals per target | Record size | About how many targets fit |
| --- | --- | --- |
| 1 | 51 bytes | 119,000 |
| 2 | 92 bytes | 46,000 |
| 4 | 174 bytes | 7,000 |

These come from a simple greedy placement with uniform record sizes. A real mix will differ. The point: demo-scale lists (thousands of targets, mostly one or two signals) fit comfortably, and a four-signal target is expensive because only two fit in a bucket. If a list outgrows this, double `bucketCount`. At 65,536 buckets the table is 32 MiB, each query is 8 KiB, and the hash table the client downloads is 2 MiB.

## Dependencies and decisions to review

- **Weights come from the reputation checkpoint.** All indexers must use the same `lookout.v0.reputation` snapshot, or their weights, and so their roots, will differ. The `reputation` entities carry a `snapshotId` for this reason. The weight rule (`min(1, rep / cap)`) is in `packages/core`.
- **`sourceIdx` needs a registry** (Proposed): an append-only ordered list of source ids (`openfeed-phishing`, `lookout-checker`, ...) shipped in the repo, the same file as the trusted writers list. The client maps `sourceIdx` back to a name for the verdict screen. Not written yet.
- **Weight quantisation:** a weight is stored as `round(w x 255)`, so it is off by at most 1/510. Near the scoring threshold (0.5) that can flip a result: a weight of 0.4990 is stored as 127/255 = 0.4980 (below the threshold), while 0.5000 is stored as 128/255 = 0.5020 (above). The client scores from the stored value, so any check the indexer makes about its own weights must use the quantised value too. Open item for whoever owns the scoring rule.
- **PIR request encoding** (JSON with a base64 vector) is my choice for simplicity. A raw binary body would save about a third of the bytes. Dev B may propose a change, and then both documents change together.
- **Both candidate buckets are fetched with separate, independent vectors**, so a server sees two unrelated random vectors from one client at about the same time. It still learns nothing about the target. Sending the two queries in random order and in parallel avoids leaking which is "first".

## Limits and honesty

- Privacy holds only if the two servers do not collude. If they compare vectors, the single flipped bit gives the bucket away. This is the PRD's stated assumption.
- The server still sees the client's IP. That is what Anon-RPC would address, and its support is unverified.
- The table proves what the **indexers published**, not that the underlying reports are true. Trust in the content rests on the entities on Arkiv, the trusted writers rules, and having several indexers that anyone can recompute.
- The 8 MiB table is derived data. Only its root is on Arkiv.

## Open questions

1. Is a 41-byte signal worth carrying the full 32-byte `entityKey`, or should it be a shorter prefix that the client resolves? The full key lets a user inspect the exact entity, which supports the "check how Lookout decided" story, so v0 keeps it.
2. Should `bucketCount` grow automatically when the build fails, or only by a manual decision?
3. Does the client need a signed freshness proof, so a server cannot serve an old snapshot? v0 relies on the client comparing to the latest root on Arkiv.
4. **Which block does a snapshot describe? (found while building the indexer)** The indexer names a snapshot `snap-<block>` after the Arkiv block it read, and the root depends on that id and on every entity's age. Two indexers that sync at even slightly different blocks therefore get **different roots from identical data**, so "several independent indexers publish the same root" does not yet hold. Fixes to decide between: (a) indexers read **as of an agreed block** (for example a multiple of 300 blocks, about 10 minutes), if Arkiv can serve queries at a past block, which I have not checked, or (b) derive `createdAt` and the id from the entity data only, never from the block the indexer happened to read at. This must be settled before Phase 4's "wipe and rebuild gives the same root" test.
