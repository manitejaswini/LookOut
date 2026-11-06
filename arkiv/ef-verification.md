# EF items checked before promising them (Phase 6)

Checked on 2026-11-06 by reading the primary pages listed at the bottom. Nothing here was run in a browser or against a devnet yet. "Documented" means a page says it. "Tested" means we ran it. Right now nothing in this file is tested. The three spikes below close that.

## Summary

| Item | Documented | Not known | Verdict |
| --- | --- | --- | --- |
| **EF8 Anon-RPC read path** | Real, installable (`@anon-rpc/browser-harness` 0.4.0). Browser only. Routes any `fetch` through an anonymizing network. | Whether any network forwards to Sepolia or to Arkiv's RPC. Per-chain support is decided by each network's worker and is not listed anywhere. | **Plausible, untested.** Spike 1 decides it. |
| **EF9 EIP-8141 sweep** | A public alt-mempool devnet exists (chain 1337, gateway, explorer, faucet). It can be reset at any time. | How an ordinary EOA (our stealth address) sends a frame transaction. No page shows an EOA-signed frame tx or a sweep. | **Possible, untested, and it cannot move the Sepolia payout.** Spike 2 decides it. |
| **EF1 funding Arkiv from the escrow chain** | Arkiv's testnet (Rabdi) is its own chain with its own gas token (tGLM) and faucet. | | **Answered: no.** Escrow chain and Arkiv are separate. Writers fund Arkiv from the faucet. |

## One EF prize per project

The official prize page says: "One EF prize per project. You can submit to anon-rpc, the alt mempool and CROPS, but you will be placed in at most one. EF judges decide where it fits best."

So Phase 6 does **not** add prize money on top of CROPS. It only adds depth to the CROPS story, or it fails honestly. That sets the priority: finish the CROPS properties (PIR, stealth, no trackers, FOSS) before spending time here, and judge each Phase 6 item by whether it strengthens the CROPS demo. The Anon-RPC prize judges "how much of the app's traffic goes through Anon-RPC" and wants reads routed through it **by default**. The alt-mempool prize wants "real alt mempool usage" that is admitted on the devnet. A plain sweep that the canonical mempool would also accept does not show that.

## EF8: Anon-RPC

**What it is (documented).** `new AnonRpcWorker({ address, config, preExisting: { rpcProvider } })` returns a worker. `worker.fetch(url, init)` is a drop-in `fetch` that goes out through an anonymizing network, so it can be passed to a viem custom transport. The harness only runs worker code whose `keccak256` matches a pinned hash.

**Networks listed (documented).**

| Network | Specifier contract is on | Notes |
| --- | --- | --- |
| Passthrough | mainnet | plain fetch, no anonymization, reference only |
| tor-js | mainnet | the gateway is a "demonstration gateway only: limited capacity, and it may disappear at any time" |
| Nym | mainnet | bundle about 18 MB, a few seconds to bootstrap |
| Nox | **Sepolia** | slower than direct |

The "Sepolia" in that table is where the network's **specifier contract** is published, so `rpcProvider` must answer for that chain once. It does **not** say which chains a network can forward to. The docs list no destination chains. Whether `worker.fetch("https://sepolia-rpc/...")` or `worker.fetch("https://rpc.rabdi.db-chain.testnet.arkiv.network")` works is decided by each network's worker.

**Constraints that affect us (documented).**
- **Browser only.** It needs a null-origin iframe and WebRTC. The wallet page can use it. **The agent tool (Node) cannot.**
- The one `rpcProvider` read that fetches the specifier "is _not_ anonymized".
- "A malicious worker can observe, censor, or lie", and it sees every request routed through it.
- Latency is higher than a direct fetch.

**Arkiv specifics.**
- Arkiv "speaks Ethereum's JSON-RPC. Writes are transactions, and reads are `arkiv_query` calls", over plain HTTPS at `https://rpc.rabdi.db-chain.testnet.arkiv.network`. A generic forwarder can in principle carry it.
- **An Arkiv access key would undo the point.** The SDK takes an optional `accessKey`. The public RPC is "heavily rate limited" and a key is recommended, but a key identifies the caller to Arkiv. Through Anon-RPC use the keyless public endpoint and accept rate limits.
- The docs do not say how the key is attached on the wire. Not needed if we go keyless.

**What we would route through it.** The wallet's chain reads and the Arkiv reads, including the published-root lookup that `createPirClient({ publishedRoots })` needs. The PIR server requests are ordinary HTTPS `fetch` calls too, so routing them through `worker.fetch` would hide the client's IP from the PIR servers: PIR hides **what** you asked, Anon-RPC would hide **who**. Whether a network's worker forwards to an arbitrary host is exactly what spike 1 tests, so do not claim it until it passes.

### Spike 1 (30 minutes, needs a browser; the page cannot be run from the CLI)

One HTML page, files under `spikes/anon-rpc/`.
1. `npm install @anon-rpc/browser-harness`. Build a worker for **Nox** (its specifier is on Sepolia) with `rpcProvider` answering for Sepolia. Also try tor-js with a mainnet provider.
2. Through `worker.fetch`, POST `eth_blockNumber` to (a) a public Sepolia RPC, (b) `https://rpc.rabdi.db-chain.testnet.arkiv.network` with no access key.
3. Pass: a correct block number comes back for each, plus the round-trip time. Record `worker.ready` rejections and error codes (`unsupported-chain` is the documented example).
4. Fail: record the exact error. Then the answer is "not supported yet" and we say so in the README with this evidence.

The same question, "can Anon-RPC read a chain it does not list", is being asked in another team's open issue ([kou-uni/ethglobal-mumbai#6](https://github.com/kou-uni/ethglobal-mumbai/issues/6)), which had no result when read.

## EF9: EIP-8141 frame-transaction sweep

**What exists (documented).** A workshop repo describes a public devnet: chain `1337`, every request through the gateway `https://altmempoolgateway.forshtat.com/rpc` (a sidecar that gossips and forwards reads to ethrex), explorer `https://explorer.altmempool.wtf/`, and a 1 ETH faucet. The repo warns "Work in progress" and "the devnet can be reset at any time". Pinned: ethrex branch `eip8141-tracer`, EIP-8141 at `4a9ad32c`. The package `@forshtat/hegota-support` (0.0.1) provides a TypeScript codec for the transactions. Node 20.12+ and yarn are needed.

**Alt mempool, in the repo's words.** The canonical mempool has the strictest rules. The standard alt mempool (ERC-8421 style) "admits some txs the canonical mempool rejects, when staking and reputation conditions hold".

**What is not shown anywhere I read.**
- An ordinary EOA, signed with a secp256k1 key, sending a frame transaction. The examples use contracts (`SponsorPaymaster`, `ExampleWallet`) and a throwaway key.
- Any sweep of ETH from an address that pays its own gas.
- A pinned-revision conflict: the workshop pins EIP-8141 at `4a9ad32c`, while the execution-specs tracker says the spec is frozen at `ethereum/EIPs@b75cbe6`. I did not resolve which is current.
- The spec is a draft with no activation date.

**Why this cannot be the real payout.** The devnet is chain 1337 with its own faucet. Our bounties are native ETH on the escrow chain (Sepolia). A sweep on the devnet can only move **devnet** ETH from a stealth address that was derived with our scheme and funded from the devnet faucet. It shows that the key derivation works as a frame-transaction sender. It is not the Sepolia payout, and the demo must not suggest it is.

**Why it may not show "alt mempool".** If a normal EOA sweep is accepted by the canonical path, it demonstrates EIP-8141 but not the alt mempool. A stronger story needs something only the alt mempool admits. Do not claim that until the spike shows which path admits it.

### Spike 2 (needs the devnet; read the repo's `docs/steps` first)

1. Clone `forshtat/mempool-workshop`, run `yarn install && yarn step_1_check` (creates a key and funds it from the faucet).
2. Read `src/lib` and `docs/steps`, and find out how an EOA-signed frame transaction is built.
3. Derive a stealth address with `packages/stealth`, fund it from the faucet, and sweep it to a fresh address with a frame transaction.
4. Pass: an admitted transaction on the explorer, and a note of which mempool admitted it (canonical or alt). Fail or blocked: document the exact reason in the README. Do not present it as working.

## Arkiv facts that settle open questions

All documented, none run yet.
- **Testnet:** Rabdi, chain id `7794095`, gas token tGLM, block time 2 s, HTTP RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, faucet `https://hub.arkiv.network/faucet`, explorer `https://rabdi.explorer.arkiv.network`.
- **Funding (answers EF1's question):** Arkiv has its own gas token and faucet. It is **not** funded from the escrow chain. The escrow chain and Arkiv are two separate networks.
- **Max lifetime:** "No entity lives more than 7,884,000 blocks, about 182.5 days", counted in blocks. This matches `schema.md`'s 182-day note.
- **SDK:** `@arkiv-network/sdk` 1.0.1 on npm (modified 2026-11-02), the version `schema.md` targets. Older search results named other chains (`mendoza`, `kaolin`) from earlier SDK versions. Use the chain exported by the installed SDK.

## What to do now

1. Do not change the plan or the pitch yet. Neither item is promised.
2. Run spike 1 and spike 2 when there is a browser and devnet access. Each is small and has a clear pass or fail.
3. Whatever happens, write the result into the README and `arkiv/friction.md` with the evidence, as `WORK_SPLIT.md` already requires.
4. Re-check the dates and rules on the official ETHGlobal EF page before submitting. Sources disagree on the event dates (one says 5 to 7 November, another 6 to 8 November), and the EF workshop on 5 November has already happened.

## Sources

- [ETHGlobal Mumbai: Ethereum Foundation prizes](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation) (prize rules, one-prize rule)
- [anon-rpc docs](https://ethereum.github.io/anon-rpc/), [wallets](https://ethereum.github.io/anon-rpc/wallets/), [networks](https://ethereum.github.io/anon-rpc/networks/), [adopters](https://ethereum.github.io/anon-rpc/adopters/)
- [kou-uni/ethglobal-mumbai issue 6](https://github.com/kou-uni/ethglobal-mumbai/issues/6) (another team checking non-listed chains)
- [forshtat/mempool-workshop](https://github.com/forshtat/mempool-workshop) (devnet, versions, alt-mempool terms)
- [shubham5080/FrameCap](https://github.com/shubham5080/FrameCap) (a project using the devnet gateway)
- [ethereum/execution-specs issue 3532](https://github.com/ethereum/execution-specs/issues/3532) (frames-devnet fixture tracker, EIP-8141 spec revision)
- [Arkiv docs: Rabdi testnet](https://docs.arkiv.network/networks/rabdi/), [expiration](https://docs.arkiv.network/writing/expiration/), [introduction](https://docs.arkiv.network/start-here/introduction/)
- npm: [`@anon-rpc/browser-harness`](https://www.npmjs.com/package/@anon-rpc/browser-harness), [`@forshtat/hegota-support`](https://www.npmjs.com/package/@forshtat/hegota-support), [`@arkiv-network/sdk`](https://www.npmjs.com/package/@arkiv-network/sdk)
