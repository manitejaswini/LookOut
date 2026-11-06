import { keccak_256 } from '@noble/hashes/sha3.js';
import { normalizeTarget } from '@lookout/core';
import { fit } from './evidence.ts';
import type { CheckOutcome } from './domain.ts';

/**
 * Contract check: hash the contract's deployed (runtime) bytecode and see whether that exact hash is on a curated
 * list of known drainer contracts. An exact match is precise and anyone can repeat it: fetch the code, hash it,
 * compare. There is deliberately NO "looks like a drainer" guesswork. Legitimate marketplaces call the same functions
 * (setApprovalForAll, transferFrom), so a selector heuristic would block real projects.
 */

export interface DrainerEntry {
  /** keccak256 of the runtime bytecode, 0x + 64 lowercase hex */
  codeHash: string;
  label: string;
  /** where this claim is documented (a report, an analysis, a registry). Required for every entry */
  source: string;
}

const HASH = /^0x[0-9a-f]{64}$/;

export class DrainerList {
  private byHash = new Map<string, DrainerEntry>();

  constructor(entries: DrainerEntry[]) {
    for (const e of entries) {
      if (!HASH.test(e.codeHash)) throw new Error(`drainer list: bad codeHash ${JSON.stringify(e.codeHash)} (want 0x + 64 lowercase hex)`);
      if (!e.label) throw new Error(`drainer list: ${e.codeHash} has no label`);
      if (!e.source) throw new Error(`drainer list: ${e.codeHash} has no source. Every entry needs one, or it could block a real contract on our word alone`);
      if (this.byHash.has(e.codeHash)) throw new Error(`drainer list: duplicate ${e.codeHash}`);
      this.byHash.set(e.codeHash, e);
    }
  }

  get size() { return this.byHash.size; }
  match(codeHash: string): DrainerEntry | undefined { return this.byHash.get(codeHash.toLowerCase()); }
}

export function parseDrainerList(json: unknown): DrainerList {
  const entries = (json as { entries?: DrainerEntry[] } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error('drainer list: expected { "entries": [...] }');
  return new DrainerList(entries);
}

/** What the check needs from an Ethereum node. A fake with this shape is used in tests. */
export interface CodeSource {
  chainId(): Promise<number>;
  getCode(address: string): Promise<string>;
}

export interface ContractDeps {
  code: CodeSource;
  drainers: DrainerList;
  now?: () => Date;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('the node returned malformed bytecode');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

export async function checkContract(input: string, deps: ContractDeps): Promise<CheckOutcome> {
  const address = normalizeTarget('contract', input);
  const notes: string[] = [];
  const [chainId, rawCode] = await Promise.all([deps.code.chainId(), deps.code.getCode(address)]);
  const bytes = hexToBytes(rawCode);
  notes.push(`chain ${chainId}`);

  if (bytes.length === 0) {
    notes.push('no code at this address (an ordinary account, or a contract not deployed on this chain)');
    return { finding: null, notes };
  }
  const codeHash = toHex(keccak_256(bytes));
  notes.push(`runtime code ${bytes.length} bytes, hash ${codeHash}`);

  const hit = deps.drainers.match(codeHash);
  if (!hit) {
    notes.push(`not on the known-drainer list (${deps.drainers.size} entries). This is not a clearance`);
    return { finding: null, notes };
  }

  notes.push(`FOUND: matches "${hit.label}" (${hit.source})`);
  const evidence = {
    version: 0,
    type: 'known-drainer-bytecode',
    target: address,
    chainId,
    checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
    codeBytes: bytes.length,
    codeHash,
    listedAs: hit.label,
    listedBecause: hit.source,
    howToRecheck: 'eth_getCode at this address, keccak256 the result, compare with codeHash and with the cited source',
  };
  return {
    finding: { kind: 'known-drainer-bytecode', targetKind: 'contract', value: address, reason: fit(`bytecode matches known drainer "${hit.label}"`), evidence },
    notes,
  };
}

/** A CodeSource backed by a JSON-RPC endpoint. The URL is operator configuration, not user input. */
export function rpcCodeSource(rpcUrl: string, fetchImpl: typeof fetch = fetch): CodeSource {
  let id = 0;
  const call = async (method: string, params: unknown[]) => {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
  return {
    chainId: async () => parseInt(String(await call('eth_chainId', [])), 16),
    getCode: async (address) => String(await call('eth_getCode', [address, 'latest'])),
  };
}
