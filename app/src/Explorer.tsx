'use client';

import { useState } from 'react';
import { CONFIG } from './config';
import { SEED_ENTITIES } from './mock';
import { fmtLeft, useNow } from './hooks';
import type { ArkivEntity } from './types';

const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');

export default function Explorer() {
  const now = useNow(1000);
  const [entities, setEntities] = useState<ArkivEntity[]>(SEED_ENTITIES);

  const post = () => {
    const e: ArkivEntity = {
      id: `ark_rp_${hex()}`,
      kind: 'report',
      owner: `0x${hex()}…${hex()}`,
      attr: 'targetKind=domain category=drainer',
      expiresAt: Date.now() + CONFIG.REPORT_EXPIRY_HOURS * 3_600_000,
    };
    setEntities((prev) => [e, ...prev]);
  };

  const live = now === null ? entities.length : entities.filter((e) => e.expiresAt > now).length;

  return (
    <section id="explorer" className="section">
      <div className="split">
        <div>
          <h2>Everything is an Arkiv entity.</h2>
          <p className="mono-label">The explorer</p>
          <p className="lede-sm">
            Reports, verdicts, attestations and rulings each have an owner and an expiry. Post a report with a {CONFIG.DEPOSIT_ETH} ETH
            deposit and watch it appear. The last report in the list is about to expire.
          </p>
          <button className="btn" onClick={post}>Post a report · {CONFIG.DEPOSIT_ETH} ETH</button>
          <p className="tiny">{live} live of {entities.length} entities. Mock data, no chain calls yet.</p>
        </div>

        <div className="table-wrap">
          <table className="ent-table">
            <thead>
              <tr><th>Entity</th><th>Kind</th><th>Owner</th><th>Attributes</th><th>Expires in</th></tr>
            </thead>
            <tbody>
              {entities.map((e) => {
                const left = now === null ? Infinity : e.expiresAt - now;
                return (
                  <tr key={e.id} className={left <= 0 ? 'expired' : left < 60_000 ? 'soon' : ''}>
                    <td className="mono">{e.id}</td>
                    <td><span className={`kind k-${e.kind}`}>{e.kind}</span></td>
                    <td className="mono">{e.owner}</td>
                    <td className="mono dim">{e.attr}</td>
                    <td className="mono">{now === null ? '—' : fmtLeft(left)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
