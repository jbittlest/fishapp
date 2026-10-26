/* Offline "area intelligence pack" readers and builder (engine/areadata.js). First Mate answers
 * from these with no signal, so the honesty rules are pinned: unknown days stay null, expired
 * packs do not pretend to be "now", "today" is the local date, failed sections are flagged. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [{ n: 'In', la: 33.71, lo: -118.44 }, { n: 'Out', la: 35, lo: -120 }] } }));
vi.mock('../../../src/engine/fish.js', async () => (await import('./_mocks.js')).fishMock());
vi.mock('../../../src/engine/tides.js', async () => (await import('./_mocks.js')).tidesMock());

const A = await import('../../../src/engine/areadata.js');
const db = await import('../../../src/engine/db.js');
const { fullPack } = await import('./_mocks.js');

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':00';

describe('areaFcstIndex', () => {
  const t0 = new Date(2026, 9, 25, 6, 0, 0);
  const fc = { time: Array.from({ length: 24 }, (_, i) => localIso(new Date(t0.getTime() + i * 3600e3))) };
  it('finds the nearest hour inside the captured window', () => {
    expect(A.areaFcstIndex(fc, t0.getTime() + 2 * 3600e3 + 10 * 60e3)).toBe(2);
    expect(A.areaFcstIndex(fc, t0.getTime() + 2 * 3600e3 + 40 * 60e3)).toBe(3);
  });
  it('returns -1 outside the window instead of reporting the last hour as now', () => {
    expect(A.areaFcstIndex(fc, t0.getTime() + 30 * 3600e3)).toBe(-1);
    expect(A.areaFcstIndex(fc, t0.getTime() - 5 * 3600e3)).toBe(-1);
    expect(A.areaFcstIndex(fc, t0.getTime() + 24 * 3600e3)).toBe(23);   // within 90 min of the last sample
  });
  it('honours an explicit gap and handles a missing forecast', () => {
    expect(A.areaFcstIndex(fc, t0.getTime() + 30 * 3600e3, Infinity)).toBe(23);
    expect(A.areaFcstIndex(null, 0)).toBe(-1);
    expect(A.areaFcstIndex({}, 0)).toBe(-1);
  });
});

describe('areaDailyForecast', () => {
  const pack = {
    forecast: {
      time: ['2026-10-24T10:00', '2026-10-25T06:00', '2026-10-25T12:00', '2026-10-26T06:00', '2026-10-27T06:00'],
      wind: [5, 8, 14.4, null, 6], gust: [9, 12, 20, null, 9], temp: [60, 58, 71, null, 62], precip: [0, 10, 40, null, 0],
    },
    marine: { time: ['2026-10-25T06:00', '2026-10-25T12:00', '2026-10-26T06:00'], wave_m: [1, 1.5, null] },
  };
  it('drops days already gone by and aggregates each day', () => {
    const days = A.areaDailyForecast(pack, '2026-10-25');
    expect(days.map((d) => d.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
    expect(days[0]).toEqual({ date: '2026-10-25', wind_kn: [8, 14], gust_kn: 20, air_f: [58, 71], wave_ft: 4.9, precip_pct: 40 });
  });
  it('a day with no readings is null everywhere, never Infinity (so it can never rank as best)', () => {
    const d = A.areaDailyForecast(pack, '2026-10-25')[1];
    expect(d).toEqual({ date: '2026-10-26', wind_kn: null, gust_kn: null, air_f: null, wave_ft: null, precip_pct: 0 });
  });
  it('survives a missing gust array (the API dropping a key)', () => {
    const p = { forecast: { time: ['2026-10-25T06:00'], wind: [7], temp: [60], precip: [5] } };
    expect(A.areaDailyForecast(p, '2026-10-25')[0]).toMatchObject({ wind_kn: [7, 7], gust_kn: null });
  });
  it('uses the LOCAL date as today, not the UTC date', () => {
    vi.useFakeTimers();
    try {
      const evening = new Date(2026, 9, 25, 21, 30);       // 9:30 pm local — already the 26th in UTC west of Greenwich
      vi.setSystemTime(evening);
      expect(A.areaLocalYmd(new Date())).toBe('2026-10-25');
      const days = A.areaDailyForecast(pack);
      expect(days[0].date).toBe('2026-10-25');
    } finally { vi.useRealTimers(); }
  });
  it('returns [] without a forecast', () => {
    expect(A.areaDailyForecast({})).toEqual([]);
  });
});

describe('tides / water temp / depth readers', () => {
  it('areaTidesNext lists the next n turns from an hour ago', () => {
    const d = { tides: { preds: [
      { t: '2026-10-25 03:10', type: 'L', v: 0.4 }, { t: '2026-10-25 09:20', type: 'H', v: 4.9 },
      { t: '2026-10-25 15:30', type: 'L', v: 1.1 }, { t: '2026-10-25 21:40', type: 'H', v: 5.2 },
    ] } };
    const from = new Date('2026-10-25T09:50').getTime();
    expect(A.areaTidesNext(d, from, 2)).toEqual([
      { time: '09:20', day: '2026-10-25', type: 'High', ft: 4.9 },
      { time: '15:30', day: '2026-10-25', type: 'Low', ft: 1.1 },
    ]);
    expect(A.areaTidesNext({}, from, 2)).toEqual([]);
  });
  it('areaSstStats summarises the grid', () => {
    const g = [{ lat: 1, lng: 1, f: 60 }, { lat: 2, lng: 2, f: 66 }, { lat: 3, lng: 3, f: 63 }];
    expect(A.areaSstStats({ sstGrid: g })).toMatchObject({ avg: 63, min: 60, max: 66, span: 6, warmest: g[1], coolest: g[0] });
    expect(A.areaSstStats({ sstGrid: [] })).toBeNull();
  });
  it('areaDepthAt returns the nearest captured point', () => {
    const g = [{ lat: 33.7, lng: -118.4, ft: 40 }, { lat: 33.8, lng: -118.5, ft: 300 }];
    expect(A.areaDepthAt({ depthGrid: g }, { lat: 33.79, lng: -118.49 })).toBe(g[1]);
    expect(A.areaDepthAt({}, { lat: 0, lng: 0 })).toBeNull();
  });
});

describe('geometry helpers', () => {
  it('mpaBBox walks nested coordinates', () => {
    const m = { g: { type: 'MultiPolygon', coordinates: [[[[-118.5, 33.7], [-118.4, 33.75], [-118.45, 33.8]]], [[[-119, 33.6], [-118.9, 33.65], [-118.95, 33.62]]]] } };
    expect(A.mpaBBox(m)).toEqual({ s: 33.6, n: 33.8, w: -119, e: -118.4 });
    expect(A.mpaBBox({})).toBeNull();
  });
  it('bboxIntersect', () => {
    const b = L.latLngBounds([33.7, -118.5], [33.8, -118.4]);
    expect(A.bboxIntersect({ s: 33.75, n: 33.9, w: -118.45, e: -118.3 }, b)).toBe(true);
    expect(A.bboxIntersect({ s: 34, n: 35, w: -118.45, e: -118.3 }, b)).toBe(false);
  });
});

describe('areaPackFor', () => {
  beforeEach(() => { A.AreaData.packs = []; });
  it('picks the newest captured pack containing the point and ignores charts-only / cancelled records', () => {
    const b = { s: 33, n: 34, w: -119, e: -118 };
    A.AreaData.packs = [
      { id: 1, bounds: b, ts: 1, data: fullPack({ capturedTs: 100 }) },
      { id: 2, bounds: b, ts: 2, data: fullPack({ capturedTs: 300 }) },
      { id: 3, bounds: b, ts: 3, data: null },
      { id: 4, bounds: b, ts: 4, data: { cancelled: true, capturedTs: 999 } },
      { id: 5, bounds: { s: 40, n: 41, w: -119, e: -118 }, ts: 5, data: fullPack({ capturedTs: 900 }) },
    ];
    expect(A.areaPackFor({ lat: 33.5, lng: -118.5 }).id).toBe(2);
    expect(A.areaPackFor({ lat: 10, lng: 10 })).toBeNull();
    expect(A.areaPackFor(null)).toBeNull();
  });
  it('never serves a pack where nothing usable was captured - an older real pack wins', () => {
    const b = { s: 33, n: 34, w: -119, e: -118 };
    // the review's case: the signal dropped during the data phase (record saved by the old builder)
    const dead = { capturedTs: 500, forecastError: true, marineError: true, sstError: true, depthGrid: [], tidesError: true, fishError: true, mpas: [{ n: 'X', t: 'SMR' }], reefCount: 2 };
    A.AreaData.packs = [
      { id: 1, bounds: b, ts: 1, data: fullPack({ capturedTs: 100 }) },
      { id: 2, bounds: b, ts: 2, data: dead },
    ];
    expect(A.areaPackFor({ lat: 33.5, lng: -118.5 }).id).toBe(1);
    A.AreaData.packs = [{ id: 2, bounds: b, ts: 2, data: dead }];
    expect(A.areaPackFor({ lat: 33.5, lng: -118.5 })).toBeNull();
  });
  it('areaDataInit loads the records and survives unavailable storage', async () => {
    db.idb.stores.areas.set(7, { id: 7, name: 'x' });
    await A.areaDataInit();
    expect(A.AreaData.packs).toHaveLength(1);
    vi.mocked(db.idb.getAll).mockRejectedValueOnce(new Error('no idb'));
    await A.areaDataInit();
    expect(A.AreaData.packs).toEqual([]);
  });
});

describe('areaPackHealth', () => {
  it('full / partial / none', () => {
    expect(A.areaPackHealth(fullPack())).toEqual({ level: 'full', failed: [], ok: 6, total: 6 });
    const f = fullPack();
    const p = A.areaPackHealth({ forecast: f.forecast, marineError: true, sstGrid: f.sstGrid, depthError: true });
    expect(p.level).toBe('partial');
    expect(p.failed).toEqual(['wave & water-temp forecast', 'depth grid']);
    expect(A.areaPackHealth(null).level).toBe('none');
    expect(A.areaPackHealth({ cancelled: true }).level).toBe('none');
    expect(A.areaPackHealth({ forecastError: true, marineError: true, sstError: true, depthError: true, tidesError: true, fishError: true }).level).toBe('none');
  });
  it('a tide section skipped for want of a station is not a failure', () => {
    const { tides, ...noTides } = fullPack();
    expect(tides).toBeTruthy();
    expect(A.areaPackHealth(noTides)).toMatchObject({ level: 'full', failed: [], ok: 5 });
  });
  it('an empty section is not captured data (records saved before the builders flagged empty answers)', () => {
    // the review's case: network gone during the pack phase - depthGrid [] with no flag
    const dead = { forecastError: true, marineError: true, sstError: true, depthGrid: [], tidesError: true, fishError: true };
    expect(A.areaPackHealth(dead)).toMatchObject({ level: 'none', ok: 0 });
    expect(A.areaPackHealth(dead).failed).toContain('depth grid');
    // error bodies stored as content-free sections
    const hollow = { forecast: { time: [] }, marine: { time: [] }, sstGrid: [], depthGrid: [], tides: { preds: [] } };
    expect(A.areaPackHealth(hollow)).toMatchObject({ level: 'none', ok: 0 });
    expect(A.areaPackHealth(hollow).failed).toEqual(['weather forecast', 'wave & water-temp forecast', 'sea-temperature grid', 'depth grid', 'tide predictions']);
    // one real section among empty ones is "some data", naming every empty one
    const one = { ...hollow, depthGrid: fullPack().depthGrid };
    expect(A.areaPackHealth(one)).toMatchObject({ level: 'partial', ok: 1 });
    expect(A.areaPackHealth(one).failed).not.toContain('depth grid');
  });
  it('zero fish sightings is a real answer, not a missing section', () => {
    expect(A.areaPackHealth(fullPack({ fish: { total: 0, sampled: 0, tally: {}, recent: [] } })).level).toBe('full');
  });
});

describe('buildAreaPack', () => {
  const bounds = L.latLngBounds([33.70, -118.45], [33.72, -118.43]);
  let calls;
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (/\/\/api\.open-meteo\.com/.test(url)) return { json: async () => ({ hourly: { time: ['2026-10-25T06:00'], wind_speed_10m: [5], wind_gusts_10m: [8], wind_direction_10m: [270], temperature_2m: [60], precipitation_probability: [10] } }) };
      if (/marine-api.*current=/.test(url)) return { json: async () => [{ current: { sea_surface_temperature: 64.2 } }] };
      if (/marine-api/.test(url)) return { json: async () => ({ hourly: { time: ['2026-10-25T06:00'], wave_height: [1], wave_period: [9], wave_direction: [250], sea_surface_temperature: [64] } }) };
      if (/ImageServer\/identify/.test(url)) return { json: async () => ({ value: '-30' }) };
      if (/tidesandcurrents/.test(url)) throw new Error('timed out after 30s');
      if (/inaturalist/.test(url)) return { json: async () => ({ total_results: 2345, results: [{ taxon: { preferred_common_name: 'Calico bass' }, observed_on: '2026-10-01' }] }) };
      if (/mpa-ca\.json/.test(url)) return { json: async () => [] };
      throw new Error('unexpected ' + url);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('captures every section and flags the one that failed', async () => {
    const steps = [];
    const p = await A.buildAreaPack(bounds, (m) => steps.push(m));
    expect(p.forecast.wind).toEqual([5]);
    expect(p.marine.wave_m).toEqual([1]);
    expect(p.sstGrid[0]).toMatchObject({ f: 64 });
    expect(p.depthGrid).toHaveLength(16);
    expect(p.depthGrid[0].ft).toBe(Math.round(30 * 3.28084));
    expect(p.tidesError).toBe(true);
    expect(p.fish).toMatchObject({ total: 2345, sampled: 1, tally: { 'Calico bass': 1 } });   // total_results, not the page size
    expect(p.reefCount).toBe(1);
    expect(steps).toEqual(['weather forecast', 'wave & water-temp forecast', 'sea-temperature grid', 'depth grid', 'tide predictions', 'recent fish sightings', 'protected-area closures']);
    expect(A.areaPackHealth(p)).toMatchObject({ level: 'partial', failed: ['tide predictions'] });
  });

  it('flags every section when the signal drops during the data phase - nothing counts as captured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const p = await A.buildAreaPack(bounds);
    expect(p).toMatchObject({ forecastError: true, marineError: true, sstError: true, depthError: true, tidesError: true, fishError: true });
    expect(p.depthGrid).toBeUndefined();
    expect(A.areaPackHealth(p)).toMatchObject({ level: 'none', ok: 0 });
    expect(A.areaPackHealth(p).failed).toHaveLength(6);
  });

  it('flags sections whose answer is an error body (HTTP 400/429 JSON), not just network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (/open-meteo/.test(url)) return { ok: false, json: async () => ({ error: true, reason: 'Too many concurrent requests' }) };
      if (/ImageServer[/]identify/.test(url)) return { ok: true, json: async () => ({ error: { code: 400, message: 'Unable to complete operation.' } }) };
      if (/tidesandcurrents/.test(url)) return { ok: true, json: async () => ({ error: { message: 'No Predictions data was found.' } }) };
      if (/inaturalist/.test(url)) return { ok: false, json: async () => ({ error: 'Too Many Requests', status: 429 }) };
      if (/mpa-ca[.]json/.test(url)) return { json: async () => [] };
      throw new Error('unexpected ' + url);
    }));
    const p = await A.buildAreaPack(bounds);
    expect(p).toMatchObject({ forecastError: true, marineError: true, sstError: true, depthError: true, tidesError: true, fishError: true });
    expect(p.fish).toBeUndefined();          // never "0 sightings" stated as fact
    expect(p.sstGrid).toBeUndefined();
    expect(A.areaPackHealth(p).level).toBe('none');
  });

  it('a depth grid keeps the points that answered and skips the ones that failed', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++;
      if (n % 2) throw new TypeError('Failed to fetch');
      return { json: async () => ({ value: '-30' }) };
    }));
    const g = await A.fetchDepthGrid(bounds);
    expect(g).toHaveLength(8);
    expect(g[0].ft).toBe(98);
  });

  it('stops between sections once cancelled and reports it', async () => {
    let n = 0;
    const p = await A.buildAreaPack(bounds, () => { n++; }, () => n >= 2);
    expect(p.cancelled).toBe(true);
    expect(calls.some((u) => /inaturalist/.test(u))).toBe(false);
  });
});

describe('areaPackSummary', () => {
  it('summarises a pack for First Mate without throwing on missing sections', () => {
    const s = A.areaPackSummary({ name: 'Bay', data: { capturedTs: Date.now(), center: { lat: 33.71, lng: -118.44 }, fish: { total: 9, tally: { a: 2, b: 7 }, recent: [] }, mpas: [{ n: 'X', t: 'SMR' }], reefCount: 3 } });
    expect(s).toMatchObject({ area: 'Bay', center: '33.710, -118.440', fish_history: { total: 9, top: ['b ×7', 'a ×2'] }, closures: [{ n: 'X', t: 'SMR' }], reefs_in_area: 3 });
    expect(s.forecast_daily).toBeUndefined();
  });
});
