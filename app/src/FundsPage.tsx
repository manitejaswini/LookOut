'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { loadFunds, type Funds } from './flows/funds-flow';
import { escrowConfigured } from './wallet/chains';
import { escrowFor, fundsPorts } from './wallet/ports';
import { savedReports } from './wallet/reports-store';
import { short, useWallet } from './wallet/WalletProvider';

/** What the escrow holds for you: refunds you can claim, and deposits nobody settled that you can take back. */

export default function FundsPage() {
  const wallet = useWallet();
  const [funds, setFunds] = useState<Funds | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.address || !escrowConfigured) return setFunds(null);
    try {
      setFunds(await loadFunds(fundsPorts(), wallet.address, savedReports()));
    } catch (e) {
      setMessage({ tone: 'bad', text: `Could not read the escrow: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [wallet.address]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function act(label: string, run: () => Promise<unknown>) {
    setBusy(label);
    setMessage(null);
    try {
      await wallet.switchChain('escrow');
      await run();
      setMessage({ tone: 'ok', text: `${label}: done.` });
      await refresh();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!escrowConfigured) return <div className="wallet reviewer"><p className="tiny">The escrow contract is not configured (NEXT_PUBLIC_ESCROW_ADDRESS).</p></div>;

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">YOUR ESCROW FUNDS</span>
        <span className="mono-label">{wallet.address ? short(wallet.address) : 'NOT CONNECTED'}</span>
      </div>
      {!wallet.address && <p className="tiny">Connect your wallet to see what the escrow holds for you.</p>}

      {funds && (
        <>
          <div className="tx">
            <div className="mono-label">Refund waiting for you</div>
            <div className="tx-title">{formatEther(funds.claimableWei)} ETH</div>
            <button className="btn" type="button" disabled={!!busy || funds.claimableWei === 0n} onClick={() => void act('Claim refund', () => escrowFor(wallet).claim())}>
              {busy === 'Claim refund' ? 'Waiting for your wallet…' : 'Claim refund'}
            </button>
            <p className="tiny">Refunds are pulled by you, so a wallet that refuses ETH can never block anyone else.</p>
          </div>

          <div className="mono-label">Reports filed from this browser</div>
          {funds.deposits.length === 0 && <p className="tiny">None. Reports filed from another browser are not listed here.</p>}
          <ul className="reasons">
            {funds.deposits.map((d) => (
              <li key={d.reportId}>
                <span className="mono-label">{d.status}</span>
                <span>{d.value.length > 28 ? `${d.value.slice(0, 26)}…` : d.value}</span>
                <span className="mono-label">{d.note}</span>
                <span>
                  {d.canReclaim && (
                    <button className="btn btn-ghost" type="button" disabled={!!busy} onClick={() => void act('Reclaim deposit', () => escrowFor(wallet).reclaim(d.reportId))}>
                      {busy === 'Reclaim deposit' ? 'Waiting…' : 'Take it back'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {message && (
        <div className={`verdict ${message.tone === 'ok' ? 'v-unknown' : 'v-warn'}`} role="status">
          <div className="verdict-head"><span className="verdict-tag">{message.tone === 'ok' ? 'DONE' : 'NOT DONE'}</span></div>
          <p className="verdict-line">{message.text}</p>
        </div>
      )}
    </div>
  );
}
