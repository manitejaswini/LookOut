# Data quality

## Is the data up to date, and how does the import keep it that way?

Lookout has two kinds of writers, both in this repo and re-runnable:

| What | Script / service | How it stays current |
| --- | --- | --- |
| Source verdicts (demo) | `npm run demo:seed`, `npm run demo:flag -- <domain or 0x address>` | each verdict lives 6 hours and is **refreshed with `extendEntity`** while the finding holds. A source that stops refreshing lets the flag expire on its own |
| Reports and stakes | the app writes `report`; `services/operator` mirrors escrow events to `stake` | the operator runs a pass every few seconds; a report expires in 24 hours, a stake in 30 days |
| Lookup table + root | `npm run indexer:sync`, `from-indexer`, `indexer:publish` | the indexer reads Arkiv, applies the trusted-writer rules, builds the table and publishes a new `snapshot` root (kept 14 days) |
| Reputation | operator checkpoint job | a `reputation` checkpoint with a 30-day half-life, so an unrefreshed score decays |

**What we are honest about:** the live `verdict` entities are **labelled demo fixtures** (`reason` starts with "DEMO FIXTURE"). There is **no importer for a real external feed yet**. Freshness today is real (expiry and refresh work, tested live), but the content is not real threat intelligence.

Everything is re-runnable: `npm run e2e:live -- --i-know-this-fakes-world-id` writes and reads the whole loop on Rabdi and Sepolia.

## Can people filter it the way they actually search for it?

People look up **a thing they are about to interact with**: a domain, an address or a contract. Every entity has an indexed `targetHash` (keccak256 of a normalized target), plus indexed `targetKind`, `category`, `status`, `level`, `sourceType`, `sourceId`, `reportId` and `caseId`, and system fields `$creator` and `$expiresAt`. The normalization rules (punycode, lowercase, `www.` kept, checksum case ignored) have pinned test vectors in `arkiv/schema.md`.

The end-user path does not query Arkiv by target, on purpose: Arkiv attributes are public, so a target query would reveal what the user is checking. Users go through the private lookup. **Indexers and auditors** query Arkiv directly.

## One query you can run

Read-only. Needs `ARKIV_ACCESS_KEY` in `.env` (free from the Arkiv access-key page).

```
npm install
npm run arkiv:query                 # live count per schema and the wallets that wrote them
npm run arkiv:query -- verdict      # every live verdict: key, creator, expiry block
```

The equivalent SDK query (`@arkiv-network/sdk`), for all drainer reports on domains:

```ts
import { and, eq } from '@arkiv-network/sdk/query'
publicClient.select().from(SCHEMAS.report)
  .where(and(eq('targetKind', 'domain'), eq('category', 'drainer')))
  .limit(100).fetch()
```

Raw query string form: `targetKind = str('domain') AND category = str('drainer')`.

## Known gaps in data quality

- `arkiv:query` reads one page (at most 100 rows) per schema, so the counts cap at 100.
- Only one wallet currently writes verdicts, so there is no cross-source corroboration in live data except the demo checker.
- No deduplication across sources beyond the `targetHash` match.
