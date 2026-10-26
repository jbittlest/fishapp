// Characterisation tests for engine/catch.js — catch records, conditions capture, the save
// guards, delete confirmation, the list/stats view and photo handling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { setOnline, fetchRouter, gps, ui, db, uiStore, noaaT, nav } from './mocks.js';

vi.mock('../../../src/engine/gps.js', async () => (await import('./mocks.js')).gps);
vi.mock('../../../src/engine/app.js', async () => (await import('./mocks.js')).app);
vi.mock('../../../src/engine/weather.js', async () => (await import('./mocks.js')).weather);
vi.mock('../../../src/engine/voice.js', async () => (await import('./mocks.js')).voice);
vi.mock('../../../src/engine/spots.js', async () => (await import('./mocks.js')).spots);
vi.mock('../../../src/engine/db.js', async () => (await import('./mocks.js')).db);
vi.mock('../../../src/services/ui', async () => (await import('./mocks.js')).ui);
vi.mock('../../../src/services/native', async () => (await import('./mocks.js')).native);
vi.mock('../../../src/engine/nav.js', async () => (await import('./mocks.js')).nav);

const C = await import('../../../src/engine/catch.js');
const { Tides } = await import('../../../src/engine/tides.js');
const { Astro } = await import('../../../src/engine/astro.js');
const {
  Catch, catchStore, isSafePhotoUrl, cleanMoonName, catchListView, catchToView, tideStateAt, captureConditions,
  openCatchModal, closeCatchModal, saveCatch, deleteCatch, catchesReload, catchMarkerHtml, catchCondLine,
  onCatchPhoto, clearCatchPhoto, PHOTO_ERROR, goToCatch, catchPos, condToView, catchInit, CAPTURE_WAIT_MS,
} = C;

const HERE = { lat: 33.7, lng: -118.3 };
const JPEG = 'data:image/jpeg;base64,/9j/AAAA';

/** An Image stand-in: decode succeeds or fails when the test says so. */
class FakeImage {
  static all = [];
  static auto = null;   // 'load' | 'error' | null (manual)
  constructor() { this.width = 1800; this.height = 1200; this.naturalWidth = 1800; FakeImage.all.push(this); }
  set src(v) { this._src = v; if (FakeImage.auto) queueMicrotask(() => this.fire(FakeImage.auto)); }
  get src() { return this._src; }
  fire(kind) { (kind === 'load' ? this.onload : this.onerror)?.(); }
}

function marineRoute() { return ['marine-api', { current: { sea_surface_temperature: 63.6, wave_height: 1 } }]; }
function forecastRoute() {
  return ['api.open-meteo.com/v1/forecast', {
    current: { wind_speed_10m: 9.4, wind_direction_10m: 280, wind_gusts_10m: 14.2, temperature_2m: 68.4, pressure_msl: 1016.24, cloud_cover: 40 },
    hourly: { pressure_msl: [1012, 1013, 1014, 1014.5, 1015, 1015.5, 1016.24] },
  }];
}
function tideRoute(now) {
  const prev = new Date(now - 2 * 3600000), next = new Date(now + 4 * 3600000);
  return ['tidesandcurrents', { predictions: [
    { t: noaaT(new Date(now - 8 * 3600000)), v: '4.8', type: 'H' },
    { t: noaaT(prev), v: '0.3', type: 'L' },
    { t: noaaT(next), v: '5.1', type: 'H' },
  ] }];
}

beforeEach(() => {
  Catch.all = []; Catch.markers = {}; Catch._editing = null; Catch._photo = null; Catch._saving = false; Catch.loaded = true;
  Catch.layer = L.layerGroup();
  Tides.stations = [{ id: '9410660', n: 'Los Angeles', la: 33.72, lo: -118.27 }];
  gps.GPS.lastLatLng = { ...HERE }; gps.GPS.lastFixTs = Date.now();
  nav.navHandleClick.mockReset(); nav.navHandleClick.mockReturnValue(false);
  uiStore.setState({ card: null, modal: null });
  ui.toast.mockClear(); ui.confirmDialog.mockReset(); ui.confirmDialog.mockResolvedValue(true);
  db.idb.put.mockReset(); db.idb.put.mockResolvedValue(7);
  db.idb.del.mockReset(); db.idb.del.mockResolvedValue(undefined);
  db.idb.getAll.mockReset(); db.idb.getAll.mockResolvedValue([]);
  setOnline(false);
  FakeImage.all = []; FakeImage.auto = null;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('record hygiene', () => {
  it('only image data URLs count as photos (no markup injection from a crafted backup)', () => {
    expect(isSafePhotoUrl(JPEG)).toBe(true);
    expect(isSafePhotoUrl('data:image/png;base64,iVBOR')).toBe(true);
    expect(isSafePhotoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafePhotoUrl('x" onerror="alert(1)')).toBe(false);
    expect(isSafePhotoUrl('https://evil.example/x.jpg')).toBe(false);
    expect(isSafePhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePhotoUrl('data:,')).toBe(false);
    expect(isSafePhotoUrl(null)).toBe(false);
  });
  it('moon names from legacy records lose their emoji', () => {
    expect(cleanMoonName('\u{1F315} Full Moon')).toBe('Full Moon');
    expect(cleanMoonName('Waxing Gibbous')).toBe('Waxing Gibbous');
    expect(cleanMoonName(undefined)).toBe('');
    for (let i = 0; i < 8; i++) expect(Astro.moonPhaseName(i / 8)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it('catchToView coerces imported records to safe plain data', () => {
    const v = catchToView({ id: 3, lat: 1, lng: 2, ts: 5, length: 24, photo: '"><script>', cond: null });
    expect(v).toMatchObject({ lat: 1, lng: 2, species: 'Catch', length: '24', weight: '', photo: null, cond: {} });
    // no usable position → null (never a fake 0°00.000'N), cond sanitised
    expect(catchToView({ id: 4, lat: undefined, lng: 'x', ts: 1, cond: { tide: 3, sst: 61 } }))
      .toMatchObject({ lat: null, lng: null, cond: { sst: 61 } });
  });
  it('catchPos: finite and in range; numeric strings accepted (as Leaflet does); blanks are not 0', () => {
    expect(catchPos({ lat: 33.7, lng: -118.3 })).toEqual({ lat: 33.7, lng: -118.3 });
    expect(catchPos({ lat: '33.7', lng: '-118.3' })).toEqual({ lat: 33.7, lng: -118.3 });
    expect(catchPos({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
    for (const bad of [null, {}, { lat: null, lng: 1 }, { lat: '', lng: 1 }, { lat: ' ', lng: 1 }, { lat: 'n/a', lng: 1 },
      { lat: NaN, lng: 0 }, { lat: Infinity, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: [1], lng: 2 }]) {
      expect(catchPos(bad)).toBeNull();
    }
  });
  it('condToView keeps finite numbers / non-empty strings for the known keys only', () => {
    const v = condToView({
      sst: 64, tide: 7, solunar: { x: 1 }, lightPhase: 'dawn', wind: ['12kn'], windKn: '12', gustKn: null,
      moon: 'Full Moon', moonLit: Infinity, pressureTrend: '', minsToTideChange: 40, injected: '<b>',
    });
    expect(v).toEqual({ sst: 64, lightPhase: 'dawn', moon: 'Full Moon', minsToTideChange: 40 });
    expect(condToView(null)).toEqual({});
    expect(condToView('sst')).toEqual({});
  });
});

describe('list + stats (legacy renderCatchList)', () => {
  it('total, top 4 by count (exact grouping), newest first', () => {
    const recs = [
      { id: 1, ts: 1, species: 'Calico Bass' }, { id: 2, ts: 5, species: 'Calico Bass' }, { id: 3, ts: 3, species: 'calico bass' },
      { id: 4, ts: 4, species: 'Sand Bass' }, { id: 5, ts: 2, species: 'Halibut' }, { id: 6, ts: 6, species: 'Yellowtail' },
      { id: 7, ts: 7, species: undefined }, { id: 8, ts: 8, species: 'Catch' },
    ];
    const v = catchListView(recs);
    expect(v.total).toBe(8);
    expect(v.top[0]).toEqual({ species: 'Calico Bass', count: 2 });
    expect(v.top[1]).toEqual({ species: 'Catch', count: 2 });   // no species counts as "Catch"
    expect(v.top.length).toBe(4);
    expect(v.items.map((c) => c.id)).toEqual([8, 7, 6, 2, 4, 3, 5, 1]);
    expect(catchListView([])).toEqual({ items: [], total: 0, top: [] });
  });
  it('the marker escapes the species and carries no emoji', () => {
    const html = catchMarkerHtml({ species: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/[\u{1F000}-\u{1FAFF}]/u);
  });
  it('the marker: the species chip takes no taps; a 44 px hit extension sits on the 26 px disc', () => {
    const html = catchMarkerHtml({ species: 'Bass' });
    expect(html).toMatch(/catch-pin__label"[^>]*pointer-events:none/);
    expect(html).toMatch(/catch-pin__hit"[^>]*inset:-9px/);   // 26 + 2×9 = 44
  });
  it('conditions line', () => {
    expect(catchCondLine({ sst: 64, tide: 'incoming', moon: '\u{1F315} Full Moon' })).toBe('64°F water · incoming tide · Full Moon');
    expect(catchCondLine({})).toBe('');
  });
});

describe('tide state (same semantics as the bite engine)', () => {
  it('an H next means incoming; minutes to the turn; stage; range', () => {
    const now = 1_000_000_000_000;
    const hl = [{ t: now - 2 * 3600000, type: 'L', v: 0.3 }, { t: now + 4 * 3600000, type: 'H', v: 5.1 }];
    expect(tideStateAt(hl, now, {})).toEqual({ tide: 'incoming', minsToTideChange: 240, tidePct: 33, tideRangeFt: 4.8 });
    expect(tideStateAt([{ t: now + 60000, type: 'L', v: 1 }], now, {})).toEqual({ tide: 'outgoing', minsToTideChange: 1 });
    expect(tideStateAt([{ t: now - 1, type: 'L', v: 1 }], now, {})).toEqual({});
  });
});

describe('captureConditions', () => {
  it('records the tide (the nowMs scoping bug since 0d79399 is fixed)', async () => {
    setOnline(true);
    const now = Date.now();
    vi.stubGlobal('fetch', fetchRouter([marineRoute(), forecastRoute(), tideRoute(now)]));
    const c = await captureConditions(L.latLng(HERE.lat, HERE.lng));
    expect(c.tide).toBe('incoming');
    expect(c.minsToTideChange).toBeGreaterThanOrEqual(239);
    expect(c.minsToTideChange).toBeLessThanOrEqual(240);
    expect(c.tidePct).toBeGreaterThanOrEqual(33);   // NOAA times are whole minutes
    expect(c.tidePct).toBeLessThanOrEqual(34);
    expect(c.tideRangeFt).toBe(4.8);
    expect(c.tideStation).toBe('9410660');
    expect(c).toMatchObject({ sst: 64, waveFt: 3.3, windKn: 9, windDir: 280, gustKn: 14, airF: 68, cloudPct: 40, pressureHpa: 1016.2, wind: '9kn W' });
    expect(c.pressureTrend3h).toBe(1.7);     // 1016.2 − 1014.5 (three samples back)
    expect(c.pressureTrend).toBe('rising');
    expect(c.moon).toMatch(/^[A-Z]/);        // plain name, no emoji
    expect(['major', 'minor', 'off']).toContain(c.solunar);
    expect(['dawn', 'dusk', 'day', 'night']).toContain(c.lightPhase);
  });
  it('offline: astronomy only, nothing fetched', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const c = await captureConditions(L.latLng(HERE.lat, HERE.lng));
    expect(f).not.toHaveBeenCalled();
    expect(c.tide).toBeUndefined();
    expect(typeof c.moonPhase).toBe('number');
    expect(typeof c.minsFromLightChange).toBe('number');
  });
  it('a failing service never throws', async () => {
    setOnline(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timed out after 30s'); }));
    const c = await captureConditions(L.latLng(HERE.lat, HERE.lng));
    expect(c.sst).toBeUndefined();
    expect(c.moon).toBeTruthy();
  });
  it('the three lookups run side by side, and the whole lookup is capped (a stalled body cannot hold the fish)', async () => {
    setOnline(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const started = [];
    vi.stubGlobal('fetch', vi.fn((url) => { started.push(String(url)); return new Promise(() => {}); }));   // never answers
    let done = null;
    const p = captureConditions(L.latLng(HERE.lat, HERE.lng)).then((c) => { done = c; });
    expect(started.length).toBe(3);                       // all three in flight at once
    expect(started.some((u) => u.includes('marine-api'))).toBe(true);
    expect(started.some((u) => u.includes('/v1/forecast'))).toBe(true);
    expect(started.some((u) => u.includes('tidesandcurrents'))).toBe(true);
    await vi.advanceTimersByTimeAsync(CAPTURE_WAIT_MS - 1);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done.moon).toBeTruthy();                       // what was already known is kept
    expect(done.sst).toBeUndefined();
    expect(CAPTURE_WAIT_MS + C.PHOTO_WAIT_MS).toBeLessThanOrEqual(60000);   // "up to a minute" in the modal
  });
});

describe('the modal and saving', () => {
  it('fixes the position at open (GPS, else the chart centre) and opens modal "catch"', () => {
    openCatchModal();
    expect(uiStore.getState().modal.name).toBe('catch');
    expect(catchStore.getState().modal).toMatchObject({ at: HERE, from: 'gps', photo: null, photoBusy: false, photoError: null });
    gps.GPS.lastLatLng = null;
    openCatchModal();
    expect(catchStore.getState().modal).toMatchObject({ at: { lat: 33.7, lng: -118.3 }, from: 'map', fixTs: 0 });
  });
  it('a lost / old GPS fix is labelled as the LAST fix with its time, never as live', () => {
    const old = Date.now() - 5 * 60000;
    gps.GPS.lastFixTs = old;
    openCatchModal();
    expect(catchStore.getState().modal).toMatchObject({ at: HERE, from: 'gps-stale', fixTs: old });
    gps.GPS.lastFixTs = 0;                                 // a position with no fix time at all
    openCatchModal();
    expect(catchStore.getState().modal).toMatchObject({ from: 'gps-stale', fixTs: 0 });
    gps.GPS.lastFixTs = Date.now();
    openCatchModal();
    expect(catchStore.getState().modal.from).toBe('gps');
  });

  it('saves with trimmed fields, species defaulting to "Catch", then closes, toasts and lists it', async () => {
    openCatchModal();
    const ok = await saveCatch({ species: '  ', length: ' 24 ', weight: '6', bait: ' sardine ', notes: '' });
    expect(ok).toBe(true);
    const rec = db.idb.put.mock.calls[0][1];
    expect(db.idb.put.mock.calls[0][0]).toBe('catches');
    expect(rec).toMatchObject({ lat: HERE.lat, lng: HERE.lng, species: 'Catch', length: '24', weight: '6', bait: 'sardine', notes: '', photo: null });
    expect(Catch.all[0].id).toBe(7);
    expect(Catch.markers[7]).toBeTruthy();
    expect(uiStore.getState().modal).toBeNull();
    expect(ui.toast).toHaveBeenCalledWith('Catch logged');
    expect(catchStore.getState().items.map((c) => c.id)).toEqual([7]);
    expect(catchStore.getState().modal.saving).toBe(false);
  });

  it('re-entry guard: a second tap while saving does nothing', async () => {
    openCatchModal();
    const a = saveCatch({ species: 'Bass' });
    const b = await saveCatch({ species: 'Bass' });
    expect(b).toBe(false);
    await a;
    expect(db.idb.put).toHaveBeenCalledTimes(1);
  });

  it('saves the fish even when the conditions lookup throws', async () => {
    setOnline(true);
    vi.spyOn(Astro, 'moonIllumination').mockImplementation(() => { throw new Error('bad astro'); });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline really'); }));
    openCatchModal();
    expect(await saveCatch({ species: 'Bass' })).toBe(true);
    expect(db.idb.put).toHaveBeenCalledTimes(1);
  });

  it('an IndexedDB failure says so and keeps the modal open', async () => {
    db.idb.put.mockRejectedValue(new Error('QuotaExceededError'));
    openCatchModal();
    expect(await saveCatch({ species: 'Bass' })).toBe(false);
    expect(ui.toast).toHaveBeenCalledWith("Couldn't save that catch: QuotaExceededError");
    expect(uiStore.getState().modal?.name).toBe('catch');
    expect(Catch.all.length).toBe(0);
    expect(catchStore.getState().modal.saving).toBe(false);
  });

  it('closing and reopening mid-save: the old save must not close the new modal', async () => {
    setOnline(true);
    let release;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', fetchRouter([['marine-api', async () => { await gate; return {}; }], ['open-meteo', {}], ['tidesandcurrents', {}]]));
    openCatchModal();
    const first = Catch._editing;
    const p = saveCatch({ species: 'First' });
    closeCatchModal();
    openCatchModal();
    const second = Catch._editing;
    expect(second).not.toBe(first);
    release();
    expect(await p).toBe(true);
    expect(db.idb.put.mock.calls[0][1].species).toBe('First');   // the fish was still saved
    expect(uiStore.getState().modal?.name).toBe('catch');        // ...and the new modal is still open
    expect(Catch._editing).toBe(second);
  });
});

describe('photos', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(/** @type {any} */ ({ drawImage() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(JPEG);
  });
  const file = () => new File([new Uint8Array([1, 2, 3])], 'fish.jpg', { type: 'image/jpeg' });

  it('downscales to a JPEG preview', async () => {
    FakeImage.auto = 'load';
    openCatchModal();
    onCatchPhoto(file());
    expect(catchStore.getState().modal.photoBusy).toBe(true);
    await Catch._editing.photoPending;
    expect(catchStore.getState().modal).toMatchObject({ photo: JPEG, photoBusy: false, photoError: null });
    expect(Catch._photo).toBe(JPEG);
  });

  it('an undecodable image says so instead of vanishing', async () => {
    FakeImage.auto = 'error';
    openCatchModal();
    onCatchPhoto(file());
    await Catch._editing.photoPending;
    expect(catchStore.getState().modal).toMatchObject({ photo: null, photoBusy: false, photoError: PHOTO_ERROR });
  });

  it('a slow decode never lands in a newer modal session', async () => {
    openCatchModal();
    onCatchPhoto(file());
    const pending = Catch._editing.photoPending;
    await vi.waitFor(() => expect(FakeImage.all.length).toBe(1));
    closeCatchModal();
    openCatchModal();
    FakeImage.all[0].fire('load');
    await pending;
    expect(catchStore.getState().modal.photo).toBeNull();
    expect(Catch._editing.photo).toBeNull();
  });

  it('Save waits for a photo still decoding instead of leaving it behind', async () => {
    openCatchModal();
    onCatchPhoto(file());
    await vi.waitFor(() => expect(FakeImage.all.length).toBe(1));
    const p = saveCatch({ species: 'Bass' });
    FakeImage.all[0].fire('load');
    expect(await p).toBe(true);
    expect(db.idb.put.mock.calls[0][1].photo).toBe(JPEG);
  });

  it('Remove drops the photo (and any decode in flight)', async () => {
    FakeImage.auto = 'load';
    openCatchModal();
    onCatchPhoto(file());
    await Catch._editing.photoPending;
    clearCatchPhoto();
    expect(catchStore.getState().modal.photo).toBeNull();
    await saveCatch({ species: 'Bass' });
    expect(db.idb.put.mock.calls[0][1].photo).toBeNull();
  });
});

describe('delete, reload, go-to', () => {
  const rec = (id) => ({ id, lat: HERE.lat, lng: HERE.lng, ts: id, species: 'Bass', cond: {} });

  it('always confirms; a "no" deletes nothing', async () => {
    Catch.all = [rec(1)];
    ui.confirmDialog.mockResolvedValue(false);
    expect(await deleteCatch(1)).toBe(false);
    expect(ui.confirmDialog.mock.calls[0][0]).toMatchObject({ title: 'Delete this catch?', destructive: true });
    expect(db.idb.del).not.toHaveBeenCalled();
    expect(Catch.all.length).toBe(1);
  });

  it('a "yes" deletes the record, its marker and its open card', async () => {
    Catch.all = [rec(1), rec(2)];
    Catch.all.forEach(C.addCatchMarker);
    C.openCatchCard(1);
    expect(uiStore.getState().card).toMatchObject({ kind: 'catch', data: { id: 1 } });
    expect(await deleteCatch(1)).toBe(true);
    expect(db.idb.del).toHaveBeenCalledWith('catches', 1);
    expect(Catch.markers[1]).toBeUndefined();
    expect(Catch.all.map((c) => c.id)).toEqual([2]);
    expect(uiStore.getState().card).toBeNull();
    expect(catchStore.getState().total).toBe(1);
  });

  it('re-checks after the dialog: already gone → no second delete', async () => {
    Catch.all = [rec(1)];
    ui.confirmDialog.mockImplementation(async () => { Catch.all = []; return true; });
    expect(await deleteCatch(1)).toBe(false);
    expect(db.idb.del).not.toHaveBeenCalled();
  });

  it('a failed delete says so and keeps the catch', async () => {
    Catch.all = [rec(1)];
    db.idb.del.mockRejectedValue(new Error('locked'));
    expect(await deleteCatch(1, { confirmed: true })).toBe(false);
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledWith("Couldn't delete that catch: locked");
    expect(Catch.all.length).toBe(1);
  });

  it('catchesReload rebuilds markers and the list from IndexedDB (backup import)', async () => {
    Catch.all = [rec(1)]; Catch.all.forEach(C.addCatchMarker);
    db.idb.getAll.mockResolvedValue([rec(5), rec(6)]);
    await catchesReload();
    expect(Object.keys(Catch.markers).sort()).toEqual(['5', '6']);
    expect(Catch.layer.getLayers().length).toBe(2);
    expect(catchStore.getState().items.map((c) => c.id)).toEqual([6, 5]);
  });

  it('one record with a bad position never stalls the log: init lists everything and draws what it can', async () => {
    // records 2 and 3 have no usable position; record 4's marker throws for some other reason
    const real = L.marker;
    vi.spyOn(L, 'marker').mockImplementation((ll, o) => { if (o && o.title === 'Boom') throw new Error('boom'); return real(ll, o); });
    db.idb.getAll.mockResolvedValue([rec(1), { ...rec(2), lat: undefined }, { ...rec(3), lat: 'n/a', lng: 'x' }, { ...rec(4), species: 'Boom' }]);
    Catch.loaded = false; Catch.markers = {};
    catchStore.setState({ loaded: false, error: null, items: [], total: 0, top: [] });
    await catchInit({ addLayer: vi.fn() });
    expect(Object.keys(Catch.markers)).toEqual(['1']);
    const s = catchStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.error).toBeNull();
    expect(s.items.map((c) => c.id)).toEqual([4, 3, 2, 1]);       // all listed (so they can be deleted)
    expect(s.items.find((c) => c.id === 2)).toMatchObject({ lat: null, lng: null });
  });

  it('catchesReload after an import with a bad record still republishes the NEW list', async () => {
    Catch.all = [rec(1)]; Catch.all.forEach(C.addCatchMarker);
    db.idb.getAll.mockResolvedValue([rec(5), { ...rec(6), lng: null }]);
    await catchesReload();
    expect(Object.keys(Catch.markers)).toEqual(['5']);
    expect(catchStore.getState().items.map((c) => c.id)).toEqual([6, 5]);
    expect(C.addCatchMarker({ ...rec(9), lat: '' })).toBe(false);   // spots.js importData calls this directly
  });

  it('marker: 26 px box on the disc; a tap goes to the route planner / measure tool first', () => {
    Catch.all = [rec(1)];
    expect(C.addCatchMarker(rec(1))).toBe(true);
    const m = Catch.markers[1];
    expect(m.options.icon.options.iconSize).toEqual([26, 26]);
    expect(m.options.icon.options.iconAnchor).toEqual([13, 13]);
    nav.navHandleClick.mockReturnValue(true);
    m.fire('click');
    expect(nav.navHandleClick).toHaveBeenCalledTimes(1);
    expect(nav.navHandleClick.mock.calls[0][0]).toMatchObject({ lat: HERE.lat, lng: HERE.lng });   // snaps to the catch
    expect(uiStore.getState().card).toBeNull();
    nav.navHandleClick.mockReturnValue(false);
    m.fire('click');
    expect(uiStore.getState().card).toMatchObject({ kind: 'catch', data: { id: 1 }, latlng: { lat: HERE.lat, lng: HERE.lng } });
  });

  it('go-to a catch with no position: nothing to fly to, its card still opens', async () => {
    const { map } = await import('./mocks.js');
    map.setView.mockClear();
    Catch.all = [{ ...rec(4), lat: null }];
    goToCatch(4);
    expect(map.setView).not.toHaveBeenCalled();
    expect(uiStore.getState().card).toMatchObject({ kind: 'catch', data: { id: 4 } });
    expect(uiStore.getState().card.latlng).toBeUndefined();
  });

  it('go-to: closes panels, stops following, programmatic setView, opens the card', async () => {
    const { map } = await import('./mocks.js');
    Catch.all = [rec(3)];
    map.zoom = 9;
    goToCatch(3);
    expect(ui.closePanels).toHaveBeenCalled();
    expect(gps.setFollow).toHaveBeenCalledWith(false);
    expect(gps.mapProgrammatic).toHaveBeenCalled();
    expect(map.setView).toHaveBeenCalledWith([HERE.lat, HERE.lng], 14);
    expect(uiStore.getState().card).toMatchObject({ kind: 'catch', data: { id: 3 } });
  });
});
