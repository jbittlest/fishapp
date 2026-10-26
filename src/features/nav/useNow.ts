import { useEffect, useState } from 'react';

/** Wall-clock that re-renders every `ms` (0 = frozen at mount). For live countdowns and
 *  ages only — the safety timers themselves live in the engine, never in React. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ms) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "45 s" / "3 min" / "2 h" */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.round(m / 60) + ' h';
}

/** A duration for reading, not for instruments: "<1 min" / "17 min" / "1 h 5 min" (floors). */
export function durWords(sec: number | null | undefined, fallback = '—'): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return fallback;
  if (sec < 60) return '<1 min';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
