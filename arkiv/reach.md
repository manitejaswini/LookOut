# Reach

## How many people or projects already use or depend on this data?

**None yet, and we say so.** Lookout is a new project built at ETHGlobal Mumbai 2026, and its data on Arkiv was created during the hackathon. It is not a copy of an existing dataset with an existing user base.

What exists today on Arkiv Rabdi (run `npm run arkiv:query` for the live numbers; a run on 2026-11-07 counted, within the 100-row page the script reads):

| Schema | Live entities | Writers |
| --- | --- | --- |
| `lookout.v0.report` | 31 | the operator wallet and two test reporter wallets |
| `lookout.v0.verdict` | 11 | the operator wallet (as demo `lookout-checker` / `openfeed-demo`) |
| `lookout.v0.attestation` | 3 | operator wallet, one test wallet |
| `lookout.v0.stake` | 41 | the operator wallet |
| `lookout.v0.ruling` | 6 | the operator wallet |
| `lookout.v0.reputation` | 26 | the operator wallet |
| `lookout.v0.snapshot` | 6 | the operator wallet |

These are test and demo records written by the team. The `verdict` entities are **labelled demo fixtures**, not real detections.

## Who would use a copy of this on Arkiv after Mumbai, and for what?

This is intent, not a claim of users.

- **Wallets and AI agents** that want to check an address, domain or contract before signing, without telling a lookup service what they are about to pay. The private lookup (`@lookout/client`, `@lookout/agent-tool`) reads a table whose root is published on Arkiv.
- **Independent indexers and auditors.** Because reports, verdicts, disputes and rulings are public entities and the trusted-writer rules are in `services/indexer/registry.json`, anyone can rebuild the same table and compare roots.
- **Security researchers and feed maintainers** who want to publish a verdict with evidence under their own wallet, and have it count once they are added to the trusted list.
- **Owners of wrongly flagged addresses**, who can publish a signed dispute that every client sees.

## What would have to be true for that to happen

1. Real intelligence sources (a feed importer, a checker with cited evidence) replace the demo fixtures. **Not built.**
2. A second, independent PIR operator, so the privacy claim is not one person's word. **Not built.**
3. Hosting. It runs on one laptop today.

## Data license

The records are created by Lookout's own users and services, so there is no third-party dataset whose license we depend on. The code is MIT (`LICENSE`). We import no Sourcify data. When a real feed importer is added, its source license must allow republishing and will be linked here.
