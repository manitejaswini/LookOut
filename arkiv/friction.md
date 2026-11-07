# Arkiv friction: what got in our way

Written from building Lookout on Arkiv Rabdi (chain 7794095) with `@arkiv-network/sdk`. Everything below happened to us. Items are ordered by how much time they cost.

## 1. Writes are not idempotent, and a retry can create a duplicate

- **Expected:** creating an entity with the same attributes (or the same salt) twice would return the same entity, or fail, so a retry after a timeout is safe.
- **Happened:** the entity key includes the writing account's nonce, so a second `createEntity` always makes a new entity. A write that timed out but landed, then retried, left two entities. Our operator mirrored one escrow deposit twice (two `stake` entities for one report) until we added a check-before-create (`findStakes`), a 60 s wait after a failed create, and a one-pass-at-a-time lock.
- **Reproduce:** create an entity, abort the client at the timeout while the tx is still pending, create again with the same attributes, then `select().from(schema).where(eq(attr, value))`. Two rows.
- **Ask:** an optional caller-supplied idempotency key (unique per creator and schema), or a documented "create if absent" call.

## 2. Errors embed the RPC URL with the access key

- **Expected:** an error message is safe to print or log.
- **Happened:** a failed call threw an error whose message contained the full RPC URL including the access key. It reached our tool output once, so we had to rotate the key.
- **Reproduce:** make a write fail (for example with a wrong chain state or a timeout) and print `error.message` / `error.shortMessage`.
- **Workaround:** `packages/arkiv/src/redact.ts` scrubs messages (`redactSecrets`, `safeMessage`, `installErrorScrubbing`).
- **Ask:** pass the access key in a header (`X-API-KEY`) in the SDK transport, not in the URL, or strip it from errors.

## 3. Slow or flaky writes need client-side tuning we had to discover

- **Happened:** with default viem transport settings, writes sometimes failed with timeouts. We settled on a 30 s timeout and 4 retries with 2 s delay (`packages/arkiv/src/clients.ts`). Combined with item 1, the retries are exactly what makes duplicates likely.
- **Ask:** document recommended transport settings for Rabdi, and make receipts for `createEntity` easy to wait on.

## 4. Query builder types are very deep

- **Happened:** `publicClient.select(...).from(schema).where(...)` produces types so deep that TypeScript slowed down and some projections would not typecheck. We cast the client to `any` in the indexer and in `roots.ts`, and unwrap values with a small `plain()` helper because projected columns can come back as `{ value }` objects.
- **Ask:** a simpler typed return for `select` with a field list, and a plain value for scalar attributes.

## 5. No way to read "how long until this expires" in a friendly unit

- **Happened:** expiry is a block number and no event fires when an entity expires, so the indexer has to select `$expiresAt` and compare against the current block itself. We compute 2-second-block lifetimes by hand (`packages/arkiv/src/lifetimes.ts`).
- **Ask:** a helper `expiresInSeconds(entity)`, and an optional "expired" event for indexers.

## 6. Keyless endpoint warning is noisy and the failure mode is unclear

- **Happened:** using the SDK without an access key logs a warning on every client creation, and our dev server reloaded in a loop while a process was also writing a file inside the project. It took us a while to separate the two causes.
- **Ask:** one clear message the first time, and a clear error (not a timeout) when a key is missing or rate limited.

## 7. Small things

- The 128-byte `str` limit is a good constraint, but it fails at write time with a generic error. A message naming the attribute and its byte length would save time.
- Schema names are not a security boundary (anyone can write an entity with the tag), so every reader must also check `$creator`. This is documented, but easy to forget. A first-class "only entities from these creators" filter on `select` would make the safe path the short one.
- `extendEntity` counts the new duration from now, not from the old expiry. Fine once known. We rely on it for 6-hour verdict refreshes.

## What worked well

- Per-entity ownership and expiry are exactly what a community scam list needs: stale flags age out by themselves.
- Named schemas with indexed attributes, and `$creator` / `$expiresAt` as system fields, made the trusted-writer rule easy to express.
- The public explorer links (`rabdi.explorer.arkiv.network/entity/<id>`) let us show users the record behind every verdict.
