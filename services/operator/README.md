# Operator service

What settles reports and keeps the record. The rules live in `@lookout/core` and are pure. This package only moves data.

There is **no vote and no panel**. A report is settled by evidence: a trusted source (a feed or the checker) corroborates it, or it does not.

| Piece | Where | What it does |
| --- | --- | --- |
| Resolution rules | `packages/core/src/resolution.ts` | confirm, refund or wait, from public facts. The automatic path can never forfeit a deposit |
| Reputation rules | `packages/core/src/reputation.ts` | gain on confirmed, 2x loss on rejected, half-life decay, and a floor for verified humans |
| Planner | `src/reports.ts` | which reports to act on: a payload that matches its hash AND a deposit that is LOCKED in the escrow contract (the contract is asked, not the Arkiv mirror). Also lists owner disputes with a valid proof |
| Resolver | `src/resolver.ts`, `src/settle.ts` | looks up what the trusted sources said, applies the rules, and acts: confirm (deposit plus a bounty for a verified human, in one transaction), refund, or wait |
| Operator commands | `src/cli.ts` | `rule` publishes a ruling with a public reason, `reject` forfeits a deposit, `disputes` lists owner disputes |
| Stake mirror | `src/mirror.ts` | escrow deposits and settlements become Arkiv `stake` entities |
| Checkpoint job | `src/checkpoint-job.ts` | publishes the next reputation checkpoint, with the verified-human floor. The indexer reads it |
| Service | `src/service.ts` | one pass: mirror, resolve, track disputes, checkpoint. Each part can fail without stopping the others. Also a read-only API |

## How a report is settled

| Situation | Result |
| --- | --- |
| A trusted source flags the same target AFTER the report, within the window (7 days), and is not the reporter | **Confirmed.** Deposit credited back, reputation up, and if the reporter is a verified human a bounty from the pool |
| The target was already flagged by an independent source when the report came in | **Refunded** as `already-flagged`. No bounty, so known scams cannot be farmed for rewards |
| The window closed and nothing corroborated it | **Refunded** as `not-corroborated`. Nothing is forfeited, so an honest early report is never punished for being early |
| The operator rules the report false (`reject`) | **Forfeited** to the bounty pool, and reputation falls twice as fast. This is the ONLY way a deposit is lost |

The reporter claims everything with one `claim()` on the escrow (the Funds page). Only a verified human is paid a bounty (`BOUNTY_REQUIRES_HUMAN`), so a swarm of fresh wallets cannot farm rewards.

## Disputes

The owner of a flagged wallet address signs a fixed message with that address (`core/owner-proof.ts`). The proof is checked with plain maths by every indexer, and the dispute marks the flag `disputed`. **It never clears a flag by itself.** The operator decides:

```
npm run operator -- disputes
npm run operator -- rule 0xADDRESS clear "the owner proved control and the flag came from one report"
npm run operator -- reject 0xREPORTER <reportId>
```

A ruling needs a reason, and the reason is public (the ruling's payload on Arkiv).

## Running it

```
npm run operator:run                 real timing (7 day window)
npm run operator:run -- --demo       a 10 minute window, for a recording
npm run operator:run -- --window 45  an exact window in seconds
npm run operator:run -- --once       one pass, then exit
```

Needs in `.env`: `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY` (the operator wallet, which is also the escrow resolver), `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, and optionally `ESCROW_RPC_URL`, `WORLDID_DB`, `LOOKOUT_DATA_DIR`. State lives in `~/.lookout/operator/journal.sqlite`, outside the repo on purpose (a file inside the project makes the Next dev server reload).

The API (`127.0.0.1:8790`, read only) serves `/reports`, `/reports?reportId=`, `/disputes` and `/status`. It has no write endpoint.

## Trust limits, stated plainly

- **One operator key.** It settles reports, can forfeit a deposit and publishes rulings. It cannot take a deposit for itself (forfeits go to the pool), and it can pay a bounty only to the reporter of a report it confirms, at most once and at most `bountyWei`. It can still be wrong or compromised. Every ruling has a public reason.
- **Verified humans are decided by our server.** The operator checks World ID proofs on its server, so "this wallet is a unique human" is a trust assumption, not something anyone can verify from Arkiv alone.
- **Trusted sources are a short list in `services/indexer/registry.json`.** A report is only as trustworthy as the sources that corroborate it. Opening that list up is future work.
- **Owner disputes cover wallet addresses only.** A contract has no key and a domain needs a different proof.
- **Bounties are paid to the reporter's own wallet.** There is no privacy for a payout: reputation and payouts are tied to the wallet that reported.

## What has run live

`npm run e2e:live -- --i-know-this-fakes-world-id` runs the whole loop on Arkiv Rabdi and the Sepolia escrow: a verified human's report corroborated by a trusted source, confirmed with the deposit and a bounty claimed in one transaction, a report nobody corroborates refunded, and a copied report refunded as already flagged. The "verified human" in that script is faked in the local seat database, because there is only one real World ID.

## Not yet run live

- The browser wallet paths (report with deposit, dispute, verify, funds) in a real wallet.
- A real World ID proof.
- A second, independent PIR operator.
