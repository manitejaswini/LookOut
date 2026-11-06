# Lookout stealth bounty format (v0)

Owner: Dev B. Dev A's payer code follows this file. Reference implementation: `packages/stealth`, whose tests pin the vectors below. Change the doc, the code and the vectors together.

Scheme id: `lookout-stealth-v0`. It is **ERC-5564 style, not ERC-5564 conformant**: same secp256k1 spending-key and viewing-key construction, but no view tags (the PRD drops them: a tag needs the ephemeral key, so it cannot narrow a server-side search) and no ERC-6538 registry (the meta-address travels inside the report).

## Keys

A reporter holds two secp256k1 keys, created on their device and never sent anywhere:

| Key | Can do | Cannot do |
| --- | --- | --- |
| spending key `k_s` | spend the bounty | |
| viewing key `k_v` | find which address a bounty went to | spend it |

## Meta-address

```
st:eth:0x + K_s (33 bytes) + K_v (33 bytes)       // compressed public keys, lowercase hex, 132 hex digits
```

Parsers reject anything else, including uppercase, a wrong length, or a point not on the curve. It goes into the `report` entity `payload`, **encrypted** (see below).

## Paying (Dev A, payer wallet)

```
r  = keccak256( payerSecret || "lookout-stealth-v0:ephemeral:" || reportId ) mod n     // ephemeral secret
R  = r·G                                                                                // 33 bytes compressed
S  = r·K_v                                                                              // ECDH, 33 bytes compressed
h  = keccak256( S ) mod n
P  = K_s + h·G
stealthAddress = last 20 bytes of keccak256( P uncompressed without the 0x04 prefix )   // lowercase
```

1. Derive `r` as above. It is **deterministic per report**, so a retried payout reproduces the same address and one report can never be paid to two addresses. `payerSecret` is the payer service's own secret, never published.
2. **Post the `bounty` entity first**, then send the ETH. If the payment fails, the announcement points to an empty address, which is harmless, and the retry fixes it. The other order can leave money at an address nobody is told about.
3. Send native ETH to `stealthAddress`. The amount must exceed the claim gas (21,000 gas at the current price, with margin), because the address pays its own gas. Choose `amountTier` accordingly.

### `bounty` entity

| Field | Value |
| --- | --- |
| `reportId` | the report being rewarded (indexed, found by the reporter over PIR) |
| `amountTier` | integer tier, not the exact amount |
| `payload` | `R`: 33 bytes, compressed. Nothing else |

The payload is a public key, so it is safe in plaintext. There is no view tag and no metadata.

## Claiming (Dev B, reporter device)

```
S  = k_v·R
h  = keccak256( S ) mod n
p  = ( k_s + h ) mod n          // private key of the stealth address
```

1. Look up your own `reportId` over PIR to get `R`.
2. Derive `p` and check that `p` controls the address that holds the funds (`addressFromPrivateKey(p) == stealthAddress`).
3. Sweep: send `balance - gasPrice * 21000` to a **fresh destination address**. No relayer and no funding transaction, because the stealth address already holds the ETH it needs.

A viewing-only device can compute the address and watch the balance but cannot sweep.

## Test vectors

Inputs are `keccak256` of the ASCII label.

| Item | Value |
| --- | --- |
| `k_s` | label `lookout test spending key`: `ad4797fdd0e060056341384abf268ba43f965951945e4243142801e0579cf8bc` |
| `k_v` | label `lookout test viewing key`: `17b30f4ff50374205c9b807f9b143abb69a05c67790eb59f6b0080488ed53867` |
| meta-address | `st:eth:0x02432c0e3eb5b16469c2b996a486cb102e5ef8bed26ed952b49da563a797f8ee9a02f8493a7c42a5248c9cd967b728272141cbb8e75d228723d3268c7e4a4fc2d597` |
| `payerSecret` | `keccak256("lookout test payer secret")` |
| `reportId` | `rep_0001` |
| `r` | `c0d52a66dc6f8613d5caf44f80d6bb207f47a0609bb02c565e21abb5b00e2f65` |
| `R` (bounty payload) | `0x03359ec24120361103f4d86d574dc521a02eb4514274b799a7dce633338e884fd5` |
| `stealthAddress` | `0xb8007cb64a0a4b45a764249ca558daaebc7e3408` |
| `p` | `926c56ae3e0b0d5716f718edf52e23f8db789acab2d74513ca6084c6ed41c24d` |

Sanity check for the address function itself: private key `1` controls `0x7e5f4552091a69125d5dfcb7b8c2659029395bdf`.

## Encrypting the meta-address in the report (Proposed, not implemented)

The report `payload` must not leak the meta-address, or anyone could link a reporter's reports and watch their payouts. Only the payer needs it. Proposal: encrypt to the payer wallet's secp256k1 public key with ECIES (ephemeral ECDH, HKDF-SHA256, ChaCha20-Poly1305), `payload = ephemeralPub || nonce || ciphertext`. This is a separate task: `packages/stealth` does the key math only.

## What this hides, and what it does not

- Hides: which address received a bounty, and that it belongs to the reporter. Two bounties to the same reporter land on unrelated addresses.
- Does **not** hide: that report `X` was rewarded, the tier, the payer, or the time. The payer funds the stealth address, so payer to stealth address is on chain by design.
- Reputation ties reports to the reporter's wallet. Payouts can be hidden, earned reputation cannot (PRD, "Reputation versus privacy").
- Sweeping to an address linked to the reporter's main wallet undoes the privacy. The client should insist on a fresh destination.
- Recovery: lose `k_s` and the bounty is gone. Backup and recovery of the two keys on the device is not designed yet.

## Open questions

- Key storage on the device (IndexedDB, exportable backup, or derived from a wallet signature so it can be recovered).
- Whether the destination for the sweep can be an Arkiv-funded fresh account on the same testnet.
- EIP-8141 frame-transaction sweep (F13): replaces step 3 of claiming on the alt-mempool devnet, if it is available.
