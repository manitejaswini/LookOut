'use client';

import { useState } from 'react';
import DisputeBox from './DisputeBox';
import { useWallet } from './wallet/WalletProvider';

export default function DisputePage({ initialTarget }: { initialTarget?: string }) {
  const wallet = useWallet();
  const [target, setTarget] = useState(initialTarget ?? '');
  const t = (target || wallet.address || '').trim();
  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">DISPUTE A FLAG</span>
        <span className="mono-label">{wallet.address ? 'WALLET CONNECTED' : 'NOT CONNECTED'}</span>
      </div>
      <label className="mono-label" htmlFor="dispute-target">Your flagged address</label>
      <div className="input-row">
        <input id="dispute-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={wallet.address ?? '0x…'} spellCheck={false} autoComplete="off" />
      </div>
      {t ? <DisputeBox target={t} /> : <p className="tiny">Connect your wallet or paste the flagged address.</p>}
    </div>
  );
}
