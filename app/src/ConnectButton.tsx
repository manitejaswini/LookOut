'use client';

import { short, useWallet } from './wallet/WalletProvider';

/** Top-bar wallet control. The wallet itself signs everything; this only shows who is connected. */
export default function ConnectButton() {
  const w = useWallet();
  if (!w.ready) return <span className="connect connect-idle" aria-hidden="true" />;
  if (!w.available) {
    return <a className="connect" href="https://ethereum.org/wallets/find-wallet/" target="_blank" rel="noreferrer">Get a wallet</a>;
  }
  if (!w.address) {
    return <button className="connect" type="button" onClick={() => void w.connect()}>Connect wallet</button>;
  }
  return (
    <button className="connect connect-on" type="button" onClick={w.disconnect} title="Forget this address in the app (your wallet stays connected until you disconnect it there)">
      {short(w.address)}
    </button>
  );
}
