/* California reefs + MPAs (engine/reefs.js): MPA rule table, the live-conditions view model
 * (same states and words as the legacy popup), nearest-reef ordering, load states, cards. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/nav.js', async () => (await import('./_mocks.js')).navMock());
vi.mock('../../../src/engine/goto.js', async () => (await import('./_mocks.js')).gotoMock());
vi.mock('../../../src/engine/layers.js', async () => (await import('./_mocks.js')).layersMock());
vi.mock('../../../src/engine/inspect.js', async () => (await import('./_mocks.js')).inspectMock());
vi.mock('../../../src/engine/weather.js', async () => (await import('./_mocks.js')).weatherMock());
vi.mock('../../../src/engine/spots.js', () => ({ openSpotModal: vi.fn() }));

const R = await import('../../../src/engine/reefs.js');
const ui = await import('../../../src/services/ui');
const spots = await import('../../../src/engine/spots.js');
const inspect = await import('../../../src/engine/inspect.js');
const layers = await import('../../../src/engine/layers.js');
const goto = await import('../../../src/engine/goto.js');
const mocks = await import('./_mocks.js');

const REEFS = [
  { n: 'Far Reef', la: 34.20, lo: -119.30, d: 90, c: 'Quarry rock' },
  { n: 'Near Reef', la: 33.71, lo: -118.41, d: 45, c: 'Concrete' },
  { n: 'Mid Reef', la: 33.90, lo: -118.60 },
];
const MPAS = [
  { n: 'Point Vicente SMCA', t: 'SMCA', g: { type: 'Polygon', coordinates: [[[-118.42, 33.74], [-118.40, 33.74], [-118.40, 33.76], [-118.42, 33.74]]] } },
  { n: 'Abalone Cove SMR', t: 'SMR', g: { type: 'Polygon', coordinates: [[[-118.38, 33.73], [-118.36, 33.73], [-118.36, 33.75], [-118.38, 33.73]]] } },
];

beforeEach(() => {
  mocks.state.lastLatLng = null;
  mocks.state.map = mocks.mapStub(L.latLngBounds([33.6, -118.5], [33.8, -118.3]), 12);
  ui.uiStore.setState({ card: null, modal: null, panel: null });
});

describe('MPA rules', () => {
  it('keeps the legacy colours (data) and take wording, with a kind for the card', () => {
    expect(R.mpaStyle('SMR')).toMatchObject({ c: '#e8453d', kind: 'notake', take: 'No take — no fishing allowed' });
    expect(R.mpaStyle('SMRMA')).toMatchObject({ kind: 'notake', take: 'No take (managed area)' });
    expect(R.mpaStyle('Special Closure')).toMatchObject({ c: '#c026d3', kind: 'closure' });
    expect(R.mpaStyle('SMCA')).toMatchObject({ c: '#f2803d', kind: 'limited', take: 'Restricted — some fishing allowed, check rules' });
    expect(R.mpaStyle('SMP').take).toBe('Restricted — check regulations');
  });
  it('an unknown designation defaults to orange "Restricted — check regulations"', () => {
    expect(R.mpaStyle('XYZ')).toEqual({ c: '#f2803d', kind: 'limited', take: 'Restricted — check regulations' });
    expect(R.mpaStyle(undefined).kind).toBe('limited');
  });
  it('links to CDFW over https', () => {
    expect(R.CDFW_MPA_URL).toMatch(/^https:\/\/wildlife\.ca\.gov\//);
  });
});

describe('reefLiveView', () => {
  it('loading / offline / no-data / error states use the legacy words', () => {
    const v = R.reefLiveView({ wind: 'loading', swell: 'nodata', depth: 'nodata', sst: 'offline' });
    expect(v.wind).toEqual({ state: 'loading' });
    expect(v.swell).toEqual({ state: 'nodata', msg: 'no marine data (inland?)' });
    expect(v.seabed).toEqual({ state: 'nodata', msg: 'no survey data here' });
    expect(v.water).toEqual({ state: 'offline', msg: 'needs internet' });
    const e = R.reefLiveView({ wind: 'error', swell: 'error', depth: 'error', sst: 'error' });
    for (const c of Object.values(e)) expect(c).toEqual({ state: 'error', msg: 'unavailable' });
    expect(R.reefLiveView({ sst: 'nodata' }).water).toEqual({ state: 'nodata', msg: 'no data' });
  });
  it('missing values inside a reply are "unavailable", never 0', () => {
    const v = R.reefLiveView({ wind: { wind_speed_10m: null }, swell: { swell_wave_height: null }, sst: null, depth: NaN });
    expect(v.wind.state).toBe('error');
    expect(v.swell.state).toBe('error');
    expect(v.water.state).toBe('error');
    expect(v.seabed.state).toBe('error');
  });
  it('formats live values like the legacy inspect formatters', () => {
    const v = R.reefLiveView({
      wind: { wind_speed_10m: 11.6, wind_direction_10m: 270, wind_gusts_10m: 17.5 },
      swell: { swell_wave_height: 1.2, swell_wave_period: 11.6, swell_wave_direction: 255 },
      sst: 64.27,
      depth: -13.7,
    });
    expect(v.wind).toEqual({ state: 'ok', kn: 12, dir: 'W', towardDeg: 90, gustKn: 18 });
    expect(v.swell).toEqual({ state: 'ok', ft: 3.9, periodS: 12, dir: 'W' });
    expect(v.water).toEqual({ state: 'ok', f: 64.3 });
    expect(v.seabed).toEqual({ state: 'ok', ft: 44.9, m: 13.7, fa: 7.5 });
    expect(R.reefLiveView({ depth: -40 }).seabed.ft).toBe(131);          // ≥100 ft: whole feet
    expect(R.reefLiveView({ depth: 3 }).seabed).toEqual({ state: 'land', msg: 'land (10 ft above sea)' });
  });
});

describe('nearest reefs', () => {
  it('sorts by distance and returns n rows with nm + true bearing', () => {
    const rows = R.nearestReefs(REEFS, L.latLng(33.70, -118.40), 2);
    expect(rows.map((r) => r.reef.n)).toEqual(['Near Reef', 'Mid Reef']);
    expect(rows[0].distNm).toBeGreaterThan(0);
    expect(rows[0].distNm).toBeLessThan(1);
    expect(rows[0].brgDeg).toBeGreaterThanOrEqual(0);
    expect(rows[0].brgDeg).toBeLessThan(360);
    expect(R.nearestReefs([], L.latLng(0, 0), 3)).toEqual([]);
    expect(R.nearestReefs(REEFS, null, 3)).toEqual([]);
  });
});

describe('reefsInit', () => {
  it('stays "loading" until the data arrives, then publishes the nearest list (never a stuck "No reef data")', async () => {
    let release;
    vi.stubGlobal('fetch', vi.fn((url) => new Promise((res) => {
      release = release || [];
      release.push(() => res({ json: async () => (/reefs-ca/.test(url) ? REEFS : MPAS) }));
    })));
    const p = R.reefsInit(mocks.state.map);
    expect(R.reefsStore.getState().status).toBe('loading');
    release.forEach((f) => f());
    await p;
    const s = R.reefsStore.getState();
    expect(s).toMatchObject({ status: 'ready', total: 3, from: 'map' });
    expect(s.items[0].reef.n).toBe('Near Reef');
    expect(R.Reefs.loaded).toBe(true);
    expect(R.Reefs.reefLayer.getLayers()).toHaveLength(3);
    expect(R.Reefs.mpaLayer.getLayers()).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('a failed load is an error state with a retry that rebuilds instead of doubling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    R.Reefs.loaded = false;
    await R.reefsInit(mocks.state.map);
    expect(R.reefsStore.getState()).toMatchObject({ status: 'error', error: 'offline' });
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ json: async () => (/reefs-ca/.test(url) ? REEFS : MPAS) })));
    await R.reefsRetry();
    expect(R.reefsStore.getState().status).toBe('ready');
    expect(R.Reefs.reefLayer.getLayers()).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  it('distances come from the boat when there is a fix', () => {
    mocks.state.lastLatLng = L.latLng(34.19, -119.29);
    R.reefsRefreshNearest();
    expect(R.reefsStore.getState()).toMatchObject({ from: 'gps' });
    expect(R.reefsStore.getState().items[0].reef.n).toBe('Far Reef');
  });
});

describe('cards and actions', () => {
  it('offline: the reef card shows "needs internet" at once and fetches nothing', () => {
    const on = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(inspect.queryPointData).mockClear();
    R.openReefCard(REEFS[1]);
    const c = ui.uiStore.getState().card;
    expect(c).toMatchObject({ kind: 'reef', latlng: { lat: 33.71, lng: -118.41 } });
    expect(c.data.live).toEqual({ wind: 'offline', swell: 'offline', depth: 'offline', sst: 'offline' });
    expect(inspect.queryPointData).not.toHaveBeenCalled();
    on.mockRestore();
  });

  it('online: live values land on the card that asked, not on a newer one', () => {
    let update, results;
    vi.mocked(inspect.queryPointData).mockImplementation((_ll, r, u) => { results = r; update = u; });
    R.openReefCard(REEFS[1]);
    const first = ui.uiStore.getState().card;
    expect(first.data.live.wind).toBe('loading');
    results.wind = { wind_speed_10m: 8, wind_direction_10m: 180, wind_gusts_10m: 12 };
    update();
    expect(ui.uiStore.getState().card.data.live.wind).toMatchObject({ wind_speed_10m: 8 });
    ui.openCard('spot', { id: 1 });
    results.sst = 60;
    update();
    expect(ui.uiStore.getState().card.kind).toBe('spot');
    expect(ui.uiStore.getState().card.data.live).toBeUndefined();
  });

  it('Save as spot opens the editor prefilled as a wreck with the reef facts', () => {
    R.saveReefAsSpot(REEFS[1]);
    expect(spots.openSpotModal).toHaveBeenCalledWith({ lat: 33.71, lng: -118.41, name: 'Near Reef', type: 'wreck', notes: '45 ft. Concrete' });
    R.saveReefAsSpot(REEFS[2]);
    expect(vi.mocked(spots.openSpotModal).mock.calls.at(-1)[0].notes).toBe('');
  });

  it('Navigate awaits gotoStart', async () => {
    expect(await R.navigateToReef(REEFS[0])).toBe(true);
    expect(goto.gotoStart).toHaveBeenCalledWith({ lat: 34.2, lng: -119.3 }, 'Far Reef');
  });

  it('flying to a reef from the list turns the layer on through the layer owner (persisted)', () => {
    vi.mocked(layers.setDataOverlay).mockClear();
    mocks.layersStoreMock.setState({ reefs: false });
    R.flyToReef(REEFS[1]);
    expect(layers.setDataOverlay).toHaveBeenCalledWith('reefs', true);
    expect(mocks.state.map.setView).toHaveBeenCalled();
    mocks.layersStoreMock.setState({ reefs: true });
    vi.mocked(layers.setDataOverlay).mockClear();
    R.flyToReef(REEFS[1]);
    expect(layers.setDataOverlay).not.toHaveBeenCalled();
  });
});
