import { useEffect, useState } from 'react';

/** Returns null on the server and first client render (avoids hydration mismatch), then ticks. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const fmtAge = (s: number) =>
  s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;

export const fmtLeft = (ms: number) => {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d > 0) return `${d}d ${hh}h`;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
};
