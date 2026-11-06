'use client';

import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { ClaimError, findBounties, sweepBounty, type FoundBounty } from './flows/claim-flow';
import { claimPorts } from './wallet/ports';
import { exportKeys, loadKeys } from './wallet/stealth-keys';
import { savedReports } from './wallet/reports-store';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * Collect a private bounty. The keys that find it are in this browser (made when you filed a report), and the one-time address
 * signs the transfer here too. The connected wallet is not involved, which is the point.
 */

const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

export default function ClaimPage() {
  const wallet = useWallet();
  const [keysReady, setKeysReady] = useState<boolean | null>(null);
  const [bounties, setBounties] = useState<FoundBounty[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [dest, setDest] = useState('');
  const [acceptLink, setAcceptLink] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string; hash?: string } | null>(null);
  const [backup, setBackup] = useState<string | null>(null);

  useEffect(() => { setKeysReady(!!loadKeys()); }, []);

  async function look() {
    const keys = loadKeys();
    if (!keys) return;
    setLooking(true);
    setMessage(null);
    try {
      setBounties(await findBounties(claimPorts(), savedReports().map((r) => r.reportId), keys));
    } catch (e) {
      setMessage({ tone: 'bad', text: `Could not look for bounties: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLooking(false);
    }
  }
  useEffect(() => { if (keysReady) void look(); }, [keysReady]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sweep(b: FoundBounty) {
    const keys = loadKeys();
    if (!keys) return;
    setBusy(b.stealthAddress);
    setMessage(null);
    try {
      const out = await sweepBounty(claimPorts(), keys, b, dest.trim(), { knownWallets: wallet.address ? [wallet.address] : [], allowLinked: acceptLink });
      setMessage({ tone: 'ok', text: `Sent ${formatEther(out.sentWei)} ETH (the network fee came out of the bounty).`, hash: out.hash });
      void look();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof ClaimError || e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const linked = !!wallet.address && dest.trim().toLowerCase() === wallet.address.toLowerCase();

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">COLLECT A BOUNTY</span>
        <span className="mono-label">{keysReady ? 'BOUNTY KEY IN THIS BROWSER' : 'NO BOUNTY KEY HERE'}</span>
      </div>

      {keysReady === false && (
        <p className="tiny">
          This browser has no bounty key, so it cannot find any bounty. The key is created when you file a report with a private bounty on this
          browser. If you filed from another browser, collect it there.
        </p>
      )}

      {keysReady && (
        <>
          <label className="mono-label" htmlFor="claim-dest">Send the bounty to (use a fresh address)</label>
          <div className="input-row">
            <input id="claim-dest" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x… a new address that is not your main wallet" spellCheck={false} autoComplete="off" />
          </div>
          {linked && (
            <label className="ack">
              <input type="checkbox" checked={acceptLink} onChange={(e) => setAcceptLink(e.target.checked)} />
              {' '}This is the wallet that filed the report. I understand sending it there links the two.
            </label>
          )}

          <div className="mono-label">Bounties found for the reports filed here</div>
          {looking && <p className="tiny">Looking…</p>}
          {bounties && bounties.length === 0 && !looking && <p className="tiny">None yet. A bounty appears after the panel confirms a report, which takes as long as the review rounds.</p>}
          {bounties && bounties.length > 0 && (
            <ul className="reasons">
              {bounties.map((b) => (
                <li key={b.stealthAddress}>
                  <span className="mono-label">report {b.reportId.slice(0, 8)}</span>
                  <span>{short(b.stealthAddress)}</span>
                  <span className="mono-label">{formatEther(b.balanceWei)} ETH</span>
                  <span>
                    <button className="btn btn-ghost" type="button" disabled={!!busy || b.balanceWei <= 0n || !dest.trim()} onClick={() => void sweep(b)}>
                      {busy === b.stealthAddress ? 'Sending…' : b.balanceWei > 0n ? 'Collect' : 'Collected'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button className="btn btn-ghost" type="button" onClick={() => setBackup(backup ? null : exportKeys())}>{backup ? 'Hide backup' : 'Show my bounty key backup'}</button>
          {backup && (
            <>
              <p className="tiny"><b>Anyone who has this can take your bounties.</b> Store it like a password, and do not share it.</p>
              <pre className="srvlog"><code>{backup}</code></pre>
            </>
          )}
        </>
      )}

      {message && (
        <div className={`verdict ${message.tone === 'ok' ? 'v-unknown' : 'v-warn'}`} role="status">
          <div className="verdict-head"><span className="verdict-tag">{message.tone === 'ok' ? 'SENT' : 'NOT SENT'}</span></div>
          <p className="verdict-line">{message.text}</p>
          {message.hash && <p className="tiny"><a href={explorer(message.hash)} target="_blank" rel="noreferrer">View the transaction</a></p>}
        </div>
      )}
    </div>
  );
}
