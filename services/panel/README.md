# Panel service (trust layer)

What decides disputed reports and moves the money. The rules live in `@lookout/core` and are pure; this package only moves data.

| Piece | Where | What it does |
| --- | --- | --- |
| Reputation rules | `packages/core/src/reputation.ts` | gain on confirmed, 2x loss on rejected, juror win/loss, 30 day half-life, floor 0. Deterministic, so every indexer reaches the same scores |
| Juror draw + tally | `packages/core/src/panel.ts` | seed-based draw, one human = one seat (World ID nullifier), reporter and disputer excluded, commit-reveal tally, quorum, non-reveal counts as a loss |
| Case settlement | `src/settle.ts` | ruling on Arkiv, escrow confirm/reject, slash losers, stealth bounty, reputation events. Every step is journaled, so a crash is repaired by running it again |
| Stake mirror | `src/mirror.ts` | escrow `Deposited`/settled events become Arkiv `stake` entities |
| Checkpoint job | `src/checkpoint-job.ts` | next reputation checkpoint from the last one plus new events, published as `reputation` entities. The indexer reads them (`services/indexer/src/checkpoint.ts`) |
| Escrow contract | `contracts/src/LookoutEscrow.sol`, client `packages/escrow` | deposits, bounty pool, reviewer stakes |

## Trust limits, stated plainly

- One resolver key decides confirm/reject and slashes. It cannot take anyone's deposit for itself (forfeits go to the pool), pay a bounty twice, or touch a stake beyond slashing it into the pool. It is still one key and can be wrong or compromised. Anyone can recompute the tally from the revealed votes and the ruling payload (seed, jurors, counts).
- The draw is only as fair as its seed. The seed must be unpredictable when the case opens (use the hash of an Arkiv block produced after it). Not wired to a live block yet, the caller passes it in.
- Sybils: a seat needs a World ID nullifier, a stake, and reputation. A seat is not yet bound to a wallet by a signature (open item).
- The commit-reveal round driver (open the case, collect commits, close, collect reveals, call `settleReportCase`) is not built yet. Settlement is.

## Not yet run live

Everything here is tested against fakes for Arkiv and a real local EVM (anvil) for escrow. Nothing has been run against the live Arkiv testnet or a deployed Sepolia escrow. `npm run escrow:deploy` does the deployment once a funded key is in `.env`.
