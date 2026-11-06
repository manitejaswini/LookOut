'use client';

import { useMemo, useState } from 'react';
import { CONFIG } from '@lookout/core';
import { simulateSybil } from '@lookout/core';

export default function Attack() {
  const [n, setN] = useState(1000);
  const [rep, setRep] = useState(0);

  const result = useMemo(() => simulateSybil(n, rep), [n, rep]);

  return (
    <section id="attack" className="section">
      <div className="split">
        <div>
          <h2>A thousand wallets. Still just a warning.</h2>
          <p className="mono-label">Why the list cannot be gamed</p>
          <p className="lede-sm">
            Weight comes from earned reputation, not wallet count. A source type scores once, at its single highest weight,
            so volume inside one type adds nothing.
          </p>
        </div>

        <div className="panel">
          <div className="control">
            <label htmlFor="n" className="mono-label">Fresh wallets reporting</label>
            <output>{n.toLocaleString()}</output>
            <input id="n" type="range" min={1} max={1000} value={n} onChange={(e) => setN(+e.target.value)} />
          </div>
          <div className="control">
            <label htmlFor="rep" className="mono-label">Reputation per wallet (cap {CONFIG.REP_CAP})</label>
            <output>{rep}</output>
            <input id="rep" type="range" min={0} max={CONFIG.REP_CAP} value={rep} onChange={(e) => setRep(+e.target.value)} />
          </div>

          <div className="swarm" aria-hidden="true">
            {Array.from({ length: n }, (_, i) => (
              <span key={i} style={{ opacity: 0.2 + (rep / CONFIG.REP_CAP) * 0.8 }} />
            ))}
          </div>

          <div className="calc">
            <div><span className="mono-label">Community type score</span><b>{result.communityScore.toFixed(2)}</b></div>
            <div><span className="mono-label">Strong types</span><b>{result.strongTypes} / {CONFIG.MIN_STRONG_TYPES} needed</b></div>
            <div><span className="mono-label">Verdict</span><b className={`pill v-${result.verdict}`}>{result.verdict.toUpperCase()}</b></div>
            <div><span className="mono-label">Deposits at risk</span><b>{result.depositsAtRiskEth.toFixed(2)} ETH</b></div>
          </div>
          <p className="tiny">
            Residual risk: the attacker burns money to annoy with warnings. Even at full reputation, one source type alone can never block.
          </p>
        </div>
      </div>
    </section>
  );
}
