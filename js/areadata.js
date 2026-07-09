/* Offline "area intelligence pack": when you download an area, we also capture
   the environmental data for it — a multi-day wind/wave/tide/water-temp
   forecast, a sea-surface-temp grid, recent fish-sighting history, and
   protected-area closures — so First Mate can answer questions about that
   area with zero signal. Stored on the area record in IndexedDB. */
'use strict';

const AreaData = { packs: [] };

async function areaDataInit() {
  try { AreaData.packs = await idb.getAll('areas'); } catch (e) { AreaData.packs = []; }
}
async function areaDataRefresh() { await areaDataInit(); }

/* Most-recently-captured pack whose bounds contain a point (or null). */
function areaPackFor(ll) {
  if (!ll || !AreaData.packs) return null;
  const inside = AreaData.packs.filter((a) => a.data && a.bounds &&
    ll.lat <= a.bounds.n && ll.lat >= a.bounds.s && ll.lng <= a.bounds.e && ll.lng >= a.bounds.w);
  if (!inside.length) return null;
  inside.sort((a, b) => (b.data.capturedTs || b.ts) - (a.data.capturedTs || a.ts));
  return inside[0];
}

/* ---------- Build the pack (called by download.js while online) ---------- */
async function buildAreaPack(bounds, onProgress) {
  const c = bounds.getCenter();
  const step = (m) => { if (onProgress) onProgress(m); };
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
    pack.forecast = {
      time: j.hourly.time, wind: j.hourly.wind_speed_10m, gust: j.hourly.wind_gusts_10m,
      dir: j.hourly.wind_direction_10m, temp: j.hourly.temperature_2m, precip: j.hourly.precipitation_probability,
    };
  } catch (e) { pack.forecastError = true; }

  // 7-day hourly seas + water temp
  try {
    step('wave & water-temp forecast');
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + c.lat + '&longitude=' + c.lng +
      '&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&temperature_unit=fahrenheit&forecast_days=7&timezone=auto');
    const j = await r.json();
    pack.marine = {
      time: j.hourly.time, wave_m: j.hourly.wave_height, period: j.hourly.wave_period,
      wdir: j.hourly.wave_direction, sst: j.hourly.sea_surface_temperature,
    };
  } catch (e) { pack.marineError = true; }

  // Sea-surface-temp grid snapshot (to describe breaks / warmest water)
  try { step('sea-temperature grid'); pack.sstGrid = await fetchSstGrid(bounds); } catch (e) { /* ignore */ }

  // Depth grid (NOAA NCEI DEM point identify) so "how deep is it" works offline
  try { step('depth grid'); pack.depthGrid = await fetchDepthGrid(bounds); } catch (e) { /* ignore */ }

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
        pack.tides = {
          station: st.n, id: st.id,
          dist_nm: +nmBetween(L.latLng(c.lat, c.lng), L.latLng(st.la, st.lo)).toFixed(0),
          preds: (j.predictions || []).map((p) => ({ t: p.t, type: p.type, v: +parseFloat(p.v).toFixed(1) })),
        };
      }
    }
  } catch (e) { pack.tidesError = true; }

  // Recent fish-sighting history in the bounds (iNaturalist)
  try {
    step('recent fish sightings');
    if (typeof FISH_TAXA !== 'undefined') {
      const r = await fetch('https://api.inaturalist.org/v1/observations?taxon_id=' + encodeURIComponent(FISH_TAXA) +
        '&nelat=' + bounds.getNorth() + '&nelng=' + bounds.getEast() + '&swlat=' + bounds.getSouth() + '&swlng=' + bounds.getWest() +
        '&per_page=100&order_by=observed_on&order=desc&geo=true&quality_grade=research&geoprivacy=open');
      const j = await r.json();
      const tally = {}, recent = [];
      (j.results || []).forEach((o) => {
        const n = (o.taxon && (o.taxon.preferred_common_name || o.taxon.name)) || 'unknown';
        tally[n] = (tally[n] || 0) + 1;
        if (recent.length < 12 && o.observed_on) recent.push({ species: n, date: o.observed_on });
      });
      pack.fish = { total: (j.results || []).length, tally, recent };
    }
  } catch (e) { pack.fishError = true; }

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
  } catch (e) { /* ignore */ }

  // Reef count inside the bounds (reefs are bundled globally; just note how many)
  try {
    if (typeof Reefs !== 'undefined' && Reefs.reefs) {
      pack.reefCount = Reefs.reefs.filter((r) =>
        r.la <= bounds.getNorth() && r.la >= bounds.getSouth() && r.lo <= bounds.getEast() && r.lo >= bounds.getWest()).length;
    }
  } catch (e) { /* ignore */ }

  return pack;
}

async function fetchSstGrid(bounds) {
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
    const v = o.current && o.current.sea_surface_temperature;
    if (v != null) pts.push({ lat: +lats[k], lng: +lngs[k], f: Math.round(v) });
  });
  return pts;
}

async function fetchDepthGrid(bounds) {
  const N = 4, jobs = [];
  for (let i = 0; i < N; i++) for (let jx = 0; jx < N; jx++) {
    jobs.push({
      lat: +(bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * (i + 0.5) / N).toFixed(4),
      lng: +(bounds.getWest() + (bounds.getEast() - bounds.getWest()) * (jx + 0.5) / N).toFixed(4),
    });
  }
  const out = [];
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
    } catch (e) { /* skip point */ }
  }));
  return out;
}

/* Nearest captured depth-grid point to a location. */
function areaDepthAt(d, ll) {
  const g = d.depthGrid;
  if (!g || !g.length) return null;
  let best = null, bd = Infinity;
  g.forEach((p) => { const dist = (p.lat - ll.lat) ** 2 + (p.lng - ll.lng) ** 2; if (dist < bd) { bd = dist; best = p; } });
  return best;
}

function mpaBBox(m) {
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
function bboxIntersect(bb, bounds) {
  return !(bb.e < bounds.getWest() || bb.w > bounds.getEast() || bb.n < bounds.getSouth() || bb.s > bounds.getNorth());
}

/* ---------- Readers (shared by the offline engine and the online tool) ---------- */
function areaFcstIndex(fc, whenMs) {
  if (!fc || !fc.time) return -1;
  let best = -1, bd = Infinity;
  for (let i = 0; i < fc.time.length; i++) {
    const d = Math.abs(new Date(fc.time[i]).getTime() - whenMs);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function areaDailyForecast(d) {
  if (!d.forecast || !d.forecast.time) return [];
  const f = d.forecast, days = {};
  for (let i = 0; i < f.time.length; i++) {
    const day = f.time[i].slice(0, 10);
    const o = days[day] || (days[day] = { windLo: Infinity, windHi: -Infinity, gust: -Infinity, tLo: Infinity, tHi: -Infinity, precip: 0 });
    if (f.wind[i] != null) { o.windLo = Math.min(o.windLo, f.wind[i]); o.windHi = Math.max(o.windHi, f.wind[i]); }
    if (f.gust[i] != null) o.gust = Math.max(o.gust, f.gust[i]);
    if (f.temp[i] != null) { o.tLo = Math.min(o.tLo, f.temp[i]); o.tHi = Math.max(o.tHi, f.temp[i]); }
    if (f.precip[i] != null) o.precip = Math.max(o.precip, f.precip[i]);
  }
  const wave = {};
  const m = d.marine;
  if (m && m.time) for (let i = 0; i < m.time.length; i++) {
    const day = m.time[i].slice(0, 10);
    if (m.wave_m[i] != null) wave[day] = Math.max(wave[day] || 0, m.wave_m[i]);
  }
  return Object.keys(days).sort().map((day) => ({
    date: day,
    wind_kn: [Math.round(days[day].windLo), Math.round(days[day].windHi)],
    gust_kn: Math.round(days[day].gust),
    air_f: [Math.round(days[day].tLo), Math.round(days[day].tHi)],
    wave_ft: wave[day] != null ? +(wave[day] * 3.28084).toFixed(1) : null,
    precip_pct: days[day].precip,
  }));
}

function areaTidesNext(d, fromMs, n) {
  if (!d.tides || !d.tides.preds) return [];
  return d.tides.preds
    .map((p) => ({ ms: new Date(p.t.replace(' ', 'T')).getTime(), type: p.type === 'H' ? 'High' : 'Low', ft: p.v, t: p.t }))
    .filter((p) => p.ms >= fromMs - 3600e3)
    .sort((a, b) => a.ms - b.ms).slice(0, n)
    .map((p) => ({ time: p.t.slice(11, 16), day: p.t.slice(0, 10), type: p.type, ft: p.ft }));
}

function areaSstStats(d) {
  const g = d.sstGrid;
  if (!g || !g.length) return null;
  let min = g[0], max = g[0], sum = 0;
  g.forEach((p) => { if (p.f < min.f) min = p; if (p.f > max.f) max = p; sum += p.f; });
  return { avg: Math.round(sum / g.length), min: min.f, max: max.f, warmest: max, coolest: min, span: max.f - min.f };
}

function areaPackSummary(a) {
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
