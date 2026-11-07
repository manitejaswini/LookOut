# Handoff

Where the project stands, for whoever picks it up next. Read `README.md` first for what Lookout is and its trust limits. This file is the practical state.

## What works (all on `main`)

- **Tests:** `npm run verify` passes (typecheck, every workspace's tests, the attack simulation). Contract tests need Foundry (`forge`, `anvil`).
- **Live, on Arkiv Rabdi + the Sepolia escrow:** `npm run e2e:live -- --i-know-this-fakes-world-id` passed in full: a verified human's report corroborated by a trusted source (confirmed, deposit + bounty claimed in one transaction), an uncorroborated report refunded, a copied report refunded as already flagged, one Arkiv stake entity per report, and the reputation floor published.
- **Tried by hand in a real browser wallet:** Pay (flag and clean address), Report with a deposit through MetaMask (needed the permission fixes below), the operator confirming it. Not yet tried by hand: claiming the refund on Funds, Dispute, the uncorroborated refund wait.
- **World ID:** World App verified the person, and our server rejected the proof because it was a legacy (3.0) proof. That is fixed (legacy now accepted, see `packages/worldid/src/config.ts`) but **not yet re-tested with a real scan**. This is the first thing to check.

## Running it locally

```
npm install
cp .env.example .env && cp app/.env.example app/.env.local    # fill in. Never commit these. Use throwaway wallets only
npm run dev                                                    # the app, http://localhost:3000
npm run operator:run -- --demo --every 8                       # settles reports. --demo = 10 minute window
npm run demo:flag -- some-domain.example                       # plays a trusted source for a target (DEMO fixture)
npm run demo:seed                                              # keeps the labelled demo flag alive (it expires in 6 hours)
```

The lookup table must be rebuilt after flags change: `npm run indexer:sync`, `npm run from-indexer -w @lookout/pir-server`, `npm run indexer:publish`, then restart the two PIR servers (`node services/pir/src/cli.ts --dir services/pir/data --port 8801 --name A`, and 8802 / B). Only one live script or operator at a time: they share a wallet and can collide.

## Current deployment (testnet)

- Escrow (Sepolia): `0x582c5f1c17b5ee678315dabd9b4772c2b33629ae` (see `ESCROW_ADDRESS` in `.env` and `NEXT_PUBLIC_ESCROW_ADDRESS` in `app/.env.local`). Redeploy with `npm run escrow:deploy`, then `npm run escrow:fund -- 0.02`.
- The one demo wallet is the operator, the escrow resolver, `lookout-checker`, `openfeed-demo` and the indexer. Its address is in the README.

## Known problems and gotchas

1. **MetaMask permissions.** Recent MetaMask grants a site access network by network. The app now always requests a switch, and disconnecting (the address button, top right) revokes the site so the next connect can grant Sepolia and Rabdi. If a transaction fails with "not authorized", that is the cause.
2. **Free Sepolia RPCs rate limit and lag a block.** The app reads through the wallet's RPC first, then public fallbacks (set `NEXT_PUBLIC_SEPOLIA_RPC` to your own). Scripts read balances at a specific block for this reason.
3. **The Arkiv access key was exposed once** in a tool output earlier in development. **Rotate it** (hub.arkiv.network/access-keys) and update `ARKIV_ACCESS_KEY` in `.env`.
4. **World ID action name** must match one registered for the app in the Developer Portal. Set `WORLD_ID_ACTION` (server env, also in the repo-root `.env` for the operator) if it differs from `lookout-verified-human-v1`.
5. **Legacy World ID proofs weaken "one human, one wallet" slightly** (a person holding both a 3.0 and a 4.0 credential has two nullifiers). Set `WORLD_ID_ALLOW_LEGACY=false` to require 4.0 only.
6. The dev server can reload in a loop if something writes files inside the repo (the indexer cache and seat DB live in `~/.lookout` for that reason). If the page reloads by itself, look for a process writing into the project folder.

## What is left

- **Verify with a real scan** after the legacy-proof fix. Then file a report from the verified wallet and check the operator pays a **bounty** (the outcome should no longer say `not-a-verified-human`).
- Finish the manual wallet checks: claim the refund on **Funds**, **Dispute** (sign, then `npm run operator -- disputes` and `rule`), and the uncorroborated refund after the 10 minute demo window.
- **Real intelligence sources:** the live flags are labelled demo fixtures. The feed importer and checker lists with cited evidence are not built.
- **A second, independent lookup operator.** Today one person runs both PIR servers, so the privacy claim is only as strong as that separation.
- **Hosting.** Everything runs on one laptop.
- **Demo video:** write the runbook and record. The pitch decks (`/pitch/arkiv`, `/pitch/worldid`) were rewritten for the current design but the figures on the problem slide still need re-verifying against their sources.
- Optional: delete the old merged branches, a MetaMask Snap for in-wallet warnings, owner disputes for domains and contracts.
