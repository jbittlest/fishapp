import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { GPS, bearingBetween, mapProgrammatic, nmBetween, setFollow } from './gps.js';
import { openSpotModal } from './spots.js';
import { gotoStart } from './goto.js';
import { queryPointData, M_TO_FT, M_TO_FATHOM } from './inspect.js';
import { compass } from './weather.js';
import { navHandleClick } from './nav.js';
import { layersStore, setDataOverlay } from './layers.js';
import { getMap } from './app.js';
import { closeCard, closePanels, openCard, uiStore, updateCard } from '../services/ui';

/* California artificial reefs + Marine Protected Areas (bundled, works offline) */
'use strict';

export const Reefs = {
  reefLayer: null,
  mpaLayer: null,
  reefs: [],
  loaded: false,
};

/* MPA type → how restrictive for fishing. Red = no take, orange = restricted.
   The colours are DATA (the meaning of the zone), not chrome — they stay literal, and the
   `kind` drives the card's wording and the polygon's CSS class. */
export const MPA_STYLE = {
  'SMR':            { c: '#e8453d', kind: 'notake', take: 'No take — no fishing allowed' },
  'FMR':            { c: '#e8453d', kind: 'notake', take: 'No take — no fishing allowed' },
  'SMRMA':          { c: '#e8453d', kind: 'notake', take: 'No take (managed area)' },
  'SMCA (No-Take)': { c: '#e8453d', kind: 'notake', take: 'No take — no fishing allowed' },
  'Special Closure':{ c: '#c026d3', kind: 'closure', take: 'Special closure — check regulations' },
  'SMCA':           { c: '#f2803d', kind: 'limited', take: 'Restricted — some fishing allowed, check rules' },
  'FMCA':           { c: '#f2803d', kind: 'limited', take: 'Restricted — some fishing allowed, check rules' },
  'SMP':            { c: '#f2803d', kind: 'limited', take: 'Restricted — check regulations' },
};
export function mpaStyle(t) { return MPA_STYLE[t] || { c: '#f2803d', kind: 'limited', take: 'Restricted — check regulations' }; }

/* What the designation letters stand for (shown on the MPA card). */
export const MPA_TYPE_NAMES = {
  'SMR': 'State Marine Reserve',
  'FMR': 'Federal Marine Reserve',
  'SMRMA': 'State Marine Recreational Management Area',
  'SMCA (No-Take)': 'State Marine Conservation Area (no-take)',
  'Special Closure': 'Special Closure',
  'SMCA': 'State Marine Conservation Area',
  'FMCA': 'Federal Marine Conservation Area',
  'SMP': 'State Marine Park',
};
/** California Department of Fish and Wildlife — Marine Protected Areas (opened outside the app). */
export const CDFW_MPA_URL = 'https://wildlife.ca.gov/Conservation/Marine/MPAs';

/* ---- View store: the Spots panel's "Nearest reefs" ----
   status stays 'loading' until reefsInit settles, so a panel opened during the load shows a
   spinner and then the list — never the old permanent "No reef data loaded." */
/** @typedef {{ n: string, la: number, lo: number, d?: number, c?: string }} Reef */
/** @typedef {{ key: string, reef: Reef, distNm: number, brgDeg: number }} ReefRow */
/**
 * @typedef {Object} ReefsView
 * @property {'loading'|'ready'|'error'} status
 * @property {string} error
 * @property {ReefRow[]} items       the 12 nearest
 * @property {'gps'|'map'} from      distances measured from the boat, or from the chart centre
 * @property {number} total
 */
/** @type {import('zustand/vanilla').StoreApi<ReefsView>} */
export const reefsStore = createStore(() => /** @type {ReefsView} */ ({ status: 'loading', error: '', items: [], from: 'map', total: 0 }));

function theMap() { return getMap() || window._map || null; }

export async function reefsInit(map) {
  if (!Reefs.reefLayer) Reefs.reefLayer = L.layerGroup();
  if (!Reefs.mpaLayer) Reefs.mpaLayer = L.layerGroup();
  reefsStore.setState({ status: 'loading', error: '' });
  try {
    const [reefs, mpas] = await Promise.all([
      fetch('./data/reefs-ca.json').then((r) => r.json()),
      fetch('./data/mpa-ca.json').then((r) => r.json()),
    ]);
    Reefs.reefs = reefs;
    Reefs.reefLayer.clearLayers(); Reefs.mpaLayer.clearLayers();   // a retry rebuilds, never doubles
    buildReefMarkers(reefs);
    buildMpaPolygons(mpas);
    Reefs.loaded = true;
    reefsStore.setState({ status: 'ready', error: '', total: reefs.length });
    reefsRefreshNearest(map);
  } catch (e) { /* data missing — layers just stay empty */
    reefsStore.setState({ status: 'error', error: (e && e.message) || String(e) });
  }
}

/** Retry the bundled-data load (the panel's Retry), then apply the CURRENT layer toggles. */
export async function reefsRetry() {
  const map = theMap();
  if (!map) return;
  await reefsInit(map);
  if (Reefs.loaded) {
    const s = layersStore.getState();
    reefsSetVisible('reefs', !!s.reefs);
    reefsSetVisible('mpa', !!s.mpa);
  }
}

const REEF_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 20h18"/><path d="M5 20c0-3 1.5-5 3-5s1.5 2 3 2 1-4 3-4 3 3.5 3 7"/><path d="M8 15V9"/><path d="M8 11l-2-2"/><path d="M14 13V7"/><path d="M14 9l2-2"/></svg>';

export function buildReefMarkers(reefs) {
  /* One shared icon — 142 identical markers. Shape-coded (a rounded square, spots are discs)
     so the two still read apart in the red night mode. */
  const icon = L.divIcon({
    className: 'spot-reefmk-wrap',
    html: '<div class="spot-reefmk">' + REEF_GLYPH + '</div>',
    iconSize: [24, 24], iconAnchor: [12, 12],
  });
  reefs.forEach((r) => {
    const m = L.marker([r.la, r.lo], { icon, title: r.n, alt: r.n });
    m.on('click', () => {
      const ll = L.latLng(r.la, r.lo);
      // route planner / measure tool active: the reef becomes a waypoint at its exact spot
      if (typeof navHandleClick === 'function' && navHandleClick(ll)) return;
      openReefCard(r);
    });
    m.addTo(Reefs.reefLayer);
  });
}

/* Open the reef card, then fetch live wind/swell/seabed depth for it */
export function openReefCard(r) {
  const s = navigator.onLine ? 'loading' : 'offline';
  const results = { wind: s, swell: s, depth: s, sst: s };
  openCard('reef', { reef: r, live: Object.assign({}, results) }, { lat: r.la, lng: r.lo });
  const card = uiStore.getState().card;
  const id = card ? card.id : -1;
  /* updateCard is a no-op once this card has been closed or replaced, so late answers from a
     slow network never land on the wrong card. */
  const update = () => { updateCard(id, { live: Object.assign({}, results) }); };
  if (navigator.onLine) queryPointData(L.latLng(r.la, r.lo), results, update);
  else update();   // offline: render the "needs internet" states instead of a stuck spinner
}

/* ---- Live conditions → view data (pure; the card renders these) ----
   Same states and words as the legacy popup formatters (inspect.js windText & co.):
   'loading' (spinner), 'offline' → "needs internet", 'nodata', 'error' → "unavailable". */
/**
 * @typedef {{ state: 'loading'|'offline'|'nodata'|'error'|'ok'|'land', msg?: string,
 *   kn?: number, gustKn?: number|null, dir?: string, towardDeg?: number|null,
 *   ft?: number, m?: number, fa?: number, periodS?: number|null, f?: number }} LiveCell
 */
const LIVE_MSG = { offline: 'needs internet', error: 'unavailable' };
function statusCell(v, nodataMsg) {
  if (v === 'loading') return { state: 'loading' };
  if (v === 'offline') return { state: 'offline', msg: LIVE_MSG.offline };
  if (v === 'nodata') return { state: 'nodata', msg: nodataMsg };
  return null;
}
const finite = (v) => typeof v === 'number' && isFinite(v);

/** @returns {{ wind: LiveCell, swell: LiveCell, water: LiveCell, seabed: LiveCell }} */
export function reefLiveView(live) {
  const L0 = live || {};
  /** @type {LiveCell} */
  let wind = statusCell(L0.wind, 'unavailable');
  if (!wind) {
    const w = L0.wind;
    if (w === 'error' || !w || w.wind_speed_10m == null) wind = { state: 'error', msg: LIVE_MSG.error };
    else wind = {
      state: 'ok', kn: Math.round(w.wind_speed_10m), dir: compass(w.wind_direction_10m),
      // wind arrows point where the wind blows TOWARD (legacy dirArrow semantics)
      towardDeg: finite(w.wind_direction_10m) ? (w.wind_direction_10m + 180) % 360 : null,
      gustKn: finite(w.wind_gusts_10m) ? Math.round(w.wind_gusts_10m) : null,
    };
  }
  /** @type {LiveCell} */
  let swell = statusCell(L0.swell, 'no marine data (inland?)');
  if (!swell) {
    const s = L0.swell;
    const h = s && typeof s === 'object' ? s.swell_wave_height : null;
    if (s === 'error' || !s || h === null || h === undefined) swell = { state: 'error', msg: LIVE_MSG.error };
    else swell = {
      state: 'ok', ft: +(h * M_TO_FT).toFixed(1),
      periodS: finite(s.swell_wave_period) ? Math.round(s.swell_wave_period) : null,
      dir: compass(s.swell_wave_direction),
    };
  }
  /** @type {LiveCell} */
  let water = statusCell(L0.sst, 'no data');
  if (!water) {
    const v = L0.sst;
    if (v === 'error' || v === null || v === undefined || !finite(v)) water = { state: 'error', msg: LIVE_MSG.error };
    else water = { state: 'ok', f: +v.toFixed(1) };
  }
  /** @type {LiveCell} */
  let seabed = statusCell(L0.depth, 'no survey data here');
  if (!seabed) {
    const v = L0.depth;
    if (v === 'error' || !finite(v)) seabed = { state: 'error', msg: LIVE_MSG.error };
    else if (v >= 0) seabed = { state: 'land', msg: 'land (' + Math.round(v * M_TO_FT) + ' ft above sea)' };
    else {
      const ft = Math.abs(v) * M_TO_FT;
      seabed = { state: 'ok', ft: +ft.toFixed(ft < 100 ? 1 : 0), m: +Math.abs(v).toFixed(1), fa: +(Math.abs(v) * M_TO_FATHOM).toFixed(1) };
    }
  }
  return { wind, swell, water, seabed };
}

/** Distance/bearing line for the card: from the boat when there is a fix. */
export function reefDistBrg(here, r) {
  if (!here || !r) return { distNm: null, brgDeg: null };
  const from = L.latLng(here.lat, here.lng), ll = L.latLng(r.la, r.lo);
  return { distNm: nmBetween(from, ll), brgDeg: Math.round(bearingBetween(from, ll)) % 360 };
}

/** Navigate: a Go-To to the reef (gotoStart may ask before discarding a voyage — awaited). */
export async function navigateToReef(r) {
  if (!r) return false;
  closeCard('reef');
  return !!(await gotoStart({ lat: r.la, lng: r.lo }, r.n));
}

/** Save as spot: the spot editor, prefilled as a wreck/structure with the reef's facts. */
export function saveReefAsSpot(r) {
  closeCard('reef');
  openSpotModal({ lat: r.la, lng: r.lo, name: r.n, type: 'wreck',
    notes: (r.d ? r.d + ' ft. ' : '') + (r.c || '') });
}

export function buildMpaPolygons(mpas) {
  mpas.forEach((mpa) => {
    const st = mpaStyle(mpa.t);
    const layer = L.geoJSON(mpa.g, {
      style: { color: st.c, weight: 1.5, fillColor: st.c, fillOpacity: 0.18, className: 'spot-mpa spot-mpa--' + st.kind },
    });
    layer.on('click', (e) => {
      /* Stop the tap here so tap-to-inspect does not open over the MPA card (the legacy
         popup stopped it the same way) — unless the route/measure tool wants the point. */
      L.DomEvent.stop(e);
      if (typeof navHandleClick === 'function' && navHandleClick(e.latlng)) return;
      openCard('mpa', {
        name: mpa.n || 'Marine Protected Area',
        type: mpa.t || '',
        typeName: MPA_TYPE_NAMES[mpa.t] || '',
        take: st.take,
        kind: st.kind,
        color: st.c,
      }, { lat: e.latlng.lat, lng: e.latlng.lng });
    });
    layer.addTo(Reefs.mpaLayer);
  });
}

export function reefsSetVisible(which, on) {
  const layer = which === 'reefs' ? Reefs.reefLayer : Reefs.mpaLayer;
  const map = theMap();
  if (!layer || !map) return;
  if (on) layer.addTo(map); else map.removeLayer(layer);
}

/* ---- Nearest reefs list for the Spots panel ---- */
/** The n nearest reefs to an L.LatLng (pure). */
export function nearestReefs(reefs, here, n) {
  if (!here || !reefs || !reefs.length) return [];
  return reefs.slice().sort((a, b) =>
    here.distanceTo(L.latLng(a.la, a.lo)) - here.distanceTo(L.latLng(b.la, b.lo)))
    .slice(0, n)
    .map((r) => {
      const ll = L.latLng(r.la, r.lo);
      return { key: r.n + '|' + r.la + '|' + r.lo, reef: r, distNm: nmBetween(here, ll), brgDeg: Math.round(bearingBetween(here, ll)) % 360 };
    });
}

/** Publish the 12 nearest reefs (to the GPS fix, else the chart centre). */
export function reefsRefreshNearest(mapArg) {
  if (!Reefs.loaded) return;
  const map = mapArg || theMap();
  const fromGps = !!GPS.lastLatLng;
  const here = GPS.lastLatLng || (map ? map.getCenter() : null);
  reefsStore.setState({ items: nearestReefs(Reefs.reefs, here, 12), from: fromGps ? 'gps' : 'map' });
}
/** Legacy name (the old panel-open hook). */
export function renderReefsList() { reefsRefreshNearest(); }

/** Fly to a reef from the list: turn the reef layer on through the layer owner (so the
 *  choice persists — the legacy list flipped the checkbox without saving it), then move. */
export function flyToReef(r) {
  const map = theMap();
  if (!map || !r) return;
  const ll = L.latLng(r.la, r.lo);
  closePanels();
  setFollow(false);
  if (!layersStore.getState().reefs) setDataOverlay('reefs', true);
  mapProgrammatic(() => map.setView(ll, Math.max(map.getZoom(), 14)));
  openReefCard(r);
}
