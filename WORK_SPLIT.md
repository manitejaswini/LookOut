# Lookout: Work split (2 developers)

Source of truth for scope is `Lookout PRD (ETHGlobal Mumbai 2026).md`. This file says **who builds what, in what order, and where the two of us meet**.

**Scope: everything.** Time is not a constraint, so there is no cut list. Every requirement in the PRD (F1 to F14), including the stealth bounty, Anon-RPC and EIP-8141 items, is in scope and has an owner. The only exception is a dependency we cannot control (for example, a network that does not support Anon-RPC yet). Then we verify it, document the result honestly and build the closest thing that works.

**Status now:** the Next.js frontend (`/app`) is built against mock data. Scoring logic exists as a pure function in `app/src/scoring.ts`. Everything else (Arkiv, indexer, PIR, contracts, checker, agent tool, stealth bounties) is still to build.

Names: **Dev A** and **Dev B**. Decide who is who.

## Split in one table

| | Dev A: Arkiv and trust core | Dev B: Client, privacy and demo |
| --- | --- | --- |
| Theme | Data, scoring, reputation, disputes, chain | What the user sees, private lookup, stealth payouts, packaging |
| PRD workstreams | A (Arkiv and scoring) + D (signals) | B (client and demo) + C (privacy) + docs and demo |
| Requirements | F1, F2, F3, F5, F6, F7, F8, F9, and the payer side of F12 | F4, F10, F11, F14, F13, and the claim side of F12 |
| Owns folders | `packages/core`, `services/indexer`, `services/workers`, `contracts`, `arkiv/schema.md` | `app/`, `services/pir`, `packages/client`, `packages/agent-tool`, `packages/stealth`, `README.md` |

Neither side blocks the other after Sync 1, because both build against the contracts below.

## Shared contracts (agree in Phase 0, then freeze)

1. **Entity schema.** Nine entity types with attributes, payloads, owners and expiry, as in the PRD table. Dev A writes `arkiv/schema.md`. Dev B reads it, never edits it.
2. **`checkTarget` API.** Exactly the PRD shape (`verdict`, `disputed`, `reasons[]`, `snapshotId`, `verified`). Lives in `packages/core/types.ts`. Today it is `app/src/types.ts`, so move it there first.
3. **Snapshot format.** 16,384 buckets of 512 bytes, a bucket-hash table (about 512 KB), a root hash, two-choice hashing of `targetHash` to two bucket indexes. Dev A produces the bucket file and hash table. Dev B's PIR servers serve it. Exact byte layout goes in `arkiv/snapshot-format.md`.
4. **Config.** One file, `packages/core/config.ts` (today `app/src/config.ts`): threshold, min strong types, rep cap, expiry, deposit.
5. **Stealth format.** Meta-address encoding, ephemeral key placement in the `bounty` entity, and the scheme id. Dev B writes it to `arkiv/stealth-format.md` in Phase 0. Dev A's payer code follows it.

## Repo layout (target)

```
/app                  Next.js frontend                                  (B)
/packages/core        types, config, scoring                            (A)
/packages/client      checkTarget, PIR client, snapshot verifier        (B)
/packages/agent-tool  check_target JSON tool                            (B)
/packages/stealth     ERC-5564 style key derivation and claim           (B)
/services/indexer     Arkiv reader, buckets, snapshot publisher         (A)
/services/workers     feed importer, checker, panel service, payer      (A)
/services/pir         PIR servers A and B                               (B)
/contracts            Escrow (Foundry)                                  (A)
/arkiv                schema.md (A), friction.md, reach.md, why-arkiv.md, how-you-use-arkiv.md (B)
```

Move `scoring.ts`, `config.ts`, `types.ts` from `app/src` to `packages/core` first. The frontend then imports from there.

## Phases and tasks

Phases are an order, not a schedule. Do not start a phase's gate until the previous gate passes. Nothing is cut: every task below gets built.

### Phase 0: Setup (both, together)

- [ ] Agree on the five contracts and the repo layout.
- [ ] Settle the open questions: which chain holds escrow, exact Arkiv filter and expiry API in the SDK version, which open feeds are license-compatible, who runs the second PIR server and second indexer.
- [ ] Create the Arkiv testnet writer wallets and note the addresses (the README table is a track requirement).
- [ ] Set up npm workspaces so packages import each other.
- [ ] Branch rules (see "Working together").

### Phase 1: Core loop

Goal: a real block verdict read from real Arkiv entities, shown on the wallet page.

| Dev A | Dev B |
| --- | --- |
| [ ] Write `arkiv/schema.md` | [ ] Move the frontend to import from `packages/core` |
| [ ] Arkiv writers for `report`, `verdict`, `attestation` with owner, attributes, expiry (F1) | [ ] `packages/client`: `checkTarget()` calling the indexer's plain lookup (no PIR yet), returning the API shape (F4) |
| [ ] Indexer v1: read Arkiv by attribute filters into SQLite, target to signals (F2) | [ ] Replace `checkTarget` in `app/src/mock.ts` with the client call, keep mock behind a flag |
| [ ] Plain `GET /lookup?targetHash=` endpoint (temporary, replaced by PIR) | [ ] Explorer reading real entities with a live expiry countdown (F14) |
| [ ] Wire `scoreTarget` to indexer output (F3) | [ ] Scoring test table: one type, two types, proof, ruling, dispute |

**Gate 1:** post a report on Arkiv, see the verdict change on the wallet page, see the entity and its expiry in the explorer.

### Phase 2: Signals

| Dev A | Dev B |
| --- | --- |
| [ ] Feed importer: every license-compatible open scam list, as `verdict` entities with a source id (F5) | [ ] Agent tool `check_target` returning the same JSON, plus an abort-on-block demo agent (F11) |
| [ ] Checker: re-checkable proof for both patterns, known drainer bytecode and redirect to a flagged address (F6) | [ ] Replace the Attack page maths with a real run against the scoring package and real entities |
| [ ] Seed data: staged reports and a staged legitimate project so the dispute demo is repeatable | [ ] Attack simulation script: 1,000 fresh wallets file reports, assert verdict never exceeds warn |

**Gate 2:** the fake-airdrop target returns block with three source types, all read from Arkiv.

### Phase 3: Trust

| Dev A | Dev B |
| --- | --- |
| [ ] Escrow contract with Foundry: deposits, bounty pool, `stake` entities mirror its state (F7). Deploy to the chosen testnet and verify it. | [ ] UI to post a report with a deposit from a connected testnet wallet |
| [ ] Reputation recompute from public `ruling` and `stake` entities, report weight, decay, doubled penalty on rejection (F7) | [ ] UI for owner attestation and the disputed state (F9, frontend half) |
| [ ] Attestation turns a block into disputed and opens a case (F9, backend half) | [ ] Case view: panel votes, reveal, ruling |
| [ ] Panel service: draw 5 random staked reviewers, hidden-then-reveal voting, post `ruling`, slash losers (F8) | [ ] ENS display on attestations (see EF7) |
| [ ] Open the reviewer panel beyond the seeded set once the contract supports staking | [ ] Tests for reputation recompute: any indexer reaches the same score |

**Gate 3:** the 1,000-wallet attack stays at warn and loses its deposits, owner attestation flips a block to disputed, a ruling clears or confirms it.

### Phase 4: Privacy

| Dev A | Dev B |
| --- | --- |
| [ ] Indexer builds buckets, bucket-hash table and root, publishes a `snapshot` entity | [ ] PIR servers A and B: `GET /snapshot/latest`, `GET /snapshot/:id/hashes`, `POST /pir/query` (F10) |
| [ ] Rebuild-from-Arkiv script: wipe cache and servers, rebuild, identical root | [ ] PIR client: random vector, two queries, XOR, always query both candidate buckets |
| [ ] A second independent indexer publishing its own snapshot | [ ] Verification against the Arkiv root, retry on a different server pair when a bucket is tampered |
| [ ] Run the second PIR operator separately from the first | [ ] Tests: fetch every bucket and compare with direct reads, tamper test, server logs show only random vectors |
| | [ ] Swap the wallet page from plain lookup to PIR, wire the existing step animation to real events |

**Gate 4:** the lookup runs over PIR, both servers' logs show no target, `verified: true` comes from a real root, and a wiped system rebuilds to the same root.

### Phase 5: Stealth bounties (F12)

| Dev A (payer) | Dev B (claim) |
| --- | --- |
| [ ] Pick an ephemeral key, derive the one-time address from the reporter's meta-address, send native ETH | [ ] `packages/stealth`: meta-address generation, keys stored on device only |
| [ ] Post the `bounty` entity with the ephemeral public key and amount tier | [ ] Claim flow: look up own `reportId` over PIR, derive the private key, spend from the stealth address |
| [ ] Pay from the escrow bounty pool when a report is confirmed | [ ] Show the no-relayer property: the address pays its own gas, no funding tx links it to the main wallet |

**Gate 5:** a confirmed report pays out to a fresh address and the reporter claims it with no relayer.

### Phase 6: Advanced EF reads and sweeps (F13)

| Dev B | Dev A |
| --- | --- |
| [ ] Check Anon-RPC support for Sepolia and Arkiv. If supported, route chain and Arkiv reads through it. If not, document it in `arkiv/friction.md` and the README. | [ ] Support the above: confirm Arkiv endpoints work through the alternate path |
| [ ] EIP-8141 frame-transaction sweep of the stealth address on the EF alt-mempool devnet. Draft proposal, verify the devnet first. | [ ] Review the sweep for correctness and key safety |

**Gate 6:** either both items run, or each has a documented, evidence-backed reason it cannot yet.

### Phase 7: Submission (both)

| Dev A | Dev B |
| --- | --- |
| [ ] `arkiv/schema.md` final, plus a runnable query for the README | [ ] README: CROPS section, AI-use statement, writer wallet table, runnable query |
| [ ] `arkiv/friction.md` (plaintext attributes, expiry vs history, gas for one-time keys) | [ ] `arkiv/reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` |
| [ ] Verify every stat's source and replace "verify" notes in the UI with real citations | [ ] 3-minute demo video following the PRD script |
| [ ] Choose and add the open-source license | [ ] Rehearse the demo, fix flaky steps, keep the mock fallback working |

## Ethereum Foundation integration (CROPS lead track)

The EF prize is judged on privacy shown at the moment of lookup. This section pulls every EF-facing task into one place. All of them are in scope.

**Tracks:** CROPS is the main EF target. Anon-RPC and Alt Mempool are separate EF tracks with their own rules, which we meet through Phase 6. ENS is the optional third slot. Only one EF prize per project, so EF judges decide which track we land in.

| # | Task | Owner | Phase | Done when |
| --- | --- | --- | --- | --- |
| EF1 | Pick the testnet (Sepolia unless Arkiv forces another) and deploy escrow with Foundry. Confirm whether Arkiv testnet can be funded from it. | A | 0 and 3 | Contract address in README, verified on a block explorer |
| EF2 | 2-server PIR lookup with verification against a root on Arkiv (the lead property) | B | 4 | Both server logs show only random vectors, `verified: true` |
| EF3 | Stealth bounty, payer side (ERC-5564 style) | A | 5 | A confirmed report pays out to a fresh address |
| EF4 | Stealth bounty, claim side over PIR | B | 5 | Funds move from the stealth address with no relayer |
| EF5 | No-relayer proof: the stealth address pays its own gas in native ETH | B | 5 | Demo step works end to end |
| EF6 | Keys on device. No third-party analytics or trackers (fonts are already bundled locally) | B | all | Network tab shows no third-party requests |
| EF7 | ENS owner identity on attestations: resolve the name on the testnet and accept it as proof of control | A (verify), B (UI) | 3 | An attestation shows an ENS name |
| EF8 | Anon-RPC read path | B | 6 | Reads route through an IP-hiding RPC, or the limit is documented with evidence |
| EF9 | EIP-8141 sweep of the stealth address on the alt-mempool devnet | B | 6 | One sweep transaction lands, or the limit is documented with evidence |
| EF10 | CROPS README section: one or two lines each for Censorship resistance, Open source, Privacy, Security | B | 7 | Section titled "CROPS" in README |
| EF11 | FOSS license and the AI-use statement | A | 7 | License file in repo root |
| EF12 | Demo shows privacy at the moment of lookup, within 3 minutes | both | 7 | Video shows both server logs and the stealth claim |

**Verify before promising on stage:** Anon-RPC network support, EIP-8141 devnet availability, and whether Arkiv testnet accepts funding from our escrow chain. The PRD marks each as unverified.

**Honest limits to state:** two-server PIR assumes the servers do not collude. Arkiv attributes are plaintext. Reputation ties reports to a wallet, so reporters can hide payouts but not earned reputation. The first reviewer panel is seeded by the team.

## Definition of done (whole project)

- [ ] Every requirement F1 to F14 works end to end, not just in mock mode.
- [ ] Arkiv judges: the verdict screen reads from Arkiv entities, and a wiped system rebuilds from Arkiv alone.
- [ ] EF judges: lookup is private over PIR, payout is stealth and relayer-free, answers are verified.
- [ ] Every submission checklist item in the PRD is ticked.
- [ ] Tests pass: scoring table, PIR correctness, tamper rejection, attack simulation, rebuild.
- [ ] From a clean clone, the demo runs start to finish.

## Working together

- **Branches:** `main` is always demoable. Work on `a/<topic>` and `b/<topic>`, merge by pull request, and the other dev reviews. Keep PRs small.
- **Folder ownership** is in the table above. Changing a shared contract (core types, schema, snapshot format, stealth format) needs the other dev's OK in the PR.
- **Sync points:** after Phase 0 (contracts frozen), at every gate (a short demo to each other), and before recording the video.
- **Commits must show work at the event.** Commit early and often. The Arkiv track checks the history.
- **No secrets in git.** Private keys and RPC keys go in `.env` files that are gitignored.

## Hand-off checklist before each gate

- [ ] Builds pass and the demo path works from a clean clone
- [ ] No secrets or private keys committed
- [ ] Schema and contract docs match the code
- [ ] Mock fallback still works if a service is down during the demo
