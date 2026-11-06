# @lookout/indexer

Reads Lookout's entities from Arkiv, applies the trusted-writer rules, turns them into signals per target, scores them with the shared rule in `@lookout/core`, and builds the PIR table.

```
Arkiv (Rabdi)  ->  reader  ->  SQLite cache  ->  signals (trust rules)  ->  scoreTarget  ->  verdict
                                                                      \->  snapshot builder  ->  PIR table + root
```

## Run it

You need `ARKIV_ACCESS_KEY` in the repo-root `.env` (copy `.env.example`). The indexer only reads, so it needs no wallet and no gas.

```
npm run indexer:sync                                   read Arkiv into services/indexer/data/index.sqlite
npm run lookup -w @lookout/indexer -- domain lookout-demo-airdrop.example
npm run snapshot -w @lookout/indexer                   build the 8 MiB table and print its root
npm run indexer:serve                                  sync every 30 s, serve the TEMPORARY plain /lookup on 127.0.0.1:8787
npm test                                               52 tests, no network
```

The SQLite file is a cache and is gitignored. Delete it and the next sync rebuilds everything from Arkiv alone.

## What it trusts (and what it does not)

Arkiv says who **created** an entity, not whether they were **allowed** to. The indexer applies the rules from `arkiv/schema.md` ("Trusted writers"), always on `$creator`, never `$owner`, because ownership can be transferred. The trust list is `registry.json`.

| Entity | Counted when |
| --- | --- |
| `report` | always. Its weight is the creator's reputation / cap, so a fresh wallet weighs 0 and can only cause a warning |
| `verdict` | the creator is a registered source and the entity's `sourceType` **and** `sourceId` match that registration |
| `attestation` | the creator is in `attesters`. **This is a placeholder**: real proof of control (deployer signature, ENS, DNS) is still an open question, so the list is empty and no dispute is honoured yet |
| `ruling` | the creator is the `panel` wallet. The newest ruling per target wins. `panel` is null, so none count yet |
| anything | unexpired, with a well-formed `targetHash` |

Reputation comes from `registry.json` too (`reputation`, address to score). Every indexer must use the same checkpoint, or their roots differ.

## The plain lookup is not private

`GET /lookup?kind=domain&value=...` tells this server what you are checking, which is exactly what Lookout exists to avoid. It is temporary scaffolding so the demo UI can show real verdicts before PIR exists (Phase 4). It binds to `127.0.0.1`, never logs request URLs, and answers `private: false, verified: false` so no UI can mistake it for the real thing. Do not expose it publicly.

## Known limits

- **Snapshot agreement:** two indexers that sync at different blocks get different roots from the same data. See open question 4 in `arkiv/snapshot-format.md`.
- A sync is a full read, replaced in one transaction. Fine at demo scale, and it is the "rebuild from Arkiv" path.
- `stake`, `vote`, `reputation` and `bounty` entities are not read yet. Weights come from `registry.json`, not from `reputation` entities.
- Payloads (evidence, proofs, the encrypted meta-address) are not read.
