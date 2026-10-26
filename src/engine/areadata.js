import L from 'leaflet';
import { idb } from './db.js';
import { nmBetween } from './gps.js';
import { Reefs } from './reefs.js';
import { FISH_TAXA } from './fish.js';
import { nearestTideStation } from './tides.js';

/* Offline "area intelligence pack": when you download an area, we also capture
   the environmental data for it — a multi-day wind/wave/tide/water-temp
   forecast, a sea-surface-temp grid, recent fish-sighting history, and
   protected-area closures — so First Mate can answer questions about that
   area with zero signal. Stored on the area record in IndexedDB. */
'use strict';

export const AreaData = { packs: [] };

export async function areaDataInit() {
  try { AreaData.packs = await idb.getAll('areas'); } catch (e) { AreaData.packs = []; }
}
export async function areaDataRefresh() { await areaDataInit(); }

/* Most-recently-captured pack whose bounds contain a point (or null).
   A pack where nothing usable was captured (areaPackHealth level 'none' — e.g. the signal
   dropped during the data phase) is skipped: First Mate used to be told "an area pack covers
   this location" and then read an empty one. An older pack with real data still serves. */
export function areaPackFor(ll) {
  if (!ll || !AreaData.packs) return null;
  const inside = AreaData.packs.filter((a) => a.data && !a.data.cancelled && a.bounds &&
    ll.lat <= a.bounds.n && ll.lat >= a.bounds.s && ll.lng <= a.bounds.e && ll.lng >= a.bounds.w &&
    areaPackHealth(a.data).level !== 'none');
  if (!inside.length) return null;
  inside.sort((a, b) => (b.data.capturedTs || b.ts) - (a.data.capturedTs || a.ts));
  return inside[0];
}

/* ---------- Build the pack (called by download.js while online) ----------
   `isCancelled` (optional) is checked between sections: Cancel used to be ignored once the
   pack phase began, leaving the user watching six more network calls finish. A cancelled
   build resolves `{ cancelled: true }`; download.js discards it (never stored as data). */
export async function buildAreaPack(bounds, onProgress, isCancelled) {
  const c = bounds.getCenter();
  const stop = () => !!(isCancelled && isCancelled());
  const step = (m) => {
    if (stop()) throw new PackCancelled();
    if (onProgress) onProgress(m);
  };
  try {
    return await buildAreaPackSections(bounds, c, step, stop);
  } catch (e) {
    if (e instanceof PackCancelled) return { cancelled: true, capturedTs: Date.now() };
    throw e;
  }
}
export class PackCancelled extends Error { constructor() { super('cancelled'); this.name = 'PackCancelled'; } }

async function buildAreaPackSections(bounds, c, step, stop) {
  const pack = {
    capturedTs: Date.now(),
    center: { lat: c.lat, lng: c.lng },
    bounds: { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() },
  };

  // 7-day hourly weather at the area center
  try {
    step('weather forecast');
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lng +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation_probability' +
      '&wind_speed_unit=kn&temperature_unit=fahrenheit&forecast_days=7&timezone=auto');
    const j = await r.json();
    /* An error body (HTTP 400/429 → {error, reason}) has no hourly block: flag it, never
       store a forecast with no hours in it as if it had been captured. */
    if (!j || !j.hourly || !nonEmpty(j.hourly.time)) throw new Error((j && j.reason) || 'no forecast in the response');
    pack.forecast = {
      time: j.hourly.time, wind: j.hourly.wind_speed_10m, gust: j.hourly.wind_gusts_10m,
      dir: j.hourly.wind_direction_10m, temp: j.hourly.temperature_2m, precip: j.hourly.precipitation_probability,
    };
  } catch (e) { if (e instanceof PackCancelled) throw e; pack.forecastError = true; }

  // 7-day hourly seas + water temp
  try {
    step('wave & water-temp forecast');
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + c.lat + '&longitude=' + c.lng +
      '&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&temperature_unit=fahrenheit&forecast_days=7&timezone=auto');
    const j = await r.json();
    if (!j || !j.hourly || !nonEmpty(j.hourly.time)) throw new Error((j && j.reason) || 'no marine forecast in the response');
    pack.marine = {
      time: j.hourly.time, wave_m: j.hourly.wave_height, period: j.hourly.wave_period,
      wdir: j.hourly.wave_direction, sst: j.hourly.sea_surface_temperature,
    };
  } catch (e) { if (e instanceof PackCancelled) throw e; pack.marineError = true; }

  /* Flag these like every other section. Swallowed silently, a partly-failed pack was
     indistinguishable from a complete one — First Mate just omitted water temp or
     depth, and nothing ever prompted a re-download. */
  try { step('sea-temperature grid'); pack.sstGrid = await fetchSstGrid(bounds); } catch (e) { if (e instanceof PackCancelled) throw e; pack.sstError = true; }
  try { step('depth grid'); pack.depthGrid = await fetchDepthGrid(bounds); } catch (e) { if (e instanceof PackCancelled) throw e; pack.depthError = true; }

  // A week of tide highs/lows at the nearest station
  try {
    step('tide predictions');
    if (typeof nearestTideStation === 'function') {
      const st = nearestTideStation(L.latLng(c.lat, c.lng));
      if (st) {
        const fmt = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        const r = await fetch('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo&datum=MLLW&units=english&time_zone=lst_ldt&format=json&station=' +
          st.id + '&begin_date=' + fmt(new Date()) + '&end_date=' + fmt(new Date(Date.now() + 7 * 864e5)));
        const j = await r.json();
        /* NOAA answers a bad request with HTTP 200 and {error: {message}} — no predictions.
           That used to be stored as a tide section with zero turns and counted as captured. */
        if (!j || !nonEmpty(j.predictions)) throw new Error((j && j.error && j.error.message) || 'no tide predictions in the response');
        pack.tides = {
          station: st.n, id: st.id,
          dist_nm: +nmBetween(L.latLng(c.lat, c.lng), L.latLng(st.la, st.lo)).toFixed(0),
          preds: (j.predictions || []).map((p) => ({ t: p.t, type: p.type, v: +parseFloat(p.v).toFixed(1) })),
        };
      }
    }
  } catch (e) { if (e instanceof PackCancelled) throw e; pack.tidesError = true; }

  // Recent fish-sighting history in the bounds (iNaturalist)
  try {
    step('recent fish sightings');
    if (typeof FISH_TAXA !== 'undefined') {
      const r = await fetch('https://api.inaturalist.org/v1/observations?taxon_id=' + encodeURIComponent(FISH_TAXA) +
        '&nelat=' + bounds.getNorth() + '&nelng=' + bounds.getEast() + '&swlat=' + bounds.getSouth() + '&swlng=' + bounds.getWest() +
        '&per_page=100&order_by=observed_on&order=desc&geo=true&quality_grade=research&geoprivacy=open');
      const j = await r.json();
      /* An error body has no results array. It used to become {total: 0} — "no fish seen
         here", stated as fact — instead of "the sightings could not be fetched". */
      if (!j || !Array.isArray(j.results)) throw new Error('no sightings in the response');
      const tally = {}, recent = [];
      (j.results || []).forEach((o) => {
        const n = (o.taxon && (o.taxon.preferred_common_name || o.taxon.name)) || 'unknown';
        tally[n] = (tally[n] || 0) + 1;
        if (recent.length < 12 && o.observed_on) recent.push({ species: n, date: o.observed_on });
      });
      /* total_results is the real count. `results.length` is capped by per_page=100,
         so this was handed to First Mate as "100 sightings" for an area with
         thousands — which it then stated as fact. */
      const sampled = (j.results || []).length;
      pack.fish = { total: (j.total_results != null ? j.total_results : sampled), sampled, tally, recent };
    }
  } catch (e) { if (e instanceof PackCancelled) throw e; pack.fishError = true; }

  // Protected-area closures intersecting the bounds (bundled data)
  try {
    step('protected-area closures');
    const r = await fetch('./data/mpa-ca.json');
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.features || j.mpas || []);
    const inb = [];
    for (const m of arr) {
      const bb = mpaBBox(m);
      if (bb && bboxIntersect(bb, bounds)) inb.push({ n: m.n || m.name, t: m.t || m.type });
    }
    pack.mpas = inb;
  } catch (e) { if (e instanceof PackCancelled) throw e; /* ignore */ }

  // Reef count inside the bounds (reefs are bundled globally; just note how many)
  try {
    if (typeof Reefs !== 'undefined' && Reefs.reefs) {
      pack.reefCount = Reefs.reefs.filter((r) =>
        r.la <= bounds.getNorth() && r.la >= bounds.getSouth() && r.lo <= bounds.getEast() && r.lo >= bounds.getWest()).length;
    }
  } catch (e) { /* ignore */ }

  if (stop()) throw new PackCancelled();
  return pack;
}

export async function fetchSstGrid(bounds) {
  const N = 4, lats = [], lngs = [];
  for (let i = 0; i < N; i++) for (let jx = 0; jx < N; jx++) {
    lats.push((bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * (i + 0.5) / N).toFixed(4));
    lngs.push((bounds.getWest() + (bounds.getEast() - bounds.getWest()) * (jx + 0.5) / N).toFixed(4));
  }
  const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lats.join(',') +
    '&longitude=' + lngs.join(',') + '&current=sea_surface_temperature&temperature_unit=fahrenheit');
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  const pts = [];
  arr.forEach((o, k) => {
    const v = o && o.current && o.current.sea_surface_temperature;
    if (v != null) pts.push({ lat: +lats[k], lng: +lngs[k], f: Math.round(v) });
  });
  /* An error body ({error, reason}) or an all-land box yields no points. Returned as [] it
     counted as a captured grid; throwing makes buildAreaPack flag sstError like any failure. */
  if (!pts.length) throw new Error((j && !Array.isArray(j) && j.reason) || 'no sea-temperature data in the response');
  return pts;
}

export async function fetchDepthGrid(bounds) {
  const N = 4, jobs = [];
  for (let i = 0; i < N; i++) for (let jx = 0; jx < N; jx++) {
    jobs.push({
      lat: +(bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * (i + 0.5) / N).toFixed(4),
      lng: +(bounds.getWest() + (bounds.getEast() - bounds.getWest()) * (jx + 0.5) / N).toFixed(4),
    });
  }
  const out = [];
  let failed = 0;
  await Promise.all(jobs.map(async (p) => {
    try {
      const r = await fetch('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/identify' +
        '?geometry=' + encodeURIComponent(JSON.stringify({ x: p.lng, y: p.lat })) +
        '&geometryType=esriGeometryPoint&sr=4326&returnGeometry=false&returnCatalogItems=false&f=json');
      const d = await r.json();
      const v = parseFloat(d.value);
      if (d.value === 'NoData' || isNaN(v)) return;
      if (v >= 0) out.push({ lat: p.lat, lng: p.lng, land: true });
      else out.push({ lat: p.lat, lng: p.lng, ft: Math.round(Math.abs(v) * 3.28084) });
    } catch (e) { failed++; /* skip point */ }
  }));
  /* One bad point is skipped, but a grid with NO points is not a depth grid. Every point
     failing (the signal dropped mid-capture) used to return [] — never an error — so
     depthError could not be set and a dead pack still scored "some data". */
  if (!out.length) throw new Error(failed ? 'depth service unreachable (' + failed + ' of ' + jobs.length + ' points failed)' : 'no depth data for this area');
  return out;
}

/* Nearest captured depth-grid point to a location. */
export function areaDepthAt(d, ll) {
  const g = d.depthGrid;
  if (!g || !g.length) return null;
  let best = null, bd = Infinity;
  g.forEach((p) => { const dist = (p.lat - ll.lat) ** 2 + (p.lng - ll.lng) ** 2; if (dist < bd) { bd = dist; best = p; } });
  return best;
}

export function mpaBBox(m) {
  const g = m.g || m.geometry;
  if (!g || !g.coordinates) return null;
  let s = 90, n = -90, w = 180, e = -180;
  const walk = (a) => {
    if (typeof a[0] === 'number') {
      const lng = a[0], lat = a[1];
      if (lat < s) s = lat; if (lat > n) n = lat; if (lng < w) w = lng; if (lng > e) e = lng;
    } else a.forEach(walk);
  };
  walk(g.coordinates);
  return { s, n, w, e };
}
export function bboxIntersect(bb, bounds) {
  return !(bb.e < bounds.getWest() || bb.w > bounds.getEast() || bb.n < bounds.getSouth() || bb.s > bounds.getNorth());
}

/* ---------- Readers (shared by the offline engine and the online tool) ---------- */
/* Index of the forecast hour nearest `whenMs`, or -1 when the pack does not cover that time.
   With no limit, an expired pack (captured over a week ago) reported its LAST hour as "now",
   and First Mate gave a go/no-go read from week-old wind. The data is hourly, so inside the
   captured window the nearest sample is never more than 30 min away; beyond `maxGapMs` the
   pack simply does not know, and callers fall back to live/cached weather. */
export const AREA_FCST_MAX_GAP_MS = 90 * 60 * 1000;
export function areaFcstIndex(fc, whenMs, maxGapMs) {
  if (!fc || !fc.time) return -1;
  const limit = maxGapMs == null ? AREA_FCST_MAX_GAP_MS : maxGapMs;
  let best = -1, bd = Infinity;
  for (let i = 0; i < fc.time.length; i++) {
    const d = Math.abs(new Date(fc.time[i]).getTime() - whenMs);
    if (d < bd) { bd = d; best = i; }
  }
  return bd <= limit ? best : -1;
}

/** Local calendar date YYYY-MM-DD. */
export function areaLocalYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function areaDailyForecast(d, fromYmd) {
  if (!d.forecast || !d.forecast.time) return [];
  const f = d.forecast, days = {};
  const at = (arr, i) => (Array.isArray(arr) && arr[i] != null && isFinite(arr[i])) ? arr[i] : null;
  for (let i = 0; i < f.time.length; i++) {
    const day = f.time[i].slice(0, 10);
    const o = days[day] || (days[day] = { windLo: Infinity, windHi: -Infinity, gust: -Infinity, tLo: Infinity, tHi: -Infinity, precip: 0 });
    /* Guard every array. `f.gust` is undefined if the API ever drops the key, and
       indexing it threw straight out of areaPackSummary — which cost First Mate
       every offline answer for the area, not just the wind. */
    const w = at(f.wind, i); if (w != null) { o.windLo = Math.min(o.windLo, w); o.windHi = Math.max(o.windHi, w); }
    const g = at(f.gust, i); if (g != null) o.gust = Math.max(o.gust, g);
    const tp = at(f.temp, i); if (tp != null) { o.tLo = Math.min(o.tLo, tp); o.tHi = Math.max(o.tHi, tp); }
    const pr = at(f.precip, i); if (pr != null) o.precip = Math.max(o.precip, pr);
  }
  const wave = {};
  const m = d.marine;
  if (m && m.time && Array.isArray(m.wave_m)) for (let i = 0; i < m.time.length; i++) {
    const day = m.time[i].slice(0, 10);
    const wv = at(m.wave_m, i);
    if (wv != null) wave[day] = Math.max(wave[day] || 0, wv);
  }
  /* A day with no readings kept its Infinity sentinels. They were printed verbatim
     ("wind Infinity–-Infinitykn") and, worse, -Infinity <= 12 is true — so the ONE
     day the pack knew nothing about collected the full light-wind bonus and was
     recommended as the best day to fish. Non-finite must become null. */
  const fin = (v) => (isFinite(v) ? Math.round(v) : null);
  /* LOCAL today. toISOString() is the UTC date, which from late afternoon on in the US is
     already tomorrow — so "today" was dropped from the outlook every evening. */
  const today = fromYmd || areaLocalYmd(new Date());
  return Object.keys(days).sort()
    // the pack keeps its whole captured window, so drop days that have already gone by
    .filter((day) => day >= today)
    .map((day) => {
      const o = days[day];
      const lo = fin(o.windLo), hi = fin(o.windHi);
      return {
        date: day,
        wind_kn: (lo == null || hi == null) ? null : [lo, hi],
        gust_kn: fin(o.gust),
        air_f: (fin(o.tLo) == null || fin(o.tHi) == null) ? null : [fin(o.tLo), fin(o.tHi)],
        wave_ft: wave[day] != null ? +(wave[day] * 3.28084).toFixed(1) : null,
        precip_pct: o.precip,
      };
    });
}

export function areaTidesNext(d, fromMs, n) {
  if (!d.tides || !d.tides.preds) return [];
  return d.tides.preds
    .map((p) => ({ ms: new Date(p.t.replace(' ', 'T')).getTime(), type: p.type === 'H' ? 'High' : 'Low', ft: p.v, t: p.t }))
    .filter((p) => p.ms >= fromMs - 3600e3)
    .sort((a, b) => a.ms - b.ms).slice(0, n)
    .map((p) => ({ time: p.t.slice(11, 16), day: p.t.slice(0, 10), type: p.type, ft: p.ft }));
}

export function areaSstStats(d) {
  const g = d.sstGrid;
  if (!g || !g.length) return null;
  let min = g[0], max = g[0], sum = 0;
  g.forEach((p) => { if (p.f < min.f) min = p; if (p.f > max.f) max = p; sum += p.f; });
  return { avg: Math.round(sum / g.length), min: min.f, max: max.f, warmest: max, coolest: min, span: max.f - min.f };
}

/* ---------- Pack health (what the toast and the saved-areas list report) ----------
   Each section that was attempted and failed carries a *Error flag (see buildAreaPack).
   A pack where every section failed is "charts only", not "charts + data".
   A section only counts as captured when it holds something usable (`has`): packs saved
   before the builders flagged empty answers carry `depthGrid: []`, `sstGrid: []` or a tide
   section with no turns and no error flag, and those must not score as data either. */
/** @param {unknown} a */
function nonEmpty(a) { return Array.isArray(a) && a.length > 0; }
/** @type {Array<{ key: string, err: string, label: string, has: (v: any) => boolean }>} */
export const AREA_PACK_SECTIONS = [
  { key: 'forecast', err: 'forecastError', label: 'weather forecast', has: (v) => !!v && nonEmpty(v.time) },
  { key: 'marine', err: 'marineError', label: 'wave & water-temp forecast', has: (v) => !!v && nonEmpty(v.time) },
  { key: 'sstGrid', err: 'sstError', label: 'sea-temperature grid', has: nonEmpty },
  { key: 'depthGrid', err: 'depthError', label: 'depth grid', has: nonEmpty },
  { key: 'tides', err: 'tidesError', label: 'tide predictions', has: (v) => !!v && nonEmpty(v.preds) },
  // zero sightings is a real answer (tally {}); an error body is caught at build time (fishError)
  { key: 'fish', err: 'fishError', label: 'recent fish sightings', has: (v) => !!v && typeof v === 'object' && v.tally != null },
];
/** @returns {{ level: 'none'|'partial'|'full', failed: string[], ok: number, total: number }} */
export function areaPackHealth(data) {
  const total = AREA_PACK_SECTIONS.length;
  if (!data || data.cancelled) return { level: 'none', failed: AREA_PACK_SECTIONS.map((s) => s.label), ok: 0, total };
  const usable = (s) => !data[s.err] && s.has(data[s.key]);
  // failed = flagged, or present but empty (a tide section skipped for want of a station is absent, not failed)
  const failed = AREA_PACK_SECTIONS.filter((s) => data[s.err] || (data[s.key] != null && !usable(s))).map((s) => s.label);
  const ok = AREA_PACK_SECTIONS.filter(usable).length;
  const level = ok === 0 ? 'none' : (failed.length ? 'partial' : 'full');
  return { level, failed, ok, total };
}

export function areaPackSummary(a) {
  const d = a.data;
  const s = { area: a.name, captured: new Date(d.capturedTs).toLocaleString(), center: d.center.lat.toFixed(3) + ', ' + d.center.lng.toFixed(3) };
  const daily = areaDailyForecast(d);
  if (daily.length) s.forecast_daily = daily;
  const tides = areaTidesNext(d, Date.now(), 8);
  if (tides.length) { s.tide_station = d.tides.station; s.tides_next = tides; }
  const sst = areaSstStats(d);
  if (sst) s.water_temp = sst;
  if (d.depthGrid && d.depthGrid.length) {
    const depths = d.depthGrid.filter((p) => p.ft != null).map((p) => p.ft);
    if (depths.length) s.depth_ft = { min: Math.min.apply(null, depths), max: Math.max.apply(null, depths) };
  }
  if (d.fish) {
    const top = Object.entries(d.fish.tally).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => k + ' ×' + v);
    s.fish_history = { total: d.fish.total, top: top, recent: d.fish.recent };
  }
  if (d.mpas && d.mpas.length) s.closures = d.mpas;
  if (d.reefCount != null) s.reefs_in_area = d.reefCount;
  return s;
}
