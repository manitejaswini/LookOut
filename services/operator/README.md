# Panel service (trust layer)

What decides disputed reports and moves the money. The rules live in `@lookout/core` and are pure; this package only moves data.

| Piece | Where | What it does |
| --- | --- | --- |
| Reputation rules | `packages/core/src/reputation.ts` | gain on confirmed, 2x loss on rejected, juror win/loss, 30 day half-life, floor 0. Deterministic, so every indexer reaches the same scores |
| Juror draw + tally | `packages/core/src/panel.ts` | seed-based draw, one human = one seat (World ID nullifier), reporter and disputer excluded, commit-reveal tally, quorum, non-reveal counts as a loss |
| Case settlement | `src/settle.ts` | ruling on Arkiv, escrow confirm/reject, slash losers, stealth bounty, reputation events. Every step is journaled, so a crash is repaired by running it again |
| Round driver | `src/driver.ts` | moves a case through seed block, commit round, reveal round, ruling or a fresh round. Restart-safe, one broken case never stops the others |
| Adapters | `src/adapters.ts` | candidates from World ID seats plus escrow stake plus reputation. The Arkiv vote and block readers are untested until a live run |
| Case planner | `src/cases.ts` | which cases to open: a report whose deposit is LOCKED in the escrow contract (the contract is asked, not the Arkiv mirror), or an owner dispute with a valid signature proof |
| Panel service | `src/service.ts`, `src/cli.ts` | one pass: mirror escrow to Arkiv, open cases, advance every case, publish a reputation checkpoint when due. Each part can fail without stopping the others. Also a read-only HTTP API for the app |
| Stake mirror | `src/mirror.ts` | escrow `Deposited`/settled events become Arkiv `stake` entities |
| Checkpoint job | `src/checkpoint-job.ts` | next reputation checkpoint from the last one plus new events, published as `reputation` entities. The indexer reads them (`services/indexer/src/checkpoint.ts`) |
| Escrow contract | `contracts/src/LookoutEscrow.sol`, client `packages/escrow` | deposits, bounty pool, reviewer stakes |

## Running it

```
npm run panel:keys          once: creates PANEL_PAYER_SECRET and PANEL_ENC_SECRET in .env, and the public key in app/.env.local
npm run panel:run           real timing (3 day commit round, 2 day reveal round)
npm run panel:run -- --demo 90 second rounds, a panel of 3, for a recording
npm run panel:run -- --once one pass, then exit
```

The API (`127.0.0.1:8790`, read only) serves `/cases`, `/cases?juror=0x...`, `/cases/:id` and `/status`. It never includes the reporter's bounty address. The app's Vote page uses it to show the cases a reviewer was drawn for (`NEXT_PUBLIC_PANEL_URL`).

State lives in `~/.lookout/panel/journal.sqlite`, outside the repo on purpose: a file inside the project makes the Next dev server reload.

## Two kinds of case

- **Report case.** A report with a locked deposit. The panel decides block or clear. Confirmed: deposit refunded, reputation up, a private bounty. Rejected: deposit to the pool, reputation down twice as fast.
- **Dispute case.** The owner of a flagged wallet address signs a message with that address (`core/owner-proof.ts`). No deposit. A `clear` ruling overturns the flag, a `block` ruling confirms it. A dispute never clears a flag by itself.

## Trust limits, stated plainly

- One resolver key decides confirm and reject and slashes. It cannot take deposits for itself (forfeits go to the pool). It cannot pay more bounties than there were confirmed reports, or pay the same one twice, but it does choose WHO is paid. It is still one key and can be wrong or compromised. Anyone can recompute the tally from the revealed votes and the ruling payload (seed, jurors, counts).
- The bounty payment does not name a reporter or report on chain (`payBounty(bountyId, stealth)`), and `bountyId` is derived from a secret. Timing can still hint at the link. An earlier version of the contract did leak it, and was replaced.
- The draw seed is the hash of an Arkiv block a few blocks after the case opened, so nobody could know it at open time. A block proposer could still bias a hash slightly, so this is not a randomness beacon.
- Sybils: a seat needs a World ID nullifier, a stake, and reputation. A seat is not yet bound to a wallet by a signature (open item).
- Owner disputes cover wallet addresses only.
- `scripts/demo-jurors.mjs` creates FAKE seats that skip World ID, for recordings only.

## What has run live

`npm run e2e:live` runs the whole loop on Arkiv Rabdi and the Sepolia escrow: a report with a deposit and a sealed bounty address, the panel opening the case, three demo jurors committing and revealing hidden votes, the ruling, the deposit settled, the stealth bounty found with the reporter's own keys, the stake mirrored on Arkiv, and the loser slashed. `npm run panel:live`, `npm run escrow:smoke` and `npm run arkiv:trust-smoke` cover the pieces.

## Not yet run live

- The browser wallet paths (report with deposit, dispute, vote) in a real wallet.
- Real World ID seats and the seat-to-wallet binding.
- A second, independent PIR operator.
