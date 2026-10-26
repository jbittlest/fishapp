import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { mapBoundsClamped } from './gps.js';
import { getMap } from './app.js';
import { reportDataOverlay } from './layers.js';
import { toast } from '../services/ui';

/* Sea surface temperature overlay + multi-day time-lapse loop.
   Source: NOAA CoastWatch ERDDAP (JPL MUR SST, ~1 km daily). Unlike the fixed global
   palette, ERDDAP lets us STRETCH the colour scale to the LOCAL temperature range, so small
   breaks (1-2°F) show a big colour change. Scale is auto-centred on the local water temp.
   Rendered as a per-view image overlay (one request per day) — online only. */
'use strict';

export const SST_PALETTES = ['BlueWhiteRed', 'Rainbow', 'Ocean', 'BlackRedWhite'];

/* Read at module load. Legacy read localStorage bare here, so a blocked storage (private mode,
   a locked-down WebView) threw while the script was still being parsed and took the overlay
   wiring down with it. An unknown saved name would also have been sent straight to ERDDAP. */
export function sstSavedPalette() {
  let p = null;
  try { p = localStorage.getItem('fishapp.sstpal'); } catch (e) {}
  return p && SST_PALETTES.indexOf(p) >= 0 ? p : 'BlueWhiteRed';
}

export const SST = {
  on: false,
  frames: [],       // [{ date, ov }] oldest -> newest image overlays (preloaded)
  idx: 0,
  playing: false,
  timer: null,
  range: null,      // [minC, maxC] colour scale
  palette: sstSavedPalette(),
  _moveTimer: null,
  _moveBound: false,
  _live: [],        // every overlay currently on the map (old set stays until the new one loads)
  _buildToken: 0,
  _enableGen: 0,    // bumps on every enable/disable; stale async continuations bail on it
  _enabling: false, // an enable is still sampling its first colour range (SST.range may be null or last session's)
  _loopPending: false,
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

/* Legend bar CSS gradient per palette (cold -> warm) */
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
export const SST_LAG_DAYS = 2;    // ERDDAP MUR is ~1-2 days behind; 2 is safe
export const SST_FRAME_MS = 800;
export const C_TO_F = (c) => c * 9 / 5 + 32;

/* Legend state for features/weather/MapLegends (replaces #sst-legend / #sst-date / .sst-ends /
   .sst-bar / #sst-palette / #sst-play). `rangeF`, `shownPalette` and `date` describe the image
   that is actually ON SCREEN — they change when a new image is revealed, never before, so the
   °F ends always match the colours you are looking at (the colours are relative to the view;
   these numbers are the only absolute reference). */
/**
 * @typedef {{ on: boolean, loading: boolean, playing: boolean, loadingLoop: boolean,
 *   palette: string, shownPalette: string, rangeC: number[]|null, rangeF: number[]|null,
 *   date: string }} SstView
 */
/** @type {import('zustand/vanilla').StoreApi<SstView>} */
export const sstStore = createStore(() => /** @type {SstView} */ ({
  on: false, loading: false, playing: false, loadingLoop: false,
  palette: SST.palette, shownPalette: SST.palette, rangeC: null, rangeF: null, date: '',
}));

/** The assistant's water-temp answer reads this ([minC, maxC] or null). */
export function getSstRange() { return SST.range; }

export function sstDate(back) {
  const d = new Date(Date.now() - (back != null ? back : SST_LAG_DAYS) * 86400000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

export async function sstEnable(on) {
  SST.on = on;
  const gen = ++SST._enableGen;
  if (on) {
    if (!navigator.onLine) {
      toast('SST needs internet');
      /* Legacy unticked the box but left SST.on = true, so the next pan painted SST anyway.
         The saved choice is kept (see refuseDataOverlay). */
      SST.on = false;
      SST._enabling = false;
      refuseDataOverlay('sst');
      sstStore.setState({ on: false, loading: false });
      return;
    }
    SST._enabling = true;
    sstStore.setState({ on: true, loading: true });
    await sstDetermineRange();
    /* Switched off (or off-and-on) while the range was sampled: legacy re-showed the legend
       and painted the overlay here anyway. */
    if (gen !== SST._enableGen || !SST.on) return;
    SST._enabling = false;
    sstUpdateLegend();
    /* Static: one frame only, swaps in on load (no blank gap). If Play was tapped while the
       range was still being sampled, sstPlay queued the loop for this moment — build it now,
       with the range that was just sampled. (Building a static frame here used to clear the
       pending flag and leave the button on "Pause" over a still image.) */
    buildSstFrames(SST.playing ? SST_LOOP_DAYS : 1);
    const map = getMap();
    if (!SST._moveBound && map) {
      map.on('moveend', () => {
        if (!SST.on) return;
        clearTimeout(SST._moveTimer);
        SST._moveTimer = setTimeout(() => {
          sstDetermineRange().then(() => {
            if (!SST.on) return;   // turned off while the new range loaded
            sstUpdateLegend(); buildSstFrames(SST.playing ? SST_LOOP_DAYS : 1);
          });
        }, 1000);
      });
      SST._moveBound = true;
    }
  } else {
    SST._enabling = false;
    sstStop();
    SST._buildToken = (SST._buildToken || 0) + 1;   // any build still loading is superseded
    clearTimeout(SST._moveTimer);
    const map = getMap();
    (SST._live || []).forEach((ov) => { if (map) map.removeLayer(ov); });
    SST._live = []; SST.frames = [];
    sstStore.setState({ on: false, loading: false, playing: false, loadingLoop: false, rangeC: null, rangeF: null, date: '' });
  }
}

/* Stretch the colour scale to the ACTUAL min/max water temp in view, so the full rainbow
   (blue→red) maps to exactly the temps present — maximum colour difference per degree.
   Samples a grid of points via Open-Meteo (CORS-ok; ERDDAP's own data fetch is CORS-blocked). */
export async function sstDetermineRange() {
  const c = mapBoundsClamped();
  const nLat = 5, nLon = 6;
  const lats = [], lons = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      lats.push((c.s + (c.n - c.s) * (i + 0.5) / nLat).toFixed(3));
      lons.push((c.w + (c.e - c.w) * (j + 0.5) / nLon).toFixed(3));
    }
  }
  try {
    let d = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') + '&current=sea_surface_temperature').then((r) => r.json());
    if (!Array.isArray(d)) d = [d];
    const range = sstRangeFrom(d.map((x) => x.current && x.current.sea_surface_temperature));
    if (range) { SST.range = range; return; }
  } catch (e) { /* fall through */ }
  SST.range = [13, 23];   // fallback °C
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

export function sstImgUrl(date) {
  const c = mapBoundsClamped();
  const w = Math.min(1100, Math.max(500, getMap().getSize().x));
  const h = Math.max(1, Math.min(1100, Math.round(w * (c.n - c.s) / (c.e - c.w))));
  // griddap .transparentPng honours .colorBar (palette + range); WMS ignores the palette.
  const q = 'analysed_sst%5B(' + date + 'T09:00:00Z)%5D' +
    '%5B(' + c.s.toFixed(4) + '):(' + c.n.toFixed(4) + ')%5D' +
    '%5B(' + c.w.toFixed(4) + '):(' + c.e.toFixed(4) + ')%5D';
  const cb = encodeURIComponent(SST.palette + '|C|Linear|' + SST.range[0] + '|' + SST.range[1] + '|');
  return 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.transparentPng?' + q +
    '&.size=' + w + '|' + h + '&.colorBar=' + cb;
}

/* Build n day-frames (1 = static latest, SST_LOOP_DAYS = loop). New overlays load at
   opacity 0 while the OLD ones stay visible; only once the newest new image has loaded do
   we reveal it and drop the old set — so a pan/zoom never flashes blank. */
export function buildSstFrames(n) {
  n = n || (SST.playing ? SST_LOOP_DAYS : 1);
  if (!SST.range) return;   // the enable path builds once the range is known
  const map = getMap();
  const token = SST._buildToken = (SST._buildToken || 0) + 1;
  clearInterval(SST.timer); SST.timer = null;   // stop any running loop while we (re)load
  const c = mapBoundsClamped();
  const bounds = [[c.s, c.w], [c.n, c.e]];       // must match the clamped bbox in sstImgUrl
  // the scale and palette baked into THESE images — published with them, so the legend matches
  const range = SST.range.slice();
  const palette = SST.palette;
  const frames = [];
  for (let d = SST_LAG_DAYS + n - 1; d >= SST_LAG_DAYS; d--) {
    const ov = L.imageOverlay(sstImgUrl(sstDate(d)), bounds, { opacity: 0, interactive: false }).addTo(map);
    frames.push({ date: sstDate(d), ov });   // oldest -> newest
  }
  SST.frames = frames;
  SST._live = (SST._live || []).concat(frames.map((f) => f.ov));
  const isLoaded = (ov) => ov._image && ov._image.complete && ov._image.naturalWidth;
  const waitAll = SST.playing && frames.length > 1;   // loop: preload ALL days before animating
  let done = false;

  const finish = () => {
    if (done || token !== SST._buildToken) return;   // superseded by a newer build
    done = true;
    const keep = frames.map((f) => f.ov);
    (SST._live || []).forEach((ov) => { if (keep.indexOf(ov) < 0) map.removeLayer(ov); });
    SST._live = keep;
    SST._loopPending = false;
    sstStore.setState({ loading: false, rangeC: range, rangeF: [Math.round(C_TO_F(range[0])), Math.round(C_TO_F(range[1]))], shownPalette: palette });
    if (SST.playing && frames.length > 1) {
      updateSstPlayBtn();                      // "Loading…" → "Pause"
      showFrame(0);
      clearInterval(SST.timer);
      SST.timer = setInterval(() => showFrame(SST.idx + 1), SST_FRAME_MS);
    } else {
      SST.idx = frames.length - 1;
      // exactly one image visible: the newest (a stop during preload could otherwise leave two lit)
      frames.forEach((f, j) => f.ov.setOpacity(j === frames.length - 1 ? 0.75 : 0));
      sstStore.setState({ date: frames[frames.length - 1].date });
      updateSstPlayBtn();
    }
  };

  if (waitAll) {
    let remaining = frames.length;
    frames.forEach((f) => {
      if (isLoaded(f.ov)) { if (--remaining <= 0) finish(); }
      else { const h = () => { if (--remaining <= 0) finish(); }; f.ov.once('load', h); f.ov.once('error', h); }
    });
    setTimeout(finish, 15000);   // don't hang forever if a day is slow
  } else {
    const newest = frames[frames.length - 1].ov;
    if (isLoaded(newest)) finish();
    else { newest.once('load', finish); newest.once('error', finish); setTimeout(finish, 8000); }
  }
}

export function showFrame(i) {
  if (!SST.frames.length) return;
  SST.idx = ((i % SST.frames.length) + SST.frames.length) % SST.frames.length;
  SST.frames.forEach((f, j) => f.ov.setOpacity(j === SST.idx ? 0.75 : 0));
  sstStore.setState({ date: SST.frames[SST.idx].date });
}

export function sstUpdateLegend() {
  sstStore.setState({ palette: SST.palette });
}

export function sstSetPalette(name) {
  if (SST_PALETTES.indexOf(name) < 0) return;
  SST.palette = name;
  try { localStorage.setItem('fishapp.sstpal', name); } catch (e) {}
  sstStore.setState({ palette: name });
  // an enable still sampling the range will build with it (SST.range may be last session's until then)
  if (!SST.on || !SST.range || SST._enabling) return;
  sstUpdateLegend();
  buildSstFrames(SST.playing ? SST_LOOP_DAYS : 1);   // re-render with the new palette
}

export function sstPlay() {
  if (!navigator.onLine || !SST.on) return;
  SST.playing = true;
  SST._loopPending = true;
  sstStore.setState({ playing: true, loadingLoop: true });   // "Loading loop…"
  /* Tapped while the overlay is still sampling its first colour range: building now would use
     no range at all (buildSstFrames returns) or a stale one from the last time SST was on. The
     enable continuation builds the loop as soon as the range is known (it checks SST.playing). */
  if (SST._enabling || !SST.range) return;
  // build + PRELOAD all 5 days; buildSstFrames starts the animation only once they're loaded
  buildSstFrames(SST_LOOP_DAYS);
}

export function sstStop() {
  const wasPending = SST._loopPending;
  SST.playing = false;
  SST._loopPending = false;
  clearInterval(SST.timer);
  SST.timer = null;
  updateSstPlayBtn();
  /* Stopping while the 5-day loop was still preloading used to light one of the half-loaded
     loop days ON TOP of the static image that was still showing (two overlays stacked). Hand
     back to a fresh static build instead; it supersedes the loop build and clears its images.
     (Not while the enable is still sampling — it builds the static frame itself.) */
  if (wasPending && SST.on && SST.range && !SST._enabling) { buildSstFrames(1); return; }
  if (SST.frames.length) showFrame(SST.idx);
}

export function sstTogglePlay() { SST.playing ? sstStop() : sstPlay(); }

export function updateSstPlayBtn() {
  sstStore.setState({ playing: SST.playing, loadingLoop: SST.playing && SST._loopPending });
}
