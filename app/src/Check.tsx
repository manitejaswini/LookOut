'use client';

import { useEffect, useRef, useState } from 'react';
import { TARGETS, findTarget } from './mock';
import { checkTarget, MODE, PIR_SERVERS } from './lookup';
import { fmtAge } from './hooks';
import { SNAPSHOT_ID } from '@lookout/core';
import type { CheckResult } from '@lookout/core';
import type { PirEvent } from '@lookout/client';

const stepList = (snapshotId: string, rootChecked: boolean | null) => [
  'Hash the target on this device',
  'Send a random vector to PIR server A',
  'Send the same vector, one bit flipped, to server B',
  'XOR both 512-byte answers into the bucket',
  rootChecked === false
    ? `Check bucket against the servers' own table of ${snapshotId} (no Arkiv root to compare: UNVERIFIED)`
    : `Verify bucket hash against root of ${snapshotId} on Arkiv`,
  'Score signals: block, warn or unknown',
];
const STEP_COUNT = 6;
const STEP_MS = 320; // pacing only: a real lookup takes about 35 ms, too fast to follow

interface VecView { a: number[]; b: number[]; flip: number }

const bitsAt = (v: Uint8Array, from: number) =>
  Array.from({ length: 64 }, (_, k) => (v[(from + k) >> 3] >> (7 - ((from + k) & 7))) & 1);

/** A 64-bit window of the real vectors that contains the one bit where they differ. */
function windowOf(a: Uint8Array, b: Uint8Array): VecView {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { d = i * 8 + Math.clz32(a[i] ^ b[i]) - 24; break; }
  const from = Math.max(0, Math.min(a.length * 8 - 64, (d - 24) & ~7));
  return { a: bitsAt(a, from), b: bitsAt(b, from), flip: d - from };
}

const simulatedVec = (): VecView => {
  const a = crypto.getRandomValues(new Uint8Array(8));
  const b = a.slice();
  b[Math.floor(Math.random() * 8)] ^= 1 << Math.floor(Math.random() * 8);
  return windowOf(a, b);
};

function Bits({ bits, label, flip }: { bits: number[]; label: string; flip: number }) {
  return (
    <div className="bits-wrap">
      <div className="mono-label">{label}</div>
      <div className="bits" aria-label={`${label} random-looking vector`}>
        {bits.map((b, i) => <span key={i} className={`${b ? 'on' : ''} ${i === flip ? 'flip' : ''}`} />)}
      </div>
    </div>
  );
}

interface ServerLog { name: string; lines: string[] }

export default function Check() {
  const [value, setValue] = useState(TARGETS[0].value);
  const [step, setStep] = useState(-1); // steps completed: -1 idle, 0..5 running, 6 done
  const [result, setResult] = useState<CheckResult | null>(null);
  const [ready, setReady] = useState<CheckResult | null>(null); // answer received, waiting for the animation to catch up
  const [vec, setVec] = useState<VecView | null>(null);
  const [snapshotId, setSnapshotId] = useState(SNAPSHOT_ID);
  const [rootChecked, setRootChecked] = useState<boolean | null>(null);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [logs, setLogs] = useState<ServerLog[] | null>(null);
  const runId = useRef(0);
  const want = useRef(0); // furthest step the real events have reached
  const pacer = useRef<number>(0);

  useEffect(() => () => clearInterval(pacer.current), []);

  // walk the displayed step up to the furthest real step, one readable beat at a time
  useEffect(() => {
    if (step < 0 || step >= STEP_COUNT) { clearInterval(pacer.current); return; }
    pacer.current = window.setInterval(() => setStep((s) => (s >= 0 && s < want.current ? s + 1 : s)), STEP_MS);
    return () => clearInterval(pacer.current);
  }, [step < 0 ? -1 : step >= STEP_COUNT ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && step >= STEP_COUNT) setResult(ready);
  }, [ready, step]);

  // after a live lookup, show what each server actually logged
  useEffect(() => {
    const servers = PIR_SERVERS;
    if (!result || !servers) return;
    let live = true;
    Promise.all(
      (['A', 'B'] as const).map(async (name) => {
        const r = await fetch(`${name === 'A' ? servers.a : servers.b}/log`);
        return { name, lines: ((await r.json()).lines as string[]).slice(-2) };
      }),
    ).then((l) => { if (live) setLogs(l); }, () => {});
    return () => { live = false; };
  }, [result]);

  const run = (v = value) => {
    const id = ++runId.current;
    setResult(null); setReady(null); setError(null); setNote(null); setLogs(null); setSigned(false);
    setVec(null); setRootChecked(null); setSnapshotId(SNAPSHOT_ID);
    want.current = 0;
    setStep(0);

    const reach = (n: number) => { want.current = Math.max(want.current, n); };
    const onEvent = (e: PirEvent) => {
      if (id !== runId.current) return;
      switch (e.type) {
        case 'hashed': reach(1); break;
        case 'snapshot': setSnapshotId(e.snapshotId); break;
        case 'table': setRootChecked(e.matchedPublishedRoot); break;
        case 'query': if (e.round === 0) setVec(windowOf(e.a, e.b)); reach(3); break;
        case 'combined': reach(4); break;
        case 'bucket-verified': if (e.round === e.rounds - 1) reach(5); break;
        case 'retry': setNote(`A server pair failed verification (${e.reason}). Trying the next pair.`); break;
        case 'scored': reach(6); break;
      }
    };

    if (MODE !== 'pir') { setVec(simulatedVec()); reach(STEP_COUNT); } // simulated: nothing real to wait for
    checkTarget(v, undefined, onEvent).then(
      (r) => { if (id === runId.current) { reach(STEP_COUNT); setReady(r); } },
      (e: Error) => { if (id === runId.current) { setError(e.message); setStep(-1); } },
    );
  };

  const pick = (v: string) => {
    setValue(v);
    run(v);
  };
  const target = findTarget(value);
  const running = step >= 0 && step < STEP_COUNT;
  const STEPS = stepList(snapshotId, rootChecked);

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
            <span className="mono-label">{MODE === 'pir' ? 'LIVE · 2-SERVER PIR' : MODE === 'indexer' ? 'LIVE · PLAIN LOOKUP (NOT PRIVATE)' : 'SIMULATED · MOCK DATA'}</span>
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
                <li key={i} className={i < step ? 'done' : i === step ? 'now' : ''}>{s}</li>
              ))}
            </ol>
          )}

          {vec && step >= 1 && (
            <div className="servers">
              <Bits bits={vec.a} label="Server A saw" flip={vec.flip} />
              <Bits bits={vec.b} label="Server B saw" flip={vec.flip} />
              <p className="tiny">
                {MODE === 'pir'
                  ? 'The exact vectors sent, 64 of 16,384 bits. The marked bit is where they differ: only this device knows which bucket that is. Both candidate buckets are requested, so a miss looks like a hit.'
                  : 'Simulated vectors: no PIR servers are running in this mode. Each real server sees only a random-looking vector, never the target.'}
              </p>
            </div>
          )}

          {note && <p className="tiny" role="status">{note}</p>}
          {error && <p className="tiny" role="alert">Lookup failed: {error}</p>}

          {logs && (
            <div className="srvlogs">
              <div className="mono-label">What the two servers logged</div>
              {logs.map((l) => (
                <pre key={l.name} className="srvlog"><code>{l.lines.join('\n') || '(nothing yet)'}</code></pre>
              ))}
              <p className="tiny">Vectors and bit counts only. There is no target, domain or bucket number to log.</p>
            </div>
          )}

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
