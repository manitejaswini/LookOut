'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Chain, numberToHex } from 'viem';
import { chainFor, type ChainName } from './chains';

/**
 * The person's own wallet, through the injected EIP-1193 provider (MetaMask, Rabby, Coinbase Wallet, ...).
 * The app never sees a private key: every transaction is signed and approved inside the wallet.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...a: never[]) => void): void;
  removeListener?(event: string, handler: (...a: never[]) => void): void;
}

declare global {
  interface Window { ethereum?: Eip1193 }
}

export interface WalletState {
  /** false until we have looked, so the server render and first client render agree */
  ready: boolean;
  available: boolean;
  address: `0x${string}` | null;
  chainId: number | null;
  error: string | null;
  connect(): Promise<void>;
  disconnect(): void;
  /** switches the wallet to a chain, adding it first if the wallet has never seen it */
  switchChain(name: ChainName): Promise<void>;
  provider(): Eip1193;
}

const Ctx = createContext<WalletState | null>(null);

export const useWallet = (): WalletState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>');
  return v;
};

const toChainId = (hex: unknown) => (typeof hex === 'string' ? parseInt(hex, 16) : null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = useCallback((): Eip1193 => {
    if (!window.ethereum) throw new Error('No wallet found. Install a browser wallet such as MetaMask or Rabby.');
    return window.ethereum;
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    setAvailable(!!eth);
    if (!eth) return setReady(true);
    // eth_accounts does not prompt: it only returns accounts the person already approved for this site
    // a locked or slow wallet can leave these requests pending forever, so the page must not wait on them
    const giveUp = window.setTimeout(() => setReady(true), 1500);
    eth.request({ method: 'eth_accounts' }).then((a) => setAddress(((a as string[])[0]?.toLowerCase() as `0x${string}`) ?? null)).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((c) => setChainId(toChainId(c))).catch(() => {}).finally(() => { window.clearTimeout(giveUp); setReady(true); });
    const onAccounts = (a: string[]) => setAddress((a[0]?.toLowerCase() as `0x${string}`) ?? null);
    const onChain = (c: string) => setChainId(toChainId(c));
    eth.on?.('accountsChanged', onAccounts as never);
    eth.on?.('chainChanged', onChain as never);
    return () => {
      window.clearTimeout(giveUp);
      eth.removeListener?.('accountsChanged', onAccounts as never);
      eth.removeListener?.('chainChanged', onChain as never);
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const a = (await provider().request({ method: 'eth_requestAccounts' })) as string[];
      setAddress((a[0]?.toLowerCase() as `0x${string}`) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the wallet did not connect');
    }
  }, [provider]);

  // Forget the address AND ask the wallet to revoke this site's permissions, so the next "Connect wallet" shows the full connection
  // dialog again, where the person can tick every network (Sepolia for deposits, Rabdi for Arkiv). That dialog is the reliable place
  // to grant a network the site was never given. Older wallets without revoke simply keep their connection.
  const disconnect = useCallback(() => {
    setAddress(null);
    window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  }, []);

  const switchChain = useCallback(async (name: ChainName) => {
    const chain: Chain = chainFor(name);
    const p = provider();
    const target = numberToHex(chain.id);
    // ALWAYS ask the wallet to switch, even when it is already on this network. Recent MetaMask versions grant a site access network
    // by network, and a switch request is what makes MetaMask offer that permission. Skipping it when the wallet "is already there"
    // left the site without permission on the network, and every transaction there failed with "not authorized".
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
    } catch (e) {
      // 4902: the wallet does not know this chain yet, so add it (the wallet asks the person to approve), then switch to it
      if ((e as { code?: number }).code !== 4902) throw e;
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: target, chainName: chain.name, nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
        }],
      });
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] }).catch(() => {});
    }
  }, [provider]);

  const value = useMemo<WalletState>(
    () => ({ ready, available, address, chainId, error, connect, disconnect, switchChain, provider }),
    [ready, available, address, chainId, error, connect, disconnect, switchChain, provider],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
