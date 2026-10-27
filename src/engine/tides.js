import { createStore } from 'zustand/vanilla';
import { GPS } from './gps.js';
import { Astro } from './astro.js';
import { getMap, readJSON } from './app.js';
import { coopsHiLoUrl } from './datasources.js';

/* Tides (NOAA CO-OPS) + Solunar bite times + sun/moon — the "Tides & Times" panel.
   Tides need internet; solunar/sun/moon are computed offline.

   Port note: the legacy module wrote #tide-body / #tide-hilo / #sun-moon / #solunar directly.
   It now publishes plain data through tidesStore and the React panel
   (features/tides/TidesPanel) draws it. Every rule about WHAT is shown — cache validity,
   "a failed refresh never replaces a cache already on screen", one just-passed tide in the
   list, cos(lat) station choice, device-local NOAA time parsing — lives here unchanged. */
'use strict';

export const Tides = {
  stations: [],
  loaded: false,
  /** 'idle' | 'loading' | 'ready' | 'failed' — the bundled station list */
  status: 'idle',
  _loading: false,
  _loadingId: null,
  _rerun: false,
};

/** @typedef {{ t: string, v: string, type: string }} NoaaHiLo  one NOAA hi/lo prediction (t = "YYYY-MM-DD HH:MM", station-local) */
/** @typedef {{ type: 'major'|'minor', start: number, end: number }} SolunarPeriod */
/**
 * @typedef {Object} AstroView   offline sun / moon / solunar for the device-local day
 * @property {number} at              when this was derived (ms) — the panel's "now"
 * @property {number|null} sunrise
 * @property {number|null} sunset
 * @property {string} moonName
 * @property {number} moonLitPct
 * @property {number|null} moonrise  null when the moon doesn't rise today
 * @property {number|null} moonset
 * @property {SolunarPeriod[]} solunar
 */
/**
 * @typedef {Object} TidesView
 * @property {{ id: string, name: string }|null} station
 * @property {'idle'|'no-stations'|'offline'|'loading'|'ready'|'error'|'no-data'} status
 * @property {NoaaHiLo[]} hilo      predictions for `station` only (cleared when the station changes)
 * @property {boolean} fromCache
 * @property {boolean} refreshing   a cached set is on screen while a fresh one loads
 * @property {number} updatedAt     when the shown predictions were fetched (0 = unknown)
 * @property {AstroView|null} astro
 */
/** @type {import('zustand/vanilla').StoreApi<TidesView>} */
export const tidesStore = createStore(() => /** @type {TidesView} */ ({
  station: null,
  status: 'idle',
  hilo: [],
  fromCache: false,
  refreshing: false,
  updatedAt: 0,
  astro: null,
}));

/* The bundled CA station list. Joins a load already in flight; after a failure the next
   call tries again (the legacy version swallowed the error and left "No tide station data
   available." on screen until the app was restarted). */
let _stationsLoad = null;
export function tidesInit() {
  if (_stationsLoad) return _stationsLoad;
  Tides.status = 'loading';
  _stationsLoad = (async () => {
    try {
      const list = await fetch('./data/tide-stations-ca.json').then((r) => r.json());
      if (!Array.isArray(list)) throw new Error('bad station list');
      Tides.stations = list; Tides.loaded = true; Tides.status = 'ready';
    } catch (e) { Tides.status = 'failed'; }
  })().finally(() => { _stationsLoad = null; });
  return _stationsLoad;
}

export function nearestTideStation(ll) {
  let best = null, bd = Infinity;
  /* Scale longitude by cos(latitude). A degree of longitude at 34°N is only ~0.83 of
     a degree of latitude, so treating them as equal under-weighted east-west
     separation by ~17% and could pick a station that isn't actually the closest —
     and this choice feeds the bite engine and every catch's condition snapshot. */
  const kx = Math.cos(ll.lat * Math.PI / 180);
  Tides.stations.forEach((s) => {
    const dy = s.la - ll.lat, dx = (s.lo - ll.lng) * kx;
    const d = dy * dy + dx * dx;
    if (d < bd) { bd = d; best = s; }
  });
  return best;
}

/** @param {Date|number} d */
export function fmtTime(d) { return (d instanceof Date ? d : new Date(d)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }

/* NOAA lst_ldt times come as "YYYY-MM-DD HH:MM" in the STATION's local time. Swap the space
   for a T (iOS Safari can't parse the space form) and let Date read it as device-local —
   correct while the phone is in the station's time zone, which on a boat it is. Do NOT
   convert to UTC. */
export function noaaTimeMs(t) { return new Date(t.replace(' ', 'T')).getTime(); }

/* Where "here" is: the boat, else the middle of the chart. */
function tidesHere() {
  const map = getMap();
  return GPS.lastLatLng || (map ? map.getCenter() : null);
}

export async function loadTidesTimes() {
  const ll = tidesHere();
  if (!ll) return;
  /* ---- Solunar + sun/moon (offline) ---- */
  renderSunMoonSolunar(ll);
  /* ---- Tides (online) ---- */
  if (!Tides.stations.length) {
    // The station list loads at boot; if the panel opened first (or that load failed), wait
    // for / retry it rather than announcing "no stations" a moment too early.
    if (tidesStore.getState().status === 'idle') tidesStore.setState({ status: 'loading' });
    await tidesInit();
  }
  const st = Tides.stations.length ? nearestTideStation(ll) : null;
  if (!st) { tidesStore.setState({ station: null, status: 'no-stations', hilo: [], fromCache: false, refreshing: false, updatedAt: 0 }); return; }
  /* A different station never inherits the last one's rows (legacy #tide-hilo kept the
     previous station's tides under the new station's name). */
  if (tidesStore.getState().station?.id !== st.id) {
    tidesStore.setState({ station: { id: st.id, name: st.n }, status: 'loading', hilo: [], fromCache: false, refreshing: false, updatedAt: 0 });
  }

  // Cache-first: reuse a recent (<24h) saved prediction for this station so tides render
  // instantly and still work offline; only fetch fresh when we have a connection.
  const cacheKey = 'fishapp.tides.' + st.id;
  const cached = readJSON(cacheKey, null);
  /* Tide predictions are astronomical — a 25-hour-old payload isn't stale, it's just
     partly used up. What matters is whether it still covers the future. Age-only
     expiry meant day two of a trip showed "Couldn't load tide predictions" with a
     perfectly good prediction set sitting in storage. */
  const stillCovers = !!(cached && cached.hl && cached.hl.length &&
    cached.hl.some((p) => noaaTimeMs(p.t) >= Date.now()));
  const fresh = stillCovers && cached.ts && (Date.now() - cached.ts) < 24 * 3600000;
  const showCached = () => {
    if (!stillCovers) return false;
    try { renderTideGraph(cached.hl, { fromCache: true, updatedAt: cached.ts || 0 }); return true; } catch (e) { return false; }
  };

  if (!navigator.onLine) {
    if (!showCached()) tidesStore.setState({ status: 'offline', hilo: [], fromCache: false, refreshing: false });
    return;
  }
  if (Tides._loading) {   // dedupe rapid re-opens
    // ...but a call for a DIFFERENT station (the boat moved on) must not be lost: run it
    // once the load in flight finishes.
    if (Tides._loadingId !== st.id) Tides._rerun = true;
    return;
  }
  // Track what's actually on screen: a still-valid but >24h cache renders fine, and
  // a failed refresh must not replace it with an error box.
  const showedCache = showCached();
  if (!showedCache) tidesStore.setState({ status: 'loading', hilo: [], fromCache: false, refreshing: false });
  if (showedCache && fresh) return;   // recent enough — no need to hit the network at all

  Tides._loading = true;
  Tides._loadingId = st.id;
  if (showedCache) tidesStore.setState({ refreshing: true });
  const stillThisStation = () => tidesStore.getState().station?.id === st.id;
  try {
    const now = new Date(), end = new Date(now.getTime() + 2 * 86400000);
    // hi/lo works for every station (incl. subordinate ones with no time-series)
    const url = coopsHiLoUrl(st.id, ymd(now), ymd(end));
    const hilo = await fetch(url).then((r) => r.json());
    const hl = hilo.predictions || [];
    if (!hl.length) throw new Error('no predictions');
    if (stillThisStation()) renderTideGraph(hl, { fromCache: false, updatedAt: Date.now() });
    /* Its own try: a full localStorage (quota) used to throw here and replace the graph
       that had just rendered with "Couldn't load tide predictions". */
    try { localStorage.setItem(cacheKey, JSON.stringify({ hl, ts: Date.now() })); } catch (e) { /* shown, just not cached */ }
  } catch (e) {
    if (!showedCache && stillThisStation()) tidesStore.setState({ status: 'error', hilo: [], fromCache: false });
  } finally {
    Tides._loading = false;
    Tides._loadingId = null;
    if (stillThisStation()) tidesStore.setState({ refreshing: false });
    if (Tides._rerun) { Tides._rerun = false; loadTidesTimes(); }
  }
}

/* Publish a prediction set for the panel. The curve and the rows are DERIVED at render time
   (so the now-line and the past/next split stay current), but both are built here once
   first: a malformed set throws now, inside the loader's try — exactly where the legacy
   innerHTML render threw — instead of crashing the panel later. */
export function renderTideGraph(hilo, meta) {
  const m = meta || {};
  if (hilo.length < 2) {
    tidesStore.setState({ status: 'no-data', hilo, fromCache: !!m.fromCache, updatedAt: m.updatedAt || 0 });
    return;
  }
  buildTideCurve(hilo, Date.now());
  selectHiLoRows(hilo, Date.now());
  tidesStore.setState({ status: 'ready', hilo, fromCache: !!m.fromCache, updatedAt: m.updatedAt || 0 });
}

/**
 * @typedef {Object} TideCurve
 * @property {number} W
 * @property {number} H
 * @property {string} line   SVG path (viewBox 0 0 W H)
 * @property {string} area   closed SVG path under the line
 * @property {number|null} nowX   null when now is outside the drawn range
 * @property {number|null} nowY   the curve's height at now (with nowX)
 * @property {Array<{ x: number, y: number, t: number, v: number, type: 'H'|'L' }>} marks
 * @property {number} t0
 * @property {number} t1
 * @property {number} vmin
 * @property {number} vmax
 */
/* Build a smooth tide curve from the hi/lo points via cosine interpolation
   (the natural shape of a tide between extremes) — works for all stations.
   Pure. Defaults reproduce the legacy 320x90 graph (pad 4, whole prediction range);
   opts.from/opts.to clip it to a window (the panel draws today), opts.padTop/padBottom
   leave room for the high/low labels. Returns null with fewer than 2 points ("No tide data."). */
/** @returns {TideCurve|null} */
export function buildTideCurve(hilo, nowMs, opts) {
  const o = opts || {};
  if (hilo.length < 2) return null;
  const W = o.W || 320, H = o.H || 90, pad = o.pad != null ? o.pad : 4;
  const padTop = o.padTop != null ? o.padTop : pad, padBottom = o.padBottom != null ? o.padBottom : pad;
  const ext = hilo.map((p) => ({ t: noaaTimeMs(p.t), v: parseFloat(p.v) }));
  let pts = [];
  for (let i = 0; i < ext.length - 1; i++) {
    const a = ext[i], b = ext[i + 1];
    for (let k = 0; k < 24; k++) {
      const f = k / 24, t = a.t + (b.t - a.t) * f;
      const v = a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
      pts.push({ t, v });
    }
  }
  pts.push({ t: ext[ext.length - 1].t, v: ext[ext.length - 1].v });
  if (o.from != null || o.to != null) {
    const lo = o.from != null ? o.from : -Infinity, hi = o.to != null ? o.to : Infinity;
    const clipped = pts.filter((p) => p.t >= lo && p.t <= hi);
    if (clipped.length >= 2) pts = clipped;   // no overlap with the window: keep the whole range
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const x = (t) => pad + (t - t0) / (t1 - t0) * (W - 2 * pad);
  const y = (v) => H - padBottom - (v - vmin) / (vmax - vmin || 1) * (H - padTop - padBottom);
  const line = 'M' + pts.map((p) => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' L');
  const nowX = x(nowMs);
  const area = line + ' L' + x(t1).toFixed(1) + ',' + (H - padBottom) + ' L' + x(t0).toFixed(1) + ',' + (H - padBottom) + ' Z';
  /** @type {TideCurve['marks']} */
  const marks = [];
  hilo.forEach((p) => {
    const t = noaaTimeMs(p.t);
    if (t < t0 || t > t1) return;
    const v = parseFloat(p.v);
    marks.push({ x: +x(t).toFixed(1), y: +y(v).toFixed(1), t, v, type: p.type === 'H' ? 'H' : 'L' });
  });
  const inRange = nowX >= pad && nowX <= W - pad;
  const tn = inRange ? tideNow(hilo, nowMs) : null;
  return {
    W, H, line, area, marks, t0, t1, vmin, vmax,
    nowX: inRange ? +nowX.toFixed(1) : null,
    nowY: tn ? +y(tn.ft).toFixed(1) : null,
  };
}

/**
 * @typedef {Object} TideNow
 * @property {number} ft        interpolated height now — an ESTIMATE between predicted extremes
 * @property {boolean} rising   the next extreme is a high (same rule as a catch's "incoming")
 * @property {{ t: number, v: number, type: 'H'|'L' }} next
 */
/* The tide height right now, by the same cosine interpolation the curve uses, plus which
   way it is going. Null outside the predicted range. Pure. */
/** @returns {TideNow|null} */
export function tideNow(hilo, nowMs) {
  const ext = hilo.map((p) => ({ t: noaaTimeMs(p.t), v: parseFloat(p.v), type: p.type === 'H' ? 'H' : 'L' }))
    .sort((a, b) => a.t - b.t);
  for (let i = 0; i < ext.length - 1; i++) {
    const a = ext[i], b = ext[i + 1];
    if (nowMs >= a.t && nowMs < b.t && b.t > a.t) {
      const f = (nowMs - a.t) / (b.t - a.t);
      return { ft: a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2, rising: b.type === 'H', next: /** @type {TideNow['next']} */ (b) };
    }
  }
  return null;
}

/** @typedef {{ ms: number, type: 'H'|'L', ft: number, past: boolean }} HiLoRow */
/* Show the tides still to COME. The payload starts from when it was fetched, so
   taking the first 8 unfiltered meant opening the panel at 05:00 on a cache saved
   at 18:00 yesterday listed mostly last night's tides — greyed out and useless,
   and on an older cache the whole list could be in the past. Keep one just-passed
   entry for context (you often want to know what the tide just did). Pure. */
/** @returns {HiLoRow[]} */
export function selectHiLoRows(hilo, nowMs) {
  const now = nowMs;
  const withMs = hilo.map((p) => ({ p, ms: noaaTimeMs(p.t) }))
    .sort((a, b) => a.ms - b.ms);
  const firstFuture = withMs.findIndex((x) => x.ms >= now);
  const start = firstFuture < 0 ? Math.max(0, withMs.length - 8) : Math.max(0, firstFuture - 1);
  const rows = withMs.slice(start, start + 8);
  return rows.map(({ p, ms }) => ({ ms, type: p.type === 'H' ? 'H' : 'L', ft: parseFloat(p.v), past: ms < now }));
}

/** @typedef {SolunarPeriod & { active: boolean, past: boolean }} SolunarRow */
/* NOW / past flags for the solunar list. Pure, so the panel can re-run it every minute
   from the clock alone — offline, with the panel left open. */
/** @returns {SolunarRow[]} */
export function solunarRows(periods, nowMs) {
  return periods.map((p) => ({ ...p, active: nowMs >= p.start && nowMs <= p.end, past: p.end < nowMs }));
}

const msOrNull = (d) => (d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null);

/* Sun, moon and solunar periods for the device-local day at `ll`. Pure (no network). */
/** @returns {AstroView} */
export function sunMoonSolunar(now, ll) {
  const sun = Astro.sunTimes(now, ll.lat, ll.lng);
  const ill = Astro.moonIllumination(now);
  const mt = Astro.moonTimes(now, ll.lat, ll.lng);
  const periods = Astro.solunar(now, ll.lat, ll.lng);
  return {
    at: now.getTime(),
    sunrise: msOrNull(sun.sunrise),
    sunset: msOrNull(sun.sunset),
    moonName: Astro.moonPhaseName(ill.phase),
    moonLitPct: Math.round(ill.fraction * 100),
    moonrise: mt.rise ? msOrNull(mt.rise) : null,
    moonset: mt.set ? msOrNull(mt.set) : null,
    solunar: periods.map((p) => ({ type: p.type === 'major' ? 'major' : 'minor', start: +p.start, end: +p.end })),
  };
}

export function renderSunMoonSolunar(ll) {
  tidesStore.setState({ astro: sunMoonSolunar(new Date(), ll) });
}

/* The panel's clock: re-derive sun/moon/solunar for here and now. Cheap (pure astronomy),
   needs no network, and rolls the lists over at midnight — the legacy NOW highlight only
   moved on the 10-minute ONLINE refresh, so offline it went stale with the panel open. */
export function tidesClockTick() {
  const ll = tidesHere();
  if (ll) renderSunMoonSolunar(ll);
}
