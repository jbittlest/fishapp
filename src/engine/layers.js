/* Chart layers: base map, NOAA chart + seamark overlays, the relief detail companions, and the
   data overlays (wind, SST, rain, reefs, MPAs, fish). Moved out of the legacy app.js boot.
   The Layers panel, First Mate's toggle_layer tool and the download planner all go through here,
   so the layer state has exactly one owner (layersStore) and one persisted copy (fishapp.layers). */
'use strict';
import { createStore } from 'zustand/vanilla';
import { OFFLINE_BASE, canSaveOffline, makeLayer } from './tiles.js';
import { _db } from './db.js';
import { readJSON } from './app.js';
import { windOverlayEnable } from './weather.js';
import { sstEnable } from './sst.js';
import { rainEnable } from './rain.js';
import { fishEnable } from './fish.js';
import { reefsSetVisible } from './reefs.js';

export const BASES = [
  { id: 'ocean', title: 'Ocean / bathymetry', detail: 'Global' },
  { id: 'sat', title: 'Satellite', detail: null },
  { id: 'street', title: 'Street map', detail: null },
  { id: 'bluetint', title: 'Fishing chart — US survey bathymetry', detail: 'NOAA BlueTopo, sharp to the bottom' },
  { id: 'gmrt', title: 'Fishing chart — global', detail: 'Outside US waters' },
];

const DEFAULTS = { base: 'ocean', enc: true, seamark: true, wind: false, sst: false, rain: false, reefs: true, mpa: true, fish: false };

function loadPrefs() {
  const p = Object.assign({}, DEFAULTS, readJSON('fishapp.layers', {}) || {});
  // Guard against a stale/legacy saved base value that no longer exists, which would
  // otherwise throw in makeLayer and brick startup.
  if (!BASES.some((b) => b.id === p.base)) p.base = 'ocean';
  // legacy semantics: reefs/mpa default ON unless explicitly false
  p.reefs = p.reefs !== false; p.mpa = p.mpa !== false;
  return p;
}

const _initialPrefs = loadPrefs();
export const layersStore = createStore(() => ({ ..._initialPrefs, tileBusy: false }));

/* What the USER chose. The live store can differ when a module refuses (SST offline): the toggle
   then shows off, but the saved choice survives so the overlay comes back next time there is
   signal (legacy only unticked the box and never saved it). */
const persisted = { ..._initialPrefs };
function savePrefs() {
  const s = layersStore.getState();
  ['base', 'enc', 'seamark'].forEach((k) => { persisted[k] = s[k]; });
  const p = persisted;
  const prefs = { base: p.base, enc: !!p.enc, seamark: !!p.seamark, wind: !!p.wind, sst: !!p.sst, rain: !!p.rain, reefs: !!p.reefs, mpa: !!p.mpa, fish: !!p.fish };
  try { localStorage.setItem('fishapp.layers', JSON.stringify(prefs)); } catch (e) {}
}

/** The chart layers the map shows for a layer state — the base, its relief-detail companion and
 *  the chart overlays. The offline downloader starts from this, so a downloaded area holds what
 *  the chart displays except the layers whose terms forbid offline copies (download.js). */
export function chartLayerIds(state) {
  const s = state || layersStore.getState();
  const ids = [s.base];
  if (RELIEF_DETAIL[s.base]) ids.push(RELIEF_DETAIL[s.base]);
  if (s.enc) ids.push('enc');
  if (s.seamark) ids.push('seamark');
  return ids;
}

let map = null;
const live = { base: null, enc: null, seamark: null, reliefhi: null, blueshade: null, fallback: null };
/* The two relief bases and the detail overlay each pairs with. Both want the NOAA vector
   chart on top, because the multiply blend in updateEncBlend() is the other half of the
   look: it drops the chart's white deep water to transparent while keeping contours and
   soundings razor sharp. */
const RELIEF_DETAIL = { gmrt: 'reliefhi', bluetint: 'blueshade' };

/* Layers used to pop out the instant a checkbox changed, which reads as a flicker. Fade
   them out on removal, and show a small spinner while any layer's tiles are still arriving
   so "nothing happened yet" is visibly distinct from "done". */
const _loadingLayers = new Set();
function updateTileBusy() { layersStore.setState({ tileBusy: _loadingLayers.size > 0 }); }
function trackLayer(layer) {
  layer.on('loading', () => { _loadingLayers.add(layer); updateTileBusy(); });
  layer.on('load', () => { _loadingLayers.delete(layer); updateTileBusy(); });
  layer.on('remove', () => { _loadingLayers.delete(layer); updateTileBusy(); });
  return layer;
}
/* NOTE: deliberately no fade-IN on layers. Any fade that begins at opacity 0 leaves the
   layer invisible if the animation never advances (backgrounded tab, frozen compositor),
   and a blank chart underway is a safety problem — not worth a 300ms flourish. Leaflet
   already fades each tile in as it loads, which gives the smoothness with no such risk. */
/* Fade out, then drop the layer. The caller clears its `live` slot immediately, so a fast
   re-toggle just builds a fresh layer — this only ever removes the object it captured. */
function fadeOutRemove(layer) {
  const c = layer.getContainer && layer.getContainer();
  if (!c) { map.removeLayer(layer); return; }
  c.style.transition = 'opacity 0.28s ease';
  c.style.opacity = '0';
  setTimeout(() => { try { map.removeLayer(layer); } catch (e) {} }, 280);
}

/** Called once by boot after the map exists. Builds the saved base + chart overlays. */
export function initLayers(m) {
  map = m;
  sweepUnkeepableTiles();
  const s = layersStore.getState();
  setBase(s.base);
  setOverlay('enc', !!s.enc);
  setOverlay('seamark', !!s.seamark);
}

/* Every launch: remove the stored tiles of the layers whose terms forbid keeping them — the
   retired CARTO labels (watermark images now, and CARTO allows no device copy past 30 days), and
   the Esri, OpenStreetMap and OpenSeaMap tiles older builds cached and the /classic/ app on this
   origin still caches — and correct the saved areas that named them (download.js). Not a one-time
   flag: an interrupted sweep commits nothing and is simply run again, and a cheap no-op once the
   store is clean. Never awaited, so it cannot hold up boot; download.js is loaded on demand, as
   its panel is. Skipped while offline storage is not open. */
function sweepUnkeepableTiles() {
  if (!_db) return;
  import('./download.js').then((m) => m.sweepUnkeepableTiles()).catch(() => {});
}

export function setBase(id, isUserAction) {
  if (!BASES.some((b) => b.id === id)) id = 'ocean';
  const prevBase = live.base;
  live.base = trackLayer(makeLayer(id)).addTo(map);
  live.base.setZIndex(0);
  if (prevBase) fadeOutRemove(prevBase);   // cross-fade rather than a hard swap
  /* A base whose terms forbid keeping its tiles (Esri, OpenStreetMap) has nothing stored to show
     with no signal, so the free-to-keep GEBCO chart sits underneath it. The base's own tiles
     cover it once they load; it is what shows offline or wherever a base tile fails. It keeps the
     tiles you browse (few: it stops at z10) and an area download saves it in the base's place,
     so a browsed or downloaded area is never a blank chart. Not tracked for the busy spinner —
     it is never the layer you are waiting on. */
  const wantFallback = !canSaveOffline(id);
  if (wantFallback && !live.fallback) { live.fallback = makeLayer(OFFLINE_BASE).addTo(map); live.fallback.setZIndex(-1); }
  if (!wantFallback && live.fallback) { fadeOutRemove(live.fallback); live.fallback = null; }
  /* Bring up the detail overlay that belongs to this base, and drop the other one. */
  const want = RELIEF_DETAIL[id] || null;
  ['reliefhi', 'blueshade'].forEach((slot) => {
    if (slot !== want && live[slot]) { fadeOutRemove(live[slot]); live[slot] = null; }
  });
  if (want && !live[want]) {
    live[want] = trackLayer(makeLayer(want)).addTo(map);
    live[want].setZIndex(1);
    /* GMRT's hillshade is dark and contrasty, so multiply is right for it. BlueTopo's is
       flat grayscale centred near 0.71 — multiply would just wash the whole chart grey, so
       it is recentred and amplified in updateChartFilter() and composited with overlay,
       which leaves flat bottom alone and only carves the slopes. */
    live[want]._container.style.mixBlendMode = (want === 'reliefhi') ? 'multiply' : 'overlay';
  }
  layersStore.setState({ base: id });
  document.documentElement.dataset.base = id;   // night-mode chart dimming keys off the base (base.css)
  savePrefs();
  /* NAVIONICS-STYLE relief: the base is blue depth-shading, and the NOAA vector chart is drawn
     on top with 'multiply' blend — that turns the chart's white deep-water transparent while
     keeping contours & soundings fully dark and razor-sharp at any zoom. So the relief base
     always wants the chart on. (Kept exactly as legacy: this applies at boot too.) */
  void isUserAction;
  if (RELIEF_DETAIL[id]) {
    if (!live.enc) setOverlay('enc', true);
    else { layersStore.setState({ enc: true }); savePrefs(); }
  }
  updateEncBlend();
  updateChartFilter();
}

/* Recolour the BlueTopo base through the SVG lookup table, and sharpen its hillshade.
   Set on the Leaflet tile container, matching how updateEncBlend() sets blend mode.

   NOTE: `filter` makes an element a containing block for position:fixed descendants. The
   tile container is not an ancestor of any fixed UI, so this is safe here — but it must never
   be moved up the tree onto #map or #root, which would silently break every fixed element. */
export function updateChartFilter() {
  if (!map) return;
  if (live.base && live.base._container) {
    const cs = getComputedStyle(document.documentElement);
    const lut = (cs.getPropertyValue('--chart-lut') || 'url(#lut-day)').trim();
    const trim = (cs.getPropertyValue('--chart-trim') || 'contrast(1.28) saturate(1.12)').trim();
    /* `none` cannot be composed with another filter function: 'url(#lut-night) none' is invalid
       CSS and the browser silently ignored the whole assignment (night mode never applied). */
    const composed = !trim || trim === 'none' ? lut : lut + ' ' + trim;
    live.base._container.style.filter = (layersStore.getState().base === 'bluetint') ? composed : '';
  }
  if (live.blueshade && live.blueshade._container) {
    /* Measured p5..p95 of only 0.68..0.74, so recentre to neutral then amplify hard.
       contrast(3) is visibly flat; contrast(9) starts amplifying survey-track striping. */
    live.blueshade._container.style.filter = 'brightness(0.70) contrast(6)';
  }
  /* Night over the US bathymetry base: the base is already dark through #lut-night, so the
     whole-pane dim in base.css is skipped for it — but the chart overlays drawn on top (NOAA
     chart, seamarks) would stay glaring white. Dim those layer containers individually. */
  const nightOverBluetint = document.documentElement.dataset.theme === 'night' && layersStore.getState().base === 'bluetint';
  ['enc', 'seamark'].forEach((id) => {
    const c = live[id] && live[id]._container;
    if (c) c.style.filter = nightOverBluetint ? 'brightness(0.45) saturate(0.6)' : '';
  });
}

export function setOverlay(id, on) {
  if (on && !live[id]) { live[id] = trackLayer(makeLayer(id)).addTo(map); live[id].setZIndex(id === 'enc' ? 5 : 6); }
  if (!on && live[id]) { fadeOutRemove(live[id]); live[id] = null; }
  layersStore.setState({ [id]: !!on });
  savePrefs();
  if (id === 'enc') updateEncBlend();
  updateChartFilter();   // a newly added overlay picks up the night dim
}

/* Multiply-blend the chart onto the blue relief base; normal blend over other bases. */
function updateEncBlend() {
  if (live.enc && live.enc._container) {
    live.enc._container.style.mixBlendMode = (layersStore.getState().base === 'gmrt') ? 'multiply' : 'normal';
  }
}

/* ---- data overlays ---- */
let reefsReady = false;
const ENABLERS = {
  wind: (on) => windOverlayEnable(on),
  sst: (on) => sstEnable(on),
  rain: (on) => rainEnable(on),
  fish: (on) => fishEnable(on),
  reefs: (on) => { if (reefsReady) reefsSetVisible('reefs', on); },
  mpa: (on) => { if (reefsReady) reefsSetVisible('mpa', on); },
};

/** Turn a data overlay on/off (Layers panel, First Mate, voice). Persists the choice. */
export function setDataOverlay(id, on) {
  if (!ENABLERS[id]) return;
  layersStore.setState({ [id]: !!on });
  persisted[id] = !!on;
  savePrefs();
  try { ENABLERS[id](!!on); } catch (e) { console.error('overlay ' + id, e); }
}

/** A module corrects the SHOWN state without re-running its enabler — e.g. SST refusing to turn on
 *  offline must leave the toggle OFF (legacy unchecked its box). Synchronous, and never persisted:
 *  only a user toggle (setDataOverlay) changes the saved choice. */
export function reportDataOverlay(id, on) {
  if (layersStore.getState()[id] === !!on) return;
  layersStore.setState({ [id]: !!on });
}

/** Boot: switch on whatever the saved prefs say. Reefs/MPAs apply the CURRENT state once their
 *  bundled data has loaded — not the boot-time snapshot, which used to override a toggle made
 *  while the data was still loading. */
export function initDataOverlays(reefsLoaded) {
  const s = layersStore.getState();
  ['wind', 'fish', 'sst', 'rain'].forEach((id) => { if (s[id]) { try { ENABLERS[id](true); } catch (e) { console.error(e); } } });
  Promise.resolve(reefsLoaded).then(() => {
    reefsReady = true;
    const now = layersStore.getState();
    try { reefsSetVisible('reefs', !!now.reefs); reefsSetVisible('mpa', !!now.mpa); } catch (e) { console.error(e); }
  }).catch(() => {});
}
