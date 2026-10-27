/* Offline downloads — the pure tile math, layer selection, size estimate, shared-tile delete
 * and the honest result copy (engine/download.js). Expected values were derived from the
 * legacy formulas in legacy/js/download.js. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/layers.js', async () => (await import('./_mocks.js')).layersMock());
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/fish.js', async () => (await import('./_mocks.js')).fishMock());
vi.mock('../../../src/engine/tides.js', async () => (await import('./_mocks.js')).tidesMock());

const dl = await import('../../../src/engine/download.js');
const { LAYERS } = await import('../../../src/engine/tiles.js');
const { layersStoreMock, fullPack } = await import('./_mocks.js');

const box = L.latLngBounds([33.7, -118.5], [33.8, -118.3]);

describe('slippy tile math', () => {
  it('matches the standard Web-Mercator tile indices', () => {
    expect(dl.lon2tx(-118.4, 10)).toBe(175);
    expect(dl.lat2ty(33.75, 10)).toBe(409);
    expect(dl.lon2tx(0, 1)).toBe(1);
    expect(dl.lat2ty(0, 1)).toBe(1);
    expect(dl.lon2tx(-180, 4)).toBe(0);
    expect(dl.lat2ty(-85, 4)).toBe(15);
    expect(dl.lon2tx(-118.5, 13)).toBe(1399);
    expect(dl.lon2tx(-118.3, 13)).toBe(1404);
    expect(dl.lat2ty(33.8, 13)).toBe(3277);
    expect(dl.lat2ty(33.7, 13)).toBe(3280);
  });
});

describe('tile ranges / counting / jobs', () => {
  const combos = [
    ['ocean', 'enc', 'seamark'],
    ['bluetint', 'labels', 'blueshade'],
    ['gmrt', 'labels', 'reliefhi', 'enc'],
    ['sat', 'labels'],
  ];
  it('counts exactly what the job builder produces, without allocating', () => {
    for (const ids of combos) {
      for (const [minZ, maxZ] of [[8, 12], [10, 14], [12, 16]]) {
        expect(dl.tileJobCount(box, minZ, maxZ, ids)).toBe(dl.tileJobs(box, minZ, maxZ, ids).length);
      }
    }
  });

  it('indexes 512-px layers on the grid one zoom coarser (key parity with the live layer)', () => {
    const r = dl.tileRanges(box, 13, 13, ['enc']);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'enc', z: 13, x0: dl.lon2tx(-118.5, 12), x1: dl.lon2tx(-118.3, 12), y0: dl.lat2ty(33.8, 12), y1: dl.lat2ty(33.7, 12) });
    const s = dl.tileRanges(box, 13, 13, ['seamark'])[0];   // 256-px layer: same zoom grid
    expect(s).toMatchObject({ x0: 1399, x1: 1404, y0: 3277, y1: 3280 });
  });

  it('respects each layer\'s min / max native zoom and skips unknown layer ids', () => {
    const r = dl.tileRanges(box, 8, 16, ['blueshade', 'no-such-layer']);
    const zs = r.map((x) => x.z);
    expect(Math.min(...zs)).toBe(LAYERS.blueshade.minZoom);
    expect(Math.max(...zs)).toBe(LAYERS.blueshade.maxNativeZoom);
    expect(r.every((x) => x.id === 'blueshade')).toBe(true);
  });

  it('stops accumulating absurd counts early', () => {
    const world = L.latLngBounds([-85, -180], [85, 180]);
    expect(dl.tileJobCount(world, 3, 18, ['sat', 'labels', 'street'])).toBeGreaterThan(dl.MAX_TILES);
  });

  it('estimates bytes like the legacy per-job sum (scaled by rendered pixels)', () => {
    for (const ids of combos) {
      const jobs = dl.tileJobs(box, 10, 14, ids);
      let legacy = 0;
      jobs.forEach((j) => { const px = LAYERS[j.id].tilePx || 256; legacy += dl.AVG_TILE_BYTES * (px / 512) * (px / 512); });
      expect(dl.estimateBytes(dl.tileRanges(box, 10, 14, ids))).toBeCloseTo(legacy, 3);
    }
  });

  it('never spans more than 5 zoom levels and never goes below z3', () => {
    expect(dl.zoomSpan(9, 14)).toEqual({ minZ: 10, maxZ: 14 });
    expect(dl.zoomSpan(15, 14)).toEqual({ minZ: 14, maxZ: 14 });
    expect(dl.zoomSpan(4, 12)).toEqual({ minZ: 8, maxZ: 12 });
    expect(dl.zoomSpan(2, 6)).toEqual({ minZ: 3, maxZ: 6 });
    expect(dl.zoomSpan(13, 16)).toEqual({ minZ: 12, maxZ: 16 });
  });
});

describe('activeLayerIds — what the chart shows', () => {
  beforeEach(() => layersStoreMock.setState({ base: 'ocean', enc: false, seamark: false }));
  it('plain bases carry no companions', () => {
    expect(dl.activeLayerIds({ base: 'ocean', enc: false, seamark: false })).toEqual(['ocean']);
    expect(dl.activeLayerIds({ base: 'street', enc: false, seamark: false })).toEqual(['street']);
  });
  it('satellite no longer brings the retired CARTO labels', () => {
    expect(dl.activeLayerIds({ base: 'sat', enc: false, seamark: true })).toEqual(['sat', 'seamark']);
  });
  it('GMRT relief brings its hillshade', () => {
    expect(dl.activeLayerIds({ base: 'gmrt', enc: true, seamark: false })).toEqual(['gmrt', 'reliefhi', 'enc']);
  });
  it('BlueTopo brings blueshade (the legacy list dropped it)', () => {
    expect(dl.activeLayerIds({ base: 'bluetint', enc: true, seamark: true })).toEqual(['bluetint', 'blueshade', 'enc', 'seamark']);
  });
  it('reads the layer owner store when no state is passed', () => {
    layersStoreMock.setState({ base: 'bluetint', enc: true, seamark: false });
    expect(dl.activeLayerIds()).toEqual(['bluetint', 'blueshade', 'enc']);
  });
});

describe('deleting an area keeps tiles another saved area still needs', () => {
  const rec = (id, s, w, n, e, layerIds = ['seamark']) => ({ id, name: 'A' + id, bounds: { s, w, n, e }, minZ: 12, maxZ: 13, layerIds });
  it('deletes everything when nothing overlaps', () => {
    const a = rec(1, 33.70, -118.50, 33.75, -118.45);
    const far = rec(2, 34.50, -120.00, 34.55, -119.95);
    const all = dl.areaTileKeys(a);
    const { del, kept } = dl.keysToDelete(a, [a, far]);
    expect(kept).toBe(0);
    expect(del).toEqual(all);
  });
  it('keeps the shared keys of an overlapping area', () => {
    const a = rec(1, 33.70, -118.50, 33.76, -118.44);
    const b = rec(2, 33.73, -118.47, 33.80, -118.40);
    const aKeys = dl.areaTileKeys(a), bKeys = new Set(dl.areaTileKeys(b));
    const shared = aKeys.filter((k) => bKeys.has(k));
    expect(shared.length).toBeGreaterThan(0);
    const { del, kept } = dl.keysToDelete(a, [a, b]);
    expect(kept).toBe(shared.length);
    expect(del.some((k) => bKeys.has(k))).toBe(false);
    expect(del.length + kept).toBe(aKeys.length);
  });
  it('different layers never protect each other', () => {
    const a = rec(1, 33.70, -118.50, 33.76, -118.44, ['seamark']);
    const b = rec(2, 33.70, -118.50, 33.76, -118.44, ['labels']);
    expect(dl.keysToDelete(a, [a, b]).kept).toBe(0);
  });

  /* Two boxes that do not overlap can still share a coarse tile, and with the native-zoom floor
     that tile can be the other area's only base level. The old box-overlap test deleted it. */
  const floored = (id, w, e, s, n, minZ, maxZ, layerIds) => ({ id, name: 'F' + id, bounds: { w, e, s, n }, minZ, maxZ, layerIds, nativeFloor: true });
  it('keeps the GEBCO z10 tile a nearby (not overlapping) area still needs', () => {
    // default Ocean base, Standard detail at map z13: z12-14 with GEBCO kept in the base's place
    const a = floored(1, -118.30, -118.27, 33.70, 33.72, 12, 14, ['gmrt', 'enc']);
    const b = floored(2, -118.20, -118.17, 33.70, 33.72, 12, 14, ['gmrt', 'enc']);
    expect(a.bounds.e < b.bounds.w).toBe(true);
    const bKeys = new Set(dl.areaTileKeys(b));
    expect([...bKeys].filter((k) => k.startsWith('gmrt/'))).toEqual(['gmrt/10/175/410']);   // B's only base level
    const { del, kept } = dl.keysToDelete(a, [a, b]);
    expect(del).not.toContain('gmrt/10/175/410');
    expect(del.some((k) => bKeys.has(k))).toBe(false);
    expect(kept).toBe(dl.areaTileKeys(a).filter((k) => bKeys.has(k)).length);
    expect(del.length + kept).toBe(dl.areaTileKeys(a).length);
  });
  it('keeps the shared GMRT z12 detail tile of two relief areas a couple of km apart', () => {
    // relief base, Maximum detail at map z15: z14-16, GMRT detail floored to its z12
    const a = floored(1, -118.300, -118.290, 33.700, 33.705, 14, 16, ['gmrt', 'reliefhi', 'enc']);
    const b = floored(2, -118.270, -118.260, 33.700, 33.705, 14, 16, ['gmrt', 'reliefhi', 'enc']);
    const bKeys = new Set(dl.areaTileKeys(b));
    const shared = dl.areaTileKeys(a).filter((k) => bKeys.has(k));
    expect(shared).toEqual(expect.arrayContaining(['gmrt/10/175/410']));
    expect(shared.some((k) => k.startsWith('reliefhi/12/'))).toBe(true);
    const { del } = dl.keysToDelete(a, [a, b]);
    expect(del.some((k) => bKeys.has(k))).toBe(false);
  });
  it('a far-away area still protects nothing, and a lone area deletes everything', () => {
    const a = floored(1, -118.30, -118.27, 33.70, 33.72, 12, 14, ['gmrt', 'enc']);
    const far = floored(2, -120.00, -119.97, 34.50, 34.52, 12, 14, ['gmrt', 'enc']);
    expect(dl.keysToDelete(a, [a, far])).toEqual({ del: dl.areaTileKeys(a), kept: 0 });
    expect(dl.keysToDelete(a, [a])).toEqual({ del: dl.areaTileKeys(a), kept: 0 });
  });
});

describe('honest result copy', () => {
  const full = { level: 'full', failed: [], ok: 6, total: 6 };
  const partial = { level: 'partial', failed: ['tide predictions', 'recent fish sightings'], ok: 4, total: 6 };
  const none = { level: 'none', failed: [], ok: 0, total: 6 };
  it('keeps the legacy success line when everything arrived', () => {
    expect(dl.savedToastText('Home bay', 0, full)).toBe('"Home bay" saved (charts + data) for offline use');
  });
  it('names the missing data sections', () => {
    expect(dl.savedToastText('Home bay', 0, partial)).toBe('"Home bay" saved for offline use — charts + some data (missing: tide predictions, recent fish sightings)');
  });
  it('never claims data when every pack section failed', () => {
    const s = dl.savedToastText('Home bay', 0, none);
    expect(s).toContain('charts only');
    expect(s).not.toContain('charts + data');
  });
  it('says the area is incomplete when tiles failed', () => {
    expect(dl.savedToastText('Bay', 3, full)).toBe('"Bay" saved (charts + data) for offline use. 3 tiles could not be downloaded, so this area is incomplete');
    expect(dl.savedToastText('Bay', 1, full)).toContain('1 tile could not');
  });
  it('has no emoji', () => {
    for (const h of [full, partial, none]) expect(dl.savedToastText('x', 2, h)).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('saved-area rows', () => {
  it('surfaces the stored incomplete flag and the pack health', () => {
    const r = dl.areaRow({ id: 4, name: 'Bay', tiles: 900, planned: 1000, bytes: 3 * 1048576, ts: 5, incomplete: true,
      data: fullPack({ fish: undefined, fishError: true }), bounds: { s: 1, w: 2, n: 3, e: 4 } });
    expect(r).toMatchObject({ id: 4, tiles: 900, planned: 1000, mb: 3, incomplete: true, partial: false, data: 'partial', dataMissing: ['recent fish sightings'] });
  });
  it('recognises a legacy cancelled record by its name and a pack-less record as charts only', () => {
    const r = dl.areaRow({ id: 1, name: 'Area (partial)', tiles: 10, bytes: 0, ts: 1, incomplete: true, data: null });
    expect(r.partial).toBe(true);
    expect(r.data).toBe('none');
  });
  it('treats a pack whose every section failed as charts only', () => {
    const r = dl.areaRow({ id: 2, name: 'X', data: { forecastError: true, marineError: true, sstError: true, depthError: true, tidesError: true, fishError: true } });
    expect(r.data).toBe('none');
  });
  it('a record from the old builder with an empty depth grid and no flag is charts only, not "some data"', () => {
    const r = dl.areaRow({ id: 3, name: 'Y', data: { forecastError: true, marineError: true, sstError: true, depthGrid: [], tidesError: true, fishError: true } });
    expect(r.data).toBe('none');
    expect(r.dataMissing).toEqual([]);
  });
});

describe('quota detection', () => {
  it('recognises QuotaExceededError by name or message', () => {
    expect(dl.isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(dl.isQuotaError(new Error('The quota has been exceeded'))).toBe(true);
    expect(dl.isQuotaError(new Error('network'))).toBe(false);
    expect(dl.isQuotaError(null)).toBe(false);
  });
});
