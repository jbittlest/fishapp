import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { getMap } from './app.js';
import { reportDataOverlay } from './layers.js';
import { MUR_SST_ATTRIBUTION } from './datasources.js';
import { toast } from '../services/ui';
import {
  SST_MAX_Z, SST_NBINS, SST_PX, SstLatest, sstDayBefore, sstFineLut, sstHistAdd, sstKey, sstLut, sstMemGet,
  sstPaintUpsampled, sstPrune, sstRangeFromHist, sstResolveLatest, sstStopsFromGradient, sstTileData, sstTilesAround, sstLat2y, sstLon2x,
} from './sst-tiles.js';

/* Sea surface temperature overlay + multi-day time-lapse loop.
   Source: JPL MUR SST (~1 km, daily) as NASA GIBS tiles — see sst-tiles.js for why not ERDDAP any
   more, the colormap decode and the on-device store. Credited with the dataset's requested
   NASA/JPL acknowledgement (datasources.js).

   The overlay is a tile grid fixed to the map (z0..z7; past z7 Leaflet scales the z7 tiles up,
   smoothly), so panning inside an area already seen needs no network at all, and every tile URL is
   the same tomorrow — stored on the device, it is instant next time and offline. Each tile is
   decoded to temperatures once; colouring happens here, on a canvas, from a 216-entry lookup table:
   - the colour scale is STRETCHED to the water actually in view (10th-90th percentile of the MUR
     pixels on screen — the same data you are looking at, no second source), so 1-2 °F breaks show a
     big colour change; it is recomputed on every pan / zoom without any request;
   - a palette change, a new range, a loop frame are all just a repaint of the tiles on screen.
   Turning the layer on never blanks the map: tiles fade in over what is there, and Leaflet keeps
   the previous zoom's tiles until the new ones are painted. */
'use strict';

export const SST_PALETTES = ['BlueWhiteRed', 'Rainbow', 'Ocean', 'BlackRedWhite'];

/* Read at module load. Legacy read localStorage bare here, so a blocked storage (private mode,
   a locked-down WebView) threw while the script was still being parsed and took the overlay
   wiring down with it. An unknown saved name would also have been used as a palette. */
export function sstSavedPalette() {
  let p = null;
  try { p = localStorage.getItem('fishapp.sstpal'); } catch (e) {}
  return p && SST_PALETTES.indexOf(p) >= 0 ? p : 'BlueWhiteRed';
}

export const SST = {
  on: false,
  frames: /** @type {string[]} */ ([]),   // loop days, oldest -> newest (all decoded before playing)
  idx: 0,
  playing: false,
  timer: /** @type {any} */ (null),
  range: /** @type {number[]|null} */ (null),   // [minC, maxC] colour scale on screen (First Mate reads it)
  palette: sstSavedPalette(),
  latest: /** @type {string|null} */ (null),    // newest MUR day available
  shownDate: /** @type {string|null} */ (null), // the day the tiles on screen are painted with
  layer: /** @type {any} */ (null),
  _lut: /** @type {Uint32Array|null} */ (null),
  _fine: /** @type {Uint32Array|null} */ (null),
  _repaintTimer: /** @type {any} */ (null),
  _moveBound: false,
  _rangeTimer: /** @type {any} */ (null),
  _enableGen: 0,    // bumps on every enable/disable; stale async continuations bail on it
  _enabling: false, // an enable is still finding the newest day
  _loopGen: 0,      // bumps on every play/stop; a superseded loop preload bails on it
  _loopPending: false,
  _prefetchTimer: /** @type {any} */ (null),
};

/* Where layers.js persists the overlay choices (not exported there). Only refuseDataOverlay
   below touches it. */
const LAYERS_PREFS_KEY = 'fishapp.layers';

/* An overlay that cannot start (offline) must fix the visible toggle WITHOUT rewriting the
   saved choice. Legacy only unticked the checkbox and dispatched no change event, so the saved
   pref survived and the overlay came back on the next launch with signal (legacy/js/app.js
   252-266). reportDataOverlay() also persists, so replaying the saved overlays at an offline
   boot wiped "SST on" / "Rain on" for good. Until layers.js gains an unpersisted refusal
   (docs/requests/weather-overlays.md §7), put the saved prefs back exactly as they were.
   Used by rain.js too. */
export function refuseDataOverlay(id) {
  let saved = null, readable = false;
  try { saved = localStorage.getItem(LAYERS_PREFS_KEY); readable = true; } catch (e) {}
  reportDataOverlay(id, false);
  if (!readable) return;
  try {
    if (saved == null) localStorage.removeItem(LAYERS_PREFS_KEY);
    else localStorage.setItem(LAYERS_PREFS_KEY, saved);
  } catch (e) {}
}

/* Legend bar CSS gradient per palette (cold -> warm). The map is painted from THESE stops
   (sstStopsFromGradient), so the legend bar and the picture can never disagree. */
export const SST_PALETTE_BAR = {
  BlueWhiteRed: 'linear-gradient(to right,#1f6fe0,#8fc9e8,#f4f4f4,#f2a03d,#d81f1f)',
  Rainbow: 'linear-gradient(to right,#3b1c8c,#2b6fe0,#23c3d8,#37d46a,#e8e23d,#f2803d,#d81f1f)',
  Ocean: 'linear-gradient(to right,#123a59,#2e6f9e,#4a90c2,#89c0de,#d3ebf7)',
  BlackRedWhite: 'linear-gradient(to right,#4a0000,#a80f0f,#e81f1f,#f4a0a0,#ffe6e6)',
};
/* Names shown in the legend's palette picker (legacy <option> text, arrow kept as words). */
export const SST_PALETTE_LABELS = {
  BlueWhiteRed: 'Blue to red',
  Rainbow: 'Rainbow',
  Ocean: 'Blues',
  BlackRedWhite: 'Reds',
};

export const SST_LOOP_DAYS = 5;
export const SST_LAG_DAYS = 2;    // fallback only: the newest day is asked of GIBS (usually 1 day back)
export const SST_FRAME_MS = 800;
export const SST_OPACITY = 0.75;
/** Tiles are drawn (from the z7 data, interpolated) down to this zoom; past it Leaflet scales them. */
export const SST_RENDER_MAX_Z = 10;
/** A new view's range replaces the one on screen only when an end moves at least this much (°C):
 *  small pans keep their colours instead of shimmering. */
export const SST_RANGE_HYSTERESIS = 0.2;
export const C_TO_F = (c) => c * 9 / 5 + 32;

/* Legend state for features/weather/MapLegends (replaces #sst-legend / #sst-date / .sst-ends /
   .sst-bar / #sst-palette / #sst-play). `rangeF`, `shownPalette` and `date` describe the picture
   that is actually ON SCREEN — they change in the same step as the repaint, so the °F ends always
   match the colours you are looking at (the colours are relative to the view; these numbers are
   the only absolute reference). `stored` = the day on screen came from the device (offline). */
/**
 * @typedef {{ on: boolean, loading: boolean, playing: boolean, loadingLoop: boolean,
 *   palette: string, shownPalette: string, rangeC: number[]|null, rangeF: number[]|null,
 *   date: string, stored: boolean }} SstView
 */
/** @type {import('zustand/vanilla').StoreApi<SstView>} */
export const sstStore = createStore(() => /** @type {SstView} */ ({
  on: false, loading: false, playing: false, loadingLoop: false,
  palette: SST.palette, shownPalette: SST.palette, rangeC: null, rangeF: null, date: '', stored: false,
}));

/** The assistant's water-temp answer reads this ([minC, maxC] or null). */
export function getSstRange() { return SST.range; }

export function sstDate(back) {
  const d = new Date(Date.now() - (back != null ? back : SST_LAG_DAYS) * 86400000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/** The loop's days, oldest -> newest, ending on `latest`. */
export function sstLoopDates(latest, n = SST_LOOP_DAYS) {
  const out = [];
  for (let d = n - 1; d >= 0; d--) out.push(sstDayBefore(latest, d));
  return out;
}

/** The colour-scale range [minC, maxC] for a set of sampled temps, or null with < 3 samples. */
export function sstRangeFrom(samples) {
  const vals = samples.filter((v) => v != null && !isNaN(v)).sort((a, x) => a - x);
  if (vals.length >= 3) {
    // 10th–90th percentile: clip the coldest/warmest outlier corners so the MAIN water
    // body spans the full blue→red rainbow (max colour contrast where you're fishing)
    const lo = vals[Math.floor(vals.length * 0.10)];
    const hi = vals[Math.ceil(vals.length * 0.90) - 1];
    if (hi - lo >= 0.4) return [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10];
    const mid = (lo + hi) / 2; return [Math.round((mid - 0.5) * 10) / 10, Math.round((mid + 0.5) * 10) / 10];
  }
  return null;
}

/** Should a freshly computed range replace the one on screen? */
export function sstRangeChanged(cur, next) {
  if (!next) return false;
  if (!cur) return true;
  return Math.abs(cur[0] - next[0]) >= SST_RANGE_HYSTERESIS || Math.abs(cur[1] - next[1]) >= SST_RANGE_HYSTERESIS;
}

/* ------------------------------------------------------------------ the tile layer */
const SstGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const c = /** @type {HTMLCanvasElement & {_sst?: any}} */ (document.createElement('canvas'));
    c.width = c.height = SST_PX;
    c.setAttribute('role', 'presentation');
    c._sst = sstTileCoords(coords.z, coords.x, coords.y);
    loadTile(c, done);
    return c;
  },
});

function makeLayer() {
  const layer = new SstGrid({
    tileSize: SST_PX,
    maxNativeZoom: SST_RENDER_MAX_Z,
    maxZoom: 20,
    minZoom: 0,
    opacity: SST_OPACITY,
    pane: 'overlayPane',              // above the charts, under markers (where the old image sat)
    zIndex: 3,
    className: 'sst-tiles',
    updateWhenIdle: false,            // load during a pan, not only after it
    updateWhenZooming: false,
    keepBuffer: 3,                    // a ring around the view: short pans back show instantly
    // one credit for the overlay; the map's Credits list it while the layer is on
    attribution: MUR_SST_ATTRIBUTION,
  });
  layer.on('tileunload', (e) => { if (e.tile && e.tile._sst) e.tile._sst.gone = true; });
  /* Every tile in view has settled. Nothing painted = nothing to show (GIBS unreachable behind a
     captive portal, a day it lacks): stop the spinner and say so once, rather than spin for ever. */
  layer.on('load', () => {
    if (!SST.on || !sstStore.getState().loading) return;
    sstStore.setState({ loading: false });
    if (!liveTiles().some((c) => c.dataset.sstPainted)) toast('Sea temperature unavailable right now');
  });
  return layer;
}

/** A drawn tile and the data tile it comes from: itself up to z7, its z7 ancestor below that
 *  (f = how many drawn tiles across one data tile, sx/sy = which one this is). */
export function sstTileCoords(z, x, y) {
  const dz = Math.max(0, z - SST_MAX_Z);
  const f = 1 << dz;
  const dx = x >> dz, dy = y >> dz;
  return { z, x, y, dz: z - dz, dx, dy, f, sx: x - dx * f, sy: y - dy * f, gone: false };
}

/** The decoded data tile for (day, drawn tile) — or its neighbour (ox, oy) — if it is in memory. */
function tileRec(date, t, ox = 0, oy = 0) {
  if (!date) return null;
  const n = 1 << t.dz;
  const y = t.dy + oy;
  if (y < 0 || y >= n) return null;
  return sstMemGet(sstKey(date, t.dz, (((t.dx + ox) % n) + n) % n, y));
}

let scratchImg = null;
/** Paint one tile canvas from memory for the day on screen. False = no data for it (yet): whatever
 *  it shows stays (never blank it). */
function paintTile(c) {
  const t = c._sst;
  const rec = tileRec(SST.shownDate, t);
  if (!rec || !SST._lut) return false;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  if (rec.empty) {
    ctx.clearRect(0, 0, SST_PX, SST_PX);
  } else {
    if (!scratchImg) scratchImg = ctx.createImageData(SST_PX, SST_PX);
    const out = new Uint32Array(scratchImg.data.buffer);
    if (SST._fine && SST.range) {
      const date = SST.shownDate;
      sstPaintUpsampled(out, (ox, oy) => (ox || oy ? tileRec(date, t, ox, oy) : rec), t.sx, t.sy, t.f, SST._fine, SST.range);
    } else {
      const lut = SST._lut, bins = rec.bins;
      for (let i = 0; i < bins.length; i++) out[i] = lut[bins[i]];
    }
    ctx.putImageData(scratchImg, 0, 0);
  }
  c.dataset.sstPainted = SST.shownDate + '/' + SST.palette + '/' + (SST.range ? SST.range.join(',') : '');
  return true;
}

/** The tile canvases on the map now (current zoom level first). */
function liveTiles() {
  const layer = SST.layer;
  if (!layer || !layer._tiles) return [];
  return Object.values(layer._tiles).map((t) => t.el).filter((el) => el && el._sst && !el._sst.gone);
}

function repaintAll() {
  let any = false;
  liveTiles().forEach((c) => { if (paintTile(c)) any = true; });
  if (any) publishShown();
}

/** The legend describes what was just painted. */
function publishShown() {
  const r = SST.range;
  const s = sstStore.getState();
  const next = {
    loading: false,
    date: SST.shownDate || '',
    stored: typeof navigator !== 'undefined' && navigator.onLine === false,
    rangeC: r ? r.slice() : null,
    rangeF: r ? [Math.round(C_TO_F(r[0])), Math.round(C_TO_F(r[1]))] : null,
    shownPalette: SST.palette,
  };
  if (s.loading !== next.loading || s.date !== next.date || s.stored !== next.stored || s.shownPalette !== next.shownPalette ||
      JSON.stringify(s.rangeC) !== JSON.stringify(next.rangeC)) sstStore.setState(next);
}

function rebuildLut() {
  const stops = sstStopsFromGradient(SST_PALETTE_BAR[SST.palette] || SST_PALETTE_BAR.BlueWhiteRed);
  SST._lut = SST.range ? sstLut(stops, SST.range) : null;
  SST._fine = SST.range ? sstFineLut(stops, SST.range) : null;
}

/** Data-tile zoom for the map's zoom (the view's range is measured on the data itself). */
function tileZoom(map) { return Math.max(0, Math.min(SST_MAX_Z, Math.round(map.getZoom()))); }

/** Histogram of the MUR pixels inside the view, over `dates`, from memory only. */
export function sstViewHistogram(dates) {
  const hist = new Uint32Array(SST_NBINS);
  const map = getMap();
  if (!map || !map.getBounds || !map.getZoom || !map.project) return hist;
  const b = map.getBounds();
  if (!b) return hist;
  const z = tileZoom(map);
  const nw = map.project(b.getNorthWest(), z), se = map.project(b.getSouthEast(), z);
  const n = Math.pow(2, z);
  const area = Math.max(1, (se.x - nw.x) * (se.y - nw.y));
  const step = Math.max(1, Math.floor(Math.sqrt(area / 60000)));   // ≤ ~60k samples per day
  const tx0 = Math.floor(nw.x / SST_PX), tx1 = Math.floor((se.x - 1) / SST_PX);
  const ty0 = Math.max(0, Math.floor(nw.y / SST_PX)), ty1 = Math.min(n - 1, Math.floor((se.y - 1) / SST_PX));
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const x0 = nw.x - tx * SST_PX, y0 = nw.y - ty * SST_PX, x1 = se.x - tx * SST_PX, y1 = se.y - ty * SST_PX;
      const wx = ((tx % n) + n) % n;
      dates.forEach((d) => {
        const rec = d ? sstMemGet(sstKey(d, z, wx, ty)) : null;
        if (rec && !rec.empty) sstHistAdd(hist, rec.bins, x0, y0, x1, y1, step);
      });
    }
  }
  return hist;
}

/** Re-fit the colour scale to the water in view (all loop days while playing, so every frame uses
 *  one scale). Repaints only when the range really moved. `force` skips the hysteresis. */
function updateRange(force) {
  if (!SST.on) return;
  const dates = SST.playing && SST.frames.length && !SST._loopPending ? SST.frames : [SST.shownDate];
  const next = sstRangeFromHist(sstViewHistogram(dates));
  if (next && (force ? JSON.stringify(next) !== JSON.stringify(SST.range) : sstRangeChanged(SST.range, next))) {
    SST.range = next;
    rebuildLut();
    repaintAll();
  } else if (!SST._lut && SST.range) {
    rebuildLut();
  }
}
/** First data on screen: fit the scale to the view, or (a view with almost no water in memory yet)
 *  to this tile, so the first tile never waits for its neighbours. */
function ensureRange(rec) {
  if (SST.range) return;
  updateRange(true);
  if (SST.range || !rec || rec.empty) return;
  const r = sstRangeFromHist(sstHistAdd(new Uint32Array(SST_NBINS), rec.bins, 0, 0, SST_PX, SST_PX, 2));
  if (r) { SST.range = r; rebuildLut(); }
}
function scheduleRepaint() {
  if (SST._repaintTimer) return;
  SST._repaintTimer = setTimeout(() => { SST._repaintTimer = null; if (SST.on) repaintAll(); }, 80);
}
function scheduleRange(ms = 120) {
  clearTimeout(SST._rangeTimer);
  SST._rangeTimer = setTimeout(() => updateRange(false), ms);
}

/** Fetch (or read) a new tile's data for the day on screen, then paint it. Loop days come behind
 *  it while a loop plays, so a pan during the loop fills in every frame. */
function loadTile(c, done) {
  const t = c._sst;
  const date = SST.shownDate;
  let called = false;
  /* Never synchronously: Leaflet registers the tile only after createTile returns, and a done()
     before that is dropped — the tile then stays hidden (no leaflet-tile-loaded) for good. */
  const finish = () => { if (!called) { called = true; Promise.resolve().then(() => done(null, c)); } };
  if (!date) { finish(); return; }
  const wanted = () => SST.on && !t.gone;
  const now = tileRec(date, t);
  if (now) {
    ensureRange(now);
    paintTile(c);
    finish();
    if (sstStore.getState().loading) publishShown();
  } else {
    sstTileData(date, t.dz, t.dx, t.dy, { prio: 0, wanted }).then((rec) => {
      if (!rec || !wanted()) return;
      if (!SST.range) ensureRange(rec); else scheduleRange();
      scheduleRepaint();   // neighbours drawn before this arrived get their shared edge right
      // the day on screen may have moved on (loop) while this loaded: paint whatever is current
      paintTile(c);
      if (sstStore.getState().loading) publishShown();
    }, () => {}).finally(finish);
  }
  if (SST.playing && SST.frames.length) {
    SST.frames.forEach((d) => { if (d !== date) sstTileData(d, t.dz, t.dx, t.dy, { prio: 1, wanted }).then(() => {}, () => {}); });
  }
}

/** The DATA tiles a loop needs: those under the drawn tiles at the layer's current zoom. */
function currentTileCoords() {
  const layer = SST.layer;
  const z = layer && layer._tileZoom != null ? layer._tileZoom : null;
  const seen = new Set();
  const out = [];
  liveTiles().forEach((c) => {
    const t = c._sst;
    if (z != null && t.z !== z) return;
    const k = t.dz + '/' + t.dx + '/' + t.dy;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ z: t.dz, x: t.dx, y: t.dy });
  });
  return out;
}

/* ------------------------------------------------------------------ on / off */
function onMoveEnd() {
  if (!SST.on) return;
  scheduleRange(150);
}

export async function sstEnable(on) {
  SST.on = on;
  const gen = ++SST._enableGen;
  const map = getMap();
  if (on) {
    SST._enabling = true;
    SST.range = null;      // fitted afresh to this view (a range from another place would mis-colour it)
    SST._lut = null;
    sstStore.setState({ on: true, loading: true });
    const c = map && map.getCenter ? map.getCenter() : null;
    const probe = c ? { z: SST_MAX_Z, x: sstLon2x(c.lng, SST_MAX_Z), y: sstLat2y(c.lat, SST_MAX_Z) } : null;
    let latest;
    try { latest = await sstResolveLatest(probe); } catch (e) { latest = null; }
    /* Switched off (or off-and-on) while the newest day was found: paint nothing. */
    if (gen !== SST._enableGen || !SST.on) return;
    if (!latest) {
      /* Offline with no stored day. Legacy unticked the box but left SST.on = true, so the next
         pan painted SST anyway. The saved choice is kept (see refuseDataOverlay). */
      toast('SST needs internet');
      SST.on = false;
      SST._enabling = false;
      refuseDataOverlay('sst');
      sstStore.setState({ on: false, loading: false });
      return;
    }
    SST._enabling = false;
    SST.latest = latest;
    SST.shownDate = latest;
    sstStore.setState({ palette: SST.palette });
    if (!SST.layer) SST.layer = makeLayer();
    if (map) {
      if (!map.hasLayer || !map.hasLayer(SST.layer)) map.addLayer(SST.layer);
      if (!SST._moveBound) { map.on('moveend', onMoveEnd); SST._moveBound = true; }
    }
    /* Play tapped while the newest day was still being found: sstPlay queued the loop for now. */
    if (SST.playing) startLoop();
    else schedulePrefetch(gen);
  } else {
    SST._enabling = false;
    sstStop();
    clearTimeout(SST._rangeTimer);
    clearTimeout(SST._prefetchTimer);
    if (SST.layer && map) map.removeLayer(SST.layer);
    SST.layer = null;   // a fresh grid next time: no stale canvases from another day / palette
    SST.frames = [];
    sstStore.setState({ on: false, loading: false, playing: false, loadingLoop: false, rangeC: null, rangeF: null, date: '', stored: false });
  }
}

/** After the newest day shows: quietly store the loop days for the tiles on screen, so Play starts
 *  at once (and works offline). Low priority, behind anything the view asks for. */
function schedulePrefetch(gen) {
  clearTimeout(SST._prefetchTimer);
  SST._prefetchTimer = setTimeout(() => {
    if (gen !== SST._enableGen || !SST.on || !SST.latest) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const tiles = currentTileCoords();
    sstLoopDates(SST.latest).forEach((d) => {
      if (d === SST.latest) return;
      tiles.forEach((t) => { sstTileData(d, t.z, t.x, t.y, { prio: 2, decode: false }).then(() => {}, () => {}); });
    });
  }, 1500);
}

/* ------------------------------------------------------------------ loop */
export function showFrame(i) {
  if (!SST.frames.length) return;
  SST.idx = ((i % SST.frames.length) + SST.frames.length) % SST.frames.length;
  SST.shownDate = SST.frames[SST.idx];
  repaintAll();
  sstStore.setState({ date: SST.shownDate });
}

/** Load every loop day for the tiles on screen, decoded, THEN animate — no frame ever stalls on
 *  the network mid-loop. A day GIBS does not have is skipped; 15 s at most before playing what is
 *  there. */
async function startLoop() {
  const gen = ++SST._loopGen;
  if (!SST.latest) return;
  const dates = sstLoopDates(SST.latest);
  const tiles = currentTileCoords();
  const wanted = () => SST.on && SST.playing && gen === SST._loopGen;
  const all = Promise.all(dates.map((d) => Promise.all(tiles.map((t) =>
    sstTileData(d, t.z, t.x, t.y, { prio: d === SST.latest ? 0 : 1, wanted }).catch(() => null)))));
  await Promise.race([all, new Promise((r) => setTimeout(r, 15000))]);
  if (!wanted()) return;
  const frames = dates.filter((d) => !tiles.length || tiles.some((t) => sstMemGet(sstKey(d, t.z, t.x, t.y))));
  if (frames.length < 2) {
    toast(typeof navigator !== 'undefined' && navigator.onLine === false ? 'The loop needs internet' : 'Loop days unavailable right now');
    sstStop();
    return;
  }
  SST.frames = frames;
  SST._loopPending = false;
  updateSstPlayBtn();                       // "Loading…" → "Pause"
  showFrame(0);
  updateRange(true);                        // one scale for every day of the loop
  clearInterval(SST.timer);
  SST.timer = setInterval(() => showFrame(SST.idx + 1), SST_FRAME_MS);
}

export function sstUpdateLegend() {
  sstStore.setState({ palette: SST.palette });
}

export function sstSetPalette(name) {
  if (SST_PALETTES.indexOf(name) < 0) return;
  SST.palette = name;
  try { localStorage.setItem('fishapp.sstpal', name); } catch (e) {}
  sstStore.setState({ palette: name });
  if (!SST.on) return;
  rebuildLut();
  repaintAll();   // no network: the tiles hold temperatures, the palette is applied here
}

export function sstPlay() {
  if (!SST.on) return;
  SST.playing = true;
  SST._loopPending = true;
  sstStore.setState({ playing: true, loadingLoop: true });   // "Loading loop…"
  /* Tapped while the overlay is still finding the newest day: the enable continuation starts the
     loop as soon as it knows (it checks SST.playing). */
  if (SST._enabling || !SST.latest) return;
  void startLoop();
}

export function sstStop() {
  const wasPlaying = SST.playing || SST._loopPending;
  SST.playing = false;
  SST._loopPending = false;
  SST._loopGen++;                // a loop still preloading starts nothing
  clearInterval(SST.timer);
  SST.timer = null;
  updateSstPlayBtn();
  /* Back to the newest day, with a scale fitted to it alone. */
  if (wasPlaying && SST.on && SST.latest) {
    SST.frames = [];
    SST.shownDate = SST.latest;
    repaintAll();
    sstStore.setState({ date: SST.shownDate || '' });
    updateRange(true);
  }
}

export function sstTogglePlay() { SST.playing ? sstStop() : sstPlay(); }

export function updateSstPlayBtn() {
  sstStore.setState({ playing: SST.playing, loadingLoop: SST.playing && SST._loopPending });
}

/* ------------------------------------------------------------------ preload */
/** Boot: a few seconds in, when the app is idle and online, fetch today's MUR tiles around the map
 *  (the boat, once GPS has centred it) and decode them, then store the loop days — 7 small tiles
 *  for today, 16 for the loop (~5-15 KB each), each fetched once a day at most. Turning SST on is then instant,
 *  and works with no signal later. Skipped on Data Saver. */
export function sstPreload(delayMs = 4000) {
  setTimeout(() => {
    const idle = typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(fn, { timeout: 5000 })
      : (fn) => setTimeout(fn, 0);
    idle(() => { void sstPreloadNow().catch(() => {}); });
  }, delayMs);
}

/** @param {{lat: number, lng: number}} [center] */
export async function sstPreloadNow(center) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  const conn = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).connection : null;
  if (conn && conn.saveData) return 0;
  const map = getMap();
  const c = center || (map && map.getCenter ? map.getCenter() : null);
  if (!c) return 0;
  const tiles = sstTilesAround(c.lat, c.lng);
  const latest = await sstResolveLatest(tiles[0]);
  if (!latest) return 0;
  const got = await Promise.all(tiles.map((t) => sstTileData(latest, t.z, t.x, t.y, { prio: 2 }).catch(() => null)));
  for (const d of sstLoopDates(latest)) {
    if (d === latest) continue;
    // loop days: only the ~1 km tiles near the boat (zoomed-out loops load on Play)
    await Promise.all(tiles.filter((t) => t.z === SST_MAX_Z).map((t) => sstTileData(d, t.z, t.x, t.y, { prio: 3, decode: false }).catch(() => null)));
  }
  void sstPrune(latest);
  return got.filter(Boolean).length;
}

/** For the check page / tests: the newest day known without asking anyone. */
export function sstKnownLatest() { return SST.latest || SstLatest.date; }
