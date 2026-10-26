// Characterisation tests for engine/tides.js (legacy js/tides.js behaviour, ported to a store).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setOnline, fetchRouter, noaaT, gps } from './mocks.js';

vi.mock('../../../src/engine/gps.js', async () => (await import('./mocks.js')).gps);
vi.mock('../../../src/engine/app.js', async () => (await import('./mocks.js')).app);

const T = await import('../../../src/engine/tides.js');
const { Tides, tidesStore, nearestTideStation, ymd, noaaTimeMs, buildTideCurve, selectHiLoRows, solunarRows,
  tideNow, sunMoonSolunar, loadTidesTimes, renderTideGraph } = T;

const STATIONS = [
  { id: '9410660', n: 'Los Angeles', la: 33.72, lo: -118.27 },
  { id: '9410840', n: 'Santa Monica', la: 34.008, lo: -118.5 },
  { id: '9410230', n: 'La Jolla', la: 32.867, lo: -117.257 },
];

/** hi/lo predictions every ~6h12m starting at `start` (device-local), alternating H/L. */
function preds(start, n, firstType = 'H') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * (6 * 60 + 12) * 60000);
    const type = (i % 2 === 0) === (firstType === 'H') ? 'H' : 'L';
    out.push({ t: noaaT(d), v: type === 'H' ? '5.10' : '0.40', type });
  }
  return out;
}

beforeEach(() => {
  localStorage.clear();
  Tides.stations = STATIONS.slice(); Tides.loaded = true; Tides.status = 'ready';
  Tides._loading = false; Tides._loadingId = null; Tides._rerun = false;
  tidesStore.setState({ station: null, status: 'idle', hilo: [], fromCache: false, refreshing: false, updatedAt: 0, astro: null });
  gps.GPS.lastLatLng = { lat: 33.72, lng: -118.27 };
  setOnline(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('station choice and date helpers', () => {
  it('scales longitude by cos(latitude) when picking the nearest station', () => {
    Tides.stations = [
      { id: 'N', n: 'north', la: 34.0 + 0.1, lo: -118.0 },   // 0.1° north
      { id: 'E', n: 'east', la: 34.0, lo: -118.0 + 0.11 },   // 0.11° east ≈ 0.091° of latitude at 34°N
    ];
    // Unscaled, north (0.1) beats east (0.11); scaled, east is actually closer.
    expect(nearestTideStation({ lat: 34.0, lng: -118.0 }).id).toBe('E');
  });
  it('returns null with no stations', () => {
    Tides.stations = [];
    expect(nearestTideStation({ lat: 34, lng: -118 })).toBeNull();
  });
  it('ymd is the device-local calendar day', () => {
    expect(ymd(new Date(2026, 0, 5, 23, 59))).toBe('20260105');
    expect(ymd(new Date(2026, 11, 31, 0, 1))).toBe('20261231');
  });
  it('parses NOAA lst_ldt times as device-local (space → T, never UTC)', () => {
    expect(noaaTimeMs('2026-10-25 06:14')).toBe(new Date(2026, 9, 25, 6, 14).getTime());
  });
});

describe('buildTideCurve (legacy renderTideGraph maths)', () => {
  const base = new Date(2026, 9, 25, 0, 30);
  const hl = preds(base, 4);
  it('returns null under two points ("No tide data.")', () => {
    expect(buildTideCurve(hl.slice(0, 1), Date.now())).toBeNull();
  });
  it('defaults to the legacy 320x90, pad 4 frame across the whole range', () => {
    const c = buildTideCurve(hl, base.getTime() + 3600000);
    expect(c.W).toBe(320); expect(c.H).toBe(90);
    // 3 segments × 24 samples + the final extreme
    expect(c.line.split(' L').length).toBe(3 * 24 + 1);
    expect(c.line.startsWith('M4.0,')).toBe(true);
    expect(c.line.endsWith('316.0,' + (c.marks[3].y).toFixed(1))).toBe(true);
    expect(c.area.endsWith(' L316.0,86 L4.0,86 Z')).toBe(true);
    // highs at the top (y = pad), lows at the bottom (y = H - pad)
    expect(c.marks.map((m) => m.type)).toEqual(['H', 'L', 'H', 'L']);
    expect(c.marks[0].y).toBe(4); expect(c.marks[1].y).toBe(86);
    expect(c.vmin).toBeCloseTo(0.4); expect(c.vmax).toBeCloseTo(5.1);
  });
  it('places the now-line only inside the drawn range', () => {
    expect(buildTideCurve(hl, base.getTime() - 3600000).nowX).toBeNull();
    const mid = buildTideCurve(hl, base.getTime() + (3 * 372 * 60000) / 2);
    expect(mid.nowX).toBeCloseTo(160, 0);
    expect(mid.nowY).not.toBeNull();
  });
  it('is cosine-shaped between extremes (half-way in time = half-way in height)', () => {
    const c = buildTideCurve(hl.slice(0, 2), Date.now());
    const pts = c.line.slice(1).split(' L').map((s) => s.split(',').map(Number));
    expect(pts[12][1]).toBeCloseTo(45, 0);   // f = 0.5 → mid height
  });
  it('clips to a window (the panel draws today) and leaves label room', () => {
    const from = base.getTime() + 3 * 3600000, to = base.getTime() + 15 * 3600000;
    const c = buildTideCurve(hl, from + 3600000, { W: 320, H: 140, pad: 6, padTop: 36, padBottom: 36, from, to });
    expect(c.t0).toBeGreaterThanOrEqual(from); expect(c.t1).toBeLessThanOrEqual(to);
    c.marks.forEach((m) => { expect(m.t).toBeGreaterThanOrEqual(c.t0); expect(m.y).toBeGreaterThanOrEqual(36); expect(m.y).toBeLessThanOrEqual(104); });
  });
});

describe('selectHiLoRows (upcoming tides + one just passed)', () => {
  const base = new Date(2026, 9, 24, 18, 0);
  const hl = preds(base, 12);
  it('starts one before the next future tide and shows at most 8', () => {
    const now = noaaTimeMs(hl[5].t) + 60000;          // just after #5
    const rows = selectHiLoRows(hl, now);
    expect(rows.length).toBe(7);                        // #5..#11
    expect(rows[0].ms).toBe(noaaTimeMs(hl[5].t));
    expect(rows[0].past).toBe(true);
    expect(rows.slice(1).every((r) => !r.past)).toBe(true);
    expect(selectHiLoRows(hl, noaaTimeMs(hl[0].t) - 1).length).toBe(8);
  });
  it('an all-past set shows its last 8 (all dimmed)', () => {
    const rows = selectHiLoRows(hl, noaaTimeMs(hl[11].t) + 1);
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.past)).toBe(true);
  });
  it('sorts unsorted input and types rows', () => {
    const rows = selectHiLoRows(hl.slice(0, 3).reverse(), 0);
    expect(rows.map((r) => r.type)).toEqual(['H', 'L', 'H']);
    expect(rows[0].ft).toBeCloseTo(5.1);
  });
});

describe('solunar rows and tide-now', () => {
  it('flags NOW and past from the clock alone', () => {
    const p = [{ type: 'major', start: 100, end: 200 }, { type: 'minor', start: 300, end: 400 }];
    expect(solunarRows(p, 150)).toEqual([
      { type: 'major', start: 100, end: 200, active: true, past: false },
      { type: 'minor', start: 300, end: 400, active: false, past: false },
    ]);
    expect(solunarRows(p, 250)[0]).toMatchObject({ active: false, past: true });
    expect(solunarRows(p, 200)[0]).toMatchObject({ active: true, past: false });   // inclusive end
  });
  it('interpolates the height now and says which way it is going', () => {
    const hl = [{ t: '2026-10-25 06:00', v: '0.0', type: 'L' }, { t: '2026-10-25 12:00', v: '4.0', type: 'H' }];
    const tn = tideNow(hl, new Date(2026, 9, 25, 9, 0).getTime());
    expect(tn.ft).toBeCloseTo(2.0, 5);
    expect(tn.rising).toBe(true);
    expect(tn.next.type).toBe('H');
    expect(tideNow(hl, new Date(2026, 9, 25, 13, 0).getTime())).toBeNull();
  });
});

describe('sun / moon / solunar view', () => {
  it('is plain data with no emoji', () => {
    const a = sunMoonSolunar(new Date(2026, 5, 21, 12, 0), { lat: 33.72, lng: -118.27 });
    expect((a.sunset - a.sunrise) / 3600000).toBeGreaterThan(14);
    expect((a.sunset - a.sunrise) / 3600000).toBeLessThan(14.7);
    expect(a.moonName).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
    expect(a.moonLitPct).toBeGreaterThanOrEqual(0); expect(a.moonLitPct).toBeLessThanOrEqual(100);
    const majors = a.solunar.filter((p) => p.type === 'major');
    expect(majors.length).toBe(2);
    majors.forEach((p) => expect(p.end - p.start).toBe(120 * 60000));
    a.solunar.filter((p) => p.type === 'minor').forEach((p) => expect(p.end - p.start).toBe(90 * 60000));
  });
});

describe('loadTidesTimes (cache-first loader)', () => {
  const future = () => preds(new Date(Date.now() - 3 * 3600000), 8);

  it('online with no cache: loading → ready, and caches per station', async () => {
    const hl = future();
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', { predictions: hl }]]));
    const p = loadTidesTimes();
    await p;
    const s = tidesStore.getState();
    expect(s.station).toEqual({ id: '9410660', name: 'Los Angeles' });
    expect(s.status).toBe('ready');
    expect(s.hilo).toEqual(hl);
    expect(s.astro).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('fishapp.tides.9410660')).hl).toEqual(hl);
  });

  it('a fresh (<24h) cache that still covers the future skips the network', async () => {
    const hl = future();
    localStorage.setItem('fishapp.tides.9410660', JSON.stringify({ hl, ts: Date.now() - 3600000 }));
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await loadTidesTimes();
    expect(f).not.toHaveBeenCalled();
    expect(tidesStore.getState()).toMatchObject({ status: 'ready', fromCache: true });
  });

  it('an old cache that still covers the future is shown, and a failed refresh never replaces it', async () => {
    const hl = future();
    localStorage.setItem('fishapp.tides.9410660', JSON.stringify({ hl, ts: Date.now() - 30 * 3600000 }));
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', new Error('no signal')]]));
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ status: 'ready', fromCache: true, hilo: hl, refreshing: false });
  });

  it('a cache that no longer covers the future is ignored (validity by coverage, not age)', async () => {
    const old = preds(new Date(Date.now() - 40 * 3600000), 4);
    localStorage.setItem('fishapp.tides.9410660', JSON.stringify({ hl: old, ts: Date.now() - 1000 }));
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', new Error('down')]]));
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ status: 'error', hilo: [] });
  });

  it('offline: shows a covering cache, else the offline state', async () => {
    setOnline(false);
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ status: 'offline', hilo: [] });
    const hl = future();
    localStorage.setItem('fishapp.tides.9410660', JSON.stringify({ hl, ts: Date.now() - 50 * 3600000 }));
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ status: 'ready', fromCache: true });
  });

  it('a different station never inherits the previous station\'s rows', async () => {
    const hl = future();
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', { predictions: hl }]]));
    await loadTidesTimes();
    expect(tidesStore.getState().hilo.length).toBe(8);
    setOnline(false);
    gps.GPS.lastLatLng = { lat: 32.86, lng: -117.26 };   // La Jolla, nothing cached
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ station: { id: '9410230', name: 'La Jolla' }, status: 'offline', hilo: [] });
  });

  it('a localStorage quota error still shows the tides just fetched', async () => {
    const hl = future();
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', { predictions: hl }]]));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    try { await loadTidesTimes(); } finally { spy.mockRestore(); }
    expect(tidesStore.getState()).toMatchObject({ status: 'ready', hilo: hl });
  });

  it('an empty prediction set is an error, not a blank graph', async () => {
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', { predictions: [] }]]));
    await loadTidesTimes();
    expect(tidesStore.getState().status).toBe('error');
  });

  it('de-dupes while in flight, but re-runs for a station that changed meanwhile', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const hl = future();
    const f = fetchRouter([['tidesandcurrents', async () => { await gate; return { predictions: hl }; }]]);
    vi.stubGlobal('fetch', f);
    const a = loadTidesTimes();
    await Promise.resolve(); await Promise.resolve();
    await loadTidesTimes();                                 // same station: dropped
    expect(f).toHaveBeenCalledTimes(1);
    gps.GPS.lastLatLng = { lat: 34.0, lng: -118.5 };       // Santa Monica
    await loadTidesTimes();                                 // different station: queued
    release();
    await a;
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tidesStore.getState()).toMatchObject({ station: { id: '9410840' }, status: 'ready' }));
  });

  it('no station list: waits for / retries the bundled list, then says so honestly', async () => {
    Tides.stations = []; Tides.loaded = false; Tides.status = 'failed';
    vi.stubGlobal('fetch', fetchRouter([['tide-stations-ca.json', new Error('missing')]]));
    await loadTidesTimes();
    expect(tidesStore.getState()).toMatchObject({ status: 'no-stations', station: null });
    vi.stubGlobal('fetch', fetchRouter([['tide-stations-ca.json', STATIONS], ['tidesandcurrents', { predictions: future() }]]));
    await loadTidesTimes();
    expect(Tides.loaded).toBe(true);
    expect(tidesStore.getState().status).toBe('ready');
  });

  it('renderTideGraph throws on a malformed set (so a bad cache falls back) and flags <2 points as no-data', () => {
    expect(() => renderTideGraph([{ v: '1' }, { v: '2' }])).toThrow();
    renderTideGraph([{ t: '2026-10-25 06:00', v: '1.0', type: 'H' }]);
    expect(tidesStore.getState().status).toBe('no-data');
  });
});
