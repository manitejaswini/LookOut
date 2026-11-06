# Lookout Arkiv schema (v0, proposed)

This is the contract for every Arkiv entity Lookout reads or writes. Dev A owns it. Dev B reads it and does not edit it without Dev A's OK in the pull request. It follows the PRD ("Architecture and Arkiv data model") and fills in what the PRD left open. Everything marked **Proposed** is a decision made here, not a fact about Arkiv. Everything marked **Verify** depends on the Arkiv SDK and must be checked before code relies on it (see [Open questions](#open-questions)).

The hashing rules below are implemented and tested in `packages/core/src/target.ts`. If this document and that code disagree, fix both in the same pull request.

## Conventions

- **Attributes are plaintext on Arkiv.** They hold only hashes, enums and numbers, never a raw domain, address, email or evidence. Raw targets exist only on the user's device and, for reporters, inside an encrypted payload.
- **Payload** is the entity body. Anything sensitive in it is encrypted or kept off Arkiv with only a hash on it.
- **Every entity has an expiry.** Nothing in Lookout depends on an entity living forever.
- **Owner** is the Arkiv account that created the entity. Arkiv enforces ownership, so nobody can edit another party's entry. Whether an owner is *allowed* to write a given kind is decided by the [trusted writers](#trusted-writers) rules, which every indexer applies.
- **Every entity carries two common attributes** (**Proposed**):

| Attribute | Type | Meaning |
| --- | --- | --- |
| `kind` | enum | One of the nine entity kinds below. The first filter of every indexer query |
| `schemaVersion` | integer | `0` for this document. Bump on any breaking change so old and new entities can coexist |

## Identifiers

### `targetHash` (Proposed, implemented)

```
targetHash = keccak256( namespace + ":" + normalizedTarget )     // 0x + 64 lowercase hex
```

| Target kind | `namespace` | `normalizedTarget` |
| --- | --- | --- |
| `domain` | `domain` | Lowercase punycode host. Scheme, userinfo, port, path, query, fragment and a trailing dot are dropped. A leading `www.` is **kept** because it is a different host and scams use subdomains. Must contain a dot |
| `address`, `contract` | `evm` | `0x` plus 40 hex digits, lowercased. EIP-55 checksum case is ignored |

An address and a contract share the `evm` namespace, so the same address matches whichever `targetKind` a reporter chose. `targetKind` is still stored as its own attribute for filtering.

Pinned test vectors (changing these breaks every indexer, so bump `schemaVersion` first):

| Input | `targetHash` |
| --- | --- |
| domain `example.com` | `0x2f82eafa4c5209aa62b23f7c721d9cbb14653247a84ba849ad94b042d00483e7` |
| address `0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08` | `0x9d94ab9948295ec07f20017801155c76dbf5268c25160de5e405ecf4ff9dc29f` |

Limit to be aware of: the domain rule matches an exact host. It does not group subdomains under a registrable domain, because that needs the public suffix list. A scam on `a.evil.xyz` and one on `b.evil.xyz` are separate targets. Revisit if the demo needs grouping.

### `reportId` (Proposed)

A random 128-bit value (32 hex digits), generated **by the reporter's client before anything is written**. It cannot be the Arkiv entity key, because the escrow deposit and the `stake` entity need to reference the report before or at the same moment it exists. It links `report`, `stake` and `bounty`.

### `caseId` (Proposed)

`caseId = first 16 hex digits of keccak256(targetHash + ":" + triggerEntityId)`, minted by the panel service when it opens a review. `triggerEntityId` is the `attestation` that disputed a block, or the `verdict` that is being reviewed. It links `vote` and `ruling`. Note that `case` is not an entity of its own: a case exists only as the votes and ruling that carry its id.

## Enumerations

| Name | Values | Used by |
| --- | --- | --- |
| `targetKind` | `domain`, `address`, `contract` | `report` |
| `category` | `drainer`, `phishing`, `impersonation`, `poisoning`, `other` | `report` (coarse on purpose) |
| `sourceType` | `community`, `feed`, `checker`, `verifier`, `ruling` | `verdict` (a `ruling` is also treated as this type when scoring) |
| `level` | `block`, `warn` | `verdict` |
| `claim` | `legit`, `confirmed` | `attestation` |
| `stakeStatus` | `locked`, `returned`, `slashed` | `stake` |
| `outcome` | `block`, `clear` | `ruling` |

A `community` signal comes from a `report`. All other types come from `verdict` entities. This matches `packages/core` `SourceType`.

## Entities

Expiry values are proposed defaults and live in one config file (`packages/core/src/config.ts`) so they can change during the demo. How expiry is expressed (blocks or a duration) is **Verify**.

### `report`

A scam report from a community member. Owned by the reporter.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `report`, `schemaVersion` | | common |
| `reportId` | hex128 | client generated, see above |
| `targetHash` | hex256 | |
| `targetKind` | enum | |
| `category` | enum | |

- **Payload:** evidence pointer (a hash plus where to fetch it) and the reporter's stealth meta-address, **encrypted**. Raw evidence stays off Arkiv.
- **Owner:** the reporter's wallet.
- **Expiry:** 24 hours. Extended if the report is confirmed (the extension mechanism is **Verify**: renewing an entity versus writing a new one).
- **Weight:** reputation of the owner at the snapshot, scaled by `min(1, rep / cap)`.

### `verdict`

A signed result from a source other than a community report. Owned by the source's wallet.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `verdict`, `schemaVersion` | | common |
| `targetHash` | hex256 | |
| `sourceType` | enum | `feed`, `checker`, `verifier` (and `ruling` mirrors) |
| `sourceId` | string | stable id of the source, for example `openfeed-phishing`, `lookout-checker` |
| `level` | enum | `block` or `warn` |
| `proofHash` | hex256, optional | present only when the source can give **re-checkable proof** |

- **Payload:** short reason text and a pointer to the proof (bytecode match, redirect trace).
- **Owner:** the source wallet. It must be in the trusted writers list for its `sourceType`.
- **Expiry:** 6 hours, **refreshed by the source** while the finding still holds. A feed that stops refreshing a target lets the flag fall away, which is how stale flags clear.
- **Weight:** `1.0` for feeds, checker and verifiers.

### `attestation`

The target's owner replies to a flag. Owned by the deployer or ENS wallet.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `attestation`, `schemaVersion` | | common |
| `targetHash` | hex256 | |
| `claim` | enum | `legit` (owner disputes the flag) or `confirmed` (owner confirms it) |

- **Payload:** proof of control: a deployer signature over the `targetHash`, or an ENS name that resolves to the owner. How a domain owner proves control is **Open** (see questions).
- **Owner:** the wallet that proves control.
- **Expiry:** 30 days.
- **Effect:** marks the target `disputed` and makes the panel service open a case. **It never clears a flag by itself.**

### `stake`

The record of a deposit. Mirrors the escrow contract, which is the money source of truth.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `stake`, `schemaVersion` | | common |
| `reportId` | hex128 | |
| `status` | enum | `locked`, `returned`, `slashed` |

- **Payload:** amount and the escrow transaction hash.
- **Owner:** the escrow writer (a trusted writer). The reporter does not write it, so a reporter cannot claim a stake they did not lock.
- **Expiry:** until resolved, plus 7 days.
- **Rule:** an indexer must cross-check `locked` against the escrow contract state before counting it.

### `vote`

A reviewer's hidden vote, then its reveal.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `vote`, `schemaVersion` | | common |
| `caseId` | hex64 | |
| `commitHash` | hex256 | `keccak256(outcome + salt + reviewer)`, published during the commit phase |

- **Payload:** empty during commit. After the round closes, the reveal data (`outcome`, `salt`) so anyone can verify the commit. Whether reveal is an update or a second entity is **Verify**.
- **Owner:** the reviewer's wallet. It must have been drawn for that case.
- **Expiry:** end of round plus a grace period.

### `ruling`

The outcome of a reviewer case. Written by the panel service.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `ruling`, `schemaVersion` | | common |
| `caseId` | hex64 | |
| `targetHash` | hex256 | |
| `outcome` | enum | `block` or `clear` |

- **Payload:** the juror list and the vote tally.
- **Owner:** the panel service (a trusted writer).
- **Expiry:** 90 days.
- **Effect:** overrides everything else in scoring. Anyone can recompute the tally from the revealed `vote` entities, so the panel service is not trusted blindly.

### `reputation`

A wallet's score. **Derived data**, published so clients can read it, but always recomputable.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `reputation`, `schemaVersion` | | common |
| `wallet` | address | |
| `snapshotId` | string | the snapshot this score belongs to |

- **Payload:** the score.
- **Owner:** the indexer.
- **Expiry:** per snapshot (kept while that snapshot is one of the latest few).
- **Rule:** any indexer must reach the same score from public `ruling` and `stake` entities. A `reputation` entity that disagrees with the recompute is ignored.

### `snapshot`

The fingerprint of one private lookup table. Clients check PIR answers against it.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `snapshot`, `schemaVersion` | | common |
| `snapshotId` | string | for example `snap-0412` |
| `bucketCount` | integer | 16384 at demo scale |

- **Payload:** the root hash of the bucket-hash table and the indexer id. The table itself (about 512 KB) is **not** on Arkiv.
- **Owner:** an indexer wallet (trusted writer).
- **Expiry:** keep the latest few.
- **Rule:** several independent indexers publish a root for the same `snapshotId`. A client accepts a table only if it matches a published root.

### `bounty`

The announcement of a stealth payout. Not a payment: the ETH moves on chain.

| Attribute | Type | Notes |
| --- | --- | --- |
| `kind` = `bounty`, `schemaVersion` | | common |
| `reportId` | hex128 | the only lookup key, and it is found over PIR, never by attribute query from the client |

- **Payload:** the ephemeral public key (the ERC-5564 style announcement) and an amount tier. The exact format is defined in `arkiv/stealth-format.md` (Dev B, Phase 0).
- **Owner:** the payer wallet.
- **Expiry:** until claimed plus 30 days.

## Relationships

```
report ──reportId──► stake      (money held in escrow)
   │                  └──────────► bounty   (paid out when confirmed)
   └──targetHash──┐
verdict ──targetHash──┼──► scoring ──► block / warn / unknown
attestation ──targetHash──┘     ▲
   │                            │
   └─ opens ► caseId ► vote(s) ► ruling ──┘  (a ruling overrides all)

indexer: reads all of the above ► reputation, snapshot ► PIR servers ► client
```

## Trusted writers

Arkiv guarantees *who wrote* an entity, not that they were *allowed* to. So every indexer applies the same rule before counting anything (**Proposed**):

| Kind | Who may write it | How an indexer checks |
| --- | --- | --- |
| `report` | any wallet | reputation and deposit decide its weight, not who it is |
| `verdict` | a registered source | the owner is in the source registry for that `sourceType` |
| `attestation` | any wallet | the proof of control inside the payload must verify |
| `stake` | the escrow writer | owner equals the configured escrow writer, and the amount matches escrow state |
| `vote` | a drawn reviewer | owner is in the juror list of that case |
| `ruling` | the panel service | owner equals the configured panel wallet |
| `reputation`, `snapshot` | a registered indexer | owner is in the indexer registry |
| `bounty` | the payer wallet | owner equals the configured payer wallet |

The registries (source wallets, escrow writer, panel wallet, indexer wallets, payer wallet) are a small config file that ships in the repo and is listed in the README writer-wallet table, which the Arkiv track requires. Opening the registries up beyond the team is future work, and we say so in the pitch.

## What a client can and cannot do

- **Indexers and auditors** query Arkiv by attribute, for example `kind = 'report' && targetKind = 'domain' && category = 'drainer'`. This syntax is illustrative (**Verify** against `@arkiv-network/sdk`).
- **End-user clients never query Arkiv by target.** Attributes are plaintext, so that query would reveal what the user is checking. Clients use PIR for lookups. They read only things that are not secret: the latest `snapshot`.

## Privacy and honesty notes

- Plaintext attributes mean `targetHash` is visible. A `targetHash` can be tested by anyone who guesses the target, so it hides a target only from people who cannot guess it. A scam domain is public anyway. This is why the PIR layer exists for lookups.
- Expiry is not erasure: an expired entity leaves queryable state but remains in transaction history. Never put anything in an entity that must be erasable.
- One-time Arkiv writer keys need gas, which can link them to the account that funded them. We record this in `arkiv/friction.md`.

## Open questions

These need an answer from the Arkiv SDK or a team decision before the code that depends on them is written.

1. **Expiry API:** is expiry a block count, a timestamp or a duration? Can an owner extend or refresh an entity in place, or must it write a new one? This decides how `verdict` refresh and `report` confirmation work.
2. **Attribute types and limits:** are numeric and string attributes both supported? How many attributes per entity and how large? The schema assumes strings and integers.
3. **Query filter syntax and pagination** for indexers, including filtering by owner.
4. **Updating an entity:** is `vote` reveal an update or a second entity?
5. **Domain ownership proof:** how does a domain owner prove control for an `attestation`? Options: a DNS TXT record, a signed file on the site, or an ENS name that points at the project. Contract and address owners can sign with the deployer key.
6. **Meta-address encryption:** what is the `report` payload encrypted to, and by whom can it be read? The PRD says encrypted but not to whom.
7. **Escrow chain:** which chain holds the escrow, and can Arkiv testnet interact with it? This decides how `stake` mirrors escrow state.
8. **Subdomain grouping:** do we need public-suffix aware grouping for domains, or is exact host enough for the demo?

## Changes from the PRD

For review by both devs. These were not in the PRD and are open to objection.

- Added `schemaVersion` to every entity.
- Defined `targetHash` precisely (keccak256, namespaces, normalisation).
- `reportId` is client generated, and `caseId` is derived from the target and the triggering entity.
- `stake` is written by the escrow writer, not the reporter.
- Added the trusted-writers rules, which the PRD implied but did not state.
- `report` category values are a fixed small enum.
