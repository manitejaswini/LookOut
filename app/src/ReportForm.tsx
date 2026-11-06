'use client';

import { useState } from 'react';
import type { TargetKind } from '@lookout/core';
import { CATEGORIES, FlowError, runReportFlow, TARGET_KINDS, type Category, type ReportResult, type ReportStep, type Resume } from './flows/report-flow';
import { escrowConfigured } from './wallet/chains';
import { DEPOSIT_ETH_LABEL, PAYER_ENC_KEY, reportPorts } from './wallet/ports';
import { exportKeys } from './wallet/stealth-keys';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * File a report: lock the deposit, then post the report. The deposit is returned if the panel confirms the report, goes to the
 * bounty pool if it is rejected, and can be reclaimed if nobody rules. Reports from fresh wallets can only warn, they never block.
 */

const STEP_TEXT: Record<ReportStep, string> = {
  validate: 'Checking what you entered…',
  deposit: 'Step 1 of 2. Approve the deposit in your wallet (on Sepolia).',
  post: 'Step 2 of 2. Approve posting the report to Arkiv in your wallet.',
  done: 'Done.',
};

export default function ReportForm({ initialKind, initialValue }: { initialKind?: TargetKind; initialValue?: string }) {
  const wallet = useWallet();
  const [kind, setKind] = useState<TargetKind>(initialKind ?? 'domain');
  const [value, setValue] = useState(initialValue ?? '');
  const [category, setCategory] = useState<Category>('drainer');
  const [bounty, setBounty] = useState(true);
  const [backup, setBackup] = useState<string | null>(null);
  const [step, setStep] = useState<ReportStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);
  const [done, setDone] = useState<ReportResult | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await runReportFlow(reportPorts(wallet), { kind, value, category, bounty: bounty && !!PAYER_ENC_KEY }, setStep, resume ?? undefined);
      setDone(r);
      setBackup(bounty && PAYER_ENC_KEY ? exportKeys() : null);
      setResume(null);
    } catch (e) {
      const fe = e instanceof FlowError ? e : new FlowError('post', e instanceof Error ? e.message : String(e));
      setError(fe);
      // the deposit went through but the report did not: keep the id so a retry does not pay twice
      if (fe.depositLocked && fe.reportId && fe.depositTx) setResume({ reportId: fe.reportId, depositTx: fe.depositTx });
    } finally {
      setBusy(false);
    }
  }

  const blocked = !wallet.address ? 'Connect your wallet to file a report.' : !escrowConfigured ? 'The escrow contract is not deployed yet, so deposits cannot be taken.' : null;

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">FILE A REPORT</span>
        <span className="mono-label">{wallet.address ? short(wallet.address) : 'NOT CONNECTED'}</span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="mono-label" htmlFor="report-kind">What are you reporting?</label>
        <div className="input-row">
          <select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value as TargetKind)} className="select">
            {TARGET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="select">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="mono-label" htmlFor="report-value">{kind === 'domain' ? 'Domain' : 'Address'}</label>
        <div className="input-row">
          <input id="report-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'domain' ? 'claim-airdrop.xyz' : '0x…'} spellCheck={false} autoComplete="off" />
          <button className="btn" type="submit" disabled={busy || !value.trim() || !!blocked}>{busy ? 'Working…' : resume ? 'Retry posting' : `Deposit ${DEPOSIT_ETH_LABEL} ETH and report`}</button>
        </div>
        {PAYER_ENC_KEY && (
          <label className="ack">
            <input type="checkbox" checked={bounty} onChange={(e) => setBounty(e.target.checked)} />
            {' '}Pay me a private bounty if the panel confirms this. A bounty key is created in this browser. Back it up after, or the bounty is lost.
          </label>
        )}
      </form>

      {blocked && <p className="tiny">{blocked}</p>}
      <p className="tiny">
        The deposit is held in escrow, not paid to anyone. It comes back if the panel confirms the report, it goes to the bounty pool if the report is
        rejected, and you can reclaim it yourself if nobody rules in time. A new wallet’s report can only warn, it cannot block a site on its own.
      </p>

      {busy && step && <p className="tiny" role="status">{STEP_TEXT[step]}</p>}

      {error && (
        <div className={`verdict ${error.depositLocked ? 'v-warn' : 'v-block'}`} role="alert">
          <div className="verdict-head"><span className="verdict-tag">{error.depositLocked ? 'DEPOSIT LOCKED, REPORT NOT POSTED' : 'NOT SENT'}</span></div>
          <p className="verdict-line">{error.message}</p>
          <p className="tiny">
            {error.depositLocked
              ? 'Your deposit is safe in escrow. Press “Retry posting” to post the report without paying again, or reclaim the deposit after the escrow window.'
              : 'Nothing was charged.'}
          </p>
        </div>
      )}

      {done && (
        <div className="verdict v-ok" role="status">
          <div className="verdict-head"><span className="verdict-tag">REPORT POSTED</span></div>
          <p className="verdict-line">Your report is on Arkiv and the deposit is locked.</p>
          <p className="tiny">Report id <code>{done.reportId}</code></p>
          <p className="tiny">Deposit transaction <code>{short(done.depositTx)}</code> · entity <code>{short(done.entityKey)}</code></p>
          {backup && (
            <>
              <p className="tiny"><b>Back up your bounty key now.</b> It stays only in this browser. Anyone who has it can take the bounty. Store it like a password:</p>
              <pre className="srvlog"><code>{backup}</code></pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
