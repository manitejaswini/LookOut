'use client';

import { useState } from 'react';
import type { VoteOutcome } from '@lookout/core';
import { commit, reveal, savedVote, VoteError, type SavedVote } from './flows/vote-flow';
import { votePorts } from './wallet/ports';
import { short, useWallet } from './wallet/WalletProvider';

/**
 * A juror's screen. Round 1: commit a hidden vote. Round 2: reveal it. The secret salt that makes the reveal possible is kept in
 * THIS browser only, so vote and reveal from the same browser. Clearing site data before the reveal loses the vote.
 */

const CASE_ID = /^[0-9a-f]{16}$/;

export default function VotePanel() {
  const wallet = useWallet();
  const [caseId, setCaseId] = useState('');
  const [outcome, setOutcome] = useState<VoteOutcome>('block');
  const [busy, setBusy] = useState<'commit' | 'reveal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, bump] = useState(0);

  const id = caseId.trim().toLowerCase();
  const idOk = CASE_ID.test(id);
  const saved: SavedVote | null = wallet.address && idOk && typeof window !== 'undefined' ? savedVote(votePorts(wallet).storage, id, wallet.address) : null;

  async function run(kind: 'commit' | 'reveal') {
    if (!wallet.address) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await wallet.switchChain('arkiv');
      if (kind === 'commit') {
        await commit(votePorts(wallet), { caseId: id, juror: wallet.address, outcome });
        setNotice('Your hidden vote is on Arkiv. Nobody can see it yet. Come back to this browser for the reveal round.');
      } else {
        await reveal(votePorts(wallet), { caseId: id, juror: wallet.address });
        setNotice('Your vote is revealed. The panel counts it when the reveal round closes.');
      }
    } catch (e) {
      setError(e instanceof VoteError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      bump((n) => n + 1);
    }
  }

  const blocked = !wallet.address ? 'Connect the wallet that holds your reviewer seat.' : !idOk && id ? 'A case id is 16 characters, 0-9 and a-f.' : null;

  return (
    <div className="wallet reviewer">
      <div className="wallet-bar">
        <span className="mono-label">CAST A VOTE</span>
        <span className="mono-label">{wallet.address ? short(wallet.address) : 'NOT CONNECTED'}</span>
      </div>

      <label className="mono-label" htmlFor="vote-case">Case id</label>
      <div className="input-row">
        <input id="vote-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="0011223344556677" spellCheck={false} autoComplete="off" />
      </div>

      <fieldset className="vote-choice" disabled={!!saved?.entityKey}>
        <legend className="mono-label">Is this target a scam?</legend>
        <label><input type="radio" name="outcome" checked={outcome === 'block'} onChange={() => setOutcome('block')} /> Block: yes, it is a scam</label>
        <label><input type="radio" name="outcome" checked={outcome === 'clear'} onChange={() => setOutcome('clear')} /> Clear: no, it is safe</label>
      </fieldset>

      <div className="input-row">
        <button className="btn" type="button" disabled={!!busy || !!blocked || !idOk || !!saved?.entityKey} onClick={() => void run('commit')}>
          {busy === 'commit' ? 'Sending…' : saved && !saved.entityKey ? 'Send saved vote' : 'Commit hidden vote'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={!!busy || !!blocked || !idOk || !saved?.entityKey || saved.revealed} onClick={() => void run('reveal')}>
          {busy === 'reveal' ? 'Revealing…' : saved?.revealed ? 'Revealed' : 'Reveal my vote'}
        </button>
      </div>

      {blocked && <p className="tiny">{blocked}</p>}
      {saved && (
        <p className="tiny">
          This browser holds your {saved.revealed ? 'revealed' : saved.entityKey ? 'committed' : 'unsent'} <b>{saved.outcome}</b> vote for this case.
        </p>
      )}
      <p className="tiny">
        Voting wrong, or not revealing, costs part of your stake and reputation. You can only vote in a case you were drawn for. Votes from anyone else are ignored.
      </p>

      {error && <div className="verdict v-block" role="alert"><div className="verdict-head"><span className="verdict-tag">NOT SENT</span></div><p className="verdict-line">{error}</p></div>}
      {notice && <div className="verdict v-ok" role="status"><div className="verdict-head"><span className="verdict-tag">DONE</span></div><p className="verdict-line">{notice}</p></div>}
    </div>
  );
}
