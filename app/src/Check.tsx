'use client';

import { useEffect, useRef, useState } from 'react';
import { TARGETS, findTarget } from './mock';
import { checkTarget } from './lookup';
import { fmtAge } from './hooks';
import { SNAPSHOT_ID } from '@lookout/core';
import type { CheckResult } from '@lookout/core';

const STEPS = [
  'Hash the target on this device',
  'Send a random vector to PIR server A',
  'Send the same vector, one bit flipped, to server B',
  'XOR both 512-byte answers into the bucket',
  `Verify bucket hash against root of ${SNAPSHOT_ID} on Arkiv`,
  'Score signals: block, warn or unknown',
];

const randomBits = () => {
  const a = new Uint8Array(64);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b & 1);
};

function Bits({ bits, label }: { bits: number[]; label: string }) {
  return (
    <div className="bits-wrap">
      <div className="mono-label">{label}</div>
      <div className="bits" aria-label={`${label} random-looking vector`}>
        {bits.map((b, i) => <span key={i} className={b ? 'on' : ''} />)}
      </div>
    </div>
  );
}

export default function Check() {
  const [value, setValue] = useState(TARGETS[0].value);
  const [step, setStep] = useState(-1); // -1 idle, 0..5 running, 6 done
  const [result, setResult] = useState<CheckResult | null>(null);
  const [vec, setVec] = useState<{ a: number[]; b: number[] } | null>(null);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  const timer = useRef<number>(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (v = value) => {
    clearTimeout(timer.current);
    const id = ++runId.current;
    setResult(null);
    setError(null);
    setSigned(false);
    setStep(0);
    const a = randomBits();
    const b = [...a];
    b[Math.floor(Math.random() * 64)] ^= 1; // differs at the target bit, looks random
    setVec({ a, b });
    let i = 0;
    const tick = () => {
      i++;
      setStep(i);
      if (i < STEPS.length) timer.current = window.setTimeout(tick, 380);
      else {
        checkTarget(v).then(
          (r) => { if (id === runId.current) setResult(r); },
          (e: Error) => { if (id === runId.current) setError(e.message); },
        );
      }
    };
    timer.current = window.setTimeout(tick, 380);
  };

  const pick = (v: string) => {
    setValue(v);
    run(v);
  };
  const target = findTarget(value);
  const running = step >= 0 && step < STEPS.length;

  return (
    <section id="check" className="section">
      <div className="split">
        <div>
          <h2>Check it before you sign.</h2>
          <p className="mono-label">The pre-sign check</p>
          <p className="lede-sm">
            Pick a target from the demo set or type your own. The lookup is private: neither PIR server learns what you asked.
          </p>
          <div className="chips">
            {TARGETS.map((t) => (
              <button key={t.value} className={`chip ${t.value === value ? 'active' : ''}`} onClick={() => pick(t.value)}>
                {t.title}
              </button>
            ))}
          </div>
        </div>

        <div className="wallet">
          <div className="wallet-bar">
            <span className="mono-label">DEMO WALLET · SEPOLIA</span>
            <span className="mono-label">0x4a1c…9e20</span>
          </div>
          <label className="mono-label" htmlFor="target">Target (domain, address or contract)</label>
          <form className="input-row" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <input id="target" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
            <button className="btn" type="submit" disabled={running || !value.trim()}>Check</button>
          </form>

          <div className="tx">
            <div className="mono-label">Signature request</div>
            <div className="tx-title">{target.blurb}</div>
            <div className="tx-sub">{target.value}</div>
          </div>

          {step >= 0 && (
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>{s}</li>
              ))}
            </ol>
          )}

          {vec && step >= 1 && (
            <div className="servers">
              <Bits bits={vec.a} label="Server A saw" />
              <Bits bits={vec.b} label="Server B saw" />
              <p className="tiny">Each server sees only a random-looking vector. Never the target.</p>
            </div>
          )}

          {error && <p className="tiny" role="alert">Lookup failed: {error}</p>}
          {result && <Verdict r={result} signed={signed} onSign={() => setSigned(true)} />}
        </div>
      </div>
    </section>
  );
}

const LABEL = { block: 'BLOCK', warn: 'WARN', unknown: 'UNKNOWN' } as const;

function Verdict({ r, signed, onSign }: { r: CheckResult; signed: boolean; onSign: () => void }) {
  return (
    <div className={`verdict v-${r.verdict}`} role="status">
      <div className="verdict-head">
        <span className="verdict-tag">{LABEL[r.verdict]}</span>
        {r.disputed && <span className="mono-label">DISPUTED</span>}
        <span className="mono-label right">{r.verified ? '✓ VERIFIED VS ARKIV ROOT' : '✗ UNVERIFIED'}</span>
      </div>
      <p className="verdict-line">{r.headline}</p>
      {r.reasons.length > 0 && (
        <ul className="reasons">
          {r.reasons.map((x) => (
            <li key={x.entityId}>
              <span className="mono-label">{x.sourceType}</span>
              <span>{x.sourceId}</span>
              <span className="mono-label">{x.level} · {fmtAge(x.ageSeconds)}</span>
              <span className="mono-label ent">{x.entityId}</span>
            </li>
          ))}
        </ul>
      )}
      {r.verdict === 'block' && <button className="btn btn-red" disabled>Signing blocked</button>}
      {r.verdict === 'warn' && (
        <button className="btn btn-ghost" onClick={onSign}>{signed ? 'Signed at your own risk' : 'Sign anyway'}</button>
      )}
      {r.verdict === 'unknown' && (
        <>
          <button className="btn" onClick={onSign}>{signed ? 'Signed' : 'Sign'}</button>
          <p className="tiny">Lookout never says "safe". It only found nothing.</p>
        </>
      )}
    </div>
  );
}
