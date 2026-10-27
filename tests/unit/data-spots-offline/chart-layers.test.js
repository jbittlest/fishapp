/* The live chart (engine/layers.js + the offline-first tile layer in engine/tiles.js) against a real
 * Leaflet map in jsdom: tiles whose terms forbid offline copies still draw but are never stored
 * (nor served from a copy an older build stored), a base that may not be stored gets the GEBCO
 * chart underneath it, the retired CARTO labels are gone from the map, and every launch runs the
 * sweep of stored tiles the terms forbid keeping (download.js, tested in offline-layers). */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => ({
  ...(await import('./_mocks.js')).dbMock(),
  _db: {},                                     // storage opened
}));
vi.mock('../../../src/engine/download.js', () => ({ sweepUnkeepableTiles: vi.fn(async () => ({ ok: true, swept: 0, changed: 0 })) }));
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/weather.js', () => ({ windOverlayEnable: vi.fn() }));
vi.mock('../../../src/engine/sst.js', () => ({ sstEnable: vi.fn() }));
vi.mock('../../../src/engine/rain.js', () => ({ rainEnable: vi.fn() }));
vi.mock('../../../src/engine/fish.js', () => ({ fishEnable: vi.fn() }));
vi.mock('../../../src/engine/reefs.js', () => ({ reefsSetVisible: vi.fn() }));

const db = await import('../../../src/engine/db.js');
const { EMPTY_TILE, makeLayer } = await import('../../../src/engine/tiles.js');
const layers = await import('../../../src/engine/layers.js');
const download = await import('../../../src/engine/download.js');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(9000)], { type: 'image/png' }) }));
  vi.stubGlobal('fetch', (u) => fetchMock(u));
  URL.createObjectURL = vi.fn(() => 'blob:tile');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(db.putTileBlob).mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the browse cache only keeps tiles whose terms allow it', () => {
  async function load(id) {
    const img = makeLayer(id).createTile({ z: 10, x: 175, y: 409 }, () => {});
    await vi.waitFor(() => expect(img.src).toBe('blob:tile'));
    return img;
  }
  it('draws an OpenStreetMap tile but never stores it', async () => {
    await load('street');
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/10\/175\/409\.png$/);
    expect(db.putTileBlob).not.toHaveBeenCalled();
  });
  it('draws Esri and OpenSeaMap tiles without storing them', async () => {
    await load('ocean');
    await load('sat');
    await load('seamark');
    expect(db.putTileBlob).not.toHaveBeenCalled();
  });
  it('stores GEBCO and NOAA tiles as you browse', async () => {
    await load('gmrt');
    await load('enc');
    expect(vi.mocked(db.putTileBlob).mock.calls.map((c) => c[0])).toEqual(['gmrt/10/175/409', 'enc/10/175/409']);
  });
  it('a full store costs only the offline copy, never the drawn tile', async () => {
    vi.mocked(db.putTileBlob).mockImplementationOnce(async () => { throw new Error('quota'); });
    await load('gmrt');
  });
});

describe('copies an older build (or /classic/) stored', () => {
  const stored = new Blob([new Uint8Array(9000)], { type: 'image/jpeg' });
  beforeEach(() => {
    db.idb.stores.tiles.clear();
    vi.mocked(db.getTileBlob).mockClear();
  });
  afterEach(() => { delete navigator.onLine; });

  it('a layer that may not be kept never reads its stored copy: it draws live', async () => {
    db.idb.stores.tiles.set('ocean/10/175/409', stored);
    const img = makeLayer('ocean').createTile({ z: 10, x: 175, y: 409 }, () => {});
    await vi.waitFor(() => expect(img.src).toBe('blob:tile'));
    expect(db.getTileBlob).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('...and with no signal it draws nothing, so the GEBCO chart underneath shows', async () => {
    db.idb.stores.tiles.set('seamark/10/175/409', stored);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const img = makeLayer('seamark').createTile({ z: 10, x: 175, y: 409 }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(img.src).toBe(EMPTY_TILE);
    expect(db.getTileBlob).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a free-to-keep layer still draws its stored copy without the network', async () => {
    db.idb.stores.tiles.set('gmrt/10/175/409', stored);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const img = makeLayer('gmrt').createTile({ z: 10, x: 175, y: 409 }, () => {});
    await vi.waitFor(() => expect(img.src).toBe('blob:tile'));
    expect(db.getTileBlob).toHaveBeenCalledWith('gmrt/10/175/409');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the live chart layers', () => {
  let map;
  const onMap = () => {
    const out = [];
    map.eachLayer((l) => { if (l.options.layerDef) out.push(l.options.layerDef.id + '@' + l.options.zIndex); });
    return out.sort();
  };
  const settle = () => new Promise((r) => setTimeout(r, 320));   // the 280 ms fade-out removal
  let bootSweeps = 0;

  beforeAll(async () => {
    fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', (u) => fetchMock(u));
    const el = document.createElement('div');
    document.body.appendChild(el);
    map = L.map(el, { center: [33.75, -118.4], zoom: 9 });
    layers.initLayers(map);
    await settle();
    bootSweeps = vi.mocked(download.sweepUnkeepableTiles).mock.calls.length;   // captured before any per-test reset
  });

  it('boots on the Ocean base with GEBCO underneath, the NOAA chart and seamarks, and no labels', () => {
    expect(layers.layersStore.getState().base).toBe('ocean');
    expect(onMap()).toEqual(['enc@5', 'gmrt@-1', 'ocean@0', 'seamark@6']);
  });

  it('sweeps the stored tiles the terms forbid keeping at every launch — no done-flag to go stale', async () => {
    expect(bootSweeps).toBe(1);
    vi.mocked(download.sweepUnkeepableTiles).mockClear();
    layers.initLayers(map);
    await settle();
    expect(download.sweepUnkeepableTiles).toHaveBeenCalledTimes(1);
  });

  it('a base that may be stored needs no underlay; switching back brings it again', async () => {
    layers.setBase('gmrt', true);
    await settle();
    expect(onMap()).toEqual(['enc@5', 'gmrt@0', 'reliefhi@1', 'seamark@6']);
    layers.setBase('street', true);
    await settle();
    expect(onMap()).toEqual(['enc@5', 'gmrt@-1', 'seamark@6', 'street@0']);
  });

  it('moving between two bases that may not be stored keeps the one underlay', async () => {
    layers.setBase('sat', true);
    await settle();
    expect(onMap()).toEqual(['enc@5', 'gmrt@-1', 'sat@0', 'seamark@6']);
  });

  it('chartLayerIds — what the map shows — no longer names the labels', () => {
    expect(layers.chartLayerIds({ base: 'sat', enc: true, seamark: true })).toEqual(['sat', 'enc', 'seamark']);
    expect(layers.chartLayerIds({ base: 'bluetint', enc: true, seamark: false })).toEqual(['bluetint', 'blueshade', 'enc']);
  });
});
