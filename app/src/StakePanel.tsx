'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, formatEther, http, parseEther, type PublicClient } from 'viem';
import { createEscrow, type EscrowConfig } from '@lookout/escrow';
import { ESCROW_ADDRESS, ESCROW_CHAIN, escrowConfigured } from './wallet/chains';
import { escrowFor } from './wallet/ports';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * A reviewer's stake. To be drawn as a juror a wallet needs a World ID seat AND a stake in the escrow. The stake is what a juror
 * risks: losing a vote, or not revealing, costs part of it. Unstaking takes a delay that is longer than a case lasts, so a juror
 * cannot leave before they can be held to their vote.
 */

type View = { amount: bigint; unlockAt: bigint; eligible: boolean };

export default function StakePanel() {
  const wallet = useWallet();
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!escrowConfigured) return;
    const reader = createEscrow({ address: ESCROW_ADDRESS as `0x${string}`, publicClient: createPublicClient({ chain: ESCROW_CHAIN, transport: http() }) as PublicClient });
    setCfg(await reader.config());
    if (wallet.address) setView(await reader.stakeOf(wallet.address));
  }, [wallet.address]);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);

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

  if (!escrowConfigured) return null;
  const min = cfg ? formatEther(cfg.minReviewerStake) : '…';
  const now = BigInt(Math.floor(Date.now() / 1000));
  const unstaking = !!view && view.unlockAt > 0n;
  const canWithdraw = unstaking && view!.unlockAt <= now;

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">REVIEWER STAKE</span>
        <span className="mono-label">{wallet.address ? short(wallet.address) : 'NOT CONNECTED'}</span>
      </div>
      <p className="tiny">Minimum {min} ETH. A juror who votes against the majority, or does not reveal, loses part of the stake to the bounty pool.</p>

      {view && (
        <div className="tx">
          <div className="mono-label">Your stake</div>
          <div className="tx-title">{formatEther(view.amount)} ETH</div>
          <p className="tx-sub">{view.eligible ? 'Eligible to be drawn (with a World ID seat).' : unstaking ? 'Unstaking: not eligible for new cases.' : 'Below the minimum: not eligible.'}</p>
        </div>
      )}

      <div className="input-row">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={cfg ? `at least ${min}` : 'amount in ETH'} inputMode="decimal" spellCheck={false} autoComplete="off" />
        <button className="btn" type="button" disabled={!!busy || !wallet.address || !/^\d+(\.\d{1,18})?$/.test(amount.trim())} onClick={() => void act('Stake', () => escrowFor(wallet).stake(parseEther(amount.trim())))}>
          {busy === 'Stake' ? 'Waiting…' : 'Stake'}
        </button>
      </div>

      {view && view.amount > 0n && (
        <div className="input-row">
          {!unstaking && <button className="btn btn-ghost" type="button" disabled={!!busy} onClick={() => void act('Start unstaking', () => escrowFor(wallet).requestUnstake())}>Start unstaking</button>}
          {unstaking && (
            <button className="btn btn-ghost" type="button" disabled={!!busy || !canWithdraw} onClick={() => void act('Withdraw', () => escrowFor(wallet).withdraw())}>
              {canWithdraw ? 'Withdraw' : `Withdraw (unlocks ${new Date(Number(view.unlockAt) * 1000).toLocaleString()})`}
            </button>
          )}
        </div>
      )}
      {cfg && <p className="tiny">Unstaking takes {Number(cfg.unstakeDelay) / 86_400} days, so you cannot leave before a case you were drawn for is decided.</p>}

      {message && (
        <div className={`verdict ${message.tone === 'ok' ? 'v-unknown' : 'v-warn'}`} role="status">
          <div className="verdict-head"><span className="verdict-tag">{message.tone === 'ok' ? 'DONE' : 'NOT DONE'}</span></div>
          <p className="verdict-line">{message.text}</p>
        </div>
      )}
    </div>
  );
}
