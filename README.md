# Lookout: a Private, Community-Owned Pre-Sign Scam Check

> **Before you send money or sign, Lookout tells you whether the address is flagged, why, and where to verify it, without learning what you asked. The data lives on Arkiv, and the people who report scams are real humans (World ID) who put money behind what they say.**

> ETHGlobal Mumbai 2026. Sponsor tracks: **Arkiv** and **World ID**. This is a hackathon build on testnets. Read [What is not done](#what-is-not-done) before trusting any claim here.

---

## The Problem in One Sentence

Wallets and AI agents sign transactions to addresses they know nothing about, and the scam lists that could warn them are either closed, trivially spammed, or ask you to reveal every address you look up.

### Three layers of the problem

1. **Checking leaks your intent.** A lookup service sees every address you ask about, so it learns who you are about to pay. The check itself becomes surveillance.
2. **Community reports are cheap to fake.** If anyone can flag any address for free, a thousand fresh wallets can blacklist an honest merchant, or flood the list so real warnings are buried.
3. **Closed lists are not accountable.** A wallet vendor's blocklist cannot be audited, appealed or reused. The owner of a wrongly flagged address has nobody to ask.

---

## The Solution: Lookout

```
Today:
  wallet  --"is 0xabc... safe?"-->  lookup service    (it now knows what you are paying)
  anyone  --"0xabc... is a scam"->  list              (free, so spammable)

With Lookout:
  wallet  --random-looking query A-->  server A   \  neither server learns the address,
  wallet  --random-looking query B-->  server B   /  and the table root is checked on Arkiv
  reporter --deposit locked in escrow--> report on Arkiv
          --confirmed only if an INDEPENDENT trusted source flags the same target later
          --bounty only if the reporter is a verified human (World ID)
```

1. **Private lookup.** Two servers each answer one random-looking question (2-server XOR PIR). The lookup table's root hash is published on Arkiv, and the client checks it.
2. **A verdict you can verify.** `block`, `warn` or `unknown`, with reasons and the Arkiv records behind them. Lookout never says "safe", only "nothing found".
3. **Community-owned data.** Reports, source verdicts, owner disputes, reputation and rulings are all Arkiv entities with an owner and an expiry.
4. **Reports cost money, and weight is earned.** A report locks a deposit. It is confirmed only by independent evidence. A thousand fresh wallets weigh nothing.
5. **One human, one wallet.** World ID gives verified humans a small reputation floor and makes them the only reporters eligible for a bounty.
6. **Pay page.** Like a wallet's scam warning, but in a page: type an address and an ETH amount and Lookout checks first. Sending anyway is allowed, and the choice is logged on your device.

---

## How a Report Is Settled

A report is judged by public evidence, not by a vote.

| Situation | Result |
| --- | --- |
| A trusted source (feed or checker) flags the same target **after** the report, within 7 days, and is not the reporter | **Confirmed.** Deposit credited back, reputation up, and a bounty if the reporter is a verified human |
| The target was **already** flagged when the report came in | **Refunded**, no bounty. Known scams cannot be farmed for rewards |
| Nothing corroborated it in time | **Refunded**, no bounty. An honest early report is never punished for being early |
| The operator rules the report false (`reject`, with a public reason) | **Deposit forfeited** to the bounty pool. This is the only way a deposit is lost |

Blocking needs two independent strong source types, an operator ruling, or proof anyone can re-check. **A report alone can only warn.**

Reputation: +10 per confirmed report, losses count double, a 30-day half-life, and verified humans have a floor of 20.

---

## What Makes Lookout Different

| | Private lookup | Verifiable data | Costly reports | Sybil resistant | Appealable |
| --- | --- | --- | --- | --- | --- |
| Wallet vendor blocklists | no | no | n/a | n/a | no |
| Open scam-report sites | no | partly | no (free) | no | informal |
| **Lookout** | **yes (2-server PIR)** | **yes (root on Arkiv)** | **yes (escrow deposit)** | **yes (World ID)** | **yes (owner signs with the address)** |

This table describes design intent. See [What is not done](#what-is-not-done) for what is only proven on testnet.

---

## Technical Architecture

```
┌──────────────────────── Browser (Next.js 16, React 19) ──────────────────────┐
│  Check / Pay / Report / Dispute / Verify / Funds screens                      │
│  @lookout/client  ── private lookup, checks the table root against Arkiv      │
│  viem + MetaMask  ── escrow deposits on Sepolia, report entities on Arkiv     │
│  IDKit            ── World ID proof of human, bound to the wallet             │
└───────────┬───────────────────────┬──────────────────────────┬───────────────┘
            │ PIR queries           │ report + dispute         │ proof
            ▼                       ▼                          ▼
   ┌─────────────────┐   ┌─────────────────────┐     ┌────────────────────┐
   │ PIR server A    │   │ Arkiv Rabdi testnet │     │ World ID verify    │
   │ PIR server B    │   │ 7 entity kinds      │     │ (server-side check │
   │ (XOR, 1 table)  │   │ owner + expiry each │     │  + seat database)  │
   └────────▲────────┘   └──────────▲──────────┘     └────────────────────┘
            │ table                 │ reads / trusted-writer rules
   ┌────────┴────────┐              │
   │ Indexer         │──────────────┘
   │ builds table,   │   publishes snapshot root + reputation checkpoint
   │ publishes root  │
   └─────────────────┘
                         ┌───────────────────────────────────────────────┐
                         │ Operator (services/operator)                  │
                         │ mirrors escrow events to Arkiv `stake`        │
                         │ settles reports by evidence                   │
                         │ publishes rulings with public reasons         │
                         └───────────────┬───────────────────────────────┘
                                         ▼
                         ┌───────────────────────────────────────────────┐
                         │ LookoutEscrow (Sepolia)                       │
                         │ deposit / confirm / refund / reject / claim   │
                         └───────────────────────────────────────────────┘
```

---

## How Arkiv Is Used

Arkiv is the shared, owner-controlled record. Nothing about a report, a verdict or a ruling lives in a private database. The chain is **Arkiv Rabdi testnet (chain id 7794095, gas in tGLM)**.

### Seven entity kinds

Each is a named schema `lookout.v0.<kind>`, has an owner, and expires by itself. Full spec: [`arkiv/schema.md`](arkiv/schema.md), snapshot format: [`arkiv/snapshot-format.md`](arkiv/snapshot-format.md).

| Kind | Written by | What it holds |
| --- | --- | --- |
| `report` | any wallet (after locking a deposit) | the reported target (domain, address or contract) and a hash of the reason |
| `verdict` | a registered trusted source (feed or checker) | `block` / `warn` plus evidence and a reason. Corroborates reports |
| `attestation` | the owner of an address | a signed dispute: a `personal_sign` message proves control of the flagged wallet |
| `stake` | the operator (mirrors the escrow) | that a deposit exists, its status, and what settled it |
| `ruling` | the operator | an explicit clear/block decision with a **public reason** |
| `reputation` | the indexer | a checkpoint of every reporter's score, including the verified-human floor |
| `snapshot` | the indexer | the root hash of the lookup table, so a client can verify what the PIR servers serve |

### Why Arkiv fits

- **Ownership and expiry per record.** A flag that nobody renews ages out, so stale accusations do not live forever.
- **Trusted-writer rules are public.** The indexer only counts `verdict` entities written by wallets in [`services/indexer/registry.json`](services/indexer/registry.json). Anyone can re-run the same rules and get the same table.
- **The table root is on-chain.** The client compares the table it is served against the published `snapshot` root, so a lying PIR server is detected.
- **Disputes are checkable by anyone.** An owner proof is plain signature recovery. No private service has to be trusted.

### Operational notes

- The entity key includes the account nonce, so a salt does not make a write idempotent. The operator checks for an existing `stake` entity before creating one and waits after a failed create.
- Arkiv errors can embed the RPC URL with the access key. `packages/arkiv/src/redact.ts` scrubs these.

---

## How World ID Is Used

World ID answers one question: **is this wallet a unique real person?**

- **Proof of Human** through IDKit 4.6, action `lookout-verified-human-v1` (override with `WORLD_ID_ACTION`).
- **Bound to the wallet.** The wallet first signs a fixed message (`humanMessage`), then the proof's signal is that wallet. A proof made for one wallet cannot seat another.
- **Checked on our server** against `developer.world.org/api/v4/verify`, then recorded in a seat database: **one nullifier and one wallet per action**. A second wallet from the same person is refused.
- **What a verified human gets:** a reputation floor of 20, and **eligibility for the bounty**. Unverified reporters can still report and always get their deposit back on a confirmation, but earn no bounty, so a swarm of fresh wallets cannot farm rewards.
- Legacy 3.0 proofs are accepted by default (`WORLD_ID_ALLOW_LEGACY`), with a `v3:` namespaced nullifier.

Code: [`packages/worldid`](packages/worldid), UI: `app/src/VerifyHuman.tsx`.

---

## Arkiv Track Submission

| Requirement | Where |
| --- | --- |
| Entities, queried fields, owners, expiry | [`arkiv/schema.md`](arkiv/schema.md) |
| Feedback for Arkiv | [`arkiv/friction.md`](arkiv/friction.md) |
| Reach | [`arkiv/reach.md`](arkiv/reach.md) |
| Why Arkiv | [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md) |
| Data quality | [`arkiv/data-quality.md`](arkiv/data-quality.md) |
| Network and SDK | Arkiv Rabdi testnet (chain id 7794095), `@arkiv-network/sdk` |

**Wallets that wrote entities** (public addresses):

- `0x37324A0CC17959Ee99233c8552e741519983573E`: the operator, indexer, and the demo `lookout-checker` and `openfeed-demo` sources. Writes `verdict`, `stake`, `ruling`, `reputation` and `snapshot`.
- `0x6046Ff995Fee7125e7459311A5152c404e73b7dF` and `0x2357225767F9Bf9f2f06F75bA6b060266822Fd34`: test reporter wallets. Write `report` and `attestation`.

**One query you can run** (read-only, needs `ARKIV_ACCESS_KEY` in `.env`):

```
npm run arkiv:query                 # live entity count per schema, and who wrote each
npm run arkiv:query -- verdict      # every live verdict with its creator and expiry block
```

**Import and write scripts** (all in this repo, re-runnable): `npm run demo:seed`, `npm run demo:flag -- <target>`, `npm run indexer:sync`, `npm run indexer:publish`, `npm run operator:run`, and `npm run e2e:live`. **Honest status:** the live verdicts are labelled demo fixtures, and there is no importer for a real external feed yet. **Data license:** the entities are created by Lookout itself, so no third-party dataset license applies. The code is MIT. No Sourcify data is used.

## The Escrow Contract

`contracts/src/LookoutEscrow.sol` (Foundry, 25 Solidity tests, plus 11 anvil client tests).

| Function | Who | What it does |
| --- | --- | --- |
| `deposit(reportId)` | reporter | locks `depositWei` (0.001 ETH) against a report |
| `confirm(reporter, reportId, withBounty)` | resolver | credits deposit, and `bountyWei` (0.0005 ETH) if the pool can pay and `withBounty` |
| `refund(reporter, reportId)` | resolver | credits the deposit back, no bounty |
| `reject(reporter, reportId)` | resolver | forfeits the deposit to the bounty pool |
| `claim()` | reporter | withdraws everything credited (pull payments) |
| `reclaim(reportId)` | reporter | gets the deposit back after the resolve window (30 days) if nobody acted |
| `fundPool()` / plain transfer | anyone | adds to the bounty pool |

The resolver can pay a bounty only to the reporter of a report it confirms, at most once, and at most `bountyWei`. It cannot take a deposit for itself.

---

## Deployed Contracts and Wallets (testnet, public addresses only)

| Item | Value |
| --- | --- |
| LookoutEscrow (Sepolia) | [`0x582c5f1c17b5ee678315dabd9b4772c2b33629ae`](https://sepolia.etherscan.io/address/0x582c5f1c17b5ee678315dabd9b4772c2b33629ae) |
| Escrow deploy block | `12079516` |
| Deposit / bounty / resolve window | 0.001 ETH / 0.0005 ETH / 30 days |
| Arkiv network | Rabdi testnet, chain id `7794095`, [explorer](https://rabdi.explorer.arkiv.network) |
| Operator, escrow resolver, `lookout-checker`, `openfeed-demo`, indexer | [`0x37324A0CC17959Ee99233c8552e741519983573E`](https://sepolia.etherscan.io/address/0x37324A0CC17959Ee99233c8552e741519983573E) (one demo wallet) |

The demo uses one wallet for several roles. A real deployment would split them.

---

## Full Flow, Step by Step

### 1. Check before paying

1. Open **Pay**, enter an address and an ETH amount.
2. The browser sends one random-looking query to each PIR server. Neither learns the address.
3. The client XORs the two answers, verifies the table root against the Arkiv `snapshot`, and shows `block`, `warn` or `unknown` with links to the Arkiv records.
4. You can still **send anyway**. That choice is stored only on your device.

### 2. Report a scam

1. Connect MetaMask (Sepolia and Arkiv Rabdi must both be permitted for the site).
2. Enter the target and a reason. MetaMask asks you to deposit 0.001 ETH into the escrow.
3. The report is written to Arkiv. The operator mirrors the deposit as a `stake` entity.
4. When a trusted source flags the same target afterwards, the operator confirms on-chain. You claim the deposit (and a bounty if you are a verified human) on **Funds**.

### 3. Verify you are human

**Verify** asks you to sign a message with your wallet, then scan a World ID QR. The server checks the proof and seats the wallet.

### 4. Dispute a flag you own

**Dispute**: sign the fixed message with the flagged address. The flag is marked `disputed` for everyone. **It never clears itself.** The operator decides:

```
npm run operator -- disputes
npm run operator -- rule 0xADDRESS clear "the owner proved control and the flag came from one report"
```

---

## Repository Structure

```
Lookout/
├── contracts/              Foundry project: LookoutEscrow.sol and tests
├── packages/
│   ├── core/               pure rules: scoring, resolution, reputation, owner proofs, report payloads
│   ├── arkiv/              entity kinds, schemas, lifetimes, trusted writers, error scrubbing
│   ├── escrow/             typed client for the escrow, plus its generated artifact
│   ├── pir/                2-server XOR PIR primitives
│   ├── client/             private lookup with root verification
│   ├── worldid/            IDKit server verification, seat database, handlers
│   └── agent-tool/         a lookup tool shape for AI agents
├── services/
│   ├── indexer/            reads Arkiv, applies writer rules, builds the table, publishes root and reputation
│   ├── pir/                the PIR server process (run two of them)
│   ├── workers/            a conservative checker that claims only what it can prove
│   └── operator/           settles reports, mirrors stakes, publishes rulings. See its README
├── app/                    Next.js app: Check, Pay, Report, Dispute, Verify, Funds, and the pitch decks
├── arkiv/                  schema.md and snapshot-format.md
├── scripts/                live end-to-end run, demo seed and flag helpers, escrow deploy and fund
└── HANDOFF.md              state, gotchas and the to-do list for the next developer
```

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Contracts | Solidity, Foundry (`forge`, `anvil`) |
| Chains | Ethereum Sepolia (escrow), Arkiv Rabdi testnet (data) |
| Web3 | viem 2.57, MetaMask |
| App | Next.js 16 (Turbopack), React 19, TypeScript |
| Identity | World ID IDKit 4.6 (Proof of Human) |
| Private lookup | 2-server XOR PIR |
| Runtime | Node 26 (type stripping), `node:sqlite`, `node:test`, npm workspaces |

---

## Local Setup

Needs Node 26+, and Foundry for the contract tests.

```bash
npm install
npm run verify                  # typecheck, every test, and the attack simulation
cp .env.example .env            # Arkiv key and a THROWAWAY wallet, never a real one
cp app/.env.example app/.env.local
```

**`.env`**: `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY` (the operator wallet), `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, optional `ESCROW_RPC_URL`.

**`app/.env.local`**: `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID`, `RP_SIGNING_KEY` (secret, server only), `WORLD_ID_ENVIRONMENT` (`production`), optional `WORLD_ID_ACTION` and `WORLD_ID_ALLOW_LEGACY`, `NEXT_PUBLIC_ESCROW_ADDRESS`, `NEXT_PUBLIC_PIR_A`, `NEXT_PUBLIC_PIR_B`, optional `NEXT_PUBLIC_SEPOLIA_RPC`.

### Run

```bash
npm run dev                                   # the app, http://localhost:3000
npm run indexer:sync                          # read Arkiv
npm run from-indexer -w @lookout/pir-server   # build the table
npm run indexer:publish                       # publish its root on Arkiv
node services/pir/src/cli.ts --dir services/pir/data --port 8801 --name A
node services/pir/src/cli.ts --dir services/pir/data --port 8802 --name B
npm run operator:run -- --demo --every 8      # --demo = a 10 minute window
npm run demo:seed                             # labelled demo flag so Pay has something to show
npm run demo:flag -- some-domain.example      # plays a trusted source for a target (DEMO fixture)
npm run e2e:live -- --i-know-this-fakes-world-id   # the whole loop on the live networks
```

### Deploy the escrow

```bash
npm run escrow:deploy      # then set ESCROW_ADDRESS and ESCROW_DEPLOY_BLOCK
npm run escrow:fund -- 0.02
```

---

## What Has Been Run Live

On Arkiv Rabdi and Sepolia, using `npm run e2e:live`: a verified human's report corroborated by a trusted source and **confirmed with the deposit and a bounty claimed in one transaction**; a report nobody corroborated **refunded**; a copied report **refunded as already flagged**; exactly one `stake` entity per report; the reputation checkpoint with the human floor read back by the indexer's own rules; and the operator's read-only API.

By hand in a real wallet: the Pay page (flagged and clean), and a report with a deposit through MetaMask, settled by the operator.

The "verified human" in the live script is faked in the local seat database, because there is only one real World ID.

---

## Trust Limits, Said Plainly

- **One operator key** settles reports and publishes rulings. It cannot take a deposit for itself, and it can pay a bounty only to the reporter of a report it confirms. It can still be wrong or compromised, so every ruling carries a public reason.
- **Trusted sources are a short list** the team controls. A report is only as trustworthy as those sources.
- **Verified humans are decided by our server.** "This wallet is a unique human" is a trust assumption, not something Arkiv alone proves. Accepting legacy 3.0 proofs lets a person who holds both credentials enroll two wallets.
- **Private lookup assumes the two servers do not collude.** Today both are run by the same person. Neither sees your address, but they can see your IP.
- **Bounties and reputation are tied to the reporter's wallet.** There is no payout privacy.
- **Owner disputes cover wallet addresses only.** A contract has no key, and a domain needs a different proof.
- **The live "flags" are demo fixtures**, labelled as such, not real detection.

## What Is Not Done

- A real World ID scan end to end after the legacy-proof fix (World App verified the person, our server had rejected a legacy proof, now accepted but not re-scanned).
- Browser wallet checks still to do by hand: claiming a refund on Funds, Dispute, and the uncorroborated-refund wait.
- A second, independent lookup operator.
- Real intelligence sources: the feed importer and checker lists that cite evidence.
- Hosting. Everything runs on one laptop. The World ID seat database is a local SQLite file, so the app needs a persistent host to enroll humans.

More detail and gotchas for the next developer: [`HANDOFF.md`](HANDOFF.md) and [`services/operator/README.md`](services/operator/README.md).

---

## AI Use

This project was built with substantial help from Claude (Claude Code). It wrote most of the code, tests and documents under the author's direction, and the author reviewed, ran and decided on it. Tests and live runs are the evidence for what works, not the model's say-so.

## Acknowledgements

- [Arkiv](https://arkiv.network): owned, expiring on-chain records
- [World](https://world.org): World ID and IDKit
- [Foundry](https://getfoundry.sh), [viem](https://viem.sh)

## License

MIT. See [`LICENSE`](LICENSE).
