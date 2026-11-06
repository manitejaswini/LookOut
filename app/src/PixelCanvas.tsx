'use client';

import { useEffect, useRef } from 'react';

const NAVY = '#1e2544', BLUE = '#3a56d4', YEL = '#f6c90e', GOLD = '#f6d36d', NEON = '#dcfc04', RED = '#e0492a';
const CELL = 12;

// deterministic hash → 0..1, so cells don't flicker between frames
const rnd = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return (((n ^ (n >> 16)) >>> 0) % 10000) / 10000;
};

function pickColor(xr: number, r: number) {
  // left: navy/blue · middle: yellow · right: neon/red
  const p = xr + (r - 0.5) * 0.35;
  if (p < 0.12) return r > 0.5 ? NAVY : BLUE;
  if (p < 0.3) return r > 0.7 ? NAVY : r > 0.25 ? BLUE : GOLD;
  if (p < 0.55) return r > 0.8 ? BLUE : r > 0.1 ? YEL : GOLD;
  if (p < 0.78) return r > 0.9 ? RED : r > 0.15 ? YEL : GOLD;
  return r > 0.8 ? RED : r > 0.45 ? NEON : YEL;
}

interface Props { variant: 'wave' | 'skyline'; height: number }

export default function PixelCanvas({ variant, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let w = 0;

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      w = canvas.clientWidth;
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const cell = (cx: number, cy: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx * CELL, cy * CELL, CELL - 1, CELL - 1);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, height);
      const cols = Math.ceil(w / CELL), rows = Math.floor(height / CELL);

      if (variant === 'wave') {
        for (let x = 0; x < cols; x++) {
          const edge = rows * 0.42
            + Math.sin(x * 0.06 + t * 0.6) * rows * 0.1
            + Math.sin(x * 0.17 - t * 0.9) * rows * 0.05
            + Math.sin(x * 0.011 + 1) * rows * 0.06;
          for (let y = 0; y < edge; y++) {
            const fade = Math.min(1, (edge - y) / (rows * 0.22));
            const r = rnd(x, y);
            if (r > fade * 1.15 + 0.08) continue;
            cell(x, y, pickColor(x / cols, rnd(y, x)));
          }
        }
        // pixel chomper eating a dotted line
        const row = rows - 3;
        const px = reduce ? cols * 0.7 : (t * 9) % (cols + 8) - 4;
        for (let x = 0; x < cols; x += 3) if (x > px + 4) cell(x, row, GOLD);
        const R = 3.6, mouth = reduce ? 0.5 : Math.abs(Math.sin(t * 6));
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            if (dx * dx + dy * dy > R * R) continue;
            if (dx > 0 && Math.abs(dy) < dx * mouth) continue;
            cell(Math.round(px) + dx, row + dy, dx > 2 ? NAVY : YEL);
          }
      } else {
        for (let x = 0; x < cols; x++) {
          const hgt = Math.floor(rnd(x, 7) ** 2 * rows * 0.85) + (reduce ? 0 : Math.floor(Math.max(0, Math.sin(t * 1.5 + x * 0.4)) * 2));
          for (let y = 0; y < hgt; y++) if (rnd(x, y + 40) > 0.25) cell(x, rows - 1 - y, pickColor(rnd(x, 3), rnd(x, y)));
        }
      }
    };

    resize();
    const loop = (ms: number) => { draw(ms / 1000); raf = requestAnimationFrame(loop); };
    if (reduce) draw(2); else raf = requestAnimationFrame(loop);
    const onResize = () => { resize(); if (reduce) draw(2); };
    addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); };
  }, [variant, height]);

  return <canvas ref={ref} className="pixel-canvas" style={{ height }} aria-hidden="true" />;
}
