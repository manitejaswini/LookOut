# @lookout/workers

Background workers that produce the signals the indexer reads. Today: the **checker**. Still to build: the open-feed importer and the reviewer panel service.

## The checker

It looks for **re-checkable proof** and nothing else. A block verdict needs proof anyone can verify without trusting us (PRD "Decision rules"), so the checker only claims what it can show.

| Check | Finds | Proof |
| --- | --- | --- |
| `domain` | the site redirects (HTTP 3xx or a meta refresh) to a destination that is already flagged: a flagged domain, or a flagged address inside the URL | the redirect chain, in the verdict's payload |
| `contract` | the contract's runtime bytecode hashes to an entry on the known-drainer list | the code hash, chain id and the cited source |

What it deliberately does **not** do: guess that code or a site "looks like a drainer". Legitimate marketplaces call the same functions (`setApprovalForAll`, `transferFrom`), so a heuristic would block real projects. No proof means no finding, and **no finding is not a clearance**: the output says so.

### Run it

Dry run by default. It prints what it found and writes nothing.

```
npm run check -- domain some-site.xyz
npm run check -- contract 0x... --chain-rpc https://ethereum-sepolia-rpc.publicnode.com
npm run check -- domain some-site.xyz --publish     write, or refresh, a verdict on Arkiv with the test wallet
```

`.env` (never printed): `ARKIV_ACCESS_KEY` and `ARKIV_PRIVATE_KEY` only for `--publish`, and `ETH_RPC_URL` for contract checks. `FLAG_LIST` and `DRAINER_LIST` override the files in `lists/`. If the indexer cache has been synced, anything **Lookout already blocks** also counts as flagged, so a site that redirects to a blocked destination is part of the same attack.

### How a finding becomes a verdict

1. The evidence is written as canonical JSON (sorted keys, so the same evidence always gives the same bytes).
2. `proofHash` = keccak256 of that exact text. The text itself is the verdict's `payload`.
3. A `lookout.v0.verdict` is written by the registered checker wallet, `block`, read-only, 6 hour lifetime.
4. Anyone can run `verifyProof(payload, proofHash)`, then repeat the observation (fetch the URL, read the contract) themselves.
5. While the finding still holds, running it again **refreshes** the existing verdict instead of writing a duplicate. If the checker stops, the flag expires on its own.

The wallet must be the `lookout-checker` source in `services/indexer/registry.json`, or indexers ignore the verdict. A wallet that is not registered cannot forge one: this is tested.

### Security: the checker fetches strangers' domains

A reporter or feed chooses what the checker visits, so it must never be tricked into reaching our own machine or network (SSRF). Defences, all tested:

- Only `http` and `https`, only the default ports, no credentials in the URL.
- Every connection goes through a DNS lookup that refuses unless **every** resolved address is public. The address that is validated is the address connected to, so a DNS-rebinding trick cannot swap it afterwards.
- Loopback, private, link-local (including the cloud metadata address `169.254.169.254`), carrier-grade NAT, multicast, documentation and reserved ranges are refused, in IPv4 and IPv6, including IPv4 hidden inside IPv6 (`::ffff:127.0.0.1`, NAT64, 6to4) and the decimal, hex and octal spellings of `127.0.0.1`.
- Redirects are followed by hand, up to 5 hops, and each next URL is re-validated. A redirect to a private address or another scheme ends the walk and is never requested.
- 8 second timeout, at most 64 KiB of any page read, and no scripts are run.

### Limits, said plainly

- **JavaScript redirects are invisible.** It follows HTTP and meta-refresh redirects only. The evidence says so in a `limits` field.
- **The lists ship empty on purpose.** `lists/flagged.json` and `lists/drainers.json` hold no entries, because real drainer hashes and flagged domains must come from real, cited reports and are not invented here. Every entry **requires a `source`**, and an unsourced entry is refused at load time. Until real entries exist, the only live flagged destinations are ones Lookout already blocks.
- The redirect check trusts the flagged list. If a list entry is wrong, a site redirecting there is wrongly flagged. That is why each entry carries its source.
- Exact bytecode matching misses a drainer whose code was changed even by one byte. It trades coverage for precision on purpose.
- A site can show different redirects to different visitors. The evidence records what the checker saw, and when.

## Tests

`npm test` runs 44 checker tests with no network: the SSRF table (including the classic bypasses), redirect walking, loop and hop-limit handling, the domain and contract checks, evidence hashing, and an end-to-end test that a verdict the checker writes is accepted by the indexer and produces a block, while a verdict from any other wallet is ignored.
