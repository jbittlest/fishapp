/* Display theme: day (ink), sun (paper reading surfaces for glare), night (red-safe).
 * "auto" follows the sun at the boat: Day from sunrise to sunset, Night otherwise. The chart's
 * colour lookup table always switches together with the UI (data-lume + updateChartFilter), so
 * the shallow-water hazard colouring is right for the light you're in. */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Astro } from '../engine/astro.js';
import { GPS } from '../engine/gps.js';
import { updateChartFilter } from '../engine/layers.js';

export type ThemeMode = 'auto' | 'day' | 'sun' | 'night';
export type Theme = 'day' | 'sun' | 'night';

const KEY = 'fishapp.theme';
function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'day' || v === 'sun' || v === 'night' || v === 'auto' ? v : 'auto';
  } catch { return 'auto'; }
}

export const themeStore = createStore<{ mode: ThemeMode; theme: Theme }>(() => ({ mode: readMode(), theme: 'day' }));
export function useTheme() { return useStore(themeStore); }

const THEME_COLOR: Record<Theme, string> = { day: '#0B131C', sun: '#0B131C', night: '#000000' };

function where(): { lat: number; lng: number } | null {
  if (GPS.lastLatLng) return GPS.lastLatLng;
  const m = (window as unknown as { _map?: { getCenter(): { lat: number; lng: number } } })._map;
  return m ? m.getCenter() : null;
}

function resolve(mode: ThemeMode): Theme {
  if (mode !== 'auto') return mode;
  const p = where();
  if (!p) return 'day';
  try {
    const now = new Date();
    const t = Astro.sunTimes(now, p.lat, p.lng);
    const rise = t.sunrise?.getTime(), set = t.sunset?.getTime();
    if (!Number.isFinite(rise) || !Number.isFinite(set)) return 'day';   // polar day/night: stay readable
    return now.getTime() >= rise && now.getTime() < set ? 'day' : 'night';
  } catch { return 'day'; }
}

export function applyTheme(): void {
  const { mode } = themeStore.getState();
  const theme = resolve(mode);
  const root = document.documentElement;
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme;
    root.dataset.lume = theme === 'night' ? 'night' : 'day';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
    try { updateChartFilter(); } catch { /* map not up yet — boot calls it after the layers exist */ }
  }
  if (themeStore.getState().theme !== theme) themeStore.setState({ theme });
}

export function setThemeMode(mode: ThemeMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  themeStore.setState({ mode });
  applyTheme();
}

let started = false;
export function startTheme(): void {
  applyTheme();
  if (started) return;
  started = true;
  setInterval(applyTheme, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyTheme(); });
}
