# Lookout

A pre-sign safety check for wallets and AI agents. Before you send money or sign, Lookout tells you whether the address is flagged, why, and where you can verify it, without learning what you asked.

> ETHGlobal Mumbai 2026. Built for the Arkiv track and the World ID (IDKit) track. This is a hackathon build on testnets. Read **What is not done** before trusting any claim here.

## What it does

1. **You are about to pay or sign.** Lookout checks the address first. The lookup is private: two servers each answer one random-looking question, and neither learns which address you asked about.
2. **You see a verdict:** `block`, `warn` or `unknown`, with the reasons and the Arkiv records behind them. Lookout never says "safe", only "nothing found". A flagged address can still be paid, because the decision is yours, but only if you choose to, and that choice is logged on your device.
3. **The data is community owned.** Reports, trusted-source verdicts and owner disputes are Arkiv entities, each with an owner and an expiry. The lookup table is rebuilt from them, and its root is published on Arkiv so a client can check it.
4. **Fake reports cost money, and a thousand fresh wallets weigh nothing.** A report locks a deposit in an escrow contract. It is confirmed only when an independent trusted source flags the same target afterwards.

## How a report is settled

| Situation | Result |
| --- | --- |
| A trusted source (feed or checker) flags the same target **after** the report, within 7 days, and is not the reporter | **Confirmed**: deposit back, reputation up, and a bounty if the reporter is a verified human |
| The target was **already** flagged when the report came in | Refunded, no bounty. Known scams cannot be farmed for rewards |
| Nothing corroborated it in time | Refunded, no bounty. An honest early report is never punished for being early |
| The operator rules it false | Deposit forfeited to the bounty pool. **The only way a deposit is lost** |

Blocking needs two independent strong source types, an operator ruling, or proof anyone can re-check. A report alone can only warn.

## The pieces

| Piece | Where | What it is |
| --- | --- | --- |
| Scoring, resolution, reputation | `packages/core` | pure rules: verdicts, how a report is settled, reputation with decay and a verified-human floor, owner-dispute proofs |
| Private lookup | `packages/pir`, `services/pir`, `packages/client` | two-server XOR PIR, with the table root checked against Arkiv |
| Indexer | `services/indexer` | reads Arkiv, applies the trusted-writer rules, builds the table and publishes its root |
| Checker | `services/workers` | a conservative checker that only claims what it can prove |
| Operator | `services/operator` | settles reports by evidence, publishes reputation and rulings with public reasons. [Details](services/operator/README.md) |
| Escrow | `contracts`, `packages/escrow` | report deposits and the bounty pool, with pull-based refunds |
| World ID | `packages/worldid` | one human, one wallet, so a real person's report counts a little and one person cannot pass as a crowd |
| App | `app` | Check, Pay, Report, Dispute, Verify and Funds screens, and the pitch decks |

Arkiv entities (seven kinds) are described in [`arkiv/schema.md`](arkiv/schema.md); the lookup snapshot format is in [`arkiv/snapshot-format.md`](arkiv/snapshot-format.md).

## Run it

Needs Node 26+, and Foundry (`anvil`, `forge`) for the contract tests.

```
npm install
npm run verify                          typecheck, every test, and the attack simulation
cp .env.example .env                    then fill it in (Arkiv key and a throwaway wallet, never a real one)
cp app/.env.example app/.env.local
npm run dev                             the app on http://localhost:3000
```

The live pieces, each its own command: `npm run indexer:sync`, `npm run from-indexer -w @lookout/pir-server`, `npm run indexer:publish`, then the PIR servers (`services/pir`), then `npm run operator:run`. `npm run demo:seed` keeps a labelled demo fixture alive so the Pay screen has something to flag. `npm run e2e:live -- --i-know-this-fakes-world-id` runs the whole loop on the live networks.

## Wallets and contracts (testnet, public addresses only)

| Role | Address |
| --- | --- |
| Operator, escrow resolver, `lookout-checker`, `openfeed-demo`, indexer (all one demo wallet) | `0x37324A0CC17959Ee99233c8552e741519983573E` |
| Escrow (Sepolia) | `0x582c5f1c17b5ee678315dabd9b4772c2b33629ae` |
| Arkiv testnet | Rabdi, chain id 7794095 |

The demo uses one wallet for several roles. A real deployment would split them. `services/indexer/registry.json` is the list of wallets the indexer trusts.

## Trust limits, said plainly

- **One operator key** settles reports and publishes rulings. It cannot take a deposit for itself, and it can pay a bounty only to the reporter of a report it confirms. It can still be wrong or compromised, so every ruling carries a public reason.
- **Trusted sources are a short list** the team controls. A report is only as trustworthy as those sources.
- **Verified humans are decided by our server.** It checks World ID proofs, so "this wallet is a unique human" is a trust assumption, not something Arkiv alone proves.
- **Private lookup assumes the two servers do not collude.** Today both are run by the same person, so the claim is only as strong as that separation. Neither server sees your address, but they can see your IP.
- **Bounties and reputation are tied to the reporter's wallet.** There is no payout privacy.
- **Owner disputes cover wallet addresses only.** A contract has no key, and a domain needs a different proof.
- **The live "flags" are demo fixtures** labelled as such, not real detection.

## What is not done

- A real World ID proof has not been run end to end. The code and 58 tests are there; it needs a Developer Portal app and one run in World App or the simulator.
- The browser wallet flows (report with a deposit, dispute, verify, funds) have been tested with fakes and rendered, but not clicked through with a real wallet.
- A second, independent lookup operator.
- Real intelligence sources: the feed importer and checker lists that cite their evidence.
- Hosting: it runs on a laptop.

## What has been run live

On Arkiv Rabdi and Sepolia: the escrow (deposit, confirm, refund, claim, reclaim), the trust writers, the reputation checkpoint read back by the indexer's own rules, the stake mirror driven by real escrow events, and the operator end to end. See [`services/operator/README.md`](services/operator/README.md).

## AI use

This project was built with substantial help from Claude (Claude Code). It wrote most of the code, tests and documents under the author's direction, and the author reviewed, ran and decided on it. Tests and live runs are the evidence for what works, not the model's say-so, and the sections above say what is not proven.

## License

MIT. See [`LICENSE`](LICENSE).
