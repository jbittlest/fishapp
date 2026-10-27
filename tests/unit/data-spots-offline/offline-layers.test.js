/* Offline downloads keep only what the sources' terms allow (engine/download.js + the LAYERS
 * `offline` flags in engine/tiles.js): Esri, OpenStreetMap and OpenSeaMap tiles are never planned,
 * counted, fetched or recorded; a base that may not be kept is replaced by GEBCO so the area still
 * has a chart offline; and GEBCO's z10 ceiling no longer leaves that base empty in deep downloads. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/layers.js', async () => (await import('./_mocks.js')).layersMock());
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/fish.js', async () => (await import('./_mocks.js')).fishMock());
vi.mock('../../../src/engine/tides.js', async () => (await import('./_mocks.js')).tidesMock());
vi.mock('../../../src/engine/areadata.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, buildAreaPack: vi.fn(async () => null), areaDataRefresh: vi.fn(async () => {}) };
});

const dl = await import('../../../src/engine/download.js');
const db = await import('../../../src/engine/db.js');
const { LAYERS, OFFLINE_BASE, canSaveOffline } = await import('../../../src/engine/tiles.js');
const { uiStore } = await import('../../../src/services/ui');
const mocks = await import('./_mocks.js');

const box = L.latLngBounds([33.70, -118.45], [33.72, -118.43]);
const NOT_KEPT = /arcgisonline\.com|openstreetmap\.org|openseamap\.org|cartocdn\.com/;

function blobOf(size) { return new Blob([new Uint8Array(size)], { type: 'image/png' }); }

describe('every chart layer says whether its terms allow offline copies', () => {
  it('declares the flag explicitly on every layer', () => {
    for (const def of Object.values(LAYERS)) expect(typeof def.offline, def.id).toBe('boolean');
  });
  it('keeps the public-domain and CC BY sources, and not Esri, OpenStreetMap, CARTO or OpenSeaMap', () => {
    const kept = Object.keys(LAYERS).filter(canSaveOffline).sort();
    expect(kept).toEqual(['blueshade', 'bluetint', 'enc', 'gmrt', 'ncei', 'reliefhi']);
    expect(['ocean', 'sat', 'street', 'labels', 'seamark'].some(canSaveOffline)).toBe(false);
  });
  it('gives every live layer that is not kept a plain reason line', () => {
    for (const def of Object.values(LAYERS)) {
      if (def.offline || def.retired) continue;
      expect(def.offlineNote, def.id).toMatch(/^.+ (isn't|aren't) saved — .+ offline copies$/);
    }
  });
  it('substitutes a base that may be kept', () => {
    expect(LAYERS[OFFLINE_BASE].kind).toBe('base');
    expect(canSaveOffline(OFFLINE_BASE)).toBe(true);
    expect(canSaveOffline('no-such-layer')).toBe(false);
  });
});

describe('offlineLayerPlan — what a download keeps', () => {
  it('Ocean base: GEBCO in its place, NOAA charts kept, seamarks live only', () => {
    expect(dl.offlineLayerPlan(['ocean', 'enc', 'seamark'])).toEqual({ layerIds: ['gmrt', 'enc'], skipped: ['ocean', 'seamark'], swappedBase: 'ocean' });
  });
  it('Street and Satellite bases are replaced the same way', () => {
    expect(dl.offlineLayerPlan(['street'])).toEqual({ layerIds: ['gmrt'], skipped: ['street'], swappedBase: 'street' });
    expect(dl.offlineLayerPlan(['sat', 'enc'])).toEqual({ layerIds: ['gmrt', 'enc'], skipped: ['sat'], swappedBase: 'sat' });
  });
  it('a base that may be kept is kept as is, with its companion', () => {
    expect(dl.offlineLayerPlan(['gmrt', 'reliefhi', 'enc'])).toEqual({ layerIds: ['gmrt', 'reliefhi', 'enc'], skipped: [], swappedBase: null });
    expect(dl.offlineLayerPlan(['bluetint', 'blueshade', 'enc', 'seamark'])).toEqual({ layerIds: ['bluetint', 'blueshade', 'enc'], skipped: ['seamark'], swappedBase: null });
  });
  it('drops ids this build does not know, and survives an empty list', () => {
    expect(dl.offlineLayerPlan(['gmrt', 'gone-layer'])).toEqual({ layerIds: ['gmrt'], skipped: [], swappedBase: null });
    expect(dl.offlineLayerPlan([])).toEqual({ layerIds: [], skipped: [], swappedBase: null });
  });
});

describe('native-zoom floor', () => {
  it('a deep download still keeps GEBCO\'s deepest level (z10), which the chart upscales', () => {
    const r = dl.tileRanges(box, 12, 16, ['gmrt']);
    expect(r.map((x) => x.z)).toEqual([10]);
    expect(dl.tileRanges(box, 12, 16, ['gmrt'], false)).toEqual([]);   // the old rule kept nothing
  });
  it('leaves spans that already reach a layer\'s native levels alone', () => {
    expect(dl.tileRanges(box, 8, 12, ['gmrt']).map((x) => x.z)).toEqual([8, 9, 10]);
    const zs = dl.tileRanges(box, 8, 16, ['blueshade']).map((x) => x.z);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([LAYERS.blueshade.minZoom, LAYERS.blueshade.maxNativeZoom]);
  });
  it('keeps BlueTopo\'s hillshade (native to z14) in a z15-16 span', () => {
    expect(dl.tileRanges(box, 15, 16, ['blueshade']).map((x) => x.z)).toEqual([14]);
  });
  it('the counter, the size estimate and the job builder still agree', () => {
    for (const ids of [['gmrt', 'enc'], ['gmrt', 'reliefhi', 'enc'], ['bluetint', 'blueshade', 'enc']]) {
      for (const [minZ, maxZ] of [[8, 12], [10, 14], [12, 16]]) {
        const jobs = dl.tileJobs(box, minZ, maxZ, ids);
        expect(dl.tileJobCount(box, minZ, maxZ, ids)).toBe(jobs.length);
        let sum = 0;
        jobs.forEach((j) => { const px = LAYERS[j.id].tilePx || 256; sum += dl.AVG_TILE_BYTES * (px / 512) * (px / 512); });
        expect(dl.estimateBytes(dl.tileRanges(box, minZ, maxZ, ids))).toBeCloseTo(sum, 3);
      }
    }
  });
});

describe('planning and the panel estimate', () => {
  beforeEach(() => {
    mocks.state.map = mocks.mapStub(box, 13);
    dl.dlStore.setState({ zoom: 14 });
  });

  it('plans, counts and sizes only the kept layers, and tells the panel what was left out', () => {
    mocks.layersStoreMock.setState({ base: 'ocean', enc: true, seamark: true });
    const plan = dl.planDownload(true);
    expect(plan.layerIds).toEqual(['gmrt', 'enc']);
    expect(plan.count).toBe(plan.jobs.length);
    expect(new Set(plan.jobs.map((j) => j.id))).toEqual(new Set(['gmrt', 'enc']));
    expect(plan.jobs.filter((j) => j.id === 'gmrt').every((j) => j.z === 10)).toBe(true);

    dl.updateEstimate();
    const est = dl.dlStore.getState().estimate;
    expect(est).toMatchObject({ status: 'ok', count: plan.count, layerIds: ['gmrt', 'enc'], skipped: ['ocean', 'seamark'], swappedBase: 'ocean' });
    expect(est.mb * 1048576).toBeCloseTo(dl.estimateBytes(dl.tileRanges(box, plan.minZ, plan.maxZ, ['gmrt', 'enc'])), 3);
  });

  it('a Street base with every overlay off still has a chart to download', () => {
    mocks.layersStoreMock.setState({ base: 'street', enc: false, seamark: false });
    dl.updateEstimate();
    expect(dl.dlStore.getState().estimate).toMatchObject({ status: 'ok', layerIds: ['gmrt'], skipped: ['street'], swappedBase: 'street' });
    expect(dl.dlStore.getState().estimate.count).toBeGreaterThan(0);
  });

  it('a relief base reports nothing left out', () => {
    mocks.layersStoreMock.setState({ base: 'bluetint', enc: true, seamark: false });
    dl.updateEstimate();
    expect(dl.dlStore.getState().estimate).toMatchObject({ layerIds: ['bluetint', 'blueshade', 'enc'], skipped: [], swappedBase: null });
  });

  it('a too-big area still says what would be left out', () => {
    mocks.state.map = mocks.mapStub(L.latLngBounds([20, -130], [50, -60]), 6);
    mocks.layersStoreMock.setState({ base: 'sat', enc: true, seamark: true });
    dl.dlStore.setState({ zoom: 16 });
    dl.updateEstimate();
    expect(dl.dlStore.getState().estimate).toMatchObject({ status: 'tooBig', skipped: ['sat', 'seamark'], swappedBase: 'sat' });
  });
});

describe('a download over an Ocean base', () => {
  let urls;
  beforeEach(() => {
    db.idb.stores.tiles.clear(); db.idb.stores.areas.clear();
    vi.mocked(db.putTileBlob).mockClear();
    mocks.state.map = mocks.mapStub(box, 13);
    mocks.layersStoreMock.setState({ base: 'ocean', enc: true, seamark: true });
    dl.dlStore.setState({ zoom: 14, deleting: null, draining: false });
    dl.DL.draining = null;
    urls = [];
    vi.stubGlobal('fetch', async (u) => { urls.push(u); return { ok: true, blob: async () => blobOf(9000) }; });
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    uiStore.setState({ dialogs: [] });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('never fetches or stores Esri / OpenStreetMap / OpenSeaMap tiles, and records exactly the kept plan', async () => {
    const plan = dl.planDownload(true);
    expect(await dl.startDownload('Home bay', 14)).toBe('saved');
    expect(urls.length).toBe(plan.jobs.length);
    expect(urls.some((u) => NOT_KEPT.test(u))).toBe(false);
    const stored = vi.mocked(db.putTileBlob).mock.calls.map((c) => c[0]);
    expect(stored.every((k) => /^(gmrt|enc)\//.test(k))).toBe(true);
    expect(stored.some((k) => k.startsWith('gmrt/10/'))).toBe(true);
    const a = [...db.idb.stores.areas.values()][0];
    expect(a).toMatchObject({ layerIds: ['gmrt', 'enc'], nativeFloor: true, planned: plan.jobs.length, tiles: plan.jobs.length, incomplete: false });
    expect(new Set(dl.areaTileKeys(a))).toEqual(new Set(stored));
  });

  it('deleting that area removes every tile it stored', async () => {
    await dl.startDownload('Home bay', 14);
    const a = [...db.idb.stores.areas.values()][0];
    expect(db.idb.stores.tiles.size).toBe(a.tiles);
    const p = dl.deleteArea(a.id);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    uiStore.getState().dialogs[0].resolve(true);
    expect(await p).toBe(true);
    expect(db.idb.stores.tiles.size).toBe(0);
    expect(db.idb.stores.areas.size).toBe(0);
  });
});

describe('areas saved before this change', () => {
  const old = { id: 7, name: 'Old', bounds: { s: 33.70, w: -118.45, n: 33.72, e: -118.43 }, minZ: 12, maxZ: 14 };
  it('are deleted by the rule they were planned with (no floor)', () => {
    const keys = dl.areaTileKeys({ ...old, layerIds: ['gmrt', 'reliefhi'] });
    expect(keys.some((k) => k.startsWith('gmrt/'))).toBe(false);
    const floored = dl.areaTileKeys({ ...old, layerIds: ['gmrt', 'reliefhi'], nativeFloor: true });
    expect(floored.filter((k) => k.startsWith('gmrt/')).every((k) => k.startsWith('gmrt/10/'))).toBe(true);
    expect(floored.length).toBeGreaterThan(keys.length);
  });
  it('still find their Esri, seamark and retired label tiles, so deleting the area clears them', () => {
    const keys = dl.areaTileKeys({ ...old, layerIds: ['sat', 'labels', 'seamark'] });
    for (const id of ['sat', 'labels', 'seamark']) expect(keys.some((k) => k.startsWith(id + '/')), id).toBe(true);
  });
  it('say in their row what they no longer keep, before and after the launch sweep corrects them', () => {
    expect(dl.areaRow({ ...old, layerIds: ['ocean', 'enc', 'seamark'] })).toMatchObject({ notSaved: ['ocean', 'seamark'], baseGone: true });
    expect(dl.areaRow({ ...old, layerIds: ['enc'], dropped: ['ocean', 'seamark'] })).toMatchObject({ notSaved: ['ocean', 'seamark'], baseGone: true });
    // the retired labels are not worth a line; a kept relief base is not "gone"
    expect(dl.areaRow({ ...old, layerIds: ['gmrt', 'reliefhi'], dropped: ['labels'] })).toMatchObject({ notSaved: [], baseGone: false });
    expect(dl.areaRow({ ...old, layerIds: ['bluetint', 'blueshade', 'enc'], dropped: ['labels', 'seamark'] })).toMatchObject({ notSaved: ['seamark'], baseGone: false });
    expect(dl.areaRow({ ...old, layerIds: ['gmrt', 'enc'], nativeFloor: true })).toMatchObject({ notSaved: [], baseGone: false });
  });
});

describe('the launch sweep of tiles the terms forbid keeping', () => {
  const blob = () => blobOf(9000);
  const bounds = { s: 33.70, w: -118.45, n: 33.72, e: -118.43 };
  // saved by older builds: every planned tile stored and counted, sizes recorded
  const oldOcean = { id: 1, name: 'Home bay', bounds, minZ: 12, maxZ: 14, layerIds: ['ocean', 'enc', 'seamark'], blank: 0, ts: 1 };
  const oldSat = { id: 2, name: 'Reef', bounds, minZ: 12, maxZ: 13, layerIds: ['sat', 'labels'], blank: 0, ts: 2 };
  const oldRelief = { id: 3, name: 'Canyon', bounds, minZ: 12, maxZ: 14, layerIds: ['gmrt', 'labels', 'reliefhi', 'enc'], blank: 0, ts: 3 };
  const current = { id: 4, name: 'New', bounds, minZ: 12, maxZ: 14, layerIds: ['gmrt', 'enc'], nativeFloor: true, blank: 0, ts: 4 };
  const browsed = ['ocean/9/87/204', 'street/11/351/818', 'seamark/10/175/409', 'labels/8/43/102', 'sat/15/2810/6554'];
  const keepableBrowsed = ['gmrt/9/87/204', 'enc/10/87/204'];
  const unkeepableRe = /^(ocean|sat|street|seamark|labels)\//;

  function save(rec) {
    const keys = dl.areaTileKeys(rec);
    keys.forEach((k) => db.idb.stores.tiles.set(k, blob()));
    const r = { ...rec, tiles: keys.length, planned: keys.length, bytes: keys.length * 9000 };
    db.idb.stores.areas.set(rec.id, r);
    return r;
  }
  const stored = () => [...db.idb.stores.tiles.keys()];
  const lastToast = () => { const t = uiStore.getState().toast; return t ? t.msg : ''; };

  beforeEach(() => {
    db.idb.stores.tiles.clear(); db.idb.stores.areas.clear();
    db._storeCtl.open = true; db._storeCtl.abortNext = null;
    vi.stubGlobal('IDBKeyRange', { bound: (lower, upper) => ({ lower, upper }) });
    uiStore.setState({ toast: null });
    [...browsed, ...keepableBrowsed].forEach((k) => db.idb.stores.tiles.set(k, blob()));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('names exactly the layers that may not be kept', () => {
    expect(dl.unkeepableLayerIds().sort()).toEqual(['labels', 'ocean', 'sat', 'seamark', 'street']);
  });

  it('removes them from the browse cache and from old areas, and keeps every free-to-keep tile', async () => {
    [oldOcean, oldSat, oldRelief, current].forEach(save);
    const keepable = stored().filter((k) => !unkeepableRe.test(k));
    const r = await dl.sweepUnkeepableTiles();
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(3);
    expect(stored().filter((k) => unkeepableRe.test(k))).toEqual([]);
    expect(stored().sort()).toEqual(keepable.sort());
    expect(r.swept).toBeGreaterThan(browsed.length);
  });

  it('corrects the old area records so counts, plans and delete lists match what is stored', async () => {
    const before = [oldOcean, oldSat, oldRelief].map(save);
    save(current);
    await dl.sweepUnkeepableTiles();
    const has = new Set(stored());
    for (const b of before) {
      const a = db.idb.stores.areas.get(b.id);
      expect(a.layerIds.some((id) => unkeepableRe.test(id + '/')), a.name).toBe(false);
      expect(a.dropped, a.name).toEqual(b.layerIds.filter((id) => unkeepableRe.test(id + '/')));
      const keys = dl.areaTileKeys(a);
      expect(keys.every((k) => has.has(k)), a.name).toBe(true);
      expect(a.tiles, a.name).toBe(keys.length);   // the label tiles were a third or more of these
      expect(a.planned, a.name).toBe(keys.length);
      expect(a.tiles, a.name).toBeLessThan(b.tiles);
      expect(a.bytes, a.name).toBeLessThan(b.bytes);
      // a delete would remove exactly what the row says is stored
      const { del, kept } = dl.keysToDelete(a, [a]);
      expect(del.length + kept).toBe(a.tiles);
    }
    expect(db.idb.stores.areas.get(2)).toMatchObject({ layerIds: [], tiles: 0, planned: 0, bytes: 0 });
    expect(db.idb.stores.areas.get(4)).toEqual({ ...current, tiles: dl.areaTileKeys(current).length, planned: dl.areaTileKeys(current).length, bytes: dl.areaTileKeys(current).length * 9000 });
  });

  it('tells you once which saved areas lost their base map', async () => {
    [oldOcean, oldSat, oldRelief].forEach(save);
    await dl.sweepUnkeepableTiles();
    expect(lastToast()).toBe(dl.lostBaseText([{ name: 'Home bay' }, { name: 'Reef' }]));
    expect(lastToast()).toMatch(/^The base maps saved with 2 offline areas were removed: .+ Seafloor relief \(GEBCO\) in their place\.$/);
    expect(dl.lostBaseText([{ name: 'Home bay' }])).toBe('The base map saved with "Home bay" was removed: its source doesn\'t allow offline copies. Download the area again in More › Offline charts to save Seafloor relief (GEBCO) in its place.');
    uiStore.setState({ toast: null });
    const again = await dl.sweepUnkeepableTiles();   // the next launch: nothing left to do
    expect(again).toEqual({ ok: true, swept: 0, changed: 0 });
    expect(lastToast()).toBe('');
    expect(db.idb.stores.areas.get(1).dropped).toEqual(['ocean', 'seamark']);
  });

  it('an interrupted record update deletes nothing, and the next launch finishes the job', async () => {
    const b = save(oldRelief);
    const total = stored().length;
    db._storeCtl.abortNext = 'areas';
    expect(await dl.sweepUnkeepableTiles()).toMatchObject({ ok: false, changed: 0 });
    expect(stored().length).toBe(total);
    expect(db.idb.stores.areas.get(3)).toEqual(b);
    const r = await dl.sweepUnkeepableTiles();
    expect(r).toMatchObject({ ok: true, changed: 1 });
    expect(db.idb.stores.areas.get(3).tiles).toBe(dl.areaTileKeys(db.idb.stores.areas.get(3)).length);
  });

  it('tiles left behind after the records were corrected are swept next time, never subtracted twice', async () => {
    save(oldOcean);
    vi.mocked(db.deleteTiles).mockImplementationOnce(async () => { throw new Error('tile delete aborted'); });
    expect(await dl.sweepUnkeepableTiles()).toMatchObject({ ok: false, changed: 1 });
    const corrected = db.idb.stores.areas.get(1);
    expect(stored().some((k) => unkeepableRe.test(k))).toBe(true);
    expect(await dl.sweepUnkeepableTiles()).toMatchObject({ ok: true, changed: 0 });
    expect(stored().some((k) => unkeepableRe.test(k))).toBe(false);
    expect(db.idb.stores.areas.get(1)).toEqual(corrected);
  });

  it('does nothing without offline storage', async () => {
    db._storeCtl.open = false;
    expect(await dl.sweepUnkeepableTiles()).toEqual({ ok: false, swept: 0, changed: 0 });
    expect(stored().length).toBe(browsed.length + keepableBrowsed.length);
  });

  it('areaAfterSweep leaves a record that names no such layer alone', () => {
    expect(dl.areaAfterSweep(current, new Set())).toBeNull();
    expect(dl.areaAfterSweep({ ...oldOcean, layerIds: ['enc'], dropped: ['ocean'] }, new Set())).toBeNull();
  });
});
