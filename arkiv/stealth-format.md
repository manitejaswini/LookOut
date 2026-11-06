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

1. Look up your own `reportId` to get `R`. **Open:** the snapshot format v0 (`arkiv/snapshot-format.md`) has no bounty record, so this cannot go over PIR yet. Until it does, `R` is read from the `bounty` entity on Arkiv directly, which tells Arkiv which report you are asking about (not which address is yours). Adding a bounty record kind to the snapshot is a change to Dev A's contract; the key would be `keccak256("lookout.bounty-key.v0" | reportId)` and the body `tier (1) | R (33)`.
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

## Sealing the meta-address in the report

The report `payload` is public. If it held the meta-address in clear, anyone could link a reporter's reports and watch their payouts. Only the payer needs the meta-address, so the reporter seals it to the payer. Implemented in `packages/stealth/src/seal.ts`.

```
blob = 0x01 || ephemeralPub (33) || nonce (12) || ciphertext (66) || tag (16)        // 128 bytes
key  = HKDF-SHA256( ECDH(ephemeralSecret, payerEncryptionKey), salt = none, info = "lookout-stealth-v0:seal-key", 32 bytes )
ciphertext||tag = ChaCha20-Poly1305( key, nonce, plaintext = K_s || K_v (66 bytes), aad = "lookout-stealth-v0:seal:" + reportId )
```

- ECDH output is the 33-byte compressed shared point. The reporter makes a **fresh ephemeral key and a random nonce for every report**, so two reports from one reporter look unrelated.
- `reportId` is the associated data, so a blob copied onto another report fails to open, and any changed byte fails authentication.
- Opening needs the payer's encryption secret. It throws on a wrong key, a wrong report, a tampered blob, an unknown version byte or a wrong length, and never returns something that is not a valid meta-address.
- **`payerEncryptionKey`** is a dedicated secp256k1 public key for the payer, **not** the wallet key that signs `bounty` entities. It must be published in the trusted-writers config next to the payer wallet address. This is a new config field, and the README writer-wallet table should list it.
- Where the blob sits inside the report `payload` (next to the evidence pointer) is Dev A's call in `schema.md`. The blob is fixed-length with a version byte, so a simple concatenation is unambiguous.

### Sealing test vector

| Item | Value |
| --- | --- |
| payer encryption secret | `keccak256("lookout test payer encryption key")`: `9f6831b8ddacef39664f0a65e15d26851b73c69ce0a6a6fca029b3a09c86d7a8` |
| payer encryption key | `0x03a73c5ad494ceaf0371f7899430ee89acf5e971f65ddae6470c6291b9da8cc061` |
| plaintext | the meta-address in the vectors above |
| `reportId` | `rep_0001` |
| ephemeral secret | `keccak256("lookout test seal ephemeral")`: `a4cf00c2e62ceb34db2582e32b146ad5601f2a4c601172e16d38776f3cacda39` |
| nonce | 12 bytes of `0x07` |
| blob | `0103b22c9307814a8089db73393e50c3b7afa0412b3f4d3904943ccb4375ea563ae3070707070707070707070707a87547adde35070f9bba75e47e9a728364c74bdbb739e70dfec5ea78b9b61b0a17c2f8fa1bc66a6bbe320b380d339ab1052790308831e1af960f9ae4397cec5252f689231c0ec62f7158c5533d747f0c4adb` |

This vector was also opened by a separate Python implementation (hand-written secp256k1 plus the `cryptography` library's HKDF and ChaCha20-Poly1305), so the format does not depend on the noble libraries.

## What this hides, and what it does not

- Hides from everyone except the payer: which address received a bounty, and that it belongs to the reporter. On the Arkiv side the meta-address is sealed to the payer. On the escrow side `payBounty(bountyId, stealth)` takes no reporter and no report id, its event names only the stealth address, and `bountyId` is derived from the payer's secret (`bountyIdFor` in `packages/stealth`), so it cannot be recomputed from a public report. An earlier version of the contract took the reporter and report id as arguments, which published exactly the link this format exists to hide. It was replaced.
- Does **not** hide timing: a bounty is paid soon after a confirmation, and with few reports an observer can guess the match. This hides the link from casual analysis, not from a determined observer watching the chain. Two bounties to the same reporter land on unrelated addresses, and their sealed meta-addresses look unrelated too.
- Does **not** hide from the payer. It opens the meta-address and computes the address, so it knows which report paid which address. The payer is trusted for this, the same as any bounty payer.
- Does **not** hide: that report `X` was rewarded, the tier, the payer, or the time. The payer funds the stealth address, so payer to stealth address is on chain by design.
- Reputation ties reports to the reporter's wallet. Payouts can be hidden, earned reputation cannot (PRD, "Reputation versus privacy").
- Sweeping to an address linked to the reporter's main wallet undoes the privacy. The client should insist on a fresh destination.
- Recovery: lose `k_s` and the bounty is gone. Backup and recovery of the two keys on the device is not designed yet.

## Open questions

- Key storage on the device (IndexedDB, exportable backup, or derived from a wallet signature so it can be recovered).
- Whether the destination for the sweep can be an Arkiv-funded fresh account on the same testnet.
- EIP-8141 frame-transaction sweep (F13): replaces step 3 of claiming on the alt-mempool devnet, if it is available.
