'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { checkTarget, MODE } from './lookup';
import { fmtAge } from './hooks';
import { parsePayment, PayError, reviewPayment, sendPayment, type PaymentRecord, type Review, type Tier } from './flows/pay-flow';
import { ethBalance, paymentHistory, payPorts } from './wallet/ports';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * Send ETH, with Lookout in front of it. The recipient is looked up privately BEFORE the wallet is asked to sign anything.
 * What the check found decides how much confirmation the payment needs (flows/pay-flow.ts). "Send anyway" is always the
 * person's choice and is written to the payment log on this device.
 */

type Stage = 'form' | 'checking' | 'review' | 'sending' | 'sent';

const TITLE = { block: 'Flagged as a scam', warn: 'Warning: reported as suspicious', unknown: 'No reports found', failed: 'Could not check this address' } as const;
const kindOf = (r: Review) => (r.check ? r.check.verdict : 'failed');
const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

export default function PayPage() {
  const wallet = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [stage, setStage] = useState<Stage>('form');
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [history, setHistory] = useState<PaymentRecord[]>([]);

  useEffect(() => { setHistory(paymentHistory()); }, [stage]);
  useEffect(() => {
    if (!wallet.address) return setBalance(null);
    ethBalance(wallet.address).then(setBalance, () => setBalance(null));
  }, [wallet.address, stage]);

  async function runCheck() {
    setProblem(null);
    setError(null);
    const p = parsePayment({ recipient, amountEth: amount });
    if (!p.ok) return setProblem(p.error);
    if (balance !== null && p.payment.amountWei > balance) return setProblem(`Your Sepolia balance is ${formatEther(balance)} ETH, which is less than this payment.`);
    setStage('checking');
    setAck(false);
    setReview(await reviewPayment({ checkTarget, now: () => Date.now() }, p.payment));
    setStage('review');
  }

  async function send() {
    if (!review) return;
    setError(null);
    if (!wallet.address) { setError('Connect your wallet (top right) to send.'); return; }
    setStage('sending');
    // the checkbox is the person's explicit choice: "care" for a warning, "override" for a flag or a failed check
    const given: Tier = review.tier === 'none' ? 'none' : ack ? review.tier : 'none';
    try {
      const out = await sendPayment(payPorts(wallet), review, given);
      setHash(out.hash);
      setStage('sent');
    } catch (e) {
      setError(e instanceof PayError ? e.message : e instanceof Error ? e.message : String(e));
      setStage('review');
    }
  }

  const reset = () => { setStage('form'); setReview(null); setHash(null); setAck(false); setError(null); };
  const kind = review ? kindOf(review) : null;
  const needsAck = review ? review.tier !== 'none' : false;

  return (
    <div className="wallet">
      <div className="wallet-bar">
        <span className="mono-label">SEND ETH · SEPOLIA</span>
        <span className="mono-label">{wallet.address ? `${short(wallet.address)}${balance !== null ? ` · ${Number(formatEther(balance)).toFixed(4)} ETH` : ''}` : 'NOT CONNECTED'}</span>
      </div>

      {stage === 'form' || stage === 'checking' ? (
        <form onSubmit={(e) => { e.preventDefault(); void runCheck(); }}>
          <label className="mono-label" htmlFor="pay-to">To</label>
          <div className="input-row">
            <input id="pay-to" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" disabled={stage === 'checking'} />
          </div>
          <label className="mono-label" htmlFor="pay-amount">Amount (ETH)</label>
          <div className="input-row">
            <input id="pay-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" spellCheck={false} autoComplete="off" disabled={stage === 'checking'} />
            <button className="btn" type="submit" disabled={stage === 'checking' || !recipient.trim()}>{stage === 'checking' ? 'Checking…' : 'Review payment'}</button>
          </div>
          {!wallet.address && <p className="tiny">You can check an address without a wallet. Connect one in the top bar when you are ready to send.</p>}
          {problem && <p className="tiny" role="alert">{problem}</p>}
          <p className="tiny">
            {MODE === 'pir' ? 'The address is checked privately: neither PIR server learns who you are about to pay.' : MODE === 'indexer' ? 'Live lookup, but not private: the indexer sees the address.' : 'Simulated data: no live service is connected in this mode.'}
          </p>
        </form>
      ) : null}

      {review && (stage === 'review' || stage === 'sending') && (
        <div className={`verdict v-${review.check ? review.check.verdict : 'warn'}`} role="status">
          <div className="verdict-head">
            <span className="verdict-tag">{kind === 'block' ? 'DANGER' : kind === 'warn' ? 'WARNING' : kind === 'unknown' ? 'NO REPORTS' : 'NOT CHECKED'}</span>
            {review.check?.disputed && <span className="mono-label">DISPUTED</span>}
            {review.check && <span className="mono-label right">{review.check.verified ? '✓ VERIFIED VS ARKIV ROOT' : '✗ UNVERIFIED'}</span>}
          </div>
          <p className="verdict-line">{TITLE[kind!]}</p>
          <p className="tx-sub">Paying {formatEther(review.payment.amountWei)} ETH to {review.payment.recipient}</p>
          {review.check && <p className="tiny">{review.check.headline}</p>}
          {review.checkError && <p className="tiny">The check failed: {review.checkError}. A failed check is not a clean result, so sending needs your explicit choice.</p>}

          {review.check && review.check.reasons.length > 0 && (
            <>
              <div className="mono-label">Why, and where you can verify it</div>
              <ul className="reasons">
                {review.check.reasons.map((x) => (
                  <li key={x.entityId}>
                    <span className="mono-label">{x.sourceType}</span>
                    <span>{x.sourceId}</span>
                    <span className="mono-label">{x.level} · {fmtAge(x.ageSeconds)}</span>
                    <span className="mono-label ent">{x.entityId}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {review.check && (
            <p className="tiny">
              Verification: this answer came from table <b>{review.check.snapshotId}</b>, {review.check.verified ? 'whose root matches the one published on Arkiv by a registered indexer. Each entity above is a public Arkiv record you can look up.' : 'but its root could not be compared with Arkiv, so treat it as unconfirmed.'}
              {' '}Lookout reports what was found. It never says an address is safe.
            </p>
          )}

          {needsAck && (
            <label className="ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={stage === 'sending'} />
              {review.tier === 'override'
                ? ' I understand this address may steal my funds, or was not checked, and I want to send anyway.'
                : ' I have read the warning and want to send.'}
            </label>
          )}

          <div className="input-row">
            <button className="btn" type="button" onClick={reset} disabled={stage === 'sending'}>{review.tier === 'override' ? 'Cancel, do not send' : 'Back'}</button>
            <button
              className={review.tier === 'override' ? 'btn btn-red' : review.tier === 'care' ? 'btn btn-ghost' : 'btn'}
              type="button" disabled={stage === 'sending' || (needsAck && !ack)} onClick={() => void send()}
            >
              {stage === 'sending' ? 'Waiting for your wallet…' : review.tier === 'override' ? 'Send anyway' : 'Send'}
            </button>
          </div>
          {error && <p className="tiny" role="alert">{error}</p>}
          <p className="tiny">
            Think this is wrong, or know of a scam we missed?{' '}
            <Link href={`/report?kind=address&value=${review.payment.recipient}`}>Report this address</Link>.
          </p>
        </div>
      )}

      {stage === 'sent' && hash && review && (
        <div className="verdict v-unknown" role="status">
          <div className="verdict-head"><span className="verdict-tag">SENT</span></div>
          <p className="verdict-line">{formatEther(review.payment.amountWei)} ETH sent{review.tier !== 'none' ? ', after your confirmation' : ''}.</p>
          <p className="tiny"><a href={explorer(hash)} target="_blank" rel="noreferrer">View the transaction</a> · <code>{short(hash)}</code></p>
          <button className="btn" type="button" onClick={reset}>New payment</button>
        </div>
      )}

      {history.length > 0 && (
        <div className="paylog">
          <div className="mono-label">Your payment log (this device)</div>
          <ul className="reasons">
            {history.slice(0, 5).map((h) => (
              <li key={`${h.at}-${h.recipient}`}>
                <span className="mono-label">{h.verdict}</span>
                <span>{short(h.recipient)}</span>
                <span className="mono-label">{formatEther(BigInt(h.amountWei))} ETH · {h.overrode ? 'confirmed past a warning' : 'plain'}{h.txHash ? '' : ' · not sent'}</span>
                <span className="mono-label ent">{h.txHash ? short(h.txHash) : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
