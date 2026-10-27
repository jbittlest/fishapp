/* Shared stand-ins for the modules OTHER groups own (they are being ported in parallel, and the
 * real ones drag in the whole app). Each test file wires them with
 *   vi.mock('<path>', async () => (await import('./_mocks.js')).gpsMock())
 * Only what the data-spots-offline modules import is provided. */
import { vi } from 'vitest';
import L from 'leaflet';
import { createStore } from 'zustand/vanilla';

export const state = {
  lastLatLng: null,
  map: null,
  layers: null,
};

export function gpsMock() {
  const GPS = { get lastLatLng() { return state.lastLatLng; } };
  return {
    GPS,
    nmBetween: (a, b) => a.distanceTo(b) / 1852,
    bearingBetween: (a, b) => {
      const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
      const dl = (b.lng - a.lng) * Math.PI / 180;
      const y = Math.sin(dl) * Math.cos(p2);
      const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
      return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    },
    mapProgrammatic: (fn) => fn(),
    setFollow: vi.fn(),
    formatCoord: (v) => String(v),
  };
}

export function appMock() {
  return {
    getMap: () => state.map,
    readJSON: (_k, f) => f,
    toast: vi.fn(),
  };
}

export const layersStoreMock = createStore(() => ({ base: 'ocean', enc: true, seamark: true, reefs: true, mpa: true, tileBusy: false }));
export function layersMock() {
  /* chartLayerIds mirrors engine/layers.js (the real pairing table) so download tests keep pinning it. */
  const chartLayerIds = (state) => {
    const s = state || layersStoreMock.getState();
    const ids = [s.base];
    if (s.base === 'gmrt') ids.push('reliefhi');
    if (s.base === 'bluetint') ids.push('blueshade');
    if (s.enc) ids.push('enc');
    if (s.seamark) ids.push('seamark');
    return ids;
  };
  return { layersStore: layersStoreMock, setDataOverlay: vi.fn(), reportDataOverlay: vi.fn(), chartLayerIds };
}

export function navMock() { return { navHandleClick: vi.fn(() => false) }; }
export function gotoMock() { return { gotoStart: vi.fn(async () => true), renderTripsList: vi.fn() }; }
export function tracksMock() { return { tracksInit: vi.fn(), tracksStore: createStore(() => ({ recording: false, startedAt: 0, points: 0, saved: [] })) }; }
export function catchMock() { return { catchesReload: vi.fn(async () => {}), Catch: { all: [], layer: null, markers: {} } }; }
export function inspectMock() { return { queryPointData: vi.fn(), M_TO_FT: 3.28084, M_TO_FATHOM: 0.546807 }; }
export function weatherMock() {
  return {
    compass: (deg) => {
      if (deg == null || !isFinite(deg)) return '—';
      const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return pts[Math.round(((deg % 360) / 45)) % 8];
    },
  };
}
export function fishMock() { return { FISH_TAXA: '1,2,3' }; }
export function tidesMock() { return { nearestTideStation: vi.fn(() => ({ id: '9410660', n: 'Los Angeles', la: 33.72, lo: -118.27 })) }; }

/* In-memory IndexedDB stand-in with the same promise contract as db.js `idb`. */
export function makeIdb() {
  const stores = { spots: new Map(), tracks: new Map(), catches: new Map(), trips: new Map(), areas: new Map(), tiles: new Map() };
  let seq = 1;
  const idb = {
    stores,
    failPut: null,                           // set to an Error to make the next put reject
    get: vi.fn(async (store, key) => stores[store].get(key)),
    getAll: vi.fn(async (store) => [...stores[store].values()].map((v) => (v && typeof v === 'object' && !(v instanceof Blob) ? { ...v } : v))),
    put: vi.fn(async (store, value, key) => {
      if (idb.failPut) { const e = idb.failPut; idb.failPut = null; throw e; }
      await Promise.resolve();               // a commit is never synchronous
      let k = key;
      if (k === undefined) { k = value.id != null ? value.id : seq++; if (typeof value === 'object') value = { ...value, id: k }; }
      stores[store].set(k, value);
      return k;
    }),
    del: vi.fn(async (store, key) => { stores[store].delete(key); }),
    count: vi.fn(async (store) => stores[store].size),
  };
  return idb;
}

/* Just enough of db.js's raw `_store` / `_req` for the launch sweep (download.js
 * sweepUnkeepableTiles) over the same Maps as `idb`: getAllKeys over a key range, getAll and put,
 * each answered asynchronously, in a transaction that commits once its last request has been
 * handled — or, with `ctl.abortNext = '<store>'`, the next transaction on that store aborts and
 * drops its writes. `ctl.open = false` is storage that never opened (the real _store throws).
 * Key ranges are { lower, upper } (stub IDBKeyRange). */
function fakeRawStore(idb) {
  const ctl = { open: true, abortNext: null };
  const inRange = (k, r) => !r || (k >= r.lower && k <= r.upper);
  function _store(name, mode) {
    if (!ctl.open) throw new Error('Offline storage is unavailable on this device');
    const map = idb.stores[name];
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
    const abort = ctl.abortNext === name;
    if (abort) ctl.abortNext = null;
    const writes = [];
    let pending = 0;
    const settle = () => setTimeout(() => {
      if (pending > 0) return;
      if (abort) { tx.error = new Error('aborted'); if (tx.onabort) tx.onabort(); return; }
      writes.forEach((w) => w());
      if (tx.oncomplete) tx.oncomplete();
    }, 0);
    const request = (answer) => {
      const req = { transaction: tx, result: undefined, error: null, onsuccess: null, onerror: null };
      pending++;
      setTimeout(() => { req.result = answer(); if (req.onsuccess) req.onsuccess(); if (--pending === 0) settle(); }, 0);
      return req;
    };
    return {
      transaction: tx,
      getAllKeys: (range) => request(() => [...map.keys()].filter((k) => inRange(k, range)).sort()),
      getAll: () => request(() => [...map.values()].map((v) => (v && typeof v === 'object' && !(v instanceof Blob) ? { ...v } : v))),
      put: (value, key) => {
        if (mode !== 'readwrite') throw new Error('ReadOnlyError');
        return request(() => { const k = key !== undefined ? key : value.id; writes.push(() => map.set(k, value)); return k; });
      },
    };
  }
  const _req = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return { _store, _req, ctl };
}

/* db.js stand-in: `idb` plus the tile helpers download.js and tiles.js import. */
export function dbMock() {
  const idb = makeIdb();
  const TileKeys = new Set();
  const raw = fakeRawStore(idb);
  return {
    idb,
    TileKeys,
    _store: raw._store,
    _req: raw._req,
    _storeCtl: raw.ctl,
    tileKeysReady: false,
    tileKey: (layerId, z, x, y) => layerId + '/' + z + '/' + x + '/' + y,
    getTileBlob: vi.fn(async (key) => idb.stores.tiles.get(key) || null),
    putTileBlob: vi.fn(async (key, blob) => { idb.stores.tiles.set(key, blob); TileKeys.add(key); }),
    deleteTiles: vi.fn(async (keys, onProgress) => {
      keys.forEach((k) => { idb.stores.tiles.delete(k); TileKeys.delete(k); });
      if (onProgress) onProgress(keys.length, keys.length);
    }),
  };
}

export function mapStub(bounds, zoom) {
  const handlers = {};
  const m = {
    _bounds: bounds, _zoom: zoom,
    getBounds: () => m._bounds,
    getZoom: () => m._zoom,
    getCenter: () => m._bounds.getCenter(),
    setView: vi.fn(), fitBounds: vi.fn(), removeLayer: vi.fn(), addLayer: vi.fn(),
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: () => {},
  };
  return m;
}

export const LL = (lat, lng) => L.latLng(lat, lng);

/* A pack the way buildAreaPack really stores one: every section holds usable content.
   (Content-free stand-ins like `depthGrid: []` are exactly what areaPackHealth must NOT
   count as captured data.) */
export function fullPack(extra = {}) {
  return {
    capturedTs: Date.now(),
    center: { lat: 33.71, lng: -118.44 },
    bounds: { w: -118.45, s: 33.70, e: -118.43, n: 33.72 },
    forecast: { time: ['2026-10-25T06:00'], wind: [5], gust: [8], dir: [270], temp: [60], precip: [10] },
    marine: { time: ['2026-10-25T06:00'], wave_m: [1], period: [9], wdir: [250], sst: [64] },
    sstGrid: [{ lat: 33.71, lng: -118.44, f: 64 }],
    depthGrid: [{ lat: 33.71, lng: -118.44, ft: 98 }],
    tides: { station: 'Los Angeles', id: '9410660', dist_nm: 9, preds: [{ t: '2026-10-25 09:20', type: 'H', v: 4.9 }] },
    fish: { total: 3, sampled: 3, tally: { 'Calico bass': 3 }, recent: [] },
    mpas: [],
    ...extra,
  };
}
