# Lookout snapshot format (v0)

The private lookup table. The indexer builds it from Arkiv, the two PIR servers hold identical copies, and the client reads it with PIR and verifies it against a root published on Arkiv. Implementation: `packages/snapshot` (build, decode, verify), `packages/pir` (the XOR maths), `services/pir` (the servers), `packages/client/src/pir.ts` (the client). The tests pin the vector below. Change the doc, the code and the vector together, and bump to a `lookout.v1.*` schema.

Written by Dev B so the PIR work could start. It fills the file `WORK_SPLIT.md` assigns to Dev A's indexer, which should produce exactly this layout.

## Shape

| Item | Value |
| --- | --- |
| Buckets | 16,384 (`bucketCount`, tunable) |
| Bucket size | 512 bytes. The table is 8 MiB, which is what the PIR servers hold |
| Hash table | 16,384 x 32 bytes = 512 KiB. The client downloads all of it, so fetching it reveals nothing about the target |
| Root | one hash over the hash table. Published in the `snapshot` entity as `rootHash` |

## Lookup keys and two-choice hashing

Every record has a 32-byte **lookup key**:

- target: the `targetHash` from `schema.md`
- stealth bounty: `keccak256("lookout-bounty-key-v0:" + reportId)`

Two **distinct** candidate buckets per key (`u32` is big-endian, `n` = `bucketCount`):

```
a = u32(key[0..4])  mod n
b = ( a + 1 + ( u32(key[4..8]) mod (n - 1) ) ) mod n          // never equal to a
```

The client always queries both, so a hit and a miss look identical on the wire.

## Bucket

```
bucket = used (u16 BE, counts these 2 bytes too) || record || record || ... || zero padding      // 512 bytes
```

## Record

```
record = kind (1) || keyPrefix (16) || bodyLength (1) || body
```

`keyPrefix` is the first 16 bytes of the lookup key. 128 bits makes a false match negligible and saves 16 bytes per record.

| `kind` | Meaning | `body` |
| --- | --- | --- |
| `1` | target | `flags (1) || signalCount (1) || signal x signalCount` |
| `2` | bounty | `tier (1) || ephemeralPublicKey (33, compressed)` |

`flags` bits: `1` disputed, `2` re-checkable proof attached, `4` ruling = block, `8` ruling = clear.

### Signal (16 bytes)

| Bytes | Field | Notes |
| --- | --- | --- |
| 0 | source type | `0` community, `1` feed, `2` checker, `3` verifier, `4` ruling |
| 1 | level | `1` block, `0` warn |
| 2-3 | weight | `u16 BE`, `round(weight x 65535)`. Accurate to 1/65535, so the 0.5 threshold edge survives |
| 4-7 | createdAt | `u32 BE`, epoch seconds. The client computes the age |
| 8-15 | entity key | first 8 bytes of the Arkiv entity `$key`, so the explorer can fetch the entity |

At most **8 signals** per target. The strongest signal of **every** source type is kept first, because scoring needs one per type, then the rest by weight. A target record is `20 + 16 x n` bytes, so a 3-signal target is 68 bytes.

## Building (deterministic)

1. Encode every record.
2. Sort the encoded records as lowercase hex strings. **Input order must never change the output.**
3. Place each in the emptier of its two candidate buckets (ties go to `a`). If neither has room, the build **fails** with "bucket overflow". Raise `bucketCount`. Records are never dropped silently.

The same records give byte-identical buckets on any machine, so independent indexers publish the same root and a wiped system rebuilds to it.

## Hashes and root

```
bucketHash[i] = keccak256( "lookout-bucket-v0" || u32(i) || bucket[i] )          // the index is bound in
hashTable     = bucketHash[0] || bucketHash[1] || ...                              // 32 bytes each
root          = keccak256( "lookout-root-v0" || u32(bucketCount) || hashTable )
```

Binding the index stops a server answering a query for bucket `i` with a different, validly hashed bucket. `snapshotId` is a label and is not in the root, so independent indexers agree on the root for the same data.

## Private lookup

1. Fetch `GET /snapshot/latest` from both servers. They must agree on the snapshot id and the root.
2. Fetch `GET /snapshot/:id/hashes` (512 KiB). Check `root` over it matches the announced root **and** a `snapshot` entity on Arkiv. Only then is a result `verified: true`.
3. For each candidate bucket `i`: make a random bit vector `r` of `bucketCount` bits (bit 0 is the top bit of byte 0, padding bits zero). Send `r` to server A and `r` with bit `i` flipped to server B via `POST /pir/query` `{snapshotId, vector (base64)}`. Each returns the XOR of the buckets its vector selects (512 bytes).
4. XOR the two answers to get bucket `i`. Check its `bucketHash` against the verified table.
5. If any check fails, drop that server pair and try the next operator pair. If all fail, the lookup fails. It never falls back to an unverified verdict.
6. Search both buckets for the key prefix and decode.

Each server sees only a uniformly random vector. Privacy holds as long as the two servers do not collude.

## Test vector

Key: `targetHash(domain, example.com)` = `0x2f82eafa4c5209aa62b23f7c721d9cbb14653247a84ba849ad94b042d00483e7`. One record, `flags = 0`, one signal (feed, block, weight 1, createdAt 1700000000, entity key `0x0000000000000001`), `bucketCount = 16`.

| Item | Value |
| --- | --- |
| candidate buckets | `10`, `2` |
| placed in | bucket `10` (first one with room is the emptier, both empty) |
| `used` | `38` |
| record bytes | `012f82eafa4c5209aa62b23f7c721d9cbb1200010101ffff6553f1000000000000000001` |
| root | `0x826224403b487934e2978114707eac4e3fdb77f9bf811af9611863d4162b5951` |

The record layout and candidate formula were decoded by a separate Python implementation written from this document, and matched.

## Limits, stated honestly

- **Collusion:** two servers that share their logs learn the target. Run two independent operators. At local demo scale both run on one host, and the demo must say so.
- **Reason detail is thin.** Signals carry the entity key, not the source name or note, so a reason shows an entity id. The explorer resolves the rest.
- **Capacity:** about `(510 / recordSize)` records per bucket with two-choice placement. Overflow fails the build instead of dropping data.
- **Sizes leak a little.** Every answer is exactly 512 bytes and every lookup makes two queries per server, so volume and timing are visible to a server, but the target is not.
- **The hash table is public to anyone who asks a server**, which is fine: it holds only hashes of buckets.
- **Roots on Arkiv are the trust anchor.** If the indexer set is compromised, clients accept a bad table. That is why several independent indexers publish roots and a client needs a match with any one it trusts.
