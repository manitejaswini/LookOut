'use client';

import { useEffect, useState } from 'react';
import { CONFIG } from '@lookout/core';
import type { ArkivEntity } from '@lookout/core';
import { SEED_ENTITIES } from './mock';
import { fetchEntities, type LiveEntities } from './entities';
import { fmtLeft, useNow } from './hooks';
import { INDEXER_URL } from './lookup';

const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
const REFRESH_MS = 15_000;

type Row = ArkivEntity & { notCounted?: string };

export default function Explorer() {
  const now = useNow(1000);
  const [mock, setMock] = useState<Row[]>(SEED_ENTITIES);
  const [live, setLive] = useState<LiveEntities | null>(null);
  const [error, setError] = useState<string | null>(null);

  // live mode: read the entities the indexer synced from Arkiv, and keep reading
  useEffect(() => {
    const url = INDEXER_URL;
    if (!url) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchEntities(url, ctrl.signal).then(
        (l) => { setLive(l); setError(null); },
        (e: Error) => { if (!ctrl.signal.aborted) setError(e.message); },
      );
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, []);

  const post = () => {
    const e: ArkivEntity = {
      id: `ark_rp_${hex()}`,
      kind: 'report',
      owner: `0x${hex()}…${hex()}`,
      attr: 'targetKind=domain category=drainer',
      expiresAt: Date.now() + CONFIG.REPORT_EXPIRY_HOURS * 3_600_000,
    };
    setMock((prev) => [e, ...prev]);
  };

  const rows: Row[] = INDEXER_URL ? live?.entities ?? [] : mock;
  const liveCount = now === null ? rows.length : rows.filter((e) => e.expiresAt > now).length;
  const status = !INDEXER_URL
    ? 'Mock data. Set NEXT_PUBLIC_INDEXER_URL to read real Arkiv entities.'
    : error && !live
      ? `Could not reach the indexer: ${error}`
      : live
        ? `Live from Arkiv (Rabdi) via the indexer, block ${live.block.toLocaleString()}${
            now === null ? '' : `, synced ${Math.max(0, Math.round(now / 1000 - live.syncedAt / 1000))} s ago`
          }.${error ? ` Refresh failed: ${error}` : ''}`
        : 'Reading entities…';

  return (
    <section id="explorer" className="section">
      <div className="split">
        <div>
          <h2>Everything is an Arkiv entity.</h2>
          <p className="mono-label">The explorer</p>
          <p className="lede-sm">
            Reports, verdicts, attestations and rulings each have an owner and an expiry. Watch an entity count down and leave the
            list. An entity the indexer reads but does not count is marked, with the reason.
          </p>
          {INDEXER_URL ? (
            <p className="tiny">Posting a report needs a connected wallet and a {CONFIG.DEPOSIT_ETH} ETH deposit, which comes with the report form.</p>
          ) : (
            <button className="btn" onClick={post}>Post a report · {CONFIG.DEPOSIT_ETH} ETH</button>
          )}
          <p className="tiny" role="status">{liveCount} live of {rows.length} entities{live && live.total > rows.length ? ` shown (${live.total} total)` : ''}. {status}</p>
        </div>

        <div className="table-wrap">
          <table className="ent-table">
            <thead>
              <tr><th>Entity</th><th>Kind</th><th>Owner</th><th>Attributes</th><th>Expires in</th></tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const left = now === null ? Infinity : e.expiresAt - now;
                return (
                  <tr key={`${e.id}-${i}`} className={left <= 0 ? 'expired' : left < 60_000 ? 'soon' : ''}>
                    <td className="mono">{e.id}</td>
                    <td><span className={`kind k-${e.kind}`}>{e.kind}</span></td>
                    <td className="mono">{e.owner}</td>
                    <td className="mono dim">
                      {e.attr}
                      {e.notCounted && <span className="tiny"> · not counted: {e.notCounted}</span>}
                    </td>
                    <td className="mono">{now === null ? '—' : fmtLeft(left)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="dim">No entities yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
