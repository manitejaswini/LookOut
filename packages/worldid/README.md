# @lookout/worldid

World ID **Proof of Human** for one trust moment in Lookout: **joining the reviewer panel**. One human gets one seat, and nobody learns who they are. This is Lookout's entry for the World "Best Use of IDKit" track. The pitch is at `/pitch/worldid`, the screen is at `/reviewer`.

## Why this credential, and why only here

| Moment | Credential | Why |
| --- | --- | --- |
| Joining the reviewer panel | **Proof of Human** | Jurors can slash stake and rule on blocks, so one person must not hold many seats. The seat needs strong uniqueness and nothing else |
| Filing a report | none | Reports can only warn. Deposits and reputation already limit them. Open reporting stays open |
| Selfie Check | not used | Too light to guard seats that rule on blocks |
| Passport / NFC | not used | Proves more than needed (document attributes). We only need uniqueness |

## What you have to do once (about 10 minutes)

I cannot do these for you: they need your own World account.

1. Open **https://developer.world.org** and create an app. If asked, enable **World ID 4.0 / RP registration**.
2. Copy three values: the **app id** (`app_…`), the **RP id** (`rp_…`) and the **signing key** (a 64-character hex string).
3. Create `app/.env.local` (copy `app/.env.example`) and fill them in. For the World ID **simulator** also set `WORLD_ID_ENVIRONMENT=staging`.
4. Run the app (`npm run dev`) and open `/reviewer`. The setup notice disappears when the three values are present.
5. Run one verification with the simulator or World App. That is the "time to first success" the debrief needs, so note how long it took.

The signing key is the only secret. It lives in `app/.env.local` (gitignored) and is read only by the server. It is deliberately **not** in the repo-root `.env`, so the web server never receives the Arkiv wallet's private key.

## The flow

```
browser                         our server                          World
   |  POST /api/worldid/rp-signature  ->  signs a request with the RP key (action chosen by US)
   |<- rp_context, app_id, action, environment
   |  open IDKit widget with proofOfHuman({ signal: wallet })  -------------------> World App
   |<- proof (nullifier, signal_hash, ...) <------------------------------------------
   |  POST /api/worldid/verify { wallet, idkitResponse }  ->  checks, then forwards to World  ->  /api/v4/verify/{rp_id}
   |<- seat granted | refused (409 already enrolled / wallet in use) | 400 reason
```

## What the server checks before it grants a seat

In this order, cheapest first, and the seat store is touched only after every check passes:

1. **World ID 4.0 only.** A legacy v3 proof would give the same human a second nullifier, and so a second seat.
2. **Our environment.** A server in `production` refuses a `staging` (simulator) proof. `production` is the default, so forgetting to set it fails safe.
3. **Our action.** The server only ever signs and accepts `lookout-reviewer-seat-v1`. A client cannot ask it to sign anything else.
4. **Proof of Human, not a weaker credential** (`identifier` and `issuer_schema_id`).
5. **Bound to this wallet.** The proof's signal hash must equal `hashSignal(wallet)`, so a proof made for one wallet cannot seat another.
6. **A valid nullifier**, accepted as hex or decimal (the docs and the SDK types disagree), reduced to one canonical key.
7. **World's own verification**, with the payload forwarded as received.

Then the seat store decides, with database constraints: one nullifier per action (**one human, one seat**) and one wallet per action.

| Result | HTTP | Meaning |
| --- | --- | --- |
| `enrolled` / `already_seated` | 200 | Seat granted, or this human already holds this very seat |
| `human_already_enrolled` | 409 | Same human, different wallet. The "one human, one seat" refusal |
| `wallet_taken` | 409 | This wallet already belongs to a different human |
| `wrong_credential`, `signal_mismatch`, `wrong_environment`, … | 400 | The proof is not acceptable. Nothing is stored |
| `verifier_unreachable` | 502 | World could not be reached. Safe to retry |
| `not_configured` | 503 | The three variables are not set. The response names them, never their values |

On the screen: the three outcomes the pitch promises are **seat granted**, **cancelled or no credential** (you can still report), and **already enrolled**. Each World error code from the SDK is mapped to one of these or to a plain "setup problem" message.

## Privacy

The seat store keeps only the **action-scoped nullifier** (unlinkable to the same person in any other app), the **wallet**, the action and a timestamp. No name, no iris data. No API response ever returns a nullifier. Tested.

## Limits, said plainly

- **Not run with a real proof yet.** Everything is tested against a stand-in for World's verify endpoint, and the real IDKit widget has been run against a **fake** app id, where World refused it (`invalid_rp_id_format`) and the screen handled that correctly. A real success needs the setup above.
- **The signal hash format is unconfirmed.** The server compares the proof's `signal_hash` with `hashSignal(wallet)` from the SDK. The docs only show an example with no signal (`0x0`). If the first real proof is rejected as `signal_mismatch`, that is the first thing to check.
- **No stake check yet.** A seat means "a verified unique human with a wallet". The escrow does not exist yet, so the panel service will additionally require stake when it draws jurors.
- **Wallet ownership is not proven.** The user pastes an address, and the proof binds to it, but nothing proves they control it. Wallet connection (a signed message) is still to add, and matters before real stake is involved.
- **v4 proofs only.** People on an older World App cannot take a seat. That is a deliberate trade for the one-seat guarantee.
- **World ID proves uniqueness, not honesty.** Jurors still stake, vote blind and lose reputation when wrong. It does not stop a rich human from bribing other humans.
- The rate limiter is in memory, so it limits one server process only.

## Tests

`npm test` runs 56 tests with no network: config safety, every refusal path, replay of a proof for another wallet, forged environments and credentials, hex and decimal nullifiers, the database enforcing one human one seat across two connections, the HTTP handlers, and a check that no secret key and no nullifier ever appears in a response.

See `DEBRIEF.md` for the integration debrief the track asks for.
