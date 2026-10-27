import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { getMap } from './app.js';
import { refuseDataOverlay } from './sst.js';
import { toast } from '../services/ui';

/* Animated rain radar — NOAA nowCOAST MRMS base reflectivity. Public domain (the capabilities
   list Fees NONE, AccessConstraints NONE), CORS-ok, a WMS with a TIME dimension: the service
   keeps the last ~6.5 hours of mosaics, a new one about every 4 minutes. The loop takes the last
   2 hours at ~10-minute steps and cycles them like a video.

   Live only: plain Leaflet WMS layers — never the IndexedDB tile cache (tiles.js) and never an
   offline download; the browser's own HTTP cache (max-age 240) is all a frame gets. Kept light
   on NOAA: only the frame on screen loads until Play preloads the loop, 512 px tiles (a quarter
   of the requests), nothing outside the radar's coverage, nothing deeper than z9 (MRMS is ~1 km,
   already ~4 px a cell at z9; closer in, z9 is upscaled).

   It replaced RainViewer, which serves nothing above z7 since 2026-01-01 and limits use to
   personal and small-scale projects (docs/launch/data-sources.md). */
'use strict';

export const RADAR_WMS = 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms';
export const RADAR_LAYER = 'conus_base_reflectivity_mosaic';
/* The layer's own capabilities (GeoServer virtual service): ~10 KB, against ~33 KB for the whole
   radar workspace (Alaska, Hawaii, Caribbean and Guam mosaics too). */
export const RADAR_CAPS_URL = 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/' +
  RADAR_LAYER + '/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities';
/* The layer's extent (EX_GeographicBoundingBox): the lower 48 and their coastal waters. */
export const RADAR_BOUNDS = [[20, -130], [55, -60]];
export const RADAR_LOOP_MIN = 120;
export const RADAR_STEP_MIN = 10;
export const RADAR_MAX_NATIVE_ZOOM = 9;
export const RADAR_REFRESH_MS = 5 * 60 * 1000;
const RADAR_PRELOAD_MS = 10000;   // Play starts the loop by then even if a frame is still loading
const RADAR_OPACITY = 0.75;
const RADAR_CREDIT = 'Radar: <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA nowCOAST</a> (MRMS)';

export const Rain = {
  on: false,
  frames: [],       // [{ time (ms), layer }] oldest -> newest; a layer goes on the map when first needed
  idx: 0,
  playing: false,
  timer: null,
  _refreshTimer: null,
  _preloadTimer: null,
  _preload: 0,      // bumps on every Play / Stop; a stale preload continuation checks it and bails
  _checkedAt: 0,    // last time the frame list was read
  _gen: 0,          // bumps on every enable/disable; a stale async continuation checks it and bails
};

export const RAIN_FRAME_MS = 500;

/* Loop scrubber state for features/weather/MapLegends (replaces #rain-bar / #rain-play /
   #rain-scrub / #rain-time). `outside`: the view is beyond the radar's coverage. */
/**
 * @typedef {{ on: boolean, loading: boolean, frameCount: number, idx: number, playing: boolean,
 *   loadingLoop: boolean, timeLabel: string, outside: boolean }} RainView
 */
/** @type {import('zustand/vanilla').StoreApi<RainView>} */
export const rainStore = createStore(() => /** @type {RainView} */ ({
  on: false, loading: false, frameCount: 0, idx: 0, playing: false, loadingLoop: false, timeLabel: '', outside: false,
}));

/** ISO 8601 duration "PT4M" / "PT1H" / "PT30S" in ms (0 when unreadable). */
function isoPeriodMs(p) {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(p).trim());
  if (!m) return 0;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

/** The radar layer's TIME values (ms, ascending) from a WMS 1.3.0 capabilities document. nowCOAST
 *  lists every mosaic ("2026-10-27T00:32:17.000Z,…"); a GeoServer interval ("start/end/PT4M") is
 *  expanded too, at the radar step when it gives no period. The server snaps any TIME to the
 *  nearest mosaic (nearestValue="1"), so an expanded time still finds a frame. */
export function parseRadarTimes(xml, layer = RADAR_LAYER) {
  if (typeof xml !== 'string') return [];
  const at = xml.indexOf('<Name>' + layer + '</Name>');
  const m = /<Dimension\b[^>]*\bname="time"[^>]*>([^<]*)<\/Dimension>/i.exec(at >= 0 ? xml.slice(at) : xml);
  if (!m) return [];
  const out = [];
  m[1].split(',').forEach((v) => {
    const p = v.trim().split('/');
    if (p.length === 3) {
      const a = Date.parse(p[0]), b = Date.parse(p[1]);
      const step = isoPeriodMs(p[2]) || RADAR_STEP_MIN * 60000;
      if (Number.isFinite(a) && Number.isFinite(b)) for (let t = b; t >= a && out.length < 1000; t -= step) out.push(t);
    } else {
      const t = Date.parse(p[0]);
      if (Number.isFinite(t)) out.push(t);
    }
  });
  return Array.from(new Set(out)).sort((x, y) => x - y);
}

/** The loop's frames (ms, oldest -> newest): the newest mosaic, then the mosaic nearest each
 *  `stepMin` mark of the clock (:00, :10, :20 …) over the `loopMin` minutes before it — 13
 *  frames for 2 hours at 10 minutes. Marks on the clock rather than steps back from the newest
 *  keep the picks the same from one refresh to the next, so a refresh only loads the new frames.
 *  A mark with no mosaic within half a step (an outage) is skipped; the label shows each frame's
 *  real time. */
export function pickRadarFrames(times, loopMin = RADAR_LOOP_MIN, stepMin = RADAR_STEP_MIN) {
  const all = (times || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!all.length) return [];
  const newest = all[all.length - 1];
  const step = stepMin * 60000, half = step / 2;
  const out = [newest];
  // the marks at least half a step older than the newest mosaic, loopMin / stepMin of them
  for (let mark = Math.floor((newest - half) / step) * step; mark > newest - half - loopMin * 60000; mark -= step) {
    const older = out[out.length - 1];
    let best = null;
    for (const t of all) {
      if (t >= older) break;
      if (Math.abs(t - mark) < half && (best == null || Math.abs(t - mark) < Math.abs(best - mark))) best = t;
    }
    if (best != null) out.push(best);
  }
  return out.reverse();
}

/** One loop frame: nowCOAST's WMS at that mosaic's exact TIME. */
export function radarLayer(time) {
  return L.tileLayer.wms(RADAR_WMS, {
    layers: RADAR_LAYER, styles: '', format: 'image/png', transparent: true, version: '1.1.1',
    time: new Date(time).toISOString(),   // "2026-10-27T00:32:17.000Z", as the capabilities list it
    uppercase: true,
    tileSize: 512, maxNativeZoom: RADAR_MAX_NATIVE_ZOOM, maxZoom: 20,
    bounds: RADAR_BOUNDS, updateWhenIdle: true, keepBuffer: 1,
    opacity: 0, zIndex: 4, className: 'rain-tiles', attribution: RADAR_CREDIT,
  });
}

/** Does the map view overlap the radar's coverage? (true when it cannot tell) */
export function radarCoversView(map) {
  const b = map && map.getBounds ? map.getBounds() : null;
  return !b || L.latLngBounds(RADAR_BOUNDS).intersects(b);
}

function addFrame(f) {
  const map = getMap();
  if (map && !map.hasLayer(f.layer)) f.layer.addTo(map);
}

function dropFrame(f) {
  const map = getMap();
  if (map) map.removeLayer(f.layer);
}

/* Paused: a pan or zoom would reload every frame put on the map by an earlier Play, for a loop
   nobody is watching. Keep only the frame on screen; Play preloads the rest again. */
function onMoveStart() {
  if (!Rain.on || Rain.playing) return;
  Rain.frames.forEach((f, j) => { if (j !== Rain.idx) dropFrame(f); });
}

function onMoveEnd() {
  if (Rain.on) rainStore.setState({ outside: !radarCoversView(getMap()) });
}

function onVisible() {
  if (document.visibilityState === 'visible' && Date.now() - Rain._checkedAt > 60000) void rainRefresh();
}

function watch(on) {
  const map = getMap();
  if (map && map.off) { map.off('movestart', onMoveStart); map.off('moveend', onMoveEnd); }
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(Rain._refreshTimer);
  Rain._refreshTimer = null;
  if (!on) return;
  if (map) { map.on('movestart', onMoveStart); map.on('moveend', onMoveEnd); }
  document.addEventListener('visibilitychange', onVisible);
  Rain._refreshTimer = setInterval(() => { void rainRefresh(); }, RADAR_REFRESH_MS);
}

/* Swap in a new frame list. A frame whose time is unchanged keeps its layer (and its loaded
   tiles); the rest come off the map. */
function setRainFrames(times) {
  const keep = new Map(Rain.frames.map((f) => [f.time, f]));
  const frames = times.map((t) => keep.get(t) || { time: t, layer: radarLayer(t) });
  Rain.frames.forEach((f) => { if (frames.indexOf(f) < 0) dropFrame(f); });
  Rain.frames = frames;
}

/** Read the frame list: the radar layer's capabilities -> the loop's times (ms). Throws offline. */
async function fetchRadarTimes() {
  const r = await fetch(RADAR_CAPS_URL);
  if (!r.ok) throw new Error('radar capabilities HTTP ' + r.status);
  const xml = await r.text();
  Rain._checkedAt = Date.now();
  return pickRadarFrames(parseRadarTimes(xml));
}

export async function rainEnable(on) {
  Rain.on = on;
  const gen = ++Rain._gen;
  if (on) {
    if (!navigator.onLine) {
      toast('Rain radar needs internet');
      /* Legacy unticked the box but left Rain.on = true. Refuse completely: module state off
         and the Layers toggle corrected without re-running the enabler — and without
         rewriting the saved choice, so rain radar comes back on the next launch with signal
         (legacy only unticked the box; see refuseDataOverlay in sst.js). */
      Rain.on = false;
      refuseDataOverlay('rain');
      rainStore.setState({ on: false, loading: false });
      return;
    }
    rainStore.setState({ on: true, loading: true, outside: !radarCoversView(getMap()) });
    await buildRainFrames(gen);
    /* The user may have switched rain off (or off and on again) while the frame list loaded.
       Only the newest enable may show anything — legacy re-showed the bar and radar here. */
    if (gen !== Rain._gen || !Rain.on) return;
    rainStore.setState({ loading: false });
    if (Rain.frames.length) showRainFrame(Rain.frames.length - 1); // latest, static
    rainStop();
    watch(true);
  } else {
    watch(false);
    rainStop();
    Rain.frames.forEach(dropFrame);
    Rain.frames = [];
    rainStore.setState({ on: false, loading: false, frameCount: 0, idx: 0, playing: false, loadingLoop: false, timeLabel: '', outside: false });
  }
}

export async function buildRainFrames(gen) {
  Rain.frames.forEach(dropFrame);
  Rain.frames = [];
  rainStop();
  try {
    const times = await fetchRadarTimes();
    if (gen != null && (gen !== Rain._gen || !Rain.on)) return;   // superseded while loading: add nothing
    setRainFrames(times);
    if (!Rain.frames.length) toast('No radar frames available right now');
    // scrubber: max = frames - 1, parked on the newest frame
    rainStore.setState({ frameCount: Rain.frames.length, idx: Math.max(0, Rain.frames.length - 1) });
  } catch (e) {
    if (gen != null && gen !== Rain._gen) return;
    toast('Could not load rain radar');
  }
}

/* A new mosaic lands about every 4 minutes. While the radar is on — and the app is in view,
   online, and not preloading a loop — re-read the frame list now and then: the loop moves on
   to the newest frames, and only those load. A failed read keeps what is on screen. */
export async function rainRefresh() {
  if (!Rain.on || !navigator.onLine || document.visibilityState === 'hidden' || rainStore.getState().loadingLoop) return;
  const gen = Rain._gen;
  let times;
  try { times = await fetchRadarTimes(); } catch (e) { return; }
  if (gen !== Rain._gen || !Rain.on || !times.length || rainStore.getState().loadingLoop) return;
  const last = Rain.frames[Rain.frames.length - 1];
  if (last && last.time === times[times.length - 1]) return;   // nothing new
  const shown = Rain.frames[Rain.idx];
  const atNewest = !shown || shown === last;
  setRainFrames(times);
  let i = Rain.frames.length - 1;
  if (Rain.playing) {
    Rain.frames.forEach(addFrame);   // the running loop keeps every frame loaded
    i = Math.min(Rain.idx, i);
  } else if (!atNewest) {
    // scrubbed back to look at an earlier frame: stay on it while it is still in the loop
    const j = Rain.frames.findIndex((f) => f.time === shown.time);
    if (j >= 0) i = j;
  }
  showRainFrame(i);
}

/** "2:40 PM" — the mosaic's own time (frames are observed radar; nowCOAST has no forecast). */
export function rainFrameLabel(f) {
  return new Date(f.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function showRainFrame(i) {
  if (!Rain.frames.length) return;
  Rain.idx = ((i % Rain.frames.length) + Rain.frames.length) % Rain.frames.length;
  const f = Rain.frames[Rain.idx];
  addFrame(f);   // lazily: only the frame on screen loads until Play preloads the loop
  Rain.frames.forEach((g, j) => g.layer.setOpacity(j === Rain.idx ? RADAR_OPACITY : 0));
  rainStore.setState({ idx: Rain.idx, timeLabel: rainFrameLabel(f), frameCount: Rain.frames.length });
}

/* Drag the timeline: pause and jump to that radar frame */
export function rainScrub(v) {
  if (Rain.playing) rainStop();
  showRainFrame(parseInt(v, 10));
}

/* Put every frame on the map (invisible) and start cycling once they have all loaded, or after
   RADAR_PRELOAD_MS: a frame still loading would flash an empty map into the loop. Meanwhile the
   bar shows Pause and a spinner ("loadingLoop"), as the SST loop does. */
export function rainPlay() {
  if (Rain.frames.length < 2 || !navigator.onLine || !Rain.on) return;
  Rain.playing = true;
  const token = ++Rain._preload;
  updateRainBtn();
  const pending = Rain.frames.filter((f) => { addFrame(f); return f.layer.isLoading && f.layer.isLoading(); });
  let left = pending.length;
  let started = false;
  const start = () => {
    if (started || token !== Rain._preload || !Rain.playing) return;
    started = true;
    clearTimeout(Rain._preloadTimer);
    rainStore.setState({ loadingLoop: false });
    clearInterval(Rain.timer);
    Rain.timer = setInterval(() => showRainFrame(Rain.idx + 1), RAIN_FRAME_MS);
  };
  if (!left) { start(); return; }
  rainStore.setState({ loadingLoop: true });
  pending.forEach((f) => f.layer.once('load', () => { if (--left <= 0) start(); }));
  Rain._preloadTimer = setTimeout(start, RADAR_PRELOAD_MS);
}

export function rainStop() {
  Rain.playing = false;
  Rain._preload++;   // a loop still preloading never starts
  clearTimeout(Rain._preloadTimer);
  clearInterval(Rain.timer);
  Rain.timer = null;
  rainStore.setState({ loadingLoop: false });
  updateRainBtn();
  if (Rain.on && Rain.frames.length) showRainFrame(Rain.idx);
}

export function rainTogglePlay() { Rain.playing ? rainStop() : rainPlay(); }

export function updateRainBtn() {
  rainStore.setState({ playing: Rain.playing });
}
