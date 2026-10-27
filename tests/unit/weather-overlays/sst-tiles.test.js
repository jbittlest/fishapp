// @vitest-environment jsdom
/* SST tile data (engine/sst-tiles.js): the fixed tile grid, the GIBS colormap decode, the colour
   range fitted to the pixels in view, the painter, the on-device expiry plan and the request queue. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SST_CONCURRENCY, SST_FINE, SST_KEEP_DAYS, SST_MAX_TILES, SST_NBINS, SST_PX, SstLatest,
  parseSstKey, sstBinC, sstBinForRgb, sstDateFromHeader, sstDayBefore, sstDecodeRgba, sstFineLut, sstHistAdd, sstKey,
  sstLut, sstPaintUpsampled, sstPrunePlan, sstQueueState, sstRangeFromHist, sstResetMemory, sstResolveLatest,
  sstSaveArea, sstSmooth, sstStopsFromGradient, sstTileBlob, sstTileUrl, sstTilesAround, sstTilesForBounds,
} from '../../../src/engine/sst-tiles.js';
import { SST_PALETTE_BAR, sstRangeFrom } from '../../../src/engine/sst.js';

vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null }));
vi.mock('../../../src/engine/layers.js', () => ({ reportDataOverlay: vi.fn() }));

const pngBlob = () => new Blob([new Uint8Array(300)], { type: 'image/png' });
const ok = (day) => ({
  ok: true, status: 200, blob: () => Promise.resolve(pngBlob()),
  headers: { get: (k) => (day && k.toLowerCase() === 'layer-time-actual' ? day + 'T00:00:00Z' : null) },
});
/** A tile whose every pixel is bin k (0 = land). */
const tileOf = (k) => ({ bins: new Uint8Array(SST_PX * SST_PX).fill(k), empty: !k });
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Answer queued fake requests one at a time, letting the queue refill in between. */
async function drain(pending) { for (let i = 0; i < 200; i++) { await tick(); if (pending.length) pending.shift()(); } }
const unpack = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

beforeEach(() => {
  sstResetMemory();
  SstLatest.date = null; SstLatest.at = 0;
  vi.restoreAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe('grid and keys', () => {
  it('a key per (day, z, x, y) and back', () => {
    const k = sstKey('2026-10-26', 7, 21, 51);
    expect(k).toBe('2026-10-26/7/21/51');
    expect(parseSstKey(k)).toEqual({ date: '2026-10-26', z: 7, x: 21, y: 51 });
    expect(parseSstKey('junk')).toBeNull();
  });

  it('the area around a boat: its z7 tile first, the 3 nearest neighbours, then z6/z5/z4', () => {
    const t = sstTilesAround(33.77, -118.42);
    expect(t[0]).toEqual({ z: 7, x: 21, y: 51 });
    expect(t.filter((x) => x.z === 7)).toHaveLength(4);
    expect(t.slice(4).map((x) => x.z)).toEqual([6, 5, 4]);
    expect(t.slice(4)).toEqual([{ z: 6, x: 10, y: 25 }, { z: 5, x: 5, y: 12 }, { z: 4, x: 2, y: 6 }]);
  });

  it('wraps across the dateline instead of asking for x = -1', () => {
    const t = sstTilesAround(20, -179.99);
    expect(t.every((x) => x.x >= 0 && x.x < 2 ** x.z)).toBe(true);
    expect(t.some((x) => x.z === 7 && x.x === 127)).toBe(true);
  });

  it('tiles over an area: coarse first, capped', () => {
    const b = { s: 33.4, w: -118.7, n: 33.9, e: -118.1 };
    const t = sstTilesForBounds(b, 3, 7, 48);
    expect(t[0].z).toBe(3);
    expect(t.filter((x) => x.z === 7).length).toBeGreaterThanOrEqual(1);
    expect(sstTilesForBounds({ s: 20, w: -130, n: 50, e: -60 }, 3, 7, 48)).toHaveLength(48);
  });

  it('day arithmetic and the GIBS header', () => {
    expect(sstDayBefore('2026-11-01', 1)).toBe('2026-10-31');
    expect(sstDayBefore('2026-03-01', 1)).toBe('2026-02-28');
    expect(sstDateFromHeader('2026-10-26T00:00:00Z')).toBe('2026-10-26');
    expect(sstDateFromHeader(null)).toBeNull();
  });
});

describe('colormap decode', () => {
  it('bins are the GIBS classes: 0.15 °C wide from 0 °C, open-ended at both ends, 0 = no data', () => {
    expect(sstBinC(0)).toBeNaN();
    expect(sstBinC(2)).toBeCloseTo(0.075);
    expect(sstBinC(129)).toBeCloseTo(19.125);   // [19.05, 19.20)
    expect(sstBinC(213)).toBeCloseTo(31.725);
    expect(sstBinC(214)).toBe(31.9);
    expect(sstBinC(215)).toBe(32.1);
    expect(sstBinC(1)).toBeLessThan(0);
  });

  it('decodes the colours GIBS actually served (checked against ERDDAP MUR values 2026-10-25)', () => {
    // pixel → ERDDAP analysed_sst at the same place: 21.364, 23.013, 22.168, 22.035 °C
    expect(sstBinC(sstBinForRgb(219, 243, 0))).toBeCloseTo(21.375, 3);
    expect(sstBinC(sstBinForRgb(255, 212, 0))).toBeCloseTo(23.025, 3);
    expect(sstBinC(sstBinForRgb(252, 243, 0))).toBeCloseTo(22.125, 3);
    expect(sstBinC(sstBinForRgb(248, 245, 0))).toBeCloseTo(21.975, 3);
  });

  it('a colour shifted by colour management still lands on its neighbour class', () => {
    expect(sstBinForRgb(220, 242, 1)).toBe(sstBinForRgb(219, 243, 0));
  });

  it('RGBA → bins: transparent is no data; an all-land tile is flagged empty', () => {
    const px = new Uint8ClampedArray([219, 243, 0, 255, 0, 0, 0, 0, 255, 212, 0, 255, 255, 212, 0, 40]);
    const { bins, empty } = sstDecodeRgba(px);
    expect(Array.from(bins)).toEqual([sstBinForRgb(219, 243, 0), 0, sstBinForRgb(255, 212, 0), 0]);
    expect(empty).toBe(false);
    expect(sstDecodeRgba(new Uint8ClampedArray(16)).empty).toBe(true);
  });
});

describe('range fitted to the pixels in view', () => {
  it('histogram of a pixel rectangle, sampled every `step`, land skipped', () => {
    const t = tileOf(130);
    t.bins.fill(0, 0, SST_PX * 10);    // first 10 rows land
    const h = sstHistAdd(new Uint32Array(SST_NBINS), t.bins, 0, 0, 20, 20, 1);
    expect(h[130]).toBe(20 * 10);
    expect(h[0]).toBe(0);
    expect(sstHistAdd(new Uint32Array(SST_NBINS), t.bins, -50, 200, 400, 400, 2)[130]).toBe(128 * 28);
  });

  it('same 10th–90th percentile rule as the legacy sampled range', () => {
    const bins = [100, 101, 102, 103, 104, 105, 106, 107, 108, 150];
    const h = new Uint32Array(SST_NBINS);
    bins.forEach((k) => h[k]++);
    expect(sstRangeFromHist(h)).toEqual(sstRangeFrom(bins.map(sstBinC)));
  });

  it('a near-uniform view widens to 1 °C around its middle; under 3 water pixels → null', () => {
    const h = new Uint32Array(SST_NBINS);
    h[130] = 500;
    const r = sstRangeFromHist(h);
    expect(r[1] - r[0]).toBeCloseTo(1, 5);
    expect((r[0] + r[1]) / 2).toBeCloseTo(sstBinC(130), 1);
    const few = new Uint32Array(SST_NBINS);
    few[130] = 2;
    expect(sstRangeFromHist(few)).toBeNull();
  });
});

describe('colouring', () => {
  const stops = sstStopsFromGradient(SST_PALETTE_BAR.BlueWhiteRed);

  it('the map is painted from the legend bar stops themselves', () => {
    expect(stops).toEqual([[0x1f, 0x6f, 0xe0], [0x8f, 0xc9, 0xe8], [0xf4, 0xf4, 0xf4], [0xf2, 0xa0, 0x3d], [0xd8, 0x1f, 0x1f]]);
  });

  it('bin LUT: no data transparent, clamped to the first / last stop outside the range', () => {
    const lut = sstLut(stops, [15, 20]);
    expect(lut[0]).toBe(0);
    expect(unpack(lut[2])).toEqual([0x1f, 0x6f, 0xe0, 255]);        // 0 °C → coldest colour
    expect(unpack(lut[214])).toEqual([0xd8, 0x1f, 0x1f, 255]);      // 31.9 °C → warmest
  });

  it('fine table spans the range end to end', () => {
    const f = sstFineLut(stops, [15, 20]);
    expect(f).toHaveLength(SST_FINE);
    expect(unpack(f[0])).toEqual([0x1f, 0x6f, 0xe0, 255]);
    expect(unpack(f[SST_FINE - 1])).toEqual([0xd8, 0x1f, 0x1f, 255]);
  });

  it('upsampled tile: uniform water is one colour; land stays transparent', () => {
    const out = new Uint32Array(SST_PX * SST_PX);
    const fine = sstFineLut(stops, [15, 25]);
    sstPaintUpsampled(out, () => tileOf(130), 3, 5, 8, fine, [15, 25]);
    expect(new Set(out).size).toBe(1);
    sstPaintUpsampled(out, (dx, dy) => (dx || dy ? null : tileOf(0)), 0, 0, 8, fine, [15, 25]);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('a 0.15 °C class step becomes a smooth ramp, not a staircase', () => {
    // left half of the data tile one class, right half the next one up
    const t = tileOf(130);
    for (let y = 0; y < SST_PX; y++) t.bins.fill(131, y * SST_PX + 128, y * SST_PX + 256);
    const range = [sstBinC(130), sstBinC(131)];
    const fine = new Uint32Array(SST_FINE).map((_, i) => i);   // colour = position in the table
    const out = new Uint32Array(SST_PX * SST_PX);
    // drawn tile at z10 straddling the step (data columns 96..127 | 128..159 → sx = 3 and 4)
    sstPaintUpsampled(out, (dx, dy) => (dx || dy ? null : t), 4, 2, 8, fine, range);
    const row = Array.from(out.slice(100 * SST_PX, 101 * SST_PX));
    const levels = new Set(row);
    expect(levels.size).toBeGreaterThan(8);                    // many intermediate shades…
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);   // …rising monotonically
  });

  it('smoothing never spreads water onto land, and averages water only with water', () => {
    const W = 6;
    const g = new Float32Array(W * W).fill(20);
    for (let y = 0; y < W; y++) g[y * W] = NaN;     // a land column
    g[3 * W + 3] = 26;
    const s = sstSmooth(g, W, 1);
    for (let y = 0; y < W; y++) expect(s[y * W]).toBeNaN();
    expect(s[3 * W + 3]).toBeCloseTo((26 + 8 * 20) / 9, 4);
    expect(s[3 * W + 1]).toBeCloseTo(20, 4);       // its land neighbours do not drag it down
  });
});

describe('on-device expiry', () => {
  it('drops unpinned days older than SST_KEEP_DAYS, keeps recent ones', () => {
    const latest = '2026-10-26';
    const old = sstDayBefore(latest, SST_KEEP_DAYS + 1);
    const del = sstPrunePlan([
      { key: sstKey(latest, 7, 21, 51) }, { key: sstKey(sstDayBefore(latest, 4), 7, 21, 51) },
      { key: sstKey(old, 7, 21, 51) }, { key: 'junk' },
    ], latest);
    expect(del.sort()).toEqual([sstKey(old, 7, 21, 51), 'junk'].sort());
  });

  it('offline-area tiles (pinned) outlive the expiry, but only the newest day per place', () => {
    const latest = '2026-10-26';
    const del = sstPrunePlan([
      { key: sstKey('2026-08-01', 7, 21, 51), pin: true },
      { key: sstKey('2026-09-01', 7, 21, 51), pin: true },
      { key: sstKey('2026-08-01', 7, 22, 51), pin: true },
    ], latest);
    expect(del).toEqual([sstKey('2026-08-01', 7, 21, 51)]);
  });

  it('caps the unpinned store, oldest days first', () => {
    const latest = '2026-10-26';
    const entries = [];
    for (let i = 0; i < SST_MAX_TILES + 5; i++) entries.push({ key: sstKey(sstDayBefore(latest, i % 5), 7, i, 0) });
    const del = sstPrunePlan(entries, latest);
    expect(del).toHaveLength(5);
    expect(del.every((k) => k.startsWith(sstDayBefore(latest, 4)))).toBe(true);
  });
});

describe('network', () => {
  it(`at most ${SST_CONCURRENCY} requests at once; the same tile is asked once`, async () => {
    const pending = [];
    let peak = 0, live = 0;
    globalThis.fetch = vi.fn(() => { live++; peak = Math.max(peak, live); return new Promise((r) => pending.push(() => { live--; r(ok()); })); });
    const ps = [];
    for (let x = 0; x < 10; x++) ps.push(sstTileBlob('2026-10-26', 7, x, 51));
    ps.push(sstTileBlob('2026-10-26', 7, 0, 51));       // a duplicate
    await tick();
    expect(globalThis.fetch).toHaveBeenCalledTimes(SST_CONCURRENCY);
    await drain(pending);
    const blobs = await Promise.all(ps);
    expect(blobs.every((b) => b instanceof Blob)).toBe(true);
    expect(peak).toBe(SST_CONCURRENCY);
    expect(globalThis.fetch).toHaveBeenCalledTimes(10);
    expect(sstQueueState()).toEqual({ active: 0, queued: 0, inflight: 0 });
  });

  it('the view jumps the queue ahead of background prefetch', async () => {
    const order = [];
    const pending = [];
    globalThis.fetch = vi.fn((url) => { order.push(url); return new Promise((r) => pending.push(() => r(ok()))); });
    const ps = [];
    for (let x = 0; x < SST_CONCURRENCY + 3; x++) ps.push(sstTileBlob('2026-10-25', 7, x, 51, { prio: 3 }));
    ps.push(sstTileBlob('2026-10-26', 7, 99, 51, { prio: 0 }));
    await drain(pending);
    await Promise.all(ps);
    expect(order[SST_CONCURRENCY]).toBe(sstTileUrl('2026-10-26', 7, 99, 51));
  });

  it('a request no longer wanted (tile scrolled away, overlay off) is dropped before it is sent', async () => {
    const pending = [];
    globalThis.fetch = vi.fn(() => new Promise((r) => pending.push(() => r(ok()))));
    const ps = [];
    for (let x = 0; x < SST_CONCURRENCY; x++) ps.push(sstTileBlob('2026-10-26', 7, x, 51));
    const dropped = sstTileBlob('2026-10-26', 7, 50, 51, { wanted: () => false });
    await drain(pending);
    expect(await dropped).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(SST_CONCURRENCY);
    await Promise.all(ps);
  });

  it('a day GIBS does not have (404) is not asked again this session', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
    expect(await sstTileBlob('2026-02-07', 7, 21, 51)).toBeNull();
    expect(await sstTileBlob('2026-02-07', 7, 21, 51)).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('offline: no request at all', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.fetch = vi.fn(() => Promise.resolve(ok()));
    expect(await sstTileBlob('2026-10-26', 7, 21, 51)).toBeNull();
    expect(await sstResolveLatest({ z: 7, x: 21, y: 51 })).toBeNull();   // nothing stored either
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('newest day: one probe request, read from Layer-Time-Actual, trusted for hours', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(ok('2026-10-26')));
    const [a, b] = await Promise.all([sstResolveLatest({ z: 7, x: 21, y: 51 }), sstResolveLatest({ z: 7, x: 21, y: 51 })]);
    expect(a).toBe('2026-10-26');
    expect(b).toBe('2026-10-26');
    expect(await sstResolveLatest({ z: 7, x: 21, y: 51 })).toBe('2026-10-26');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe(sstTileUrl(null, 7, 21, 51));
    expect(JSON.parse(localStorage.getItem('fishapp.sst.latest')).date).toBe('2026-10-26');
  });

  it('GIBS unreachable: the last known day, else the day before yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sstResolveLatest(null)).toBe('2026-10-25');
    SstLatest.date = '2026-10-26'; SstLatest.at = 0;
    expect(await sstResolveLatest(null)).toBe('2026-10-26');
  });

  it('offline-area save is a no-op (no requests) where there is no on-device store', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(ok('2026-10-26')));
    expect(await sstSaveArea({ s: 33.4, w: -118.7, n: 33.9, e: -118.1 })).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
