# Lookout: Work split (2 developers)

Source of truth for scope is `Lookout PRD (ETHGlobal Mumbai 2026).md`. This file only says **who builds what, in what order, and where the two of us meet**.

**Status now:** the Next.js frontend (`/app`) is built against mock data. Scoring logic exists as a pure function in `app/src/scoring.ts`. Everything else (Arkiv, indexer, PIR, contracts, checker, agent tool) is still to build.

Names: **Dev A** and **Dev B**. Decide who is who. Rohit and the repo owner can pick.

## Split in one table

| | Dev A: Arkiv and trust core | Dev B: Client, privacy and demo |
| --- | --- | --- |
| Theme | Data, scoring, reputation, disputes | What the user sees, private lookup, packaging |
| PRD workstreams | A (Arkiv and scoring) + D (signals) | B (client and demo) + C (privacy) + docs/demo |
| Requirements | F1, F2, F3, F5, F6, F7, F8, F9 | F4, F14, F10, F11, F12 (stretch), F13 (stretch) |
| Owns folders | `packages/core`, `services/indexer`, `services/workers`, `contracts`, `arkiv/` | `app/`, `services/pir`, `packages/client`, `packages/agent-tool`, `README.md` |
| Rough hours | ~14 h | ~14 h |

Neither side blocks the other after Sync 1, because both build against the contracts below.

## Shared contracts (agree on these in the first hour, then freeze)

1. **Entity schema.** Nine entity types and their attributes, payloads, owners and expiry, as in the PRD table. Dev A writes it to `arkiv/schema.md`. Dev B reads it, never edits it.
2. **`checkTarget` API.** Exactly the shape in the PRD (`verdict`, `disputed`, `reasons[]`, `snapshotId`, `verified`). It lives in `packages/core/types.ts`. Today it is `app/src/types.ts`, so move it there first.
3. **Snapshot format.** 16,384 buckets of 512 bytes, a bucket-hash table (~512 KB), root hash. Two-choice hashing of `targetHash` to two bucket indexes. Dev A produces the bucket file and hash table. Dev B's PIR servers serve it. Put the exact byte layout in `arkiv/snapshot-format.md`.
4. **Config.** One file, `packages/core/config.ts` (today `app/src/config.ts`): threshold, min strong types, rep cap, expiry, deposit.

## Repo layout (target)

```
/app                  Next.js frontend            (B)
/packages/core        types, config, scoring      (A)
/packages/client      checkTarget, PIR client     (B)
/packages/agent-tool  check_target JSON tool      (B)
/services/indexer     Arkiv reader, buckets, snapshot publisher  (A)
/services/workers     feed importer, checker, panel service      (A)
/services/pir         PIR servers A and B         (B)
/contracts            Escrow (Foundry)            (A)
/arkiv                schema.md, friction.md, reach.md, why-arkiv.md, how-you-use-arkiv.md  (A writes schema; B writes the rest)
```

Move `scoring.ts`, `config.ts`, `types.ts` from `app/src` to `packages/core` early. Frontend imports from there.

## Phases and tasks

Phase order is the PRD's. Build in this order and demo at each gate.

### Phase 0: Setup (both, ~1 h, together)

- [ ] Agree on the four contracts above and the repo layout.
- [ ] Create the Arkiv testnet writer wallets and note the addresses (README table is a track requirement).
- [ ] Set up npm workspaces so packages import each other.
- [ ] Branch rules (see "Working together").

### Phase 1: Core loop (P0)

Goal: a real block verdict read from real Arkiv entities, shown on the wallet page.

| Dev A | Dev B |
| --- | --- |
| [ ] Write `arkiv/schema.md` (F1 prerequisite) | [ ] Move frontend to import from `packages/core` |
| [ ] Arkiv writers for `report`, `verdict`, `attestation` with owner, attributes, expiry (F1) | [ ] `packages/client`: `checkTarget()` that calls the indexer's plain lookup (no PIR yet) and returns the API shape (F4) |
| [ ] Indexer v1: read Arkiv by attribute filters into SQLite, target to signals (F2) | [ ] Replace `checkTarget` in `app/src/mock.ts` with the client call, keep mock as a fallback flag |
| [ ] Plain HTTP endpoint `GET /lookup?targetHash=` returning signals (temporary, replaced by PIR) | [ ] Explorer view reading real entities, with a live expiry countdown (F14) |
| [ ] Wire `scoreTarget` from core to the indexer output (F3) | [ ] Scoring table test cases: one type, two types, proof, ruling, dispute |

**Gate 1:** post a report on Arkiv, see the verdict change on the wallet page, see the entity and its expiry in the explorer.

### Phase 2: Signals (P0 and P1)

| Dev A | Dev B |
| --- | --- |
| [ ] Feed importer: at least one open scam list as `verdict` entities, license checked first (F5) | [ ] Agent tool `check_target` returning the same JSON, with abort-on-block demo script (F11) |
| [ ] Checker: re-checkable proof for one pattern, drainer bytecode or redirect to a flagged address (F6) | [ ] Replace the mocked "Attack" page maths with a real run against the scoring package |
| [ ] Seed data: staged reports, one staged legitimate project | [ ] Attack simulation script: 1,000 fresh wallets file reports, assert verdict never exceeds warn |

**Gate 2:** the fake-airdrop demo target returns block with three source types, all from Arkiv.

### Phase 3: Trust (P1)

| Dev A | Dev B |
| --- | --- |
| [ ] Escrow contract: deposits, bounty pool, `stake` entities mirror its state (F7) | [ ] UI for posting a report with a deposit from a connected testnet wallet |
| [ ] Reputation recompute from public `ruling` and `stake` entities, report weight (F7) | [ ] UI for owner attestation and the "disputed" state (F9, frontend half) |
| [ ] Attestation turns a block into disputed and opens a case (F9, backend half) | [ ] Case view: panel votes, reveal, ruling |
| [ ] Panel service: draw 5 reviewers, hidden-then-reveal, post `ruling` (F8, seeded panel) | [ ] Chain config for the testnet escrow once Dev A confirms the chain |

**Gate 3:** the 1,000-wallet attack stays at warn, owner attestation flips a block to disputed, a ruling clears it.

### Phase 4: Privacy (P1)

| Dev A | Dev B |
| --- | --- |
| [ ] Indexer builds buckets, bucket-hash table and root; publishes `snapshot` entity (needed for F10) | [ ] PIR servers A and B: `GET /snapshot/latest`, `GET /snapshot/:id/hashes`, `POST /pir/query` (F10) |
| [ ] Rebuild-from-Arkiv script: wipe cache, rebuild, identical root | [ ] PIR client in `packages/client`: random vector, two queries, XOR, always query both candidate buckets |
| [ ] Second independent indexer publishing a snapshot | [ ] Verification against the Arkiv root, retry on a different server pair when a bucket is tampered |
| | [ ] Tests: fetch every bucket and compare with direct reads, tamper test, server logs show only random vectors |
| | [ ] Swap the wallet page from plain lookup to PIR. The UI already animates the steps, so wire it to real events. |

**Gate 4:** the lookup runs over PIR, both servers' logs show no target, `verified: true` comes from a real root.

### Phase 5: Submission (both)

| Dev A | Dev B |
| --- | --- |
| [ ] `arkiv/schema.md` final, plus a runnable query for the README | [ ] README: CROPS section (C, O, P, S), AI-use statement, writer wallet table |
| [ ] `arkiv/friction.md` (plaintext attributes, expiry vs history, gas for one-time keys) | [ ] `arkiv/reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` |
| [ ] Verify every stat's source before it goes on a slide | [ ] 3-minute demo video following the PRD script |
| [ ] Choose and add the open-source license | [ ] Rehearse the demo twice and fix flaky steps |

### Stretch (only after Gate 4)

- **Dev A:** stealth bounty payout side: ephemeral key, one-time address, `bounty` entity (F12).
- **Dev B:** stealth bounty claim side in the UI, then Anon-RPC read path and EIP-8141 sweep (F13). Check network support first.

## Cut order if time runs short

Cut from the right, as in the PRD: stretch items, then the second independent PIR operator (run both on one host and say so), then agent tool polish. **Never cut the Arkiv-backed block verdict or the attack demo.**

## Working together

- **Branches:** `main` is always demoable. Work on `a/<topic>` and `b/<topic>`, merge by pull request, and the other dev reviews. Small PRs, merged at least once per gate.
- **Folder ownership** is in the table above. Changing a shared contract (core types, schema, snapshot format) needs the other dev's OK in the PR.
- **Sync points:** after Phase 0 (contracts frozen), at each gate (5-minute demo to each other), and before recording the video.
- **Commits must show work at the event.** Commit early and often. The Arkiv track checks the history.
- **Open questions to settle in Phase 0** (from the PRD): which chain holds escrow, the exact Arkiv filter and expiry API in the SDK version, how many independent people can run the PIR servers and indexers, which open feeds are license-compatible, how many hours remain.

## Hand-off checklist before a gate

- [ ] Builds pass and the demo path works from a clean clone
- [ ] No secrets or private keys committed
- [ ] Schema and contract docs match the code
- [ ] Mock fallback still works if a service is down during the demo
