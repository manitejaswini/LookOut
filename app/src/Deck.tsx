'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import PixelCanvas from './PixelCanvas';
import * as P from './pitch-data';
import './deck.css';

/* ---------- small building blocks ---------- */

function Title({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="s-head">
      <p className="mono-label">{label}</p>
      <h2 className="s-title">{children}</h2>
    </div>
  );
}

function Rows({ items }: { items: readonly (readonly [string, string, string?])[] }) {
  return (
    <ul className="mrows">
      {items.map(([k, v, tag]) => (
        <li key={k}>
          <h3>{k}{tag && <span className="tag">{tag}</span>}</h3>
          <p>{v}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------- the 5 slides ---------- */

interface SlideDef { id: string; render: (active: boolean) => ReactNode; cover?: boolean }

const SLIDES: SlideDef[] = [
  /* 1 · cover */
  {
    id: 'title', cover: true,
    render: (active) => (
      <>
        <div className="cover-text">
          <p className="mono-label">Lookout · ETHGlobal Mumbai 2026</p>
          <h1>WE DON’T COUNT<br />WALLETS.<br />WE WEIGH THEM.</h1>
          <p className="s-lede">{P.ONE_LINE}</p>
        </div>
        {active && <div className="cover-canvas"><PixelCanvas variant="wave" height={190} /></div>}
      </>
    ),
  },

  /* 2 · problem */
  {
    id: 'problem',
    render: () => (
      <>
        <Title label="01 · Problem">Lists lag, and one company owns them.</Title>
        <div className="cols2">
          <Rows items={P.PROBLEMS} />
          <div className="statcol">
            {P.SCALE.map(([v, l, s]) => (
              <div key={l}><b>{v}</b><span>{l}</span><span className="mono-label">{s}</span></div>
            ))}
            <p className="foot-note">Re-verify these figures against their sources before presenting.</p>
          </div>
        </div>
      </>
    ),
  },

  /* 3 · solution, with the project introduction */
  {
    id: 'solution',
    render: () => (
      <>
        <Title label="02 · Solution">Introducing Lookout.</Title>
        <p className="intro-box">{P.INTRO}</p>
        <div className="workflow" aria-label="Lookout workflow">
          {P.WORKFLOW.map(([title, caption], n) => (
            <div key={title} className="wf-step">
              <div className="wf-node">
                <span className="mono-label">0{n + 1}</span>
                <h3>{title}</h3>
                <p>{caption}</p>
              </div>
              {n < P.WORKFLOW.length - 1 && <span className="wf-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
        <p className="wf-note"><span aria-hidden="true">↺</span> {P.DISPUTE_NOTE}</p>
        <div className="trio">
          <div className="verdict-tile v-block"><b>BLOCK</b><span>Earned, never counted</span></div>
          <div className="verdict-tile v-warn"><b>WARN</b><span>Low reputation or disputed</span></div>
          <div className="verdict-tile v-unknown"><b>UNKNOWN</b><span>Never “safe”</span></div>
        </div>
        <p className="foot-note">{P.BLOCK_LINE}</p>
      </>
    ),
  },

  /* 4 · trust + Arkiv */
  {
    id: 'trust-arkiv',
    render: () => (
      <>
        <Title label="03 · Trust and data">Reputation keeps it honest. Arkiv keeps it ours.</Title>
        <div className="cols2 even">
          <div className="panel-s">
            <p className="mono-label">Anti-Sybil · a thousand fake wallets weigh zero</p>
            <div className="equation">
              <div><b>1,000</b><span className="mono-label">fresh wallets</span></div>
              <i>×</i>
              <div><b>0</b><span className="mono-label">weight</span></div>
              <i>=</i>
              <div className="eq-res"><b>0</b><span className="mono-label">still a warning</span></div>
            </div>
            <Rows items={P.SYBIL} />
          </div>
          <div className="panel-s">
            <p className="mono-label">Arkiv · nine entity types, each with an owner and an expiry</p>
            <div className="kinds">
              {P.ARKIV_KINDS.map((e) => <span key={e} className={`kind k-${e}`}>{e}</span>)}
            </div>
            <Rows items={P.WHY_ARKIV} />
          </div>
        </div>
      </>
    ),
  },

  /* 5 · Ethereum Foundation fit, Anon-RPC, close */
  {
    id: 'ef',
    render: () => (
      <>
        <Title label="04 · Ethereum Foundation">How Lookout fits the EF.</Title>
        <div className="cols2 even">
          <div>
            <p className="mono-label">CROPS, one line each</p>
            <Rows items={P.CROPS} />
          </div>
          <div>
            <p className="mono-label">The privacy stack, including Anon-RPC</p>
            <Rows items={P.EF_STACK} />
          </div>
        </div>
        <div className="banner">
          <p><span>{P.PITCH_LINE}</span> {P.PITCH_SUB}</p>
          <span className="mono-label">{P.LIMITS}</span>
        </div>
      </>
    ),
  },
];

/* ---------- the deck ---------- */

export default function Deck() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const deck = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number>(0);
  const touchX = useRef<number | null>(null);
  const last = SLIDES.length - 1;

  const go = useCallback((n: number) => {
    setI((cur) => {
      const next = Math.max(0, Math.min(last, n));
      if (next !== cur) setDir(next > cur ? 1 : -1);
      return next;
    });
  }, [last]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void deck.current?.requestFullscreen?.();
  }, []);

  // restore slide from the URL hash
  useEffect(() => {
    const fromHash = () => {
      const n = parseInt(location.hash.slice(1), 10);
      if (!Number.isNaN(n)) setI(Math.max(0, Math.min(last, n - 1)));
    };
    fromHash();
    addEventListener('hashchange', fromHash);
    return () => removeEventListener('hashchange', fromHash);
  }, [last]);
  // skip the very first write so it cannot overwrite the hash we just restored from
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current) { synced.current = true; return; }
    history.replaceState(null, '', `#${i + 1}`);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter':
          e.preventDefault(); setI((c) => { const n = Math.min(last, c + 1); if (n !== c) setDir(1); return n; }); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
          e.preventDefault(); setI((c) => { const n = Math.max(0, c - 1); if (n !== c) setDir(-1); return n; }); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(last); break;
        case 'f': case 'F': e.preventDefault(); toggleFull(); break;
      }
    };
    const onFs = () => setFull(!!document.fullscreenElement);
    addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => { removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [go, last, toggleFull]);

  // hide the controls after a moment of no mouse movement
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2800);
  };
  useEffect(() => { wake(); return () => clearTimeout(idleTimer.current); }, []);

  return (
    <div
      ref={deck}
      className={`deck ${full ? 'is-full' : ''} ${idle ? 'is-idle' : ''}`}
      onMouseMove={wake}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; wake(); }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
      role="region"
      aria-roledescription="slide deck"
      aria-label="Lookout pitch"
    >
      <div className="deck-progress" style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />

      {SLIDES.map((s, n) => {
        const state = n === i ? 'active' : n < i ? 'before' : 'after';
        return (
          <section
            key={s.id}
            className={`slide ${state} ${s.cover ? 'cover' : ''}`}
            data-dir={dir}
            aria-hidden={n !== i}
            aria-label={`Slide ${n + 1} of ${SLIDES.length}`}
          >
            {!s.cover && (
              <div className="slide-top mono-label">
                <span>LOOKOUT</span>
                <span>{String(n + 1).padStart(2, '0')} / {SLIDES.length}</span>
              </div>
            )}
            <div className="slide-body">{s.render(n === i)}</div>
          </section>
        );
      })}

      <div className="deck-controls">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">←</button>
        <span className="mono-label">{String(i + 1).padStart(2, '0')} / {SLIDES.length}</span>
        <button onClick={() => go(i + 1)} disabled={i === last} aria-label="Next slide">→</button>
        <button onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Enter full screen'} className="fs-btn">
          {full ? 'Exit' : 'Full screen'} <kbd>F</kbd>
        </button>
      </div>
      <p className="deck-hint mono-label">← → or space to move · F for full screen</p>
    </div>
  );
}
