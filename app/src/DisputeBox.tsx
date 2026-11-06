'use client';

import { useState } from 'react';
import { DisputeError, runDispute, whyNotDispute, type DisputeStep } from './flows/dispute-flow';
import { disputePorts } from './wallet/ports';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * "This is my address and the flag is wrong." The owner signs a message with the address's own key. That signature is the proof,
 * and anyone can check it. It does NOT clear the flag: it asks the operator to look at it, and only an operator ruling can overturn a flag.
 */

const TEXT: Record<DisputeStep, string> = {
  validate: 'Checking…',
  sign: 'Sign the dispute message in your wallet. It costs nothing and sends nothing.',
  post: 'Approve posting the dispute to Arkiv in your wallet.',
  done: 'Done.',
};

export default function DisputeBox({ target }: { target: string }) {
  const wallet = useWallet();
  const [step, setStep] = useState<DisputeStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const why = whyNotDispute(target, wallet.address);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await runDispute(disputePorts(wallet), target, setStep);
      setDone(r.entityKey);
    } catch (e) {
      setError(e instanceof DisputeError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="verdict v-unknown" role="status">
        <div className="verdict-head"><span className="verdict-tag">DISPUTE FILED</span></div>
        <p className="verdict-line">The operator will now be asked to look at this flag.</p>
        <p className="tiny">Record <code>{short(done)}</code>. The flag stays in place until the operator rules. A dispute alone never removes it.</p>
      </div>
    );
  }

  return (
    <div className="dispute">
      <div className="mono-label">Is this your address?</div>
      <p className="tiny">
        Only the owner can dispute a flag, by signing with this address. {why && <b>{why}</b>}
      </p>
      <button className="btn btn-ghost" type="button" disabled={busy || !!why} onClick={() => void go()}>
        {busy ? 'Waiting for your wallet…' : 'Dispute this flag (sign as the owner)'}
      </button>
      {busy && step && <p className="tiny" role="status">{TEXT[step]}</p>}
      {error && <p className="tiny" role="alert">{error}</p>}
    </div>
  );
}
