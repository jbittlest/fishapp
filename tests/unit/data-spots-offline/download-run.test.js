/* Offline downloads — the run itself (engine/download.js startDownload / cancelDownload /
 * deleteArea) against stubbed map, network and storage. Pins the inventory fixes:
 * minBytes blanks are not stored, bounds are captured once, Cancel works in the data phase
 * and mid-fetch, the success copy never claims data that failed, a delete re-checks state. */
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
  return { ...orig, buildAreaPack: vi.fn(), areaDataRefresh: vi.fn(async () => {}) };
});

const dl = await import('../../../src/engine/download.js');
const db = await import('../../../src/engine/db.js');
const areadata = await import('../../../src/engine/areadata.js');
const { uiStore } = await import('../../../src/services/ui');
const mocks = await import('./_mocks.js');

const box = L.latLngBounds([33.70, -118.45], [33.72, -118.43]);
const elsewhere = L.latLngBounds([34.0, -119.0], [34.02, -118.98]);
const okPack = mocks.fullPack();
const deadPack = { forecastError: true, marineError: true, sstError: true, depthError: true, tidesError: true, fishError: true };

function blobOf(size) { return new Blob([new Uint8Array(size)], { type: 'image/png' }); }
function lastToast() { const t = uiStore.getState().toast; return t ? t.msg : ''; }

let fetchImpl;
beforeEach(() => {
  db.idb.stores.tiles.clear(); db.idb.stores.areas.clear();
  vi.mocked(db.putTileBlob).mockClear();
  mocks.state.map = mocks.mapStub(box, 13);
  mocks.layersStoreMock.setState({ base: 'bluetint', enc: false, seamark: false });
  dl.dlStore.setState({ zoom: 14 });
  /* BlueTopo base → the known 2266-byte blank; its hillshade is real tiles. */
  fetchImpl = vi.fn(async (url) => {
    const size = /bathymetry/.test(url) ? 2266 : /hillshade/.test(url) ? 5000 : 800;
    return { ok: true, blob: async () => blobOf(size) };
  });
  vi.stubGlobal('fetch', (u) => fetchImpl(u));
  vi.mocked(areadata.buildAreaPack).mockReset();
  vi.mocked(areadata.buildAreaPack).mockImplementation(async () => okPack);
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  // earlier tests leave runs hanging on purpose: start each test with no delete / drain pending
  dl.DL.draining = null;
  dl.dlStore.setState({ deleting: null, draining: false });
  uiStore.setState({ dialogs: [] });
});
afterEach(() => { vi.unstubAllGlobals(); });

function onlyArea() { return [...db.idb.stores.areas.values()][0]; }

describe('startDownload', () => {
  it('does not store minBytes blanks, does not count them as failures, records what was stored', async () => {
    const plan = dl.planDownload(true);
    const expectBlank = plan.jobs.filter((j) => j.id === 'bluetint').length;
    expect(expectBlank).toBeGreaterThan(0);

    const r = await dl.startDownload('Home bay', 14);
    expect(r).toBe('saved');
    const a = onlyArea();
    expect(a.name).toBe('Home bay');
    expect(a.blank).toBe(expectBlank);
    expect(a.tiles).toBe(plan.jobs.length - expectBlank);
    expect(a.incomplete).toBe(false);
    expect(a.layerIds).toEqual(['bluetint', 'blueshade']);
    expect(a.nativeFloor).toBe(true);
    const storedKeys = vi.mocked(db.putTileBlob).mock.calls.map((c) => c[0]);
    expect(storedKeys.some((k) => k.startsWith('bluetint/'))).toBe(false);
    expect(storedKeys.some((k) => k.startsWith('blueshade/'))).toBe(true);
    expect(lastToast()).toBe('"Home bay" saved (charts + data) for offline use');
    expect(dl.dlStore.getState()).toMatchObject({ running: false, phase: 'idle' });
    expect(dl.DL.running).toBe(false);
  });

  it('captures the bounds once — a map move during the storage check does not change the record', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => { mocks.state.map._bounds = elsewhere; return { quota: 1e12, usage: 0 }; },
        persist: async () => true,
      },
    });
    await dl.startDownload('Bay', 14);
    const a = onlyArea();
    expect(a.bounds).toEqual({ w: box.getWest(), s: box.getSouth(), e: box.getEast(), n: box.getNorth() });
  });

  it('refuses when there is not enough free storage (15% headroom) and writes nothing', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true, value: { estimate: async () => ({ quota: 1000, usage: 999 }), persist: async () => true },
    });
    expect(await dl.startDownload('Bay', 14)).toBe('refused');
    expect(db.idb.stores.areas.size).toBe(0);
    expect(lastToast()).toMatch(/^Not enough free storage for this area/);
  });

  it('is honest when the whole data pack failed', async () => {
    vi.mocked(areadata.buildAreaPack).mockImplementation(async () => deadPack);
    await dl.startDownload('Reef run', 14);
    expect(lastToast()).toBe('"Reef run" saved for offline use — charts only, the area data could not be captured');
  });

  it('marks the area incomplete and says so when tiles fail', async () => {
    let n = 0;
    fetchImpl = vi.fn(async () => { n++; return n % 5 === 0 ? { ok: false } : { ok: true, blob: async () => blobOf(9000) }; });
    await dl.startDownload('Bay', 14);
    const a = onlyArea();
    expect(a.incomplete).toBe(true);
    expect(lastToast()).toMatch(/could not be downloaded, so this area is incomplete$/);
  });

  it('stops on a full store and reports the area as incomplete', async () => {
    vi.mocked(db.putTileBlob).mockImplementationOnce(async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; });
    await dl.startDownload('Bay', 14);
    expect(lastToast()).toMatch(/^Storage full — saved \d+ of \d+ tiles\. This area is incomplete\.$/);
    expect(onlyArea().incomplete).toBe(true);
  });

  it('Cancel during the data phase stops at once and records a partial area with no data', async () => {
    vi.mocked(areadata.buildAreaPack).mockImplementation(() => { dl.cancelDownload(); return new Promise(() => {}); });
    const r = await dl.startDownload('Bay', 14);
    expect(r).toBe('cancelled');
    const a = onlyArea();
    expect(a.name).toBe('Bay (partial)');
    expect(a).toMatchObject({ incomplete: true, partial: true, data: null });
    expect(lastToast()).toBe('Download cancelled — the partial area is listed so you can delete it');
    expect(dl.DL.running).toBe(false);
  });

  it('Cancel releases the UI even while a tile fetch is hanging, and the old workers stay stopped', async () => {
    fetchImpl = vi.fn(() => new Promise(() => {}));
    const p = dl.startDownload('', 14);
    await new Promise((r) => setTimeout(r, 5));
    expect(dl.dlStore.getState().running).toBe(true);
    dl.cancelDownload();
    expect(dl.dlStore.getState().cancelling).toBe(true);
    expect(await p).toBe('cancelled');
    expect(onlyArea().name).toBe('Area (partial)');
    expect(dl.dlStore.getState()).toMatchObject({ running: false, cancelling: false });
  });

  it('the signal dropping during the data phase is reported as charts only (real builder, every data fetch failing)', async () => {
    const real = await vi.importActual('../../../src/engine/areadata.js');
    vi.mocked(areadata.buildAreaPack).mockImplementation((...a) => real.buildAreaPack(...a));
    const tiles = fetchImpl;
    fetchImpl = vi.fn(async (url) => {
      if (/open-meteo|ngdc|tidesandcurrents|inaturalist|mpa-ca/.test(url)) throw new TypeError('Failed to fetch');
      return tiles(url);
    });
    expect(await dl.startDownload('Outer bank', 14)).toBe('saved');
    expect(lastToast()).toBe('"Outer bank" saved for offline use — charts only, the area data could not be captured');
    expect(areadata.areaPackHealth(onlyArea().data).level).toBe('none');
    expect(dl.areaRow(onlyArea()).data).toBe('none');
  });

  it('Cancel is a no-op once the area record is being written (no "Cancelling…" over a saved run)', async () => {
    let sawCancelling = false;
    const unsub = dl.dlStore.subscribe((s) => {
      if (s.cancelling) sawCancelling = true;
      if (s.phase === 'saving') dl.cancelDownload();
    });
    const r = await dl.startDownload('Bay', 14);
    unsub();
    expect(r).toBe('saved');
    expect(sawCancelling).toBe(false);
    expect(onlyArea().name).toBe('Bay');
    expect(lastToast()).toBe('"Bay" saved (charts + data) for offline use');
  });

  it('Cancel aborts the run\'s in-flight tile requests', async () => {
    const signals = [];
    vi.stubGlobal('fetch', (u, init) => { signals.push(init && init.signal); return new Promise(() => {}); });
    const p = dl.startDownload('', 14);
    await vi.waitFor(() => expect(signals.length).toBe(6));
    expect(signals.every((s) => s && !s.aborted)).toBe(true);
    dl.cancelDownload();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(await p).toBe('cancelled');
  });

  it('refuses a second start while one is running', async () => {
    fetchImpl = vi.fn(() => new Promise(() => {}));
    const p = dl.startDownload('A', 14);
    await new Promise((r) => setTimeout(r, 5));
    expect(await dl.startDownload('B', 14)).toBe('refused');
    dl.cancelDownload();
    await p;
  });

  it('preflight: offline, too big, nothing to download', async () => {
    const on = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await dl.startDownload('x', 14)).toBe('refused');
    expect(lastToast()).toBe('You are offline — connect to download charts');
    on.mockRestore();

    mocks.state.map = mocks.mapStub(L.latLngBounds([20, -130], [50, -60]), 6);
    expect(await dl.startDownload('x', 16)).toBe('refused');
    expect(lastToast()).toBe('Area too large — zoom in first');
    expect(dl.dlStore.getState().estimate.status).toBe('tooBig');
  });
});

describe('downloads and deletes never overlap', () => {
  const put = (id, bounds, extra = {}) => db.idb.stores.areas.set(id, { id, name: 'A' + id, bounds, minZ: 12, maxZ: 13, layerIds: ['seamark'], ts: id, ...extra });

  it('a download is refused while an area is being deleted', async () => {
    dl.dlStore.setState({ deleting: { id: 9, done: 0, total: 4000 } });
    expect(await dl.startDownload('Home bay', 14)).toBe('refused');
    expect(lastToast()).toBe('Wait for the area to finish deleting before downloading');
    expect(db.idb.stores.areas.size).toBe(0);
    expect(dl.DL.running).toBe(false);
  });

  it('a delete that starts during the storage check wins - the download is refused before it writes anything', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => { dl.dlStore.setState({ deleting: { id: 9, done: 0, total: 1 } }); return { quota: 1e12, usage: 0 }; },
        persist: async () => true,
      },
    });
    vi.mocked(db.putTileBlob).mockClear();
    expect(await dl.startDownload('Home bay', 14)).toBe('refused');
    expect(db.putTileBlob).not.toHaveBeenCalled();
    expect(dl.DL.running).toBe(false);
  });

  it('deleteArea claims the delete before reading the area list, so a download cannot slip in meanwhile', async () => {
    put(5, { s: 33.70, w: -118.45, n: 33.72, e: -118.43 });
    const p = dl.deleteArea(5);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    let release;
    vi.mocked(db.idb.getAll).mockImplementationOnce(() => new Promise((r) => { release = () => r([...db.idb.stores.areas.values()]); }));
    uiStore.getState().dialogs[0].resolve(true);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(dl.dlStore.getState().deleting).not.toBeNull();
    expect(await dl.startDownload('Same water', 14)).toBe('refused');
    release();
    expect(await p).toBe(true);
    expect(dl.dlStore.getState().deleting).toBeNull();
    expect(db.idb.stores.areas.has(5)).toBe(false);
  });

  it('after Cancel, deletes wait until the run\'s last in-flight tile writes have landed', async () => {
    const pending = [];
    fetchImpl = vi.fn(() => new Promise((r) => { pending.push(r); }));
    const p = dl.startDownload('Home bay', 14);
    await vi.waitFor(() => expect(pending.length).toBe(6));
    dl.cancelDownload();
    expect(await p).toBe('cancelled');
    // the UI is released at once...
    expect(dl.dlStore.getState()).toMatchObject({ running: false, draining: true });
    expect(dl.DL.running).toBe(false);
    const partial = onlyArea();
    expect(partial.name).toBe('Home bay (partial)');
    // ...but the partial area cannot be deleted while a write could still land after the delete
    vi.mocked(db.deleteTiles).mockClear();
    expect(await dl.deleteArea(partial.id)).toBe(false);
    expect(lastToast()).toBe('The cancelled download is still finishing its last tiles — try again in a moment');
    expect(uiStore.getState().dialogs.length).toBe(0);
    expect(db.deleteTiles).not.toHaveBeenCalled();
    // the in-flight requests finish: a cancelled run writes nothing more, the drain ends
    vi.mocked(db.putTileBlob).mockClear();
    pending.forEach((r) => r({ ok: true, blob: async () => blobOf(9000) }));
    await dl.DL.draining;
    expect(db.putTileBlob).not.toHaveBeenCalled();
    expect(dl.DL.draining).toBeNull();
    expect(dl.dlStore.getState().draining).toBe(false);
    // now the delete goes ahead
    const d = dl.deleteArea(partial.id);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    uiStore.getState().dialogs[0].resolve(true);
    expect(await d).toBe(true);
    expect(db.idb.stores.areas.has(partial.id)).toBe(false);
  });
});

describe('deleteArea', () => {
  const put = (id, bounds, extra = {}) => db.idb.stores.areas.set(id, { id, name: 'A' + id, bounds, minZ: 12, maxZ: 13, layerIds: ['seamark'], ts: id, ...extra });

  it('asks first, deletes non-shared tiles then the record', async () => {
    put(1, { s: 33.70, w: -118.50, n: 33.76, e: -118.44 });
    put(2, { s: 33.73, w: -118.47, n: 33.80, e: -118.40 });
    const p = dl.deleteArea(1);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    const d = uiStore.getState().dialogs[0];
    expect(d).toMatchObject({ kind: 'confirm', title: 'Delete offline charts for "A1"?', destructive: true });
    d.resolve(true);
    expect(await p).toBe(true);
    expect(db.idb.stores.areas.has(1)).toBe(false);
    const deleted = vi.mocked(db.deleteTiles).mock.calls.at(-1)[0];
    const bKeys = new Set(dl.areaTileKeys(db.idb.stores.areas.get(2)));
    expect(deleted.some((k) => bKeys.has(k))).toBe(false);
    expect(lastToast()).toMatch(/^Offline area deleted — [\d,]+ tiles kept for another saved area that uses them$/);
  });

  it('does nothing when the user backs out', async () => {
    put(3, { s: 33.70, w: -118.50, n: 33.72, e: -118.48 });
    vi.mocked(db.deleteTiles).mockClear();
    const p = dl.deleteArea(3);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    uiStore.getState().dialogs[0].resolve(false);
    expect(await p).toBe(false);
    expect(db.idb.stores.areas.has(3)).toBe(true);
    expect(db.deleteTiles).not.toHaveBeenCalled();
  });

  it('re-checks after the dialog: a download that started meanwhile blocks the delete', async () => {
    put(4, { s: 33.70, w: -118.50, n: 33.72, e: -118.48 });
    const p = dl.deleteArea(4);
    await vi.waitFor(() => expect(uiStore.getState().dialogs.length).toBe(1));
    dl.DL.running = true;
    uiStore.getState().dialogs[0].resolve(true);
    expect(await p).toBe(false);
    dl.DL.running = false;
    expect(db.idb.stores.areas.has(4)).toBe(true);
  });
});
