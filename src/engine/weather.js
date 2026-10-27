import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { GPS, formatCoord, gpsStore, nmBetween } from './gps.js';
import { getMap, readJSON } from './app.js';
import { setDataOverlay } from './layers.js';
import { SST } from './sst.js';
import { OPEN_METEO_ATTRIBUTION } from './datasources.js';
import { isPanelOpen, openPanel, toast } from '../services/ui';

/* Weather: Windy-style wind arrow overlay + forecast panel (Open-Meteo, free, no key) */
'use strict';

/* Port note (React UI): this module never touches the DOM. Everything the legacy code wrote into
   #wx-current / #wx-hourly / #fc-days / #wind-bar is computed here as plain data and published
   through wxStore; features/weather/WeatherPanel and MapLegends render it. */

export const WX = {
  overlayOn: false,
  layer: null,          // L.layerGroup of wind arrows
  _moveTimer: null,
  _lastPanelData: null,
  /* forecast loop (filled by windLoopBuild) */
  pts: null,
  frames: null,
  times: [],
  startIdx: 0,
  idx: 0,
  playing: false,
  timer: null,
  _framesAt: 0,         // when the loop frames were fetched — "hour 0" drifts into the past
  _framesView: null,    // {zoom, bounds} the frame grid was laid out for
  _building: null,      // in-flight windLoopBuild promise, shared by rapid scrubs
  _scrubHour: 0,
  _liveGen: 0,          // bumps when a forecast hour (or a newer live refresh) takes over the arrows
  /* forecast panel */
  _fc10loaded: false,   // the 10-Day tab has been loaded this panel session (the 10-min refresh reloads it)
  _fcLoc: null,         // {lat,lng} while the 10-Day tab shows a tapped area (showAreaForecast)
  _fcTarget: null,      // what the 10-Day view currently describes: 'here' or 'area:lat,lng'
  _fcLoading: new Set(),
  _loadingNow: false,
  _loadingFc: false,
  /* HUD water temperature near the boat */
  _waterAt: 0,
  _waterLL: null,
  _waterBusy: false,
};

export const MS_TO_FT = 3.28084;

/* ---- view store ---------------------------------------------------------------------------- */
/** @typedef {'idle'|'loading'|'ready'|'offline'|'error'} WxStatus */
/**
 * @typedef {{ windKn: number|null, windFromDeg: number|null, gustKn: number|null, tempF: number|null,
 *   waveFt: number|null, wavePerS: number|null, waveFromDeg: number|null,
 *   swellFt: number|null, swellPerS: number|null, swellFromDeg: number|null,
 *   hasMarine: boolean, rainPctNow: number|null, maxWind24: number|null, maxGust24: number|null,
 *   windBand: number|null, gustBand: number|null, windRough: boolean, gustRough: boolean }} WxCurrent
 */
/* windBand/gustBand/windRough/gustRough describe the DISPLAYED (rounded) figure, so the cue
   always agrees with the number next to it. */
/**
 * @typedef {{ key: string, label: string, windKn: number|null, windFromDeg: number|null, gustKn: number|null,
 *   waveFt: number|null, rainPct: number|null, tempF: number|null,
 *   windBand: number|null, gustBand: number|null, windRough: boolean, gustRough: boolean }} WxHour
 */
/**
 * @typedef {{ key: string, wd: string, md2: string, dayOut: number, longRange: boolean, icon: string, desc: string,
 *   hi: number|null, lo: number|null, windMax: number|null, gust: number|null, wdir: string, wdirDeg: number|null,
 *   waveFt: number|null, wavePer: number|null, waveDir: string, swellFt: number|null, swellPer: number|null,
 *   pop: number|null, rainSum: number|null, sst: number|null, uv: number|null, sunrise: string, sunset: string,
 *   rough: boolean, strip: WxHour[] }} WxDay
 */
/**
 * @typedef {{ status: WxStatus, locLabel: string, atBoat: boolean, current: WxCurrent|null, hours: WxHour[],
 *   ts: number, refreshing: boolean, refreshFailed: boolean }} WxNowView
 */
/**
 * @typedef {{ status: WxStatus, locLabel: string, forArea: boolean, area: {lat:number,lng:number}|null,
 *   hereAtBoat: boolean, days: WxDay[], ts: number, refreshing: boolean, refreshFailed: boolean }} WxFc10View
 */
/* hereAtBoat: what "here" means to loadForecast10() right now — the boat's last fix
   (GPS.lastLatLng, kept after the fix is lost) or, with no fix ever, the map centre. */
/** @typedef {{ on: boolean, playing: boolean, loading: boolean, hour: number, timeLabel: string }} WxWindView */
/** @typedef {{ tab: 'now'|'10day', now: WxNowView, fc10: WxFc10View, wind: WxWindView }} WxView */

/** @returns {WxNowView} */
function emptyNow() {
  return { status: 'idle', locLabel: '', atBoat: false, current: null, hours: [], ts: 0, refreshing: false, refreshFailed: false };
}
/** @returns {WxFc10View} */
function emptyFc() {
  return { status: 'idle', locLabel: '', forArea: false, area: null, hereAtBoat: false, days: [], ts: 0, refreshing: false, refreshFailed: false };
}

/** @type {import('zustand/vanilla').StoreApi<WxView>} */
export const wxStore = createStore(() => /** @type {WxView} */ ({
  tab: 'now',
  now: emptyNow(),
  fc10: emptyFc(),
  wind: { on: false, playing: false, loading: false, hour: 0, timeLabel: '' },
}));

/** @param {Partial<WxNowView>} patch */
function setNow(patch) { wxStore.setState((s) => ({ now: { ...s.now, ...patch } })); }
/** @param {Partial<WxFc10View>} patch */
function setFc(patch) { wxStore.setState((s) => ({ fc10: { ...s.fc10, ...patch } })); }
/** @param {Partial<WxWindView>} patch */
function setWind(patch) { wxStore.setState((s) => ({ wind: { ...s.wind, ...patch } })); }

/* Latest sea-surface temperature near the boat, °F, with when/where it applies. The HUD's
   WATER cell reads it (and hides it when it is old or far from the boat). */
/** @typedef {{ waterF: number|null, at: number, lat: number|null, lng: number|null }} ConditionsView */
/** @type {import('zustand/vanilla').StoreApi<ConditionsView>} */
export const conditionsStore = createStore(() => /** @type {ConditionsView} */ ({ waterF: null, at: 0, lat: null, lng: null }));

export function wxInit(map) {
  // the linked Open-Meteo credit (CC BY 4.0) rides in the map's Credits while the arrows are shown
  WX.layer = L.layerGroup([], { attribution: OPEN_METEO_ATTRIBUTION });
  map.on('moveend zoomend', () => {
    if (!WX.overlayOn || WX.playing) return;   // don't clobber an active forecast loop
    /* The refresh below redraws CURRENT wind. A paused scrub position keeps its label until
       that redraw actually lands: refreshWindOverlay puts the timeline back to "now" in the
       same step that draws live arrows (and a scrub in the meantime cancels this timer). */
    clearTimeout(WX._moveTimer);
    WX._moveTimer = setTimeout(refreshWindOverlay, 900);
  });
  /* HUD water temp: re-sample near the boat as fixes arrive (heavily throttled, and only while
     a weather feature is in use — see refreshBoatWater). */
  gpsStore.subscribe((s, prev) => {
    if (s.fixAt && s.fixAt !== prev.fixAt) refreshBoatWater(false);
    /* The 10-Day tab's "Back to my position / map centre" names what loadForecast10() would
       use: GPS.lastLatLng, which is never cleared once set (gps.js sets it just after
       publishing the fix, hence the fixAt check). */
    const here = !!GPS.lastLatLng || !!s.fixAt;
    if (here !== wxStore.getState().fc10.hereAtBoat) setFc({ hereAtBoat: here });
  });
}

export function windOverlayEnable(on) {
  WX.overlayOn = on;
  const map = getMap();
  if (on) {
    if (map) WX.layer.addTo(map);
    refreshWindOverlay();
    setWind({ on: true });
  } else {
    windLoopStop(true);   // silent (don't redraw current)
    if (map) map.removeLayer(WX.layer);
    WX.frames = null;     // a later loop/scrub rebuilds for whatever view it is then
    setWind({ on: false, loading: false, playing: false, hour: 0, timeLabel: '' });
  }
}

/* ---- Wind forecast loop: animate the arrows through the next 24 h ---- */
export const WIND_LOOP_HOURS = 24;
export const WIND_FRAME_MS = 650;
/* Loop frames describe one view at one time. Past this age "hour 0" has drifted into the past,
   so a scrub rebuilds instead of replaying them (legacy reused them for the whole session). */
export const WIND_FRAMES_MAX_AGE_MS = 30 * 60000;

/* One fetch at a time: a scrub drag fires dozens of input events, and each used to start its
   own forecast download while the first was still in flight. */
export function windLoopBuild() {
  if (WX._building) return WX._building;
  WX._building = windLoopFetch().finally(() => { WX._building = null; });
  return WX._building;
}

async function windLoopFetch() {
  const map = getMap(), size = map.getSize(), step = 95;
  const lats = [], lons = [], pts = [];
  for (let px = step / 2; px < size.x; px += step) {
    for (let py = step / 2 + 40; py < size.y; py += step) {
      const ll = map.containerPointToLatLng([px, py]);
      if (Math.abs(ll.lat) > 80) continue;
      lats.push(ll.lat.toFixed(3));
      lons.push(((ll.lng + 540) % 360 - 180).toFixed(3));
      pts.push(ll);
    }
  }
  if (!pts.length) return false;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') +
    '&longitude=' + lons.join(',') +
    '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=2&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error('http ' + r.status);
  let data = await r.json();
  if (!Array.isArray(data)) data = [data];
  WX.pts = pts;
  WX.frames = data;
  WX.times = (data[0] && data[0].hourly) ? data[0].hourly.time : [];
  const now = Date.now();
  WX.startIdx = Math.max(0, WX.times.findIndex((t) => new Date(t).getTime() >= now - 3600000));
  WX._framesAt = now;
  WX._framesView = { zoom: map.getZoom(), bounds: map.getBounds() };
  return true;
}

/** True when the cached loop frames no longer describe this view / this hour. */
export function windFramesStale() {
  if (!WX.frames) return true;
  if (Date.now() - WX._framesAt > WIND_FRAMES_MAX_AGE_MS) return true;
  const map = getMap();
  const v = WX._framesView;
  if (!map || !v || !v.bounds) return false;
  if (map.getZoom() !== v.zoom) return true;
  // panned far enough that the arrow grid no longer covers the middle of the screen
  return !v.bounds.pad(-0.25).contains(map.getCenter());
}

/** Label for a forecast hour, e.g. "Mon 3 PM". */
export function windHourLabel(t) {
  return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric' });
}

export function windShowHour(offset) {
  if (!WX.frames) return;
  WX.idx = offset;
  const i = WX.startIdx + offset;
  WX._liveGen++;   // a live-wind refresh still in flight must not draw over this hour
  WX.layer.clearLayers();
  WX.frames.forEach((d, p) => {
    const h = d.hourly;
    if (!h || h.wind_speed_10m[i] == null) return;
    L.marker(WX.pts[p], {
      icon: windArrowIcon(h.wind_speed_10m[i], h.wind_direction_10m[i]),
      interactive: false, keyboard: false,
    }).addTo(WX.layer);
  });
  setWind({ hour: offset, timeLabel: WX.times[i] ? windHourLabel(WX.times[i]) : '' });
}

/* Drag the timeline: pause and show that forecast hour (loading the hourly data if needed) */
export async function windScrub(v) {
  if (WX.playing) { WX.playing = false; clearInterval(WX.timer); WX.timer = null; updateWindBtn(); }
  /* A pan just before the drag queued a live-wind refresh; left alone it fired after this
     hour was drawn and put CURRENT wind under the forecast hour's label. */
  clearTimeout(WX._moveTimer);
  const hour = parseInt(v, 10);
  WX._scrubHour = hour;
  setWind({ hour });                               // the slider follows the finger while hours load
  if (windFramesStale()) {
    if (!navigator.onLine) { toast('Wind forecast needs internet'); setWind({ hour: 0, timeLabel: '' }); return; }
    if (!WX._building) toast('Loading wind forecast…');
    setWind({ loading: true });
    /* Legacy had no catch here: a failed download was a silent unhandled rejection and the
       slider just sat on an hour that never appeared. */
    try {
      if (!(await windLoopBuild())) { setWind({ loading: false, hour: 0, timeLabel: '' }); return; }
    } catch (e) {
      setWind({ loading: false, hour: 0, timeLabel: '' });
      toast('Could not load wind forecast');
      return;
    }
    setWind({ loading: false });
    if (!WX.overlayOn || WX.playing) return;       // turned off, or a loop started, while it loaded
  }
  windShowHour(WX._scrubHour);                     // the newest position the finger asked for
}

export async function windLoopToggle() {
  if (WX.playing) { windLoopStop(); return; }
  if (wxStore.getState().wind.loading) return;     // already starting
  if (!navigator.onLine) { toast('Wind loop needs internet'); return; }
  if (!WX.overlayOn) setDataOverlay('wind', true); // auto-enables the overlay (and persists the pref)
  try {
    toast('Loading wind forecast…');
    setWind({ loading: true });
    const ok = await windLoopBuild();
    setWind({ loading: false });
    if (!ok) return;
    /* The overlay may have been switched off (or the loop started elsewhere) during the
       download — starting the timer then animated an invisible layer forever. */
    if (!WX.overlayOn || WX.playing) return;
    WX.playing = true;
    updateWindBtn();
    windShowHour(0);
    WX.timer = setInterval(() => windShowHour((WX.idx + 1) % WIND_LOOP_HOURS), WIND_FRAME_MS);
  } catch (e) {
    setWind({ loading: false });
    toast('Could not load wind forecast');
  }
}

export function windLoopStop(silent) {
  WX.playing = false;
  clearInterval(WX.timer);
  WX.timer = null;
  updateWindBtn();
  /* The arrows go back to live wind, so the timeline goes back to "now" (legacy left the last
     hour's label up). It does so in the same step that draws live wind (refreshWindOverlay):
     until then — and for good if that refresh can't run (offline, error) — the arrows still
     show the last forecast hour, and so does the label. */
  if (!silent && WX.overlayOn) { refreshWindOverlay(); return; } // back to current wind
  setWind({ hour: 0, timeLabel: '' });
}

export function updateWindBtn() {
  setWind({ playing: WX.playing });
}

/* ---- Wind arrow overlay ---- */

export function windColor(kn) {
  /* Unknown gets its own colour. Without this, null fell through to the calm blue
     (a missing gust reading looked like a flat day) and NaN fell past every test
     into stay-home red. */
  if (kn == null || !isFinite(kn)) return '#8a9aa8';   // neutral grey — no data
  if (kn < 7) return '#4aa3e0';    // light air — blue
  if (kn < 14) return '#3dd464';   // nice breeze — green
  if (kn < 21) return '#e8c93d';   // getting sporty — yellow
  if (kn < 28) return '#f2803d';   // small craft advisory feel — orange
  return '#e8453d';                // stay home — red
}

/* The same speed bands as windColor, as a number the panel can carry without colour:
   null = no data, 0 light air, 1 nice breeze, 2 getting sporty, 3 small-craft feel, 4 stay home.
   Legacy painted the WIND / GUSTS cards and every hourly wind cell in these colours; the panel
   can't show them (red is reserved for safety, never colour alone, per-theme wind tokens are
   still a request), so it marks strong readings with the rough-day triangle + weight instead
   (windRough) and keeps the band in the view model for the token request. */
export function windBand(kn) {
  if (kn == null || !isFinite(kn)) return null;
  if (kn < 7) return 0;
  if (kn < 14) return 1;
  if (kn < 21) return 2;
  if (kn < 28) return 3;
  return 4;
}
/** A wind or gust reading at/over the rough-day wind threshold (unknown is never rough). */
export function windRough(kn) {
  return kn != null && isFinite(kn) && kn >= ROUGH_WIND_KN;
}
/** The strength cues for one displayed wind / gust pair (WxCurrent, WxHour). */
export function windCues(windKn, gustKn) {
  return { windBand: windBand(windKn), gustBand: windBand(gustKn), windRough: windRough(windKn), gustRough: windRough(gustKn) };
}

/* Map symbology: the arrow's fill is data (the speed band), so it stays a literal colour from
   windColor — the chart legend for these bands is the colour itself plus the knot label. */
export function windArrowIcon(kn, dirFrom) {
  const rot = (dirFrom + 180) % 360; // meteo direction = FROM; arrow points where wind GOES
  const color = windColor(kn);
  const html =
    `<div style="text-align:center;pointer-events:none">` +
    `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${rot}deg)">` +
    `<path d="M17 3 L23 21 L17 17 L11 21 Z" fill="${color}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>` +
    `</svg>` +
    `<div style="font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;margin-top:-6px">${Math.round(kn)}</div>` +
    `</div>`;
  return L.divIcon({ className: 'wx-windarrow', html, iconSize: [34, 42], iconAnchor: [17, 21] });
}

export async function refreshWindOverlay() {
  if (!navigator.onLine) { toast('Wind overlay needs internet'); return; }
  const map = getMap();
  if (!map) return;
  const size = map.getSize();
  const step = 95; // px between arrows
  const lats = [], lons = [], pts = [];
  for (let px = step / 2; px < size.x; px += step) {
    for (let py = step / 2 + 40; py < size.y; py += step) {
      const ll = map.containerPointToLatLng([px, py]);
      if (Math.abs(ll.lat) > 80) continue;
      lats.push(ll.lat.toFixed(3));
      lons.push(((ll.lng + 540) % 360 - 180).toFixed(3));
      pts.push(ll);
    }
  }
  if (!pts.length) return;
  const gen = ++WX._liveGen;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') +
      '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn';
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    let data = await r.json();
    if (!Array.isArray(data)) data = [data];
    if (WX.playing) return;   // a forecast loop started while this loaded — don't clobber its frame
    /* A scrub drew a forecast hour while this loaded (or a newer refresh superseded it, or the
       overlay went off): drawing live wind now would put CURRENT arrows under the forecast
       hour's label. Only re-checking `playing` let that through. */
    if (gen !== WX._liveGen || !WX.overlayOn) return;
    WX.layer.clearLayers();
    setWind({ hour: 0, timeLabel: '' });   // live wind: the timeline says "now" in the same step
    data.forEach((d, i) => {
      if (!d.current || d.current.wind_speed_10m === null) return;
      const kn = d.current.wind_speed_10m;
      L.marker(pts[i], {
        icon: windArrowIcon(kn, d.current.wind_direction_10m),
        interactive: false,
        keyboard: false,
      }).addTo(WX.layer);
    });
  } catch (e) {
    toast('Could not load wind data');
  }
}

/* ---- Forecast panel ---- */

/* Called by the Weather panel when it opens (and whenever its panelData changes).
   `opts.ll` = area forecast for a tapped point (straight to 10-Day); `opts.tab` = '10day' to
   open on the 10-Day tab for here. Otherwise: reset to the "Now" tab, like every legacy open. */
export function loadWeatherPanel(opts) {
  const ll = opts && opts.ll;
  if (ll && ll.lat != null && ll.lng != null && isFinite(ll.lat) && isFinite(ll.lng)) {
    WX._fcLoc = { lat: +ll.lat, lng: +ll.lng };
    WX._fc10loaded = true;
    wxStore.setState({ tab: '10day' });
    loadNow24();                    // keep the Now tab usable if they switch to it
    return loadForecast10(WX._fcLoc);
  }
  // reset to the "Now" tab each time the panel opens
  const tab = opts && opts.tab === '10day' ? '10day' : 'now';
  wxStore.setState({ tab });
  WX._fc10loaded = false;
  WX._fcLoc = null;
  if (tab === '10day') { WX._fc10loaded = true; loadForecast10(); }
  return loadNow24();
}

/** Switch tabs. Choosing 10-Day the first time this session loads it (the latch resets on failure). */
export function setWeatherTab(tab) {
  const t = tab === '10day' ? '10day' : 'now';
  wxStore.setState({ tab: t });
  if (t === '10day' && !WX._fc10loaded) { WX._fc10loaded = true; loadForecast10(); }
}

/* The device came back online while the Weather panel is open (the panel calls this when the
   shell's `online` flag flips to true). Legacy had no reconnect refresh; a saved copy then sat
   on screen as "Saved forecast from N ago" until the next 10-minute tick or a manual Retry.
   Both loaders are cache-first and de-duped, so this is safe to call at any time. */
export function wxOnReconnect() {
  if (!navigator.onLine) return;
  loadNow24();
  if (WX._fc10loaded || wxStore.getState().tab === '10day') loadForecast10();
}

/* Open the panel straight to the 10-Day tab for a tapped location. Goes through the shared
   panel-open path so the sheet gets the same safe sizing as every other panel (the legacy
   direct classList path skipped clampPanelHeight, and the sheet's close button could end up
   under the iOS status bar). The panel then calls loadWeatherPanel({ll}). */
export function showAreaForecast(ll) {
  if (!ll) return;
  openPanel('weather', { ll: { lat: ll.lat, lng: ll.lng } });
}

/* A cached payload is only safe to display if it was saved for essentially THIS place —
   otherwise we render another location's numbers under this location's heading. Age is
   capped for the show-instantly path; offline we accept any age (the stale badge says how
   old) but never the wrong place. */
export function wxCacheFor(key, ll, maxAgeMs) {
  const c = readJSON(key, null);
  if (!c || c.lat == null || c.lng == null) return null;
  if (Math.abs(c.lat - ll.lat) > 0.25 || Math.abs(c.lng - ll.lng) > 0.25) return null;  // ~25 km
  if (maxAgeMs && c.ts && (Date.now() - c.ts) > maxAgeMs) return null;
  return c;
}

/* A storage write that fails (quota, private mode) must not undo a render that already
   succeeded — it used to throw inside the try and replace good numbers with the error state. */
function wxSave(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch (e) { return false; }
}

function locText(prefix, ll) {
  return prefix + formatCoord(ll.lat, 'lat') + ' ' + formatCoord(ll.lng, 'lon');
}

export async function loadNow24() {
  const map = getMap();
  const ll = GPS.lastLatLng || (map ? map.getCenter() : null);
  if (!ll) return;
  const atBoat = !!GPS.lastLatLng;
  setNow({ locLabel: locText(atBoat ? 'At your position — ' : 'At map center — ', ll), atBoat });

  if (WX._loadingNow) return;   // dedupe: ignore rapid re-opens while a fetch is in flight

  // Cache-first: paint the last saved forecast instantly (with its "saved X ago" badge) so
  // the panel is never blank, then refresh over it if we're online.
  let cached = wxCacheFor('fishapp.lastwx', ll, navigator.onLine ? 12 * 3600000 : null);
  /* A cache written by an older build can be missing a field this renderer reads.
     That threw here — outside every try, before _loadingNow was even set — so the
     refresh never ran and, offline (where the age cap is disabled), the poisoned
     payload never expired. The panel stayed dead until storage was cleared. */
  if (cached) {
    try { renderWeather(cached); }
    catch (e) { try { localStorage.removeItem('fishapp.lastwx'); } catch (e2) {} cached = null; }
  }

  if (!navigator.onLine) {
    if (!cached) setNow({ status: 'offline', current: null, hours: [], ts: 0 });
    return;
  }
  if (!cached) setNow({ status: 'loading', current: null, hours: [], ts: 0 });

  WX._loadingNow = true;
  setNow({ refreshing: true });
  try {
    const common = 'latitude=' + ll.lat.toFixed(3) + '&longitude=' + ll.lng.toFixed(3) +
      '&timezone=auto&forecast_days=2';
    const [wx, marine] = await Promise.all([
      fetch('https://api.open-meteo.com/v1/forecast?' + common +
        '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m' +
        '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation_probability' +
        '&wind_speed_unit=kn&temperature_unit=fahrenheit').then((r) => r.ok ? r.json() : null),
      fetch('https://marine-api.open-meteo.com/v1/marine?' + common +
        '&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period' +
        '&hourly=wave_height,wave_period').then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!wx || wx.error || !wx.current) throw new Error('forecast unavailable');
    if (!wx.hourly || !wx.hourly.time) throw new Error('forecast incomplete');
    const data = { wx, marine: marine && !marine.error ? marine : null, ts: Date.now(), lat: ll.lat, lng: ll.lng };
    renderWeather(data);                          // render BEFORE caching, so a bad payload never sticks
    wxSave('fishapp.lastwx', data);
    if (atBoat) refreshBoatWater(true);           // current conditions loaded for the boat: refresh the HUD water temp
  } catch (e) {
    // Keep the cached view if we have one; only show an error when there's nothing to show.
    if (!cached) setNow({ status: 'error', current: null, hours: [], ts: 0 });
    else setNow({ refreshFailed: true });
  } finally {
    WX._loadingNow = false;
    setNow({ refreshing: false });
  }
}

/* Missing marine data must read as missing. Math.round(null) is 0 and
   windColor(null) returns the calm-air blue, so an absent gust figure used to
   display as a confident "GUSTS 0 kn" in the same colour as a flat day — and
   Math.round(undefined) is NaN, which windColor rendered in stay-home red.
   On the water, "unknown" shown as a number is the dangerous default. */
export function wxNum(v, unit, digits) {
  if (v == null || !isFinite(v)) return '—';
  return (digits ? Number(v).toFixed(digits) : Math.round(v)) + (unit || '');
}
/** Same rule for the view model: a rounded number, or null (rendered as a dash) — never 0 for unknown. */
export function wxRound(v) {
  if (v == null || !isFinite(v)) return null;
  return Math.round(Number(v));
}
/** A finite number or null. */
export function wxVal(v) {
  if (v == null || !isFinite(v)) return null;
  return Number(v);
}
export function dirArrow(deg) {
  // arrow showing where the wind blows TOWARD
  if (deg == null || !isFinite(deg)) return '';
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round(((deg % 360) / 45)) % 8];
}
export function compass(deg) {
  if (deg == null || !isFinite(deg)) return '—';
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round(((deg % 360) / 45)) % 8];
}

/** Current conditions + the next 24 hours as plain data (replaces the legacy card/row HTML).
 *  Throws on a structurally broken payload — the callers' poisoned-cache guards rely on that.
 *  @returns {{ current: WxCurrent, hours: WxHour[] }} */
export function nowView(data) {
  const c = data.wx.current;
  const mc = data.marine && data.marine.current;

  const windKn = wxRound(c.wind_speed_10m);
  const gustKn = wxRound(c.wind_gusts_10m);
  /** @type {WxCurrent} */
  const current = {
    windKn,
    windFromDeg: wxVal(c.wind_direction_10m),
    gustKn,
    tempF: wxRound(c.temperature_2m),
    waveFt: null, wavePerS: null, waveFromDeg: null,
    swellFt: null, swellPerS: null, swellFromDeg: null,
    hasMarine: !!mc,
    rainPctNow: null, maxWind24: null, maxGust24: null,
    ...windCues(windKn, gustKn),
  };
  if (mc && mc.wave_height != null && isFinite(mc.wave_height)) {
    // period/direction are separately nullable — don't invent "@ 0s N"
    current.waveFt = mc.wave_height * MS_TO_FT;
    current.wavePerS = mc.wave_period != null ? wxRound(mc.wave_period) : null;
    current.waveFromDeg = mc.wave_direction != null ? wxVal(mc.wave_direction) : null;
  }
  if (mc && mc.swell_wave_height != null && isFinite(mc.swell_wave_height)) {
    current.swellFt = mc.swell_wave_height * MS_TO_FT;
    current.swellPerS = mc.swell_wave_period != null ? wxRound(mc.swell_wave_period) : null;
    current.swellFromDeg = mc.swell_wave_direction != null ? wxVal(mc.swell_wave_direction) : null;
  }

  /* Hourly: next 24 h from now */
  const h = data.wx.hourly;
  const mh = data.marine && data.marine.hourly;
  const now = Date.now();
  /** @type {WxHour[]} */
  const hours = [];
  for (let i = 0; i < h.time.length && hours.length < 24; i++) {
    const t = new Date(h.time[i]).getTime();
    if (t < now - 3600000) continue;
    const hr = new Date(t).toLocaleTimeString([], { hour: 'numeric' });
    const kn = h.wind_speed_10m ? h.wind_speed_10m[i] : null;
    let wave = null;
    /* Match the marine reading to this row's TIME, not its array position. The two
       APIs snap to their own grids and resolve timezone=auto independently, so a
       shared index could pin one hour's swell to a different hour's wind — with no
       visible symptom. fc3hStrip and renderForecast10 already do it this way. */
    if (mh && mh.time && mh.wave_height) {
      const mi = fcHourIdx(mh.time, h.time[i]);
      if (mi >= 0 && mh.wave_height[mi] != null) wave = mh.wave_height[mi] * MS_TO_FT;
    }
    const rain = h.precipitation_probability ? h.precipitation_probability[i] : null;
    const gust = h.wind_gusts_10m ? h.wind_gusts_10m[i] : null;
    const windKn = wxRound(kn), gustKn = wxRound(gust);
    hours.push({
      key: h.time[i],
      label: hr,
      windKn,
      windFromDeg: wxVal(h.wind_direction_10m ? h.wind_direction_10m[i] : null),
      gustKn,
      waveFt: wxVal(wave),
      rainPct: wxRound(rain),
      tempF: wxRound(h.temperature_2m ? h.temperature_2m[i] : null),
      ...windCues(windKn, gustKn),
    });
  }
  if (hours.length) {
    current.rainPctNow = hours[0].rainPct;
    const winds = hours.map((x) => x.windKn).filter((v) => v != null);
    const gusts = hours.map((x) => x.gustKn).filter((v) => v != null);
    current.maxWind24 = winds.length ? Math.max(...winds) : null;
    current.maxGust24 = gusts.length ? Math.max(...gusts) : null;
  }
  return { current, hours };
}

export function renderWeather(data) {
  const v = nowView(data);
  setNow({ status: 'ready', current: v.current, hours: v.hours, ts: data.ts || 0, refreshFailed: false });
}

/* "(offline)" was hardcoded, so an online user with a 40-minute-old cache was told
   they were offline for the second before the refresh landed. Ages past a couple of
   days also read as "58 hours".
   "— refreshing…" is said only while a refresh is actually in flight (the store's `refreshing`):
   the label now re-renders on reconnect and every 30 s, so deriving it from navigator.onLine
   alone claimed a refresh for minutes when none was running. */
export function wxAgeLabel(ts, freshText, refreshFailed, refreshing) {
  const ageMin = Math.round((Date.now() - ts) / 60000);
  if (ageMin <= 10) return freshText;
  const age = ageMin > 2880 ? Math.round(ageMin / 1440) + ' days'
    : ageMin > 120 ? Math.round(ageMin / 60) + ' hours'
    : ageMin + ' min';
  return 'Saved forecast from ' + age + ' ago' +
    (navigator.onLine
      ? (refreshing ? ' — refreshing…' : refreshFailed ? ' — couldn’t refresh' : '')
      : ' (offline)');
}
/** The stale badge applies (same 10-minute threshold as wxAgeLabel). */
export function wxIsStale(ts) {
  return Math.round((Date.now() - ts) / 60000) > 10;
}

/* ---- 10-Day marine forecast tab ---- */
/* [icon, description]. The icon is a line-icon name (src/ui Icon) — the legacy emoji are gone. */
export function wmoIcon(c) {
  if (c === 0) return ['sun', 'Clear'];
  if (c === 1 || c === 2) return ['cloud-sun', 'Mostly clear'];
  if (c === 3) return ['cloud', 'Overcast'];
  if (c === 45 || c === 48) return ['cloud-fog', 'Fog'];
  if (c >= 51 && c <= 57) return ['cloud-drizzle', 'Drizzle'];
  if (c >= 61 && c <= 67) return ['cloud-rain', 'Rain'];
  if (c >= 71 && c <= 77) return ['cloud-snow', 'Snow'];
  if (c >= 80 && c <= 82) return ['cloud-sun-rain', 'Showers'];
  if (c >= 85 && c <= 86) return ['cloud-snow', 'Snow showers'];
  if (c >= 95) return ['cloud-lightning', 'Thunderstorm'];
  return ['cloud-sun', 'Partly cloudy'];
}
export function fcHourIdx(times, target) { return times ? times.indexOf(target) : -1; }

/* Where the boat's 10-day lives vs. a tapped area's. bite.js (bite windows) and the spoken
   conditions watch read FC10_KEY for the boat's location; an area forecast used to overwrite
   it, which switched both off for HERE until a local reload. */
export const FC10_KEY = 'fishapp.fc10';
export const FC10_AREA_KEY = 'fishapp.fc10area';

/* Rough-day flag in the 10-day list (alert triangle + bold, never colour alone). */
export const ROUGH_WIND_KN = 20;
export const ROUGH_WAVE_FT = 5;

export async function loadForecast10(override) {
  const map = getMap();
  const area = override || WX._fcLoc;
  const ll = area || GPS.lastLatLng || (map ? map.getCenter() : null);
  if (!ll) return;
  const forArea = !!area;
  const cacheKey = forArea ? FC10_AREA_KEY : FC10_KEY;
  const target = forArea ? 'area:' + Number(ll.lat).toFixed(4) + ',' + Number(ll.lng).toFixed(4) : 'here';
  /* Switching between "here" and a tapped area must never leave the other place's days on
     screen under this place's heading while the new ones load. */
  const switched = WX._fcTarget !== target;
  if (switched) setFc({ status: 'loading', days: [], ts: 0, refreshFailed: false });
  WX._fcTarget = target;
  setFc({
    locLabel: locText(forArea ? 'For this area — ' : (GPS.lastLatLng ? 'At your position — ' : 'At map center — '), ll),
    forArea,
    area: forArea ? { lat: ll.lat, lng: ll.lng } : null,
    hereAtBoat: !!GPS.lastLatLng,
    // the spinner describes THIS place's load (another place's load may still be in flight)
    refreshing: WX._fcLoading.has(target),
  });

  if (WX._fcLoading.has(target)) {
    /* Dedupe rapid re-opens. But if we just switched back to a place whose load is still in
       flight (here → area → "Back to my position"), the switch above wiped the view: paint
       this place's saved copy again, or the spinner could sit there for good. The in-flight
       load renders over it, or reports its failure against whatever is on screen. */
    if (switched) fc10PaintCache(cacheKey, ll);
    return;
  }

  // Cache-first: show the saved 10-day instantly, then refresh over it if online.
  const cached = fc10PaintCache(cacheKey, ll);

  if (!navigator.onLine) {
    if (!cached) setFc({ status: 'offline', days: [], ts: 0 });
    return;
  }
  if (!cached) setFc({ status: 'loading', days: [], ts: 0 });

  WX._fcLoading.add(target);
  WX._loadingFc = true;
  setFc({ refreshing: true });
  try {
    const base = 'latitude=' + ll.lat.toFixed(3) + '&longitude=' + ll.lng.toFixed(3) + '&timezone=auto';
    const [wx, marine] = await Promise.all([
      fetch('https://api.open-meteo.com/v1/forecast?' + base + '&forecast_days=10' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset,uv_index_max' +
        // pressure_msl + cloud_cover are here for the bite engine (bite.js), which scores
        // future hours on the same dimensions the catch log records.
        '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover' +
        '&wind_speed_unit=kn&temperature_unit=fahrenheit&precipitation_unit=inch').then((r) => r.ok ? r.json() : null),
      fetch('https://marine-api.open-meteo.com/v1/marine?' + base + '&forecast_days=8' +
        '&daily=wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,swell_wave_period_max' +
        '&hourly=wave_height,sea_surface_temperature&temperature_unit=fahrenheit').then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    // Validate hourly too — the bite engine reads it, and a payload with `daily` but
    // no usable `hourly` used to get cached and then break every later render.
    if (!wx || wx.error || !wx.daily || !wx.daily.time) throw new Error('forecast unavailable');
    if (!wx.hourly || !wx.hourly.time || !wx.hourly.time.length) throw new Error('forecast incomplete');
    const data = { wx, marine: marine && !marine.error ? marine : null, ts: Date.now(), lat: ll.lat, lng: ll.lng };
    // render BEFORE caching, so a bad payload never sticks. If the panel has moved on to
    // another place meanwhile, still validate (build the view) but don't put it on screen.
    if (WX._fcTarget === target) renderForecast10(data);
    else forecast10View(data);
    wxSave(cacheKey, data);
    WX._fc10loaded = true;
  } catch (e) {
    /* Clear the latch so the tab keeps working. It was set optimistically before the
       load, so one failure (offline, no cache) made the 10-Day tab inert for the rest
       of the session — tapping between tabs did nothing until the panel was closed. */
    if (WX._fcTarget === target) {
      WX._fc10loaded = false;
      /* Decide from what is ON SCREEN now, not from this call's `cached`: switching away and
         back wiped the view, and "a copy was painted when this load started" then left the
         loading spinner up forever with nothing under it. */
      if (wxStore.getState().fc10.status !== 'ready') setFc({ status: 'error', days: [], ts: 0 });
      else setFc({ refreshFailed: true });
    }
  } finally {
    WX._fcLoading.delete(target);
    WX._loadingFc = WX._fcLoading.size > 0;
    // always: the place on screen may have changed while this loaded, and its spinner must still clear
    setFc({ refreshing: WX._fcLoading.has(WX._fcTarget) });
  }
}

/* Paint a place's saved 10-day if there is one for it (age-capped online, any age offline).
   Returns the payload, or null. Same poisoned-cache guard as loadNow24 — see the note there. */
function fc10PaintCache(cacheKey, ll) {
  let cached = wxCacheFor(cacheKey, ll, navigator.onLine ? 12 * 3600000 : null);
  if (cached) {
    try { renderForecast10(cached); }
    catch (e) { try { localStorage.removeItem(cacheKey); } catch (e2) {} cached = null; }
  }
  return cached;
}

/** The 10-day list as plain data. Throws on a structurally broken payload (poisoned-cache guard).
 *  @returns {WxDay[]} */
export function forecast10View(data) {
  const d = data.wx.daily;
  const md = data.marine && data.marine.daily;
  const hh = data.wx.hourly;
  const mh = data.marine && data.marine.hourly;
  /** @type {WxDay[]} */
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < d.time.length; i++) {
    const date = new Date(d.time[i] + 'T12:00');
    /* Label from the ACTUAL date, never the array index. A cached payload can be a day or
       more old, and index-based labels would stamp "Today" on stale data and shift every
       weekday after it. Days already past are dropped outright. */
    const dayOut = Math.round((new Date(d.time[i] + 'T00:00').getTime() - today.getTime()) / 86400000);
    if (dayOut < 0) continue;
    /* Short weekday + an always-legible date: a 10-day list contains TWO of most weekdays,
       so "Tuesday" alone is ambiguous — which is how a day-9 reading gets mistaken for the
       one coming up in two days. */
    const wd = dayOut === 0 ? 'Today' : (dayOut === 1 ? 'Tomorrow' : date.toLocaleDateString([], { weekday: 'short' }));
    const md2 = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const longRange = dayOut >= 7;   // beyond ~a week these are model trends, not numbers
    const [icon, desc] = wmoIcon(d.weather_code[i]);
    /* wxRound, not Math.round: a missing value is unknown (a dash), never "0 kn" or "0°". */
    const windMax = wxRound(d.wind_speed_10m_max[i]);
    const gust = wxRound(d.wind_gusts_10m_max[i]);
    const wdirDeg = wxVal(d.wind_direction_10m_dominant[i]);
    const wdir = compass(wdirDeg);
    const hi = wxRound(d.temperature_2m_max[i]);
    const lo = wxRound(d.temperature_2m_min[i]);
    const pop = d.precipitation_probability_max ? wxRound(d.precipitation_probability_max[i]) : null;
    const rainSum = d.precipitation_sum ? wxVal(d.precipitation_sum[i]) : null;

    let waveFt = null, wavePer = null, waveDir = '', swellFt = null, swellPer = null;
    /* Daily marine arrays are matched by DATE (the two APIs return different day counts and
       can start on different days), falling back to the shared index only when the marine
       payload carries no day list. */
    const mi = md ? (md.time ? fcHourIdx(md.time, d.time[i]) : i) : -1;
    if (md && mi >= 0 && md.wave_height_max && md.wave_height_max[mi] != null) {
      waveFt = md.wave_height_max[mi] * MS_TO_FT;
      wavePer = md.wave_period_max ? wxRound(md.wave_period_max[mi]) : null;
      waveDir = md.wave_direction_dominant && md.wave_direction_dominant[mi] != null ? compass(md.wave_direction_dominant[mi]) : '';
    }
    if (md && mi >= 0 && md.swell_wave_height_max && md.swell_wave_height_max[mi] != null) {
      swellFt = md.swell_wave_height_max[mi] * MS_TO_FT;
      swellPer = md.swell_wave_period_max ? wxRound(md.swell_wave_period_max[mi]) : null;
    }
    let sst = null;
    if (mh && mh.sea_surface_temperature) {
      const si = fcHourIdx(mh.time, d.time[i] + 'T12:00');
      if (si >= 0 && mh.sea_surface_temperature[si] != null) sst = wxRound(mh.sea_surface_temperature[si]);
    }
    const uv = d.uv_index_max && d.uv_index_max[i] != null ? wxRound(d.uv_index_max[i]) : null;
    const sr = d.sunrise && d.sunrise[i] ? new Date(d.sunrise[i]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const ss = d.sunset && d.sunset[i] ? new Date(d.sunset[i]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const rough = (windMax != null && windMax >= ROUGH_WIND_KN) || (waveFt != null && waveFt >= ROUGH_WAVE_FT);

    days.push({
      key: d.time[i], wd, md2, dayOut, longRange, icon, desc,
      hi, lo, windMax, gust, wdir, wdirDeg,
      waveFt, wavePer, waveDir, swellFt, swellPer,
      pop, rainSum, sst, uv, sunrise: sr, sunset: ss, rough,
      strip: fc3hStrip(hh, mh, d.time[i]),
    });
  }
  return days;
}

export function renderForecast10(data) {
  const days = forecast10View(data);
  setFc({ status: 'ready', days, ts: data.ts || 0, refreshFailed: false });
}

/* The long-range caveat, verbatim from the legacy detail row. */
export function longRangeNote(dayOut) {
  return '~ ' + dayOut + ' days out — long-range model output. Treat this as a trend, not a temperature; it typically shifts several degrees per day as the date nears.';
}

/** The 3-hourly breakdown for one day (00, 03, 06 … local), as rows of plain data.
 *  @returns {WxHour[]} */
export function fc3hStrip(hh, mh, dayStr) {
  if (!hh || !hh.time) return [];
  /** @type {WxHour[]} */
  const rows = [];
  for (let i = 0; i < hh.time.length; i++) {
    if (hh.time[i].slice(0, 10) !== dayStr) continue;
    if (parseInt(hh.time[i].slice(11, 13), 10) % 3 !== 0) continue;
    const hr = new Date(hh.time[i]).toLocaleTimeString([], { hour: 'numeric' });
    const kn = wxRound(hh.wind_speed_10m[i]);
    let wave = null;
    if (mh && mh.wave_height) {
      const mi = fcHourIdx(mh.time, hh.time[i]);
      if (mi >= 0 && mh.wave_height[mi] != null) wave = mh.wave_height[mi] * MS_TO_FT;
    }
    const rain = hh.precipitation_probability ? hh.precipitation_probability[i] : null;
    const gustKn = wxRound(hh.wind_gusts_10m[i]);
    rows.push({
      key: hh.time[i],
      label: hr,
      windKn: kn,
      windFromDeg: wxVal(hh.wind_direction_10m[i]),
      gustKn,
      waveFt: wxVal(wave),
      rainPct: wxRound(rain),
      tempF: wxRound(hh.temperature_2m[i]),
      ...windCues(kn, gustKn),
    });
  }
  return rows;
}

/* ---- HUD water temperature near the boat (conditionsStore) ------------------------------- */
export const WATER_REFRESH_MS = 20 * 60000;   // re-sample at most this often while sitting still…
export const WATER_MOVE_NM = 3;               // …or once the boat has moved this far from the last sample
export const WATER_MIN_GAP_MS = 2 * 60000;    // and never more than once per two minutes

/* Privacy (App Store "Precise Location shared with a third party"): the boat's position may
   only leave the device because of something the user is doing. Legacy only ever sent it to
   Open-Meteo on a user action (opening the Weather panel, tapping the map, switching on an
   overlay). So the automatic, GPS-driven re-sample runs only while a weather feature that
   already sends this area to Open-Meteo is in use: the Weather panel is open, or the wind or
   SST overlay is on. Otherwise the HUD keeps the sample taken when the panel last loaded at the
   boat (refreshBoatWater(true) from loadNow24) until its 6 h / 10 nm guard hides it. */
export function boatWaterAutoAllowed() {
  return !!(WX.overlayOn || SST.on || isPanelOpen('weather'));
}

/* Open-Meteo marine current SST (°F) at the boat. One tiny request, throttled hard; failures
   leave the last value in place (the HUD hides it once it is 6 h old or 10 nm away). */
export function refreshBoatWater(force) {
  const ll = GPS.lastLatLng;
  if (!ll || !navigator.onLine || WX._waterBusy) return false;
  const now = Date.now();
  const since = now - (WX._waterAt || 0);
  if (since < WATER_MIN_GAP_MS) return false;
  if (!force) {
    if (!boatWaterAutoAllowed()) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    let moved = Infinity;
    try { moved = WX._waterLL ? nmBetween(WX._waterLL, ll) : Infinity; } catch (e) {}
    if (since < WATER_REFRESH_MS && moved < WATER_MOVE_NM) return false;
  }
  WX._waterBusy = true;
  WX._waterAt = now;
  const at = L.latLng(ll.lat, ll.lng);
  WX._waterLL = at;
  fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + at.lat.toFixed(3) +
    '&longitude=' + at.lng.toFixed(3) + '&current=sea_surface_temperature&temperature_unit=fahrenheit')
    .then((r) => r.ok ? r.json() : null)
    .then((d) => {
      const v = d && !d.error && d.current ? d.current.sea_surface_temperature : null;
      if (v != null && isFinite(v)) conditionsStore.setState({ waterF: Number(v), at: Date.now(), lat: at.lat, lng: at.lng });
    })
    .catch(() => {})
    .finally(() => { WX._waterBusy = false; });
  return true;
}
