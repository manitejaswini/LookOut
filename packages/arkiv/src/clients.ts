import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EntityWriter } from './writers.ts';

/**
 * Builds the Arkiv clients for the Rabdi testnet.
 *
 * `privateKey` is for a server-side writer (an indexer, a feed importer, the checker, the panel service).
 * It must come from an environment variable or a secret store. NEVER hard-code it, and never reuse a real wallet:
 * use the throwaway wallet from `npm run wallet:new` for testnet work.
 * A browser app should not use this: it signs with the user's own wallet instead.
 */
export function createArkivClients(opts: { accessKey: string; privateKey: `0x${string}` }) {
  const chain = rabdi({ accessKey: opts.accessKey });
  const account = privateKeyToAccount(opts.privateKey);
  const transport = () => http(undefined, { timeout: 30_000, retryCount: 4, retryDelay: 2000 });
  const publicClient = createPublicClient({ chain, transport: transport() });
  const walletClient = createWalletClient({ chain, transport: transport(), account });
  return {
    address: account.address,
    publicClient,
    walletClient,
    /** the writers only need this narrow view of the wallet client */
    writer: walletClient as unknown as EntityWriter,
  };
}

/** Read-only client, safe for an indexer or any code that has no wallet. */
export function createArkivReader(opts: { accessKey: string }) {
  return createPublicClient({ chain: rabdi({ accessKey: opts.accessKey }), transport: http() });
}
