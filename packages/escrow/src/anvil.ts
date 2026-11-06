// Test support: starts a throwaway local EVM node (anvil, from Foundry) and gives back viem clients for it.
// Not exported from the package index. Used by the integration tests and the end-to-end trust-layer tests.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createTestClient, createWalletClient, http, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

// Anvil's well-known development keys. They are PUBLIC and hold nothing outside a local anvil node. Never use them anywhere else.
const DEV_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
] as const;

export const anvilAvailable = (): boolean => spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
  });

export interface Account { address: Address; wallet: WalletClient }

export interface LocalChain {
  url: string;
  publicClient: PublicClient;
  /** six prefunded accounts, each with its own wallet client */
  accounts: Account[];
  /** move time forward and mine a block, for the reclaim and unstake delays */
  increaseTime(seconds: number): Promise<void>;
  stop(): Promise<void>;
}

export async function startLocalChain(): Promise<LocalChain> {
  const port = await freePort();
  const proc: ChildProcess = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const publicClient = createPublicClient({ chain: foundry, transport: http(url) }) as PublicClient;

  // wait until it answers
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { await publicClient.getChainId(); break; } catch {
      if (Date.now() > deadline) { proc.kill(); throw new Error('anvil did not start in time'); }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const accounts = DEV_KEYS.map((k): Account => {
    const account = privateKeyToAccount(k);
    return { address: account.address, wallet: createWalletClient({ account, chain: foundry, transport: http(url) }) };
  });
  const test = createTestClient({ chain: foundry, mode: 'anvil', transport: http(url) });

  return {
    url,
    publicClient,
    accounts,
    async increaseTime(seconds) { await test.increaseTime({ seconds }); await test.mine({ blocks: 1 }); },
    async stop() {
      proc.kill();
      await new Promise((r) => setTimeout(r, 100));
    },
  };
}
