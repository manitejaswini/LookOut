> **Note (2026-11-07):** this is the ORIGINAL design document. What was actually built differs: there is no reviewer vote or panel (a trusted source corroborates a report, and one operator key rules in public), no stealth-address bounty (a bounty is credited to the reporter inside the escrow), and no Ethereum Foundation track work. See `README.md` for what exists.

# Lookout: PRD (ETHGlobal Mumbai 2026)

Nov 6, 2026 · @Rohit

## Overview

Lookout is a pre-sign safety check for wallets and AI agents: scam intel lives on Arkiv, trust is weighed by reputation and stake instead of wallet count, and lookups are private.

**One line:** Nobody owns the list, nobody sees your query, and a thousand fresh wallets can't block a real site.

**Goals**

- Return a block, warn or unknown verdict for a domain, address or contract before the user signs.
- Keep scam data on Arkiv as owned, expiring entities, so the list is community-owned and rebuildable.
- Resist fake-wallet reporting with reputation, deposits and a reviewer panel.
- Make lookups private (2-server PIR) and verifiable against a root published on Arkiv.
- Serve both human wallets and AI agents through the same API.

**Non-goals (for the hackathon)**

- A production DAO with token governance.
- Browser extension distribution or a real MetaMask integration (we demo with our own wallet-style page and a Snap-like mock).
- Covering every chain. We target Ethereum testnet addresses and web domains.
- Claiming "safe". The system only says block, warn or unknown.

**Sponsor tracks**

| Track | What we target | Prize fit |
| --- | --- | --- |
| Arkiv: Build from scratch | Reports, verdicts, disputes, rulings, reputation and bounties as Arkiv entities with owners and expiry | User-visible block/warn reads directly from Arkiv |
| Ethereum Foundation: CROPS | PIR lookups, stealth bounties, no relayer, no trackers, FOSS | Lead property is privacy, shown at the moment of lookup |
| Optional third slot | ENS for owner identity on disputes | Not required |

## Problem

Users sign transactions on fake sites because the scam check is slow, centralized and not private, and open reporting is easy to game.

**1. Lists lag behind scams.** Scam sites and drainer contracts are created and abandoned within minutes. A vendor list updated every few hours is always behind the newest campaign.

**2. One company owns the list and sees the query.** Wallet warnings today come from a security vendor. A wallet that checks a site or transaction must tell that vendor what the user is about to do. Sources disagree on how much of this runs locally, so the safe claim is that users depend on one party's list and trust its handling of their queries.

**3. Open reporting is gameable.** Anyone can create thousands of wallets. A system that counts reports lets one attacker flag a legitimate project as a scam, or flood the list so real warnings are lost.

**4. False flags have no clean fix.** A real project that is wrongly flagged must contact a vendor and wait. There is no public, owner-controlled way to dispute.

**5. AI agents sign without a human.** Agents move funds with no person reading the popup. Prompt-injection drains have already happened, and agent wallets need a machine-readable check that works the same way a human's does.

**6. Stale and sensitive data lingers.** Flags that are never cleaned up keep blocking sites that were later fixed or sold, and lookups of the same site leak what a user is doing.

**Scenario.** Priya opens a fake airdrop site that went live 8 minutes ago and signs. Ten minutes earlier another victim was drained by the same site, but no list had caught up and her wallet could not tell.

## Stats

Scams cost users billions a year and are shifting toward impersonation and AI-agent targets, which a fast, shared, private check addresses. These figures come from research earlier in this project. Source links are not attached yet, so verify each one before presenting it to judges.

| Stat | Figure | Source (verify) | Caveat |
| --- | --- | --- | --- |
| Onchain scam revenue, 2025 | At least $14B (about $17B with later updates) | Chainalysis | Estimate that gets revised upward as data arrives |
| Impersonation scams | Up about 1,400% year on year | Chainalysis | Percentage from a small base |
| Wallet-drainer phishing, 2025 | $83.85M lost, 106,106 victims | Scam Sniffer | EVM drainers only, and down 83% from $494M in 2024 |
| Phishing losses, H1 2026 | About $366M | Industry report from earlier research | Confirm exact source and scope |
| Address poisoning | About 270M attempts, 17M victims, at least $83.8M lost | Industry research | Multi-year window; confirm scope |
| Phishing domain lifetime | About 60% live under 10 minutes | Google research cited earlier | Why lists lag |
| AI agent activity | About 176M onchain transactions, over $73M settled (May 2025 to Apr 2026) | Industry research | Shows agents are real signers |
| Agent wallet incident | Grok-linked wallet drained about $150K to $180K via prompt injection, May 4 2026 | News coverage | Single incident |
| Agent platform response | Bankr paused after 14 wallets were hit | News coverage | Single incident |

**How we use these:** the Chainalysis and Scam Sniffer figures set the size of the problem, the domain-lifetime figure justifies expiring entries and fast ingestion, and the agent figures justify the agent tool.

**Honest framing:** drainer losses fell sharply in 2025 while impersonation grew, so the pitch is that attacks keep changing form, not that every number is going up.

## Solution

Lookout collects signed threat signals as Arkiv entities, scores them by source type and reputation, and answers wallet and agent queries privately with a block, warn or unknown verdict.

**End-to-end flow**

1. **Report.** A reporter posts a scam report with a deposit. It is an Arkiv entity owned by their wallet and expires in 24 hours unless confirmed.
2. **Verdicts.** Open scam feeds, our own contract and domain checker, and other verifiers post signed `verdict` entities.
3. **Index.** Indexers read Arkiv by attribute filters, build a bucketed lookup table, and publish its root hash as a `snapshot` entity.
4. **Check.** Before signing, a wallet or agent runs a private lookup (2-server PIR), verifies the result against the snapshot root, and gets the verdict.
5. **Decide.** The scoring rule returns block, warn or unknown.
6. **Dispute.** The real owner posts an `attestation` from the deployer or ENS wallet. A blocking flag becomes a reviewer case.
7. **Rule.** A panel of staked, random reviewers votes with a hidden-then-reveal scheme and posts a `ruling`.
8. **Settle.** Correct reporters get their deposit back plus a bounty at a stealth address. Wrong reports lose the deposit, and reputation updates from rulings.

**Decision rules**

| Verdict | Condition | What the user sees |
| --- | --- | --- |
| Block | High-reputation signals from 2 or more different source types, or a reviewer ruling, or proof anyone can re-check | Red stop with the reasons and sources |
| Warn | Signals exist but sources disagree, only low-reputation reports, or the target is under dispute | Yellow caution with what is known |
| Unknown | No signal found | Neutral message. Never "safe" |

**Re-checkable proof** means evidence a third party can verify without trusting us, for example a contract matching a known drainer bytecode pattern or a domain redirecting to a flagged address.

**Scenario with Lookout.** The earlier victim's report, an open-list hit and our checker's drainer finding give three source types. Priya's wallet gets a block and she does not sign. If the site were legitimate, its owner would post a dispute, the block would drop to a warning, and reviewers would rule.

## Users and use cases

Five roles use Lookout, and the first two are the consumers we demo.

| Role | Need | What they do in Lookout | Demo? |
| --- | --- | --- | --- |
| Wallet user | Know if a site or transaction is a scam before signing | Private lookup, read block/warn/unknown with reasons | Yes |
| AI agent | Machine-readable check before sending funds | Calls a `check_target` tool and gets the same verdict as JSON | Yes |
| Reporter | Flag a scam and be rewarded | Posts a report with a deposit, receives a stealth bounty | Yes |
| Project owner | Clear a false flag fast | Posts an attestation from the deployer or ENS wallet | Yes |
| Reviewer | Settle disputed or blocking cases | Votes in a hidden-then-reveal round, earns or loses reputation | Seeded panel |

**Use cases**

- **Pre-sign check:** a wallet calls Lookout before showing the Sign button.
- **Agent guardrail:** an agent calls the tool before any transfer and aborts on block.
- **Community reporting:** victims and researchers post reports that expire unless confirmed.
- **Owner dispute:** a legitimate project replies on-chain and triggers review.
- **Audit:** anyone can query Arkiv to see who flagged what and when, and rebuild the lookup.

## Why Lookout is better

Existing tools each solve one part: vendors are fast but centralized, open blocklists are transparent but download-all and slow to update, and report portals collect data but do not feed a pre-sign check. Lookout combines community ownership, anti-gaming and private lookup. The table describes typical designs by category. Check each named product's current behavior before making a claim about it on stage.

| Dimension | Vendor security API (for example the kind wallets integrate today) | Open blocklist (for example MetaMask's phishing list) | Report portal (for example Chainabuse) | Lookout |
| --- | --- | --- | --- | --- |
| Who owns the data | The vendor | Maintainers of the repo | The operator | Entry owners on Arkiv, rebuildable by anyone |
| Does the checker see the query | Often yes, or unclear | No if downloaded wholesale | Not applicable | No (2-server PIR) |
| Freshness | Vendor update cycle | Maintainer merge cycle | Depends on submissions | Reports in minutes, expire in 24h unless confirmed |
| Fake-report resistance | Internal, not visible | Maintainer review | Limited, mostly manual | Reputation weight, deposits, reviewer panel |
| Owner dispute | Support ticket | Pull request or issue | Varies | On-chain attestation from owner wallet |
| Verifiable by the client | No | Partly (public repo) | No | Yes, against a root published on Arkiv |
| Agent-ready | API, vendor terms | Possible | Not designed for it | Tool call returning JSON |
| Handles growth | Server-side | List grows and devices must carry it | Not applicable | PIR keeps the client small as the list grows |

**Where we are honestly weaker**

- Vendors have years of data and tuned detection. Lookout starts with open feeds plus its own checker and relies on community growth.
- At demo scale, downloading the whole list would also work. PIR pays off when the list is large and changes fast.
- Two-server PIR assumes the servers do not collude.

**The position:** vendors tell you what they know, Lookout lets the community prove it, and neither the list owner nor the checker learns what you asked.

## Trust model

Trust is weighed by earned reputation, locked stake and independent source types, never by wallet count. This is the fix for the "one person, 1,000 wallets" attack that the judges raised. All numbers below are proposed defaults to tune during the build.

**Mechanisms**

| Mechanism | Rule | Why it stops fake wallets |
| --- | --- | --- |
| Reputation | New wallets start at 0. It rises when a report is confirmed, falls twice as fast when rejected, is non-transferable and decays over time (proposed half-life 30 days) | 1,000 new wallets times weight 0 is still 0 |
| Deposit | Each report locks a deposit (testnet: 0.01 ETH). Confirmed: returned plus bounty. Rejected: forfeited | Every fake report costs money |
| Source types | Signals group into types: community report, open feed, own checker, third-party verifier, reviewer ruling. A type counts once, however many wallets back it | Volume inside one type cannot reach the block threshold |
| Block rule | Block needs 2 or more different source types above a weight threshold, or a reviewer ruling, or re-checkable proof | Low-reputation reports can only warn |
| Reviewer panel | 5 reviewers drawn at random from staked wallets above a reputation floor. Hidden vote, then reveal. Majority wins. Reviewers on the losing side lose reputation and a slice of stake | Hard to buy a panel in advance, and no reviewer can copy another's vote |
| Owner attestation | A dispute from the deployer or ENS wallet marks the target as "disputed" and opens a case. It never auto-overrides | Owners get a voice without a veto |
| Expiry | Unconfirmed reports vanish in 24h | Spam does not accumulate |

**Report weight**

```latex
w_{report} = \min\left(1, \frac{rep_{wallet}}{rep_{cap}}\right)
```

A source type's score is the largest report weight inside that type (so a flood of weight-0 reports from one type adds nothing). Block requires at least two type scores above the threshold.

**Attack walkthrough**

| Attack | Defence | Residual risk |
| --- | --- | --- |
| 1,000 fresh wallets flag a legitimate site | All weigh about 0, they can only trigger a warning, and each loses its deposit if the panel rejects | Attacker burns money to annoy with warnings |
| Attacker slowly farms reputation, then strikes | Decay, doubled penalty on rejection, and a block still needs a second source type or a ruling | Patient, well-funded attacker raises the cost, not to zero |
| Attacker bribes reviewers | Random selection at ruling time, stake slashing, hidden votes | Collusion remains possible with enough budget |
| Real project is falsely flagged | Owner attestation moves it to "disputed" and a panel rules | Short window of warning |
| Scammer disputes their own scam | Attestation never auto-clears. It opens a case, and re-checkable proof still blocks | Needs reviewer attention |

**Cold start.** The first reviewer panel is seeded by the team and the reputation floor is lowered for the demo. We say so openly and describe how it opens up later.

**Reputation versus privacy.** Reputation ties reports to a wallet. Reporters can get stealth payouts but cannot hide the reputation they earned. An anonymous first report starts with low weight by design.

## Privacy design

No server learns which target a user checked, no relayer pays for or sees reporter payouts, and the client verifies every answer. This is the Ethereum Foundation CROPS lead property.

**1. Private lookup with 2-server PIR**

PIR (private information retrieval) lets a client fetch one record without the server learning which one.

- The index is split into about 16,000 fixed-size buckets of 512 bytes each. A target maps to a bucket by hashing, with two candidate buckets (two-choice hashing) so lookups succeed reliably. The client always queries both candidates, so a hit and a miss look identical.
- To fetch bucket `i`, the client creates a random bit vector `r`, sends `r` to server A and `r` with bit `i` flipped to server B. Each server returns the XOR of the buckets its vector selects. The client XORs the two answers and gets bucket `i`.
- Each server sees only a random-looking vector, so a single server learns nothing. Privacy breaks only if the two servers collude, and we state that assumption openly.
- Cost at demo scale: each query is about 2 KB, each server scans about 8 MB, each answer is 512 bytes.

**2. Verifiable answers**

- Each snapshot has a bucket-hash table of about 512 KB. The client downloads it wholesale, so fetching it reveals nothing about the target.
- Several independent indexers publish the table's root hash as `snapshot` entities on Arkiv. The client checks that the table matches a root, then checks that the returned bucket matches its hash.
- On a mismatch the client retries with another server pair. A lying server is detected, not trusted.

**3. Stealth bounties with no relayer**

- The report carries the reporter's stealth meta-address (a spending key and a viewing key), in the style of ERC-5564.
- To pay, Lookout picks an ephemeral key, derives a one-time stealth address from the reporter's meta-address, and sends native ETH to it. The ephemeral public key goes into a `bounty` entity on Arkiv, which acts as the announcement.
- The reporter finds their payout by looking up their own `reportId` through PIR, derives the private key with their viewing and spending keys, and spends from the address.
- Because the address holds native ETH, it pays its own gas. No relayer is needed and no gas-funding transaction links it to the reporter's main wallet.
- We do not use ERC-5564 view tags to filter server-side. The recipient needs the ephemeral key to compute a tag, so a tag cannot narrow a search.
- Stretch goal: sweep the stealth address using an EIP-8141 frame transaction on the EF alternative-mempool devnet. This is a draft proposal, so treat it as optional.

**4. Read-path privacy (stretch)**

- Route chain and Arkiv reads through an IP-hiding RPC path (the EF Anon-RPC track). Network support is unverified. Check Sepolia and Arkiv support before promising it.
- Lookups from end users never query Arkiv by target. Only indexers and auditors use attribute filters.

**5. On-device keys and no trackers**

- Meta-address keys, reporter keys and the verdict cache stay on the user's device.
- No third-party analytics or trackers anywhere in the app.

**CROPS mapping (for the README section)**

| Property | How Lookout meets it |
| --- | --- |
| Censorship resistance | Reports are Arkiv entities owned by their writers. No single party can delete or hide them, and anyone can run an indexer |
| Open source | Everything is public under a FOSS license, and the lookup can be rebuilt from Arkiv |
| Privacy | PIR hides what you checked. Stealth bounties hide who got paid. Keys stay on device |
| Security | Answers are verified against a root on Arkiv. Anti-Sybil design limits fake-report attacks |

**Known privacy limits**

- Arkiv attributes are plaintext, so sensitive data must be encrypted or kept off Arkiv.
- Expired Arkiv entities leave queryable state but remain in transaction history, so expiry is not erasure.
- One-time Arkiv writer keys need gas, which can link them to the account that funded them. We report this as Arkiv feedback.

## Architecture and Arkiv data model

Writers put signed entities on Arkiv, indexers turn them into private lookup buckets, and clients query two PIR servers and verify the answer against a root on Arkiv.

&#91;embedded content: architecture · clients, PIR servers, indexers, Arkiv, writers\]

Clients never query Arkiv by target. Only indexers and auditors use attribute filters, so the lookup path stays private.

**Components**

| Component | Job | Runs where |
| --- | --- | --- |
| Client SDK | PIR client, snapshot verifier, scoring, check\_target API for wallets and agents | In the wallet page or agent process |
| PIR servers A and B | Hold identical bucket files and answer XOR queries. Run by two independent operators | Two separate hosts |
| Indexer | Reads Arkiv with attribute filters, computes the reputation and scoring inputs, builds buckets and the bucket-hash table, publishes `snapshot` | Any host. At least two independent ones for the demo |
| Checker | Fetches a domain or contract and looks for re-checkable proof (drainer bytecode pattern, redirect to flagged address). Posts `verdict` | Backend worker |
| Feed importers | Pull open scam lists and post them as `verdict` entities with a source id | Backend worker |
| Escrow contract | Holds report deposits and the bounty pool on an Ethereum testnet. Arkiv entities mirror its state. Chain to confirm | Ethereum testnet |
| Panel service | Draws reviewers, tracks rounds, posts `ruling` (seeded for the demo) | Backend worker |

**Arkiv entity schema** (this becomes `/arkiv/schema.md`)

| Entity | Plaintext attributes for filtering | Payload | Owner | Expiry (proposed) |
| --- | --- | --- | --- | --- |
| `report` | kind, reportId, targetHash, targetKind (domain, address, contract), category | Evidence pointer, reporter stealth meta-address (encrypted) | Reporter wallet | 24 hours, extended if confirmed |
| `verdict` | kind, targetHash, sourceType, sourceId, level (block or warn), proofHash | Short reason text, proof pointer | Source wallet | 6 hours, refreshed by the source |
| `attestation` | kind, targetHash, claim (legit or confirmed) | Proof of control (deployer signature or ENS name) | Deployer or ENS wallet | 30 days |
| `stake` | kind, reportId, status (locked, returned, slashed) | Amount, escrow tx hash | Escrow writer | Until resolved plus 7 days |
| `vote` | kind, caseId, commitHash | Reveal data after the round | Reviewer wallet | End of round plus grace |
| `ruling` | kind, caseId, targetHash, outcome | Juror list, vote tally | Panel service | 90 days |
| `reputation` | kind, wallet, snapshotId | Score | Indexer | Per snapshot |
| `snapshot` | kind, snapshotId, bucketCount | Root hash, indexer id | Indexer wallet | Keep latest few |
| `bounty` | kind, reportId | Ephemeral public key, amount tier | Payer wallet | Until claimed plus 30 days |

**Example indexer query** (illustrative; confirm the exact filter syntax against the `@arkiv-network/sdk` docs before it goes in the README):

```text
kind = 'report' && targetKind = 'domain' && category = 'drainer'
```

**Rules for the schema**

- Attributes are plaintext on Arkiv, so they hold only hashes and coarse categories, never raw user data.
- Anything sensitive (meta-addresses, evidence) is encrypted or kept off Arkiv with only a hash on it.
- Every entity has an expiry. Nothing in the system depends on an entity living forever.
- Reputation and scores can be recomputed from public entities, so no indexer is trusted blindly.

## Requirements, APIs and scoring spec

P0 items make the core demo work, P1 items add the trust and privacy story, P2 items are stretch. Build in that order.

**Functional requirements**

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Write `report`, `verdict` and `attestation` entities to Arkiv testnet with owner, attributes and expiry | P0 |
| F2 | Indexer reads Arkiv and builds a lookup of target to signals | P0 |
| F3 | Scoring returns block, warn or unknown with reasons and sources | P0 |
| F4 | Wallet-style demo page shows the verdict before the Sign button | P0 |
| F5 | Feed importer loads at least one open scam list as `verdict` entities | P0 |
| F6 | Checker finds a re-checkable proof for at least one pattern (known drainer bytecode or a redirect to a flagged address) | P1 |
| F7 | Deposit, reputation score and report weight | P1 |
| F8 | Reviewer panel with hidden-then-reveal voting and a `ruling` | P1 |
| F9 | Owner attestation changes a block to disputed and opens a case | P1 |
| F10 | 2-server PIR lookup with bucket-hash verification against a `snapshot` on Arkiv | P1 |
| F11 | Agent tool `check_target` returning JSON | P1 |
| F12 | Stealth bounty payout and claim without a relayer | P2 |
| F13 | Anon-RPC read path and EIP-8141 sweep | P2 |
| F14 | Explorer view showing entities and a report expiring | P0 |

**Non-functional (proposed targets)**

- Lookup completes in under 2 seconds at demo scale.
- Index rebuild from Arkiv alone completes in under 5 minutes, which proves Arkiv is the source of truth.
- No third-party trackers. Keys and the verdict cache stay on device.
- All code under an open-source license, with an AI-use statement in the README.

**Client API**

```ts
checkTarget(input: { kind: 'domain' | 'address' | 'contract'; value: string })
  => Promise<{
    verdict: 'block' | 'warn' | 'unknown';
    disputed: boolean;
    reasons: { sourceType: string; sourceId: string; level: 'block' | 'warn'; entityId: string; ageSeconds: number }[];
    snapshotId: string;
    verified: boolean; // bucket matched a root published on Arkiv
  }>
```

The agent tool wraps the same call. Its JSON schema takes `kind` and `value`, and it returns the object above so an agent can abort on `block` and ask a human on `warn`.

**PIR server endpoints**

| Endpoint | Purpose |
| --- | --- |
| `GET /snapshot/:id/hashes` | Returns the whole bucket-hash table (about 512 KB) for client verification |
| `POST /pir/query` | Body: snapshot id and the bit vector. Returns the XOR of selected buckets (512 bytes) |
| `GET /snapshot/latest` | Returns the newest snapshot id and the root it should match |

**Scoring (reference logic)**

```text
for each signal on target:
  weight = reportWeight(signal)        # 1.0 for feeds, checker and verifiers; reputation-scaled for reports
typeScore[type] = max(weight of signals in that type)
strongTypes = count(types with typeScore >= THRESHOLD)
if ruling exists:            return ruling.outcome (block or clear)
if proof exists:             return block
if strongTypes >= 2:         return block
if any signal and not above: return warn
if disputed:                 return warn (never auto-clear)
return unknown
```

The 2-type threshold, the 24-hour report expiry and the reputation parameters are tunable defaults. Put them in one config file so they can be changed during the demo.

**Reputation update (reference logic)**

- Confirmed report: add a fixed amount, then apply decay on each snapshot.
- Rejected report: subtract twice that amount and slash the deposit.
- Reviewer on the winning side: small gain. On the losing side: loss and a slice of stake slashed.
- Everything is recomputed from public `ruling` and `stake` entities, so any indexer arrives at the same score.

## Build plan

Build the core loop first and demo it, then add signals, trust, privacy and the submission material, in that order. The hours total about 28 and are a proposal. Resize them to the time actually left before submission.

&#91;embedded content: build roadmap · 5 phases, 5 gates, stretch at the end\]

Phase 1 is highlighted because nothing else ships without it. If time runs short, cut from the right: first stretch items, then the second independent PIR operator (run both servers on one host and label that honestly in the demo), then the agent tool polish. Never cut the Arkiv-backed block verdict or the attack demo.

**Workstreams** (assign to however many people are on the team)

| Workstream | Owns | Phases |
| --- | --- | --- |
| A: Arkiv and scoring | Schema, writers, indexer, scoring, reputation recompute | 1, 3 |
| B: Client and demo | Wallet-style page, agent tool, explorer view | 1, 5 |
| C: Privacy | PIR servers and client, snapshot verification, stealth bounty | 4 and stretch |
| D: Signals and docs | Feed import, checker, README, schema doc, friction notes, demo video | 2, 5 |

**Stack (proposed)**

| Layer | Choice |
| --- | --- |
| Language | TypeScript across client, indexer, servers and workers |
| Arkiv | `@arkiv-network/sdk` against the Arkiv testnet |
| Chain and wallets | viem against an Ethereum testnet. Escrow contract in Solidity built with Foundry |
| Crypto | `@noble/curves` and `@noble/hashes` for stealth keys and hashing |
| PIR | Plain Node servers using typed arrays for the XOR scan, and a small client library |
| Indexer cache | SQLite file, rebuilt from Arkiv on demand |
| Frontend | Vite and React demo page styled like a wallet confirm screen |

**Testing**

- Scoring: a table of cases (one source type, two types, proof, ruling, dispute) with expected verdicts.
- PIR: correctness test that fetches every bucket index and compares with direct reads. A privacy check that server logs contain only random-looking vectors.
- Verification: tamper a bucket on one server and confirm the client rejects it and retries.
- Attack simulation: a script creates 1,000 fresh wallets, files reports against a legitimate domain, and asserts the verdict never exceeds warn.
- Rebuild: wipe the indexer cache and servers, rebuild from Arkiv alone, and confirm identical snapshot roots.

**Seed data**

- Load one or more open scam feeds whose license allows redistribution (verify each license first).
- Add a few staged reports and a staged legitimate project so the dispute demo is repeatable.
- Keep all demo wallets and their addresses in a README table, as the Arkiv track requires.

## Demo and submission

The demo runs 3 minutes, shows the lead property at the moment it matters, and uses the Priya scenario end to end.

**Demo script (3 minutes)**

| Time | Action | What judges see |
| --- | --- | --- |
| 0:00 | One sentence: "Nobody owns the list, nobody sees your query." | Title and the wallet-style page |
| 0:15 | A reporter posts a report with a deposit | The entity appears in the Arkiv explorer with owner and expiry |
| 0:35 | Open the fake airdrop site in the demo wallet | Block verdict citing three source types, read from Arkiv entities |
| 1:00 | Run the attack: 1,000 fresh wallets flag a legitimate site | Verdict stays at warn, deposits are forfeited after the panel rules |
| 1:30 | The legitimate project posts an attestation | Status becomes disputed, the panel rules, the flag clears |
| 1:55 | Private lookup: show both PIR servers' logs | Only random-looking vectors, no target. Client reports verified against the Arkiv root |
| 2:20 | AI agent calls `check_target` before a transfer | The agent aborts on block |
| 2:35 | Stealth bounty claimed from a fresh address (if built) | Payout arrives with no relayer and no link to the reporter's main wallet |
| 2:50 | Show a report expiring, then close with "wipe our servers, rebuild from Arkiv" | The entity leaves queryable state |

**Say "Arkiv is the source of truth", not "everything is on Arkiv".** The PIR tables and large evidence are derived data, with only their fingerprint published on Arkiv.

**Pitch lines**

- Arkiv judges: "No Arkiv, no Lookout. The data, ownership, expiry and disputes are all Arkiv entities."
- EF judges: "Nobody sees what you checked, nobody relays your payout, and a thousand fresh wallets cannot block a real site."

**Submission checklist**

Arkiv Build from scratch:

- [ ] Project built at the event, with commits showing it
- [ ] Writes to Arkiv testnet through `@arkiv-network/sdk` or JSON-RPC
- [ ] A user-visible feature that reads from Arkiv (the verdict screen)
- [ ] README lists writer wallet addresses and one runnable query
- [ ] `/arkiv/schema.md` describes every entity
- [ ] `/arkiv/friction.md` with honest feedback (plaintext attributes, expiry versus history, gas for one-time keys)
- [ ] `/arkiv/reach.md`, `/arkiv/why-arkiv.md` and `/arkiv/how-you-use-arkiv.md`
- [ ] Open-source license and an AI-use statement

Ethereum Foundation CROPS:

- [ ] Public repo under a FOSS license
- [ ] README section titled "CROPS" with one or two lines each for C, O, P and S
- [ ] Demo of 3 minutes or less showing the lead property when it matters
- [ ] No third-party trackers or analytics
- [ ] Keys and personal data stay on device

**Prize rules to remember**

- One Arkiv track prize per team, and one EF prize per project (EF judges decide which track).
- "Arkiv as a log nobody reads" does not count, so the user-visible read path matters.
- The Anon-RPC and Alt Mempool tracks are separate EF tracks with their own requirements. We only touch them as stretch goals.

## Risks, open questions and sources

The biggest risks are scope in the time left, the PIR non-collusion assumption and unverified claims about competitors and sponsor infrastructure. Say each one openly rather than letting a judge find it.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope too large for the time left | Core demo not finished | Phase order with gates. Cut from the right. Phase 1 must work before anything else |
| Two PIR servers collude | Query privacy lost | State the assumption. Use two independent operators in the demo. Mention multi-server variants as future work |
| Sybil defence limited, not eliminated | A rich, patient attacker can still cause warnings or farm reputation | Block needs a second source type, proof or ruling. Say the cost is raised, not removed |
| Reviewer bribery or cold-start bias | Panel outcomes could be skewed | Random selection, stake slashing, hidden votes, seeded panel disclosed |
| Arkiv plaintext attributes | Cannot query privately on Arkiv | Only indexers query by attribute. End-user lookups use PIR. Report as Arkiv feedback |
| Expiry is not erasure | Expired entries remain in history | Encrypt sensitive payloads and keep raw data off Arkiv |
| One-time writer keys need gas | Funding link between writer and funder | Use known writer wallets in the demo. Record as friction |
| Feed licensing | Cannot republish some vendor lists | Use only feeds whose license allows it. Verify before import |
| Claims about MetaMask or vendor data handling | Credibility loss if wrong | Sources conflict. Say "depends on one company's list" and avoid claims about their data flows |
| Anon-RPC and EIP-8141 support unverified | Stretch goals may not run | Keep as stretch. Check network support before promising |
| Novelty unverified | A judge may name prior art | Acknowledge adjacent work, for example Arkivox (a confidential ledger on Arkiv) and existing blocklists, and state the difference |

**Open questions**

- Which chain holds the escrow contract and the bounty pool, and does Arkiv testnet accept funding from it directly?
- What is the exact Arkiv query filter syntax and entity expiry API in the SDK version available at the event?
- How many independent people can run PIR servers and indexers during the demo?
- Which open scam feeds are license-compatible and large enough to be convincing?
- Does the Anon-RPC track support the networks we use?
- How many hours remain before submission, so phase hours can be resized?

**Sources and verification status**

- The event sponsor prize file (uploaded earlier) is the source for the Arkiv, EF CROPS, Anon-RPC, Alt Mempool and Mirror rules and the checklist above.
- Statistics in the Stats section come from earlier research in this project. Source links are not attached yet. Attach and verify them before presenting.
- The EF judges' expectations (stealth addresses, PIR, no relayer) and the Arkiv judges' openness to privacy and AI-agent data come from Rohit's conversations with them. They are not published sources.
- An Arkiv post on X could not be read during research (the site blocked automated access), so nothing in this document relies on it.
- Statements about how wallets such as MetaMask check transactions are unresolved. Older documentation describes local simulation plus a periodically pushed database, while a current help page describes sending transaction data to a vendor server. Treat this as unverified.
