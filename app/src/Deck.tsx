'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SLIDE_SETS, type Track } from './deck-slides';
import './deck.css';

/* ---------- the deck ---------- */

export default function Deck({ track }: { track: Track }) {
  const { name, slides: SLIDES } = SLIDE_SETS[track];
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
      aria-label={`${name} pitch`}
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
                <span>{name}</span>
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
