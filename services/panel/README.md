# Panel service (trust layer)

What decides disputed reports and moves the money. The rules live in `@lookout/core` and are pure; this package only moves data.

| Piece | Where | What it does |
| --- | --- | --- |
| Reputation rules | `packages/core/src/reputation.ts` | gain on confirmed, 2x loss on rejected, juror win/loss, 30 day half-life, floor 0. Deterministic, so every indexer reaches the same scores |
| Juror draw + tally | `packages/core/src/panel.ts` | seed-based draw, one human = one seat (World ID nullifier), reporter and disputer excluded, commit-reveal tally, quorum, non-reveal counts as a loss |
| Case settlement | `src/settle.ts` | ruling on Arkiv, escrow confirm/reject, slash losers, stealth bounty, reputation events. Every step is journaled, so a crash is repaired by running it again |
| Round driver | `src/driver.ts` | moves a case through seed block, commit round, reveal round, ruling or a fresh round. Restart-safe, one broken case never stops the others |
| Adapters | `src/adapters.ts` | candidates from World ID seats plus escrow stake plus reputation. The Arkiv vote and block readers are untested until a live run |
| Stake mirror | `src/mirror.ts` | escrow `Deposited`/settled events become Arkiv `stake` entities |
| Checkpoint job | `src/checkpoint-job.ts` | next reputation checkpoint from the last one plus new events, published as `reputation` entities. The indexer reads them (`services/indexer/src/checkpoint.ts`) |
| Escrow contract | `contracts/src/LookoutEscrow.sol`, client `packages/escrow` | deposits, bounty pool, reviewer stakes |

## Trust limits, stated plainly

- One resolver key decides confirm/reject and slashes. It cannot take anyone's deposit for itself (forfeits go to the pool), pay a bounty twice, or touch a stake beyond slashing it into the pool. It is still one key and can be wrong or compromised. Anyone can recompute the tally from the revealed votes and the ruling payload (seed, jurors, counts).
- The draw seed is the hash of an Arkiv block `seedDelayBlocks` after the case opened, so nobody could know it at open time. A block proposer could still bias a hash slightly, so this is not a randomness beacon.
- Sybils: a seat needs a World ID nullifier, a stake, and reputation. A seat is not yet bound to a wallet by a signature (open item).
- Nothing yet OPENS cases from real reports: the ruling writer needs the target's plaintext (kind and value), and a report entity only carries its hash. Decide where the plaintext comes from (the disputer supplies it, or the report payload) before wiring this.
- A service entry point that runs `tick()`, the mirror and the checkpoint job on a timer is not written.

## What has run live

`npm run panel:live` (Arkiv Rabdi plus the deployed Sepolia escrow) passed on 2026-11-07: the Arkiv block and vote readers, a reputation checkpoint published by the job and read back by the indexer's own reader and rules, the stake mirror driven by the real escrow deposit events, and the round driver end to end on real blocks (seed block, draw, commit, reveal, ruling, seed re-verified from the chain). `npm run escrow:smoke` does a real deposit, confirm and claim on Sepolia, and `npm run arkiv:trust-smoke` writes every trust entity kind.

## Still not run live

- Settlement against live Arkiv AND the live escrow together. Each half is proven separately (settlement on a local EVM, rulings on Arkiv), and the one wallet here is both reporter and juror candidate, so the exclusion rules block a single-wallet run.
- The browser wallet path (`app/src/wallet/ports.ts`), in particular the Arkiv SDK signing through a browser account.
- More than one juror, and the World ID seat pool feeding candidates.
