'use client';

import { useState } from 'react';
import { TARGETS } from './mock';
import { checkTarget } from './lookup';
import type { CheckResult } from '@lookout/core';
import type { TargetKind } from '@lookout/core';

export default function Agent() {
  const [kind, setKind] = useState<TargetKind>('domain');
  const [value, setValue] = useState(TARGETS[0].value);
  const [out, setOut] = useState<Partial<CheckResult> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const call = async () => {
    setErr(null);
    try {
      const r = await checkTarget(value, kind);
      // the agent tool returns the same object as the wallet client, minus UI-only fields
      const { headline: _h, typeScores: _t, strongTypes: _s, ...api } = r;
      void _h; void _t; void _s;
      setOut(api);
    } catch (e) {
      setOut(null);
      setErr((e as Error).message);
    }
  };

  const decision = !out
    ? null
    : out.verdict === 'block'
      ? { text: 'Agent aborts the transfer.', cls: 'v-block' }
      : out.verdict === 'warn'
        ? { text: 'Agent pauses and asks a human.', cls: 'v-warn' }
        : { text: 'Agent proceeds. Unknown is not safe, so it still caps the amount.', cls: 'v-unknown' };

  return (
    <section id="agent" className="section">
      <div className="split">
        <div>
          <h2>Agents get the same answer.</h2>
          <p className="mono-label">Agent tool · check_target</p>
          <p className="lede-sm">
            No popup, no human reading it. An agent calls one tool before any transfer and gets machine-readable JSON.
            It aborts on block and asks a human on warn.
          </p>
          <div className="chips">
            {TARGETS.slice(0, 4).map((t) => (
              <button
                key={t.value}
                className={`chip ${t.value === value ? 'active' : ''}`}
                onClick={() => { setValue(t.value); setKind(t.kind); setOut(null); }}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <pre className="code"><code>{`check_target({
  kind: "${kind}",
  value: "${value}"
})`}</code></pre>
          <button className="btn" onClick={call}>Run tool call</button>
          {err && <p className="tiny" role="alert">Lookup failed: {err}</p>}
          {out && (
            <>
              <pre className="code out"><code>{JSON.stringify(out, null, 2)}</code></pre>
              <div className={`verdict ${decision!.cls}`}><p className="verdict-line">{decision!.text}</p></div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
