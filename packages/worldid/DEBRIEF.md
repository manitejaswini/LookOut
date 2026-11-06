# World ID integration debrief

Written for the World "Best Use of IDKit" track. It is based on actually building the integration against IDKit 4.6.0 and the linked documentation. **A real proof has not been run yet**, so the first item is honestly empty, and the rest should be re-checked after the first real run.

## Time to first success

**Not measured yet.** A first success needs a World Developer Portal app (app id, RP id, signing key) and one run with World App or the simulator. When that is done, record here: minutes from "open the Portal" to "seat granted", and the point where it first worked.

What can be said now: the server, the store and the screen were built and tested offline, and the real IDKit widget was run against a fake app id. World refused it with `invalid_rp_id_format`, which proves the SDK, the request signing and the error path are wired correctly.

## Friction encountered

1. **Docs and SDK types disagree about the nullifier.** The integration guide's example shows a hex value (`0x04e5…`), while the SDK's own type comment says the v4 nullifier is a decimal string. We accept both and reduce them to one key. Getting this wrong would let the same human enroll twice.
2. **The Portal address differs between pages.** The links given for the track use `developer.worldcoin.org`, while the integration guide and the verify endpoint use `developer.world.org`.
3. **Credential names differ between pages.** The track text says "Passport/NFC" and "Selfie Check". The overview calls them Proof of Attributes and Proof of Presence. IDKit's presets are `proofOfHuman`, `passport` and `selfieCheck`. The response uses `proof_of_human` plus an `issuer_schema_id`. It took reading the SDK's types to line these up.
4. **The Proof of Human page does not say how to request it or what comes back.** It covers what the credential is, then says the SDK reference is "coming soon". The preset name, the response shape and the identifier all came from the SDK's type declarations.
5. **Error codes live only in the SDK.** `IDKitErrorCodes` has 28 codes (`user_rejected`, `credential_unavailable`, `invalid_rp_id_format`, `nullifier_replayed`, …). No docs page maps them to meanings, or says whose fault each is (the person's, the app's setup, or the network). We had to sort them ourselves into "person backed out", "no credential", "already used", "update World App" and "app setup problem".
6. **The verification-flows page covers the install flows, not the request lifecycle.** It does not describe request states, cancellation or errors, which are exactly what the track asks every team to demonstrate.
7. **Accepting legacy proofs has a hidden cost.** The only place that says `allow_legacy_proofs: true` means tracking two nullifier spaces to avoid double claims is a comment in the type declarations. For a "one human, one seat" rule that decides the design, so we accept v4 only.
8. **The RP id format is not documented, and is checked only by World at runtime.** Our config accepted a plausible-looking id and World rejected it with `invalid_rp_id_format`. A documented pattern would let an app catch this at startup.

## Missing capability or documentation

- **A server-side verify helper.** `@worldcoin/idkit-server` exists (it is not mentioned in the guide, which imports `@worldcoin/idkit-core/signing`), but it only offers signing and nullifier utilities. The verify call is hand-written, along with the environment checks around it.
- **A documented way to enforce the signal.** The guide says "your backend should enforce the same value" but not how. We found `hashSignal` in `@worldcoin/idkit-core`, and compare it with the proof's `signal_hash`. Whether the response's `signal_hash` equals `hashSignal(signal)` is not documented (the example shows `0x0`), so this is the first thing to verify against a real proof.
- **An error table** (see friction 5) and **the verify endpoint's error body shape.** The guide shows only the success case.
- **A way to test without a phone.** The simulator is mentioned, but nothing says which environment it uses or how to see a complete successful response.

## The one improvement with the greatest impact

**One complete, copy-pasteable server reference** that covers, in order: verify the proof, check the credential identifier, enforce the signal with `hashSignal`, reduce the nullifier to one canonical form, and store it with a unique constraint, plus a table of error codes saying whose fault each is. Every integration that wants "one person, one X" has to rediscover these steps, and a mistake in any one of them (hex versus decimal, legacy proofs, an unchecked signal) silently breaks the uniqueness guarantee. Our pick, to be confirmed after the first real run.

## What we got right early, and would tell the next team

- Default the server's expected environment to `production`, and require `staging` explicitly, so a forgotten setting refuses simulator proofs instead of accepting them.
- Never let the client choose the action the server signs.
- Verify locally before calling World, and touch the database only after every check passes.
- Let the database enforce uniqueness, and test it with two connections, not just one.
