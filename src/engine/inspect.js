import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { GPS, bearingBetween, nmBetween } from './gps.js';
import { openSpotModal } from './spots.js';
import { compass, showAreaForecast } from './weather.js';
import { gotoStart } from './goto.js';
import { closeCard, openCard } from '../services/ui';

/* Tap-to-inspect: single-tap the map to get depth, wind and swell at that point */
'use strict';

export const Inspect = {
  ll: null,       // L.LatLng of the open card (lng normalised)
  reqId: 0,
};

export const M_TO_FT = 3.28084;
export const M_TO_FATHOM = 0.546807;

/* What the `inspect` map card (features/weather/InspectCard) renders. Each result fills in
   independently: 'loading' | 'offline' | 'nodata' | 'error' | the value (depth: metres, +up;
   wind / swell: the Open-Meteo `current` object; sst: °F). */
/** @typedef {'loading'|'offline'|'nodata'|'error'} PointState */
/**
 * @typedef {{ depth: PointState|number, wind: PointState|Record<string, any>,
 *   swell: PointState|Record<string, any>, sst: PointState|number }} PointResults
 */
/**
 * @typedef {{ reqId: number, lat: number|null, lng: number|null, distNm: number|null, brgDeg: number|null,
 *   results: PointResults }} InspectView
 */
/** @type {import('zustand/vanilla').StoreApi<InspectView>} */
export const inspectStore = createStore(() => /** @type {InspectView} */ ({
  reqId: 0, lat: null, lng: null, distNm: null, brgDeg: null,
  results: { depth: 'loading', wind: 'loading', swell: 'loading', sst: 'loading' },
}));

export function inspectAt(latlng) {
  const id = ++Inspect.reqId;         // cancels stale responses if you tap again fast
  const ll = L.latLng(latlng.lat, ((latlng.lng + 540) % 360) - 180);   // worldCopyJump can hand us lng outside ±180
  Inspect.ll = ll;

  let distNm = null, brgDeg = null;
  if (GPS.lastLatLng) {
    distNm = nmBetween(GPS.lastLatLng, ll);
    brgDeg = Math.round(bearingBetween(GPS.lastLatLng, ll));
  }

  // Offline shows "needs internet" straight away rather than a spinner that never resolves
  const online = navigator.onLine;
  const s = online ? 'loading' : 'offline';
  /** @type {PointResults} */
  const results = { depth: s, wind: s, swell: s, sst: s };

  inspectStore.setState({ reqId: id, lat: ll.lat, lng: ll.lng, distNm, brgDeg, results: { ...results } });
  openCard('inspect', { reqId: id, lat: ll.lat, lng: ll.lng }, { lat: ll.lat, lng: ll.lng });

  const update = () => {
    if (id !== Inspect.reqId) return;          // a newer tap owns the card now
    inspectStore.setState({ results: { ...results } });
  };

  if (!online) { update(); return; }
  queryPointData(ll, results, update);
}

/* Reusable: fetch depth + wind + swell for a point, calling onUpdate after each
   arrives. Mutates the passed `results` object. Shared by tap-to-inspect and reefs. */
export function queryPointData(ll, results, onUpdate) {
  if (!navigator.onLine) { onUpdate(); return; }

  /* Depth — NOAA NCEI DEM point identify (US coastal high-res, else global) */
  fetch('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/identify' +
    '?geometry=' + encodeURIComponent(JSON.stringify({ x: ll.lng, y: ll.lat })) +
    '&geometryType=esriGeometryPoint&sr=4326&returnGeometry=false&returnCatalogItems=false&f=json')
    .then((r) => r.json())
    .then((d) => {
      const v = parseFloat(d.value);
      results.depth = (d.value === 'NoData' || isNaN(v)) ? 'nodata' : v;
      onUpdate();
    })
    .catch(() => { results.depth = 'error'; onUpdate(); });

  /* Wind — Open-Meteo */
  fetch('https://api.open-meteo.com/v1/forecast?latitude=' + ll.lat.toFixed(3) +
    '&longitude=' + ll.lng.toFixed(3) +
    '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn')
    .then((r) => r.json())
    .then((d) => { results.wind = d.current || 'error'; onUpdate(); })
    .catch(() => { results.wind = 'error'; onUpdate(); });

  /* Swell + water temp — Open-Meteo marine */
  fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + ll.lat.toFixed(3) +
    '&longitude=' + ll.lng.toFixed(3) +
    '&current=swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,sea_surface_temperature' +
    '&temperature_unit=fahrenheit')
    .then((r) => r.ok ? r.json() : null)
    .then((d) => {
      const c = d && d.current && !d.error ? d.current : null;
      results.swell = c || 'nodata';
      results.sst = (c && c.sea_surface_temperature !== null && c.sea_surface_temperature !== undefined)
        ? c.sea_surface_temperature : 'nodata';
      onUpdate();
    })
    .catch(() => { results.swell = 'error'; results.sst = 'error'; onUpdate(); });
}

/* ---- Card actions (legacy bindMarkButton): close the card, then act ---- */
export function inspectSaveSpot() {
  const ll = Inspect.ll; if (!ll) return;
  closeCard('inspect');
  openSpotModal({ lat: ll.lat, lng: ll.lng });
}
/** Resolves to gotoStart's answer (false when the user kept a voyage already in progress). */
export async function inspectNavigate() {
  const ll = Inspect.ll; if (!ll) return false;
  closeCard('inspect');
  return await Promise.resolve(gotoStart(ll, 'Pin ' + ll.lat.toFixed(3) + ', ' + ll.lng.toFixed(3)));
}
export function inspectAreaForecast() {
  const ll = Inspect.ll; if (!ll) return;
  closeCard('inspect');
  showAreaForecast(ll);
}

/* ---- Readings as plain text (reefs.js and the cards). The legacy versions returned HTML
   fragments; these return the same words with no markup, and never "0" for a missing value. */

/** The non-value states, in the legacy wording. Returns null for a real value. */
function stateText(v, nodataText) {
  if (v === 'loading') return '…';
  if (v === 'offline') return 'needs internet';
  if (v === 'nodata') return nodataText;
  if (v === 'error' || v === null || v === undefined) return 'unavailable';
  return null;
}

export function sstText(v) {
  const st = stateText(v, 'no data');
  if (st != null) return st;
  if (!isFinite(v)) return 'unavailable';
  return Number(v).toFixed(1) + '°F';
}

/** Depth parts: land is ≥ 0 (height above sea), water is negative metres. */
export function depthInfo(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v >= 0) return { land: true, aboveFt: Math.round(v * M_TO_FT), ft: null, m: null, fathoms: null };
  const m = Math.abs(v);
  return { land: false, aboveFt: null, ft: m * M_TO_FT, m, fathoms: m * M_TO_FATHOM };
}

export function depthText(v) {
  const st = stateText(v, 'no survey data here');
  if (st != null) return st;
  const d = depthInfo(v);
  if (!d) return 'unavailable';
  if (d.land) return 'land (' + d.aboveFt + ' ft above sea)';
  return d.ft.toFixed(d.ft < 100 ? 1 : 0) + ' ft (' + d.m.toFixed(1) + ' m · ' + d.fathoms.toFixed(1) + ' fa)';
}

export function windText(w) {
  if (w === 'loading') return '…';
  if (w === 'offline') return 'needs internet';
  if (w === 'error' || !w || w.wind_speed_10m == null) return 'unavailable';
  const kn = Math.round(w.wind_speed_10m);
  // a missing gust reads "gust —", never "gust 0" (or NaN)
  const gust = w.wind_gusts_10m == null || !isFinite(w.wind_gusts_10m) ? '—' : Math.round(w.wind_gusts_10m);
  /* compass words only: the legacy arrow glyph (dirArrow) has emoji forms on some
     platforms, and the cards draw a real direction dial instead */
  const dir = w.wind_direction_10m == null ? '' : ' from ' + compass(w.wind_direction_10m);
  return kn + ' kn' + dir + ' gust ' + gust;
}

export function swellText(s) {
  if (s === 'loading') return '…';
  if (s === 'offline') return 'needs internet';
  if (s === 'nodata') return 'no marine data (inland?)';
  if (s === 'error' || !s) return 'unavailable';
  const h = s.swell_wave_height;
  if (h === null || h === undefined || !isFinite(h)) return 'unavailable';
  const ft = h * M_TO_FT;
  // period / direction are separately nullable — never "@ 0s"
  const per = s.swell_wave_period != null && isFinite(s.swell_wave_period) ? ' @ ' + Math.round(s.swell_wave_period) + 's' : '';
  const dir = s.swell_wave_direction != null && isFinite(s.swell_wave_direction) ? ' ' + compass(s.swell_wave_direction) : '';
  return ft.toFixed(1) + ' ft' + per + dir;
}
