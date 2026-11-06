'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IDKitErrorCodes, IDKitRequestWidget, proofOfHuman, type RpContext } from '@worldcoin/idkit';

/**
 * "Join the reviewer panel": one human, one seat, proven with World ID Proof of Human.
 * Everything that matters is decided on the server (/api/worldid/*). This screen only asks for the proof and
 * shows what the server decided.
 */

type Status =
  | { state: 'loading' }
  | { state: 'unconfigured'; missing: string[]; problems: string[] }
  | { state: 'ready'; environment: string; seats: number }
  | { state: 'unreachable' };

type Outcome =
  | { kind: 'seated'; again: boolean; seats: number }
  | { kind: 'cancelled' }
  | { kind: 'no_credential' }
  | { kind: 'already_enrolled' }
  | { kind: 'wallet_taken' }
  | { kind: 'error'; message: string };

interface SignedRequest {
  rp_context: RpContext;
  app_id: `app_${string}`;
  action: string;
  environment: 'production' | 'staging' | 'sandbox';
}

const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** Codes where World refused the REQUEST (our app id, RP id, signature, clock or request shape), not the person. */
const SETUP_CODES: ReadonlySet<string> = new Set([
  IDKitErrorCodes.InvalidRpIdFormat,
  IDKitErrorCodes.UnknownRp,
  IDKitErrorCodes.InactiveRp,
  IDKitErrorCodes.InvalidRpSignature,
  IDKitErrorCodes.RpSignatureExpired,
  IDKitErrorCodes.TimestampTooOld,
  IDKitErrorCodes.TimestampTooFarInFuture,
  IDKitErrorCodes.InvalidTimestamp,
  IDKitErrorCodes.DuplicateNonce,
  IDKitErrorCodes.MalformedRequest,
]);

export default function ReviewerJoin() {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [wallet, setWallet] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<SignedRequest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // the server's own verdict, kept in a ref so the widget's generic error callback cannot overwrite it
  const serverOutcome = useRef<Outcome | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/worldid/status', { cache: 'no-store' });
      const b = await r.json();
      setStatus(b.configured ? { state: 'ready', environment: b.environment, seats: b.seats } : { state: 'unconfigured', missing: b.missing ?? [], problems: b.problems ?? [] });
    } catch {
      setStatus({ state: 'unreachable' });
    }
  }, []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const walletOk = WALLET.test(wallet.trim());

  async function start() {
    setOutcome(null);
    serverOutcome.current = null;
    if (!walletOk) return;
    setBusy(true);
    try {
      // the server signs the request, with an action the SERVER chooses. The signing key never reaches the browser.
      const res = await fetch('/api/worldid/rp-signature', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'could not start a verification');
      setRequest((await res.json()) as SignedRequest);
      setOpen(true);
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'could not start a verification' });
    } finally {
      setBusy(false);
    }
  }

  // Called with the proof. Throwing makes the widget show a failure, so the server's refusal is never hidden.
  async function handleVerify(result: unknown) {
    const res = await fetch('/api/worldid/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: wallet.trim().toLowerCase(), idkitResponse: result }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      serverOutcome.current = { kind: 'seated', again: body.status === 'already_seated', seats: body.seats ?? 0 };
      return;
    }
    if (body.error === 'human_already_enrolled') serverOutcome.current = { kind: 'already_enrolled' };
    else if (body.error === 'wallet_taken') serverOutcome.current = { kind: 'wallet_taken' };
    else if (body.error === 'wrong_credential') serverOutcome.current = { kind: 'no_credential' };
    else serverOutcome.current = { kind: 'error', message: body.message ?? 'the proof was not accepted' };
    throw new Error(body.message ?? 'the proof was not accepted');
  }

  function onSuccess() {
    setOutcome(serverOutcome.current ?? { kind: 'seated', again: false, seats: 0 });
    void refreshStatus();
  }

  function onError(code: string) {
    if (serverOutcome.current) return setOutcome(serverOutcome.current);
    // the person backed out
    if (code === IDKitErrorCodes.UserRejected || code === IDKitErrorCodes.Cancelled) return setOutcome({ kind: 'cancelled' });
    // the person has no Proof of Human credential, or declined to share it
    if (code === IDKitErrorCodes.CredentialUnavailable || code === IDKitErrorCodes.VerificationRejected) return setOutcome({ kind: 'no_credential' });
    // World itself says this human has already verified for this action
    if (code === IDKitErrorCodes.MaxVerificationsReached || code === IDKitErrorCodes.NullifierReplayed) return setOutcome({ kind: 'already_enrolled' });
    // we only accept World ID 4.0, so an older World App cannot take part
    if (code === IDKitErrorCodes.WorldId4NotAvailable || code === IDKitErrorCodes.FeatureUnavailable) {
      return setOutcome({ kind: 'error', message: 'Your World App is too old for World ID 4.0. Update the app and try again.' });
    }
    // World refused the request itself: this is how the site is set up, not something the person did
    if (SETUP_CODES.has(code)) {
      return setOutcome({ kind: 'error', message: `World rejected this site's setup (${code}). This is a configuration problem for the site owner, not something you did.` });
    }
    setOutcome({ kind: 'error', message: `World ID stopped with: ${code}` });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // closed without a result: the person backed out
    if (!next) setOutcome((o) => o ?? serverOutcome.current ?? { kind: 'cancelled' });
  }

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">REVIEWER PANEL · WORLD ID</span>
        <span className="mono-label">
          {status.state === 'ready' ? `${status.seats} SEAT${status.seats === 1 ? '' : 'S'} · ${status.environment.toUpperCase()}` : ' '}
        </span>
      </div>

      {status.state === 'unconfigured' && <SetupNotice missing={status.missing} problems={status.problems} />}
      {status.state === 'unreachable' && <p className="tiny">Could not reach the server. Is the app running?</p>}

      <label className="mono-label" htmlFor="reviewer-wallet">Your wallet address</label>
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <input id="reviewer-wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
        <button className="btn" type="submit" disabled={busy || !walletOk || status.state !== 'ready'}>
          {busy ? 'Starting…' : 'Verify with World ID'}
        </button>
      </form>
      <p className="tiny">
        The proof is tied to this address, so it cannot be reused for another wallet. Wallet connection comes later; for now, paste the address.
      </p>

      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={onOpenChange}
          app_id={request.app_id}
          action={request.action}
          rp_context={request.rp_context}
          environment={request.environment}
          // v4 proofs only: accepting legacy v3 proofs would give the same person a second nullifier, and so a second seat
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: wallet.trim().toLowerCase() })}
          handleVerify={handleVerify}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}

      {outcome && <OutcomeCard outcome={outcome} />}
    </div>
  );
}

function SetupNotice({ missing, problems }: { missing: string[]; problems: string[] }) {
  return (
    <div className="verdict v-warn" role="status">
      <div className="verdict-head"><span className="verdict-tag">SETUP NEEDED</span></div>
      <p className="verdict-line">World ID is not configured yet.</p>
      <ol className="setup-steps">
        <li>Create an app at <a href="https://developer.world.org" target="_blank" rel="noreferrer">developer.world.org</a> and enable World ID 4.0.</li>
        <li>Copy the <b>app id</b>, the <b>RP id</b> and the <b>signing key</b>.</li>
        <li>Put them in <code>app/.env.local</code> (see <code>app/.env.example</code>). For the simulator also set <code>WORLD_ID_ENVIRONMENT=staging</code>.</li>
        <li>Restart the app.</li>
      </ol>
      {missing.length > 0 && <p className="tiny">Missing: {missing.join(', ')}</p>}
      {problems.length > 0 && <p className="tiny">Problems: {problems.join('; ')}</p>}
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: Outcome }) {
  const c = card(outcome);
  return (
    <div className={`verdict ${c.tone}`} role="status">
      <div className="verdict-head"><span className="verdict-tag">{c.tag}</span></div>
      <p className="verdict-line">{c.line}</p>
      <p className="tiny">{c.note}</p>
    </div>
  );
}

function card(o: Outcome): { tone: string; tag: string; line: string; note: string } {
  switch (o.kind) {
    case 'seated':
      return {
        tone: 'v-ok', tag: o.again ? 'ALREADY SEATED' : 'SEAT GRANTED',
        line: o.again ? 'You already hold a reviewer seat with this wallet.' : 'You are in the reviewer pool.',
        note: `Verified as a unique human, without revealing who you are. ${o.seats} seat${o.seats === 1 ? '' : 's'} held. Jurors are drawn at random, vote hidden, then reveal.`,
      };
    case 'cancelled':
      return { tone: 'v-warn', tag: 'CANCELLED', line: 'No seat was granted.', note: 'You backed out of the verification. You can still file reports and check targets as before. Nothing else changes.' };
    case 'no_credential':
      return { tone: 'v-warn', tag: 'NO PROOF OF HUMAN', line: 'A Proof of Human credential is needed for a seat.', note: 'No seat was granted. You can still file reports and check targets: reports are limited by deposits and reputation, not by this check.' };
    case 'already_enrolled':
      return { tone: 'v-block', tag: 'ONE HUMAN, ONE SEAT', line: 'This person already holds a reviewer seat with another wallet.', note: 'A second seat is refused, whichever wallet is used. This is what keeps one person from filling the panel.' };
    case 'wallet_taken':
      return { tone: 'v-block', tag: 'WALLET IN USE', line: 'This wallet already holds a seat for a different person.', note: 'Use a wallet that belongs to you.' };
    case 'error':
      return { tone: 'v-warn', tag: 'NOT VERIFIED', line: 'The verification did not complete.', note: o.message };
  }
}
