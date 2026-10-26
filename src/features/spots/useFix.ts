/* How far "from you" can be trusted right now. gpsStore keeps the last fix's lat/lng when the
 * status turns 'lost' (and GPS.lastLatLng is never cleared), so a distance worked out from it
 * would read as live long after the feed died. DESIGN §0.7: never show a stale value as live —
 * the spots / reefs cards and lists dim those numbers and say how old the fix is.
 * The freshness window is the HUD's (Hud.tsx dims SOG / COG after 10 s), so the card and the
 * instruments always agree about whether the position is live. */
import { useEffect, useState } from 'react';
import { useStoreValue } from '../../ui';
import { gpsStore } from '../../engine/gps.js';

/** Same as the HUD's "stale" threshold. */
export const FIX_FRESH_MS = 10_000;

export interface FixInfo {
  /** the last accepted fix (may be old), or null when there has never been one */
  here: { lat: number; lng: number } | null;
  /** a current fix: status 'fix' and younger than FIX_FRESH_MS */
  live: boolean;
  /** age of the last fix in ms (Infinity when unknown) */
  ageMs: number;
}

/** Pure: is a fix with this status / timestamp live at `now`? */
export function fixInfo(status: string, lat: number | null, lng: number | null, fixAt: number, now: number): FixInfo {
  const here = lat != null && lng != null ? { lat, lng } : null;
  const ageMs = fixAt > 0 ? Math.max(0, now - fixAt) : Infinity;
  return { here, live: !!here && status === 'fix' && ageMs <= FIX_FRESH_MS, ageMs };
}

/** "8 s", "3 min", "2 h" — how old the last fix is. */
export function fixAgeText(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.round(m / 60) + ' h';
}

/** "from you" while live, else "from your last fix (3 min ago)". */
export function fromText(f: FixInfo): string {
  if (f.live) return 'from you';
  const age = fixAgeText(f.ageMs);
  return age ? `from your last fix (${age} ago)` : 'from your last fix';
}

/** Live fix state for a component; re-evaluates every few seconds so a fix that goes quiet
 *  dims on screen even though no new GPS update arrives to trigger a render. */
export function useFix(): FixInfo {
  const status = useStoreValue(gpsStore, (s) => s.status);
  const lat = useStoreValue(gpsStore, (s) => s.lat);
  const lng = useStoreValue(gpsStore, (s) => s.lng);
  const fixAt = useStoreValue(gpsStore, (s) => s.fixAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // a new fix re-renders through the store; use the later of the two clocks so it is never "in the future"
  return fixInfo(status, lat, lng, fixAt, Math.max(now, fixAt));
}
