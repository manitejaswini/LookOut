# Lookout Arkiv schema (v0.1)

This is the contract for every Arkiv entity Lookout reads or writes. Dev A owns it. Dev B reads it and does not edit it without Dev A's OK in the pull request. It follows the PRD ("Architecture and Arkiv data model"), and since v0.1 it is checked against the Arkiv docs and the published SDK (see [Sources](#sources-and-verification)).

- **Arkiv fact**: stated by the Arkiv docs. Cited in the Sources section.
- **Proposed**: a decision made here, open to objection.
- **Verify**: not confirmed. Check in code or with the Arkiv team before depending on it.

The hashing rules below are implemented and tested in `packages/core/src/target.ts`. If this document and that code disagree, fix both in the same pull request.

## What v0.1 changed (and why)

Reading the Arkiv docs overturned several v0 assumptions. Everything below is reflected in the rest of the document.

| v0 assumption | What Arkiv actually does | Consequence |
| --- | --- | --- |
| Every entity has a free-form "payload" | **There is no payload field.** An entity is a set of typed attributes. Binary data goes in an un-indexed `bytes` attribute (up to 128 KiB per write) | Our "payload" is now an optional `payload: bytes` attribute, and small values are plain attributes |
| A common `kind` attribute filters entity types | A **named schema** tags every entity with an indexed `arkiv.schema` attribute | One schema name per entity kind (`lookout.v0.report` and so on). `kind` and `schemaVersion` are dropped. The version is in the name |
| Expiry might be a timestamp | Expiry is a **block number**. Blocks take 2 seconds. Maximum lifetime is 7,884,000 blocks, about 182.5 days | All our lifetimes fit. 24 hours is 43,200 blocks |
| Expiry can be extended by us | Only the **owner** can extend, unless the entity was created with the `permissionlessExtension` flag | See "Report confirmation" below. We do not use that flag |
| `owner` is the trusted writer | Ownership is **transferable** (`changeOwnership`). `$creator` never changes | Every authorization check uses `$creator`, not `$owner` |
| Reveal of a vote needs a second entity | Attributes can be **patched in place** by the owner (`patchEntity`) | A vote is one entity, patched at reveal |
| Escrow might live on the Arkiv chain | Arkiv's testnet (Rabdi) is its own chain with its own gas token, tGLM | Escrow stays on an Ethereum testnet and `stake` entities mirror it |
| Filter syntax `kind = 'report' && ...` | The query language uses `AND`, `OR`, and typed literals such as `str('report')` | Example queries rewritten |
| An indexer can read any attribute | Only **indexed** attributes can be filtered. Sorting works on any. A page is at most 100 rows | Each attribute below says whether it is indexed. Indexers paginate by `$key` |

## Conventions

- **Attributes are plaintext and public.** The whole Arkiv database is public. Attributes hold only hashes, enums and numbers, never a raw domain, address, email or evidence.
- **Every kind is a named schema** `lookout.v0.<kind>`. The name adds the indexed `arkiv.schema` attribute and costs one of the 32 attribute slots (so 31 are ours). Schema names are not a security boundary: anyone can write an entity with that tag, so every reader also checks `$creator` (see [Trusted writers](#trusted-writers)).
- **Column types** (Arkiv fact): `str` (UTF-8, at most **128 bytes**), `i32`, `u64`, `u256`, `dec`, `bool`, `addr`, `key` (a reference to another entity, existence not checked) and `bytes` (never indexed). We use `str` for hex hashes and enums, `addr` for wallets, `i32` for small counters, and `bytes` only for the optional payload.
- **Attribute names** start with a letter, use letters, digits, `.`, `-`, `_`, are at most 32 bytes and are case sensitive.
- **System fields** maintained by Arkiv and usable in queries: `$key`, `$owner`, `$creator`, `$createdAt`, `$updatedAt`, `$expiresAt`. We filter on `$creator` and `$expiresAt` and sort on `$key`.
- **Creation flags** cannot be changed after creation. We set `readonly` (no patching) on every kind that never needs patching, and we never set `permissionlessExtension`.
- **Every entity has an expiry.** Nothing in Lookout depends on an entity living forever.
- **Hex values** are lowercase with a `0x` prefix. A 32-byte hash is 66 bytes as a `str`, which fits the 128-byte limit.

## Identifiers

### `targetHash` (Proposed, implemented)

```
targetHash = keccak256( namespace + ":" + normalizedTarget )     // 0x + 64 lowercase hex
```

| Target kind | `namespace` | `normalizedTarget` |
| --- | --- | --- |
| `domain` | `domain` | Lowercase punycode host. Scheme, userinfo, port, path, query, fragment and a trailing dot are dropped. A leading `www.` is **kept** because it is a different host and scams use subdomains. Must contain a dot. IP addresses and bare numbers such as `0x123` are rejected, never hashed (a URL parser would silently rewrite `0x123` to the IPv4 host `0.0.1.35`) |
| `address`, `contract` | `evm` | `0x` plus 40 hex digits, lowercased. EIP-55 checksum case is ignored |

An address and a contract share the `evm` namespace, so the same address matches whichever `targetKind` a reporter chose. `targetKind` is still stored as its own attribute.

Pinned test vectors (changing these breaks every indexer, so introduce `lookout.v1.*` schemas first):

| Input | `targetHash` |
| --- | --- |
| domain `example.com` | `0x2f82eafa4c5209aa62b23f7c721d9cbb14653247a84ba849ad94b042d00483e7` |
| address `0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08` | `0x9d94ab9948295ec07f20017801155c76dbf5268c25160de5e405ecf4ff9dc29f` |

Limit: the domain rule matches an exact host. It does not group subdomains under a registrable domain, because that needs the public suffix list. A scam on `a.evil.xyz` and one on `b.evil.xyz` are separate targets.

### `reportId` (Proposed)

A random 128-bit value (32 hex digits), generated **by the reporter's client before anything is written**. It cannot be the Arkiv entity key, because the escrow deposit and the `stake` entity must reference the report before or at the same moment it exists. It links `report`, `stake` and `bounty`.

### `caseId` (Proposed)

`caseId = first 16 hex digits of keccak256(targetHash + ":" + triggerEntityKey)`, minted by the panel service when it opens a review. `triggerEntityKey` is the `$key` of the `attestation` that disputed a block, or of the `verdict` under review. It links `vote` and `ruling`. A case is not an entity of its own: it exists as the votes and ruling that carry its id.

## Enumerations

| Name | Values | Used by |
| --- | --- | --- |
| `targetKind` | `domain`, `address`, `contract` | `report` |
| `category` | `drainer`, `phishing`, `impersonation`, `poisoning`, `other` | `report` (coarse on purpose) |
| `sourceType` | `community`, `feed`, `checker`, `verifier`, `ruling` | `verdict`. A `community` signal comes from a `report` |
| `level` | `block`, `warn` | `verdict` |
| `claim` | `legit`, `confirmed` | `attestation` |
| `stakeStatus` | `locked`, `returned`, `slashed` | `stake` |
| `outcome` | `block`, `clear` | `vote` (revealed), `ruling` |

This matches `SourceType` in `packages/core`.

## Entities

Each table lists the columns. **Idx** means indexed (filterable). Columns that are not indexed are still stored, selectable and sortable. Lifetimes are given as a duration and in blocks (2 seconds each). In the SDK they are built with `ExpirationTime.fromHours(...)`, `fromDays(...)` and so on, all of which must be a whole number of blocks.

### `lookout.v0.report`

A scam report from a community member. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `reportId` | `str` | yes | client generated |
| `targetHash` | `str` | yes | |
| `targetKind` | `str` | yes | enum |
| `category` | `str` | yes | enum |
| `payload` | `bytes` optional | no | evidence pointer (hash and where to fetch it) and the reporter's stealth meta-address, **encrypted**. Raw evidence stays off Arkiv |

- **Authorized writer:** any wallet. Its weight is the creator's reputation, scaled by `min(1, rep / cap)`.
- **Lifetime:** 24 hours (43,200 blocks).
- **Report confirmation (Proposed):** a confirmed report is **not** extended. Extension is owner-only, and the alternative, `permissionlessExtension`, would let anyone pay gas to keep any report alive for up to 182 days, which defeats "spam vanishes in 24 hours". Instead, confirmation is recorded where it is anyway needed: `stake.status = returned` and the `ruling`. The indexer carries confirmed reports forward through the `reputation` checkpoint (below), so the report entity itself may expire.

### `lookout.v0.verdict`

A signed result from a source other than a community report. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `targetHash` | `str` | yes | |
| `sourceType` | `str` | yes | `feed`, `checker` or `verifier` |
| `sourceId` | `str` | yes | stable source id, for example `openfeed-phishing`, `lookout-checker` |
| `level` | `str` | yes | `block` or `warn` |
| `proofHash` | `str` optional | no | present only when the source can give **re-checkable proof** |
| `reason` | `str` optional | no | short text, at most 128 bytes |
| `payload` | `bytes` optional | no | pointer to the proof (bytecode match, redirect trace) |

- **Authorized writer:** a registered source wallet for that `sourceType` (checked on `$creator`).
- **Lifetime:** 6 hours (10,800 blocks), **refreshed with `extendEntity` by the source** while the finding still holds. A duration counts from now, so each refresh pushes expiry out another 6 hours. A feed that stops refreshing lets the flag fall away.
- **Weight:** 1.0.

### `lookout.v0.attestation`

The target's owner replies to a flag. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `targetHash` | `str` | yes | |
| `claim` | `str` | yes | `legit` (owner disputes the flag) or `confirmed` |
| `payload` | `bytes` optional | no | proof of control: a deployer signature over the `targetHash`, or an ENS name that resolves to the owner |

- **Authorized writer:** any wallet, but the proof in the payload must verify. Owners of domains are an open question below.
- **Lifetime:** 30 days (1,296,000 blocks).
- **Effect:** marks the target `disputed` and makes the panel service open a case. **It never clears a flag by itself.**

### `lookout.v0.stake`

A deposit record. Mirrors the escrow contract, which is the source of truth for money. Not `readonly`, because `status` changes.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `reportId` | `str` | yes | |
| `status` | `str` | yes | `locked`, `returned`, `slashed`. Changed with `patchEntity` |
| `amountWei` | `u256` | no | |
| `escrowTx` | `str` | no | escrow transaction hash |

- **Authorized writer:** the escrow writer (checked on `$creator`). The reporter does not write it, so a reporter cannot claim a stake they did not lock.
- **Lifetime:** until resolved, plus 7 days. Set to a safe maximum, then `extendEntity` or let it lapse.
- **Rule:** an indexer must cross-check `locked` against the escrow contract before counting it.

### `lookout.v0.vote`

A reviewer's hidden vote, then its reveal. Not `readonly`, because the reveal is a patch.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `caseId` | `str` | yes | |
| `commitHash` | `str` | no | `keccak256(outcome + salt + reviewer)`, set at creation |
| `outcome` | `str` optional | no | set at reveal with `patchEntity` |
| `salt` | `str` optional | no | set at reveal |

- **Authorized writer:** a reviewer drawn for that case.
- **Lifetime:** end of round plus a grace period.
- **Rule:** a reveal counts only if `keccak256(outcome + salt + $creator) == commitHash`. Votes that are never revealed are ignored. Because a patch overwrites the entity, the `commitHash` attribute stays untouched and is the audit trail.

### `lookout.v0.ruling`

The outcome of a reviewer case. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `caseId` | `str` | yes | |
| `targetHash` | `str` | yes | |
| `outcome` | `str` | yes | `block` or `clear` |
| `payload` | `bytes` optional | no | juror list and the vote tally |

- **Authorized writer:** the panel service wallet.
- **Lifetime:** 90 days (3,888,000 blocks).
- **Effect:** overrides everything else in scoring. Anyone can recompute the tally from the revealed `vote` entities, so the panel service is not trusted blindly.

### `lookout.v0.reputation`

A wallet's score. **Derived data**, always recomputable from the previous checkpoint plus public events. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `wallet` | `addr` | yes | |
| `snapshotId` | `str` | yes | |
| `score` | `dec` | no | |

- **Authorized writer:** a registered indexer.
- **Lifetime:** while its snapshot is one of the latest few.
- **Checkpoint rule (Proposed):** Arkiv entities live at most about 182.5 days and a `stake` or `report` lives far less. So reputation cannot be rebuilt "from genesis" out of expired entities. The latest `reputation` set is the checkpoint: a new set is computed from the previous checkpoint plus the rulings and stakes since. Rebuilding Lookout from Arkiv means: take the latest checkpoint from at least two indexers and verify they agree. This is an honest narrowing of the PRD claim "rebuild from Arkiv alone", and the pitch should say "rebuild from Arkiv" with this caveat in the notes.

### `lookout.v0.snapshot`

The fingerprint of one private lookup table. Clients check PIR answers against it. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `snapshotId` | `str` | yes | for example `snap-0412` |
| `bucketCount` | `i32` | no | 16384 at demo scale |
| `rootHash` | `str` | no | root of the bucket-hash table |
| `indexerId` | `str` | yes | |

- **Authorized writer:** a registered indexer.
- **Lifetime:** keep the latest few. Several independent indexers publish a root for the same `snapshotId`, and a client accepts a table only if it matches one of them. The table itself (about 512 KB) is not on Arkiv.

### `lookout.v0.bounty`

The announcement of a stealth payout. Not a payment: the ETH moves on chain. Flag: `readonly`.

| Column | Type | Idx | Notes |
| --- | --- | --- | --- |
| `reportId` | `str` | yes | found by clients over PIR, not by attribute query |
| `amountTier` | `i32` | no | |
| `payload` | `bytes` | no | the ephemeral public key (ERC-5564 style announcement). Format in `arkiv/stealth-format.md` (Dev B, Phase 0) |

- **Authorized writer:** the payer wallet.
- **Lifetime:** until claimed plus 30 days.

## Relationships

```
report ──reportId──► stake      (money held in escrow)
   │                  └──────────► bounty   (paid out when confirmed)
   └──targetHash──┐
verdict ──targetHash──┼──► scoring ──► block / warn / unknown
attestation ──targetHash──┘     ▲
   │                            │
   └─ opens ► caseId ► vote(s) ► ruling ──┘  (a ruling overrides all)

indexer: reads all of the above ► reputation (checkpoint), snapshot ► PIR servers ► client
```

## Trusted writers

Arkiv tells us who *created* an entity (`$creator`). It does not tell us they were *allowed* to. Every indexer applies the same rule before counting anything (Proposed). The check is always on **`$creator`**, because an owner can hand an entity to another account.

| Schema | Who may create it | How an indexer checks |
| --- | --- | --- |
| `report` | any wallet | its reputation and deposit decide its weight, not who it is |
| `verdict` | a registered source | `$creator` is in the source registry for that `sourceType` |
| `attestation` | any wallet | the proof of control in the payload must verify |
| `stake` | the escrow writer | `$creator` equals the configured escrow writer, and the amount matches escrow state |
| `vote` | a drawn reviewer | `$creator` is in the juror list of that case |
| `ruling` | the panel service | `$creator` equals the configured panel wallet |
| `reputation`, `snapshot` | a registered indexer | `$creator` is in the indexer registry |
| `bounty` | the payer wallet | `$creator` equals the configured payer wallet |

The registries are a small config file in the repo, and their addresses go in the README writer-wallet table that the Arkiv track requires. Opening them up beyond the team is future work, and we say so in the pitch.

## Querying (indexers and auditors only)

End-user clients never query Arkiv by target, because attributes are public and a target query would reveal what the user is checking. Clients use PIR and read only non-secret things such as the latest `snapshot`.

Indexer queries (SDK, Arkiv fact for the syntax):

```ts
import { and, eq, asc, gt } from "@arkiv-network/sdk/query"
import { key } from "@arkiv-network/sdk/schema"

// all drainer reports on domains
publicClient.select().from(Report)
  .where(and(eq("targetKind", "domain"), eq("category", "drainer")))
  .limit(100).fetch()
```

The same filter as a raw query string: `targetKind = str('domain') AND category = str('drainer')`.

- **Pagination:** a page is at most 100 rows. For a complete, non-repeating read, order by `$key` and continue with `gt("$key", key(lastKey))`. Offset paging can repeat or skip rows while entities change.
- **Owner or creator filters:** `.ownedBy(address)` on the builder, and `$creator` is filterable in the query language.
- **Indexed only:** filtering on a column that is not indexed does not match. That is why `targetHash`, `reportId`, `caseId`, `snapshotId`, `claim`, `status` and similar are indexed, and `commitHash`, `rootHash` and `payload` are not.
- **Sorting:** one attribute per query, and indexed or not.
- **Expired entities** are skipped by queries and no event fires on expiry. Detect expiry by selecting `$expiresAt`.

## Network and access

- **Testnet:** Rabdi. Chain ID `7794095`, block time 2 seconds, gas token **tGLM** from `hub.arkiv.network/faucet`. Import `rabdi` from `@arkiv-network/sdk/chains` (confirmed present in SDK 1.0.1).
- **Access key:** the public RPC is heavily rate limited, so get a free key from `hub.arkiv.network/access-keys`. Keep it in `.env` (gitignored). Never commit it, and never put one in client code unless it is locked to the site.
- **Writes:** `createWalletClient` with a private key from the environment on a server. A browser wallet signs for the reporter's own writes.
- **The escrow is not on this chain** (Proposed): it stays on an Ethereum testnet to satisfy the EF CROPS track, and `stake` entities mirror it. Whether Rabdi can run contracts is not stated in the docs and is not needed.

## Privacy and honesty notes

- `targetHash` is visible, and a hash only hides a target from someone who cannot guess it. A scam domain is public anyway. This is why lookups go through PIR.
- Expiry hides an entity from queries, but expiry is not erasure, so never put anything in an entity that must be erasable.
- Every writer needs tGLM for gas, so a writer key can be linked to whoever funded it. This also hits the demo attack: 1,000 fresh wallets filing reports on Arkiv each needs funding. We record it in `arkiv/friction.md` and plan the attack simulation to fund wallets from one test funder, or to run the scoring part offline.
- The `bytes` limit is shared: all `bytes` in one create or patch together are at most 128 KiB.

## Open questions

Resolved by the docs: expiry units and extension, attribute types and limits, query syntax and pagination, vote reveal as a patch, and the chain for escrow (separate). What is left:

1. **Domain ownership proof:** how does a domain owner prove control for an `attestation`? Options: a DNS TXT record, a signed file on the site, or an ENS name that points at the project. Contract and address owners can sign with the deployer key.
2. **Meta-address encryption:** what is the `report` payload encrypted to, and who may read it? The PRD says encrypted but not to whom.
3. **Does `extendEntity` work on a `readonly` entity?** The docs say `readonly` blocks patching. `verdict` refresh depends on extension still working. Test on day one.
4. **Gas cost and faucet limits:** how many writes does one faucet claim fund, and what do 1,000 attack-simulation wallets cost?
5. **Response size caps and RPC limits** for indexers reading many entities at once.
6. **Subdomain grouping:** is exact host enough for the demo?
7. **Can the docs be relied on as read?** The Sources section notes how these answers were obtained.

## Sources and verification

Read on 2026-11-06 from the Arkiv docs (`docs.arkiv.network`): `start-here/introduction`, `start-here/clients`, `writing/create`, `writing/expiration`, `writing/change`, `schemas/define`, `schemas/column-types`, `querying/without-schema`, `querying/paginate`, `reference/limits`, `reference/query-language`, `networks/rabdi`. The SDK package `@arkiv-network/sdk` version 1.0.1 was downloaded and unpacked (not run) to confirm that it exports `rabdi`.

The docs were read through a summarising fetch tool, so exact numbers should be treated as likely but unconfirmed. **The first writer pull request must assert each limit used here** (attribute counts, 128-byte strings, 7,884,000 block maximum, 100-row pages) against the real SDK constants and fail loudly if they differ.

## Changes from the PRD

For review by both devs.

- Named schemas per kind replace a `kind` attribute. No `schemaVersion` attribute: the version is in the schema name.
- There is no payload field in Arkiv, so "payload" became an optional `bytes` column plus small plain columns.
- `targetHash` is defined precisely (keccak256, namespaces, normalisation).
- `reportId` is client generated, and `caseId` is derived from the target and the triggering entity.
- `stake` is written by the escrow writer, not the reporter.
- Authorization uses `$creator`, with a trusted-writers table.
- Confirmed reports are not extended. Confirmation lives in `stake` and `ruling`.
- Reputation is a checkpoint, so "rebuild from Arkiv alone" is narrowed as described above.
- `report` category values are a fixed small enum.
