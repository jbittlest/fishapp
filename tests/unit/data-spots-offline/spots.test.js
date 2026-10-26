/* Saved spots (engine/spots.js): ordering, distances, marker HTML, the editor's save path
 * (re-entry guard, honest failure), delete with confirm, backup export/import with dedupe and
 * a full UI resync. Expected values derived from legacy/js/spots.js. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/nav.js', async () => (await import('./_mocks.js')).navMock());
vi.mock('../../../src/engine/goto.js', async () => (await import('./_mocks.js')).gotoMock());
vi.mock('../../../src/engine/tracks.js', async () => (await import('./_mocks.js')).tracksMock());
vi.mock('../../../src/engine/catch.js', async () => (await import('./_mocks.js')).catchMock());
vi.mock('../../../src/engine/reefs.js', () => ({ reefsRefreshNearest: vi.fn() }));
vi.mock('../../../src/services/native', () => ({ saveOrShareFile: vi.fn(async () => 'downloaded'), isNativeShell: vi.fn(() => false) }));

const S = await import('../../../src/engine/spots.js');
const db = await import('../../../src/engine/db.js');
const goto = await import('../../../src/engine/goto.js');
const tracks = await import('../../../src/engine/tracks.js');
const catchMod = await import('../../../src/engine/catch.js');
const native = await import('../../../src/services/native');
const ui = await import('../../../src/services/ui');
const mocks = await import('./_mocks.js');

const lastToast = () => (ui.uiStore.getState().toast || { msg: '' }).msg;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

beforeEach(async () => {
  Object.values(db.idb.stores).forEach((m) => m.clear());
  mocks.state.lastLatLng = null;
  mocks.state.map = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 12);
  S.Spots.all = []; S.Spots.markers = {}; S.Spots._editing = null;
  S.Spots.layer = null;
  ui.uiStore.setState({ modal: null, card: null, panel: null, dialogs: [], toast: null });
  await S.spotsInit(mocks.state.map);
});

describe('pure helpers', () => {
  it('escapeHtml escapes the five HTML specials', () => {
    expect(S.escapeHtml('<b a="1">Tom\'s & co</b>')).toBe('&lt;b a=&quot;1&quot;&gt;Tom&#39;s &amp; co&lt;/b&gt;');
    expect(S.escapeHtml(42)).toBe('42');
  });

  it('_importKey is stable per record kind (catches use species in place of name)', () => {
    expect(S._importKey({ ts: 5, name: 'Reef', lat: 1, lng: 2, id: 9 })).toBe('5|Reef|1|2');
    expect(S._importKey({ start: 7, name: 'Trip' })).toBe('7|Trip||');
    expect(S._importKey({ ts: 5, species: 'Calico bass', lat: 1, lng: 2 })).toBe('5|Calico bass|1|2');
    expect(S._importKey({ ts: 5, species: 'Sheephead', lat: 1, lng: 2 })).not.toBe(S._importKey({ ts: 5, species: 'Calico bass', lat: 1, lng: 2 }));
  });

  it('sortSpots: nearest first with a fix, newest first without', () => {
    const a = { id: 1, lat: 33.70, lng: -118.40, ts: 1 }, b = { id: 2, lat: 33.90, lng: -118.40, ts: 3 }, c = { id: 3, lat: 33.75, lng: -118.40, ts: 2 };
    expect(S.sortSpots([a, b, c], null).map((s) => s.id)).toEqual([2, 3, 1]);
    expect(S.sortSpots([a, b, c], L.latLng(33.69, -118.40)).map((s) => s.id)).toEqual([1, 3, 2]);
  });

  it('spotDistBrg: nm and true bearing, nulls without a fix', () => {
    expect(S.spotDistBrg(null, { lat: 1, lng: 1 })).toEqual({ distNm: null, brgDeg: null });
    const r = S.spotDistBrg({ lat: 33.7, lng: -118.4 }, { lat: 33.7 + 1 / 60, lng: -118.4 });
    expect(r.brgDeg).toBe(0);
    expect(r.distNm).toBeCloseTo(1.0, 1);
    expect(S.spotDistBrg({ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }).brgDeg).toBe(90);
  });

  it('marker HTML: escaped name on an ink chip, a line glyph, no emoji', () => {
    const html = S.spotMarkerHtml({ name: '<Hot> spot', type: 'hazard' });
    expect(html).toContain('class="map-chip spot-mk__chip">&lt;Hot&gt; spot</span>');
    expect(html).toContain('spot-mk--hazard');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(EMOJI);
    expect(S.spotGlyphSvg('nope')).toContain(S.SPOT_GLYPHS.other);
  });

  it('types keep the legacy ids and labels, without emoji', () => {
    expect(S.SPOT_TYPES.map((t) => t.id)).toEqual(['fish', 'anchor', 'hazard', 'ramp', 'wreck', 'other']);
    expect(S.spotTypeLabel('ramp')).toBe('Ramp / dock');
    expect(S.spotTypeLabel('???')).toBe('Other');
    expect(JSON.stringify(S.SPOT_TYPES) + JSON.stringify(S.SPOT_ICONS)).not.toMatch(EMOJI);
  });

  it('localYmd is the local calendar date', () => {
    expect(S.localYmd(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('the spot editor', () => {
  it('opens the React modal with the legacy defaults', () => {
    S.openSpotModal({ lat: 33.7, lng: -118.4 });
    expect(ui.uiStore.getState().modal).toMatchObject({ name: 'spot', data: { isNew: true, type: 'fish', name: '', notes: '', defaultName: 'Spot 1' } });
    S.openSpotModal({ id: 4, lat: 1, lng: 2, name: 'Kelp', type: 'wreck', notes: 'n', ts: 9 });
    expect(ui.uiStore.getState().modal.data).toMatchObject({ isNew: false, name: 'Kelp', type: 'wreck' });
  });

  it('a double-tap on Save writes ONE spot', async () => {
    S.openSpotModal({ lat: 33.7, lng: -118.4 });
    const [r1, r2] = await Promise.all([S.saveSpot({ name: ' Kelp edge ', type: 'fish', notes: '' }), S.saveSpot({ name: 'Kelp edge', type: 'fish', notes: '' })]);
    expect([r1, r2].sort()).toEqual([false, true]);
    expect(db.idb.stores.spots.size).toBe(1);
    expect(S.Spots.all).toHaveLength(1);
    expect(S.Spots.all[0].name).toBe('Kelp edge');
    expect(ui.uiStore.getState().modal).toBeNull();
    expect(lastToast()).toBe('Spot saved');
    expect(S.spotsStore.getState().items).toHaveLength(1);
    expect(S.Spots.markers[S.Spots.all[0].id]).toBeTruthy();
  });

  it('an empty name saves as "Spot N+1"; an unknown type keeps the original', async () => {
    S.openSpotModal({ lat: 1, lng: 2, type: 'anchor' });
    await S.saveSpot({ name: '   ', type: 'bogus', notes: ' deep ' });
    expect(S.Spots.all[0]).toMatchObject({ name: 'Spot 1', type: 'anchor', notes: 'deep' });
  });

  it('a failed write keeps the editor open and says nothing was saved', async () => {
    S.openSpotModal({ lat: 1, lng: 2 });
    db.idb.failPut = Object.assign(new Error('The quota has been exceeded'), { name: 'QuotaExceededError' });
    expect(await S.saveSpot({ name: 'X', type: 'fish', notes: '' })).toBe(false);
    expect(ui.uiStore.getState().modal).not.toBeNull();
    expect(S.Spots.all).toHaveLength(0);
    expect(lastToast()).toMatch(/^Spot not saved — The quota has been exceeded\./);
    expect(S.spotsStore.getState().saving).toBe(false);
    // and the guard was released: a retry works
    expect(await S.saveSpot({ name: 'X', type: 'fish', notes: '' })).toBe(true);
  });

  it('editing keeps the id and the original timestamp', async () => {
    const id = await db.idb.put('spots', { lat: 1, lng: 2, name: 'Old', type: 'fish', notes: '', ts: 111 });
    await S.spotsInit(mocks.state.map);
    S.openSpotModal(S.Spots.all[0]);
    await S.saveSpot({ name: 'New', type: 'wreck', notes: 'x' });
    expect(S.Spots.all).toHaveLength(1);
    expect(S.Spots.all[0]).toMatchObject({ id, name: 'New', type: 'wreck', ts: 111 });
  });
});

describe('delete', () => {
  it('confirms (destructive) and re-checks the spot still exists', async () => {
    await S.createSpot({ lat: 1, lng: 2, name: 'Wreck A', type: 'wreck' });
    const spot = S.Spots.all[0];
    S.openSpotCard(spot.id);
    expect(ui.uiStore.getState().card).toMatchObject({ kind: 'spot', data: { id: spot.id } });
    const p = S.confirmDeleteSpot(spot);
    const d = ui.uiStore.getState().dialogs[0];
    expect(d).toMatchObject({ kind: 'confirm', title: 'Delete "Wreck A"?', destructive: true });
    d.resolve(true);
    expect(await p).toBe(true);
    expect(S.Spots.all).toHaveLength(0);
    expect(db.idb.stores.spots.size).toBe(0);
    expect(ui.uiStore.getState().card).toBeNull();
    expect(S.Spots.markers[spot.id]).toBeUndefined();
  });

  it('backing out deletes nothing; a spot already gone is not deleted twice', async () => {
    await S.createSpot({ lat: 1, lng: 2, name: 'Keep' });
    const spot = S.Spots.all[0];
    let p = S.confirmDeleteSpot(spot);
    ui.uiStore.getState().dialogs[0].resolve(false);
    expect(await p).toBe(false);
    expect(S.Spots.all).toHaveLength(1);

    p = S.confirmDeleteSpot(spot);
    await S.deleteSpot(spot.id);            // e.g. First Mate removed it while the dialog was up
    vi.mocked(db.idb.del).mockClear();
    ui.uiStore.getState().dialogs[0].resolve(true);
    expect(await p).toBe(false);
    expect(db.idb.del).not.toHaveBeenCalled();
  });
});

describe('list publishing', () => {
  it('spotsChanged reconciles markers after another module mutates Spots.all', async () => {
    S.Spots.all.push({ id: 77, lat: 1, lng: 2, name: 'From First Mate', type: 'fish', notes: '', ts: 5 });
    S.spotsChanged();
    expect(S.Spots.markers[77]).toBeTruthy();
    expect(S.spotsStore.getState().items.map((s) => s.id)).toEqual([77]);
    S.Spots.all = [];
    S.spotsChanged();
    expect(S.Spots.markers[77]).toBeUndefined();
    expect(S.spotsStore.getState().items).toEqual([]);
  });

  it('refreshSpotDistances only works while the panel is open, throttled to 3 s / 5 m', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0));
      await S.createSpot({ lat: 33.71, lng: -118.4, name: 'A' });
      mocks.state.lastLatLng = L.latLng(33.70, -118.40);
      S.spotsStore.setState({ items: [] });
      S.refreshSpotDistances();
      expect(S.spotsStore.getState().items).toEqual([]);          // panel closed → nothing
      ui.openPanel('spots');
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 10));
      S.refreshSpotDistances();
      expect(S.spotsStore.getState().items[0].distNm).toBeCloseTo(0.6, 1);
      S.spotsStore.setState({ items: [] });
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 11));
      S.refreshSpotDistances();                                   // < 3 s → skipped
      expect(S.spotsStore.getState().items).toEqual([]);
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 20));
      S.refreshSpotDistances();                                   // barely moved → skipped
      expect(S.spotsStore.getState().items).toEqual([]);
      mocks.state.lastLatLng = L.latLng(33.69, -118.40);
      vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 30));
      S.refreshSpotDistances();
      expect(S.spotsStore.getState().items).toHaveLength(1);
    } finally { vi.useRealTimers(); ui.closePanels(); }
  });

  it('opening the panel during the boot read keeps "loading" - never a false "No spots yet"', async () => {
    await db.idb.put('spots', { lat: 1, lng: 2, name: 'Kelp edge', type: 'fish', notes: '', ts: 1 });
    S.Spots.layer = null; S.Spots.all = [];
    let release;
    vi.mocked(db.idb.getAll).mockImplementationOnce((store) => new Promise((r) => { release = () => r([...db.idb.stores[store].values()]); }));
    const init = S.spotsInit(mocks.state.map);
    expect(S.Spots.layer).toBeTruthy();                       // the layer exists before the read finishes
    expect(S.spotsStore.getState().status).toBe('loading');
    S.spotsChanged();                                         // SpotsPanel mount / First Mate
    expect(S.spotsStore.getState()).toMatchObject({ status: 'loading', items: [] });
    release();
    await init;
    expect(S.spotsStore.getState().status).toBe('ready');
    expect(S.spotsStore.getState().items.map((s) => s.name)).toEqual(['Kelp edge']);
  });

  it('a storage failure at load is an error state, not "no spots"', async () => {
    vi.mocked(db.idb.getAll).mockRejectedValueOnce(new Error('IndexedDB blocked'));
    await expect(S.spotsInit(mocks.state.map)).rejects.toThrow('IndexedDB blocked');
    expect(S.spotsStore.getState()).toMatchObject({ status: 'error', error: 'IndexedDB blocked' });
    await S.spotsReload();
    expect(S.spotsStore.getState().status).toBe('ready');
  });
});

describe('Go', () => {
  it('awaits gotoStart with the spot position and name', async () => {
    vi.mocked(goto.gotoStart).mockResolvedValueOnce(false);
    expect(await S.navigateToSpot({ id: 1, lat: 3, lng: 4, name: 'Reef' })).toBe(false);
    expect(goto.gotoStart).toHaveBeenCalledWith({ lat: 3, lng: 4 }, 'Reef');
  });
});

describe('backup export / import', () => {
  it('exports everything irreplaceable through the platform share/save path', async () => {
    await db.idb.put('spots', { lat: 1, lng: 2, name: 'A', ts: 1 });
    await db.idb.put('catches', { lat: 1, lng: 2, species: 'Bass', ts: 2 });
    await db.idb.put('areas', { name: 'Bay', data: { big: true }, ts: 3 });
    await S.exportData();
    const arg = vi.mocked(native.saveOrShareFile).mock.calls.at(-1)[0];
    expect(arg.name).toMatch(/^fishapp-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(arg.mime).toBe('application/json');
    const data = JSON.parse(arg.data);
    expect(data).toMatchObject({ app: 'FishApp', version: 2 });
    expect(data.spots).toHaveLength(1);
    expect(data.catches).toHaveLength(1);
    expect(data.areas[0].data).toBeUndefined();          // tile data / packs are never in a backup
    expect(lastToast()).toBe('Backup exported — 1 spots, 0 tracks, 1 catches, 0 trips');
    expect(S.spotsStore.getState().exporting).toBe(false);
  });

  it('in the iOS app it does not claim "exported" - the share sheet may still be cancelled', async () => {
    vi.mocked(native.isNativeShell).mockReturnValue(true);
    vi.mocked(native.saveOrShareFile).mockResolvedValueOnce('shared');
    try {
      await db.idb.put('spots', { lat: 1, lng: 2, name: 'A', ts: 1 });
      await S.exportData();
      expect(lastToast()).toBe('Backup ready — choose where to save it (1 spots, 0 tracks, 0 catches, 0 trips)');
      expect(lastToast()).not.toMatch(/exported/);
    } finally { vi.mocked(native.isNativeShell).mockReturnValue(false); }
  });

  it('says so when the share sheet was cancelled', async () => {
    vi.mocked(native.saveOrShareFile).mockResolvedValueOnce('cancelled');
    await S.exportData();
    expect(lastToast()).toBe('Export cancelled — no backup was saved');
  });

  const file = (obj) => new File([typeof obj === 'string' ? obj : JSON.stringify(obj)], 'b.json', { type: 'application/json' });

  it('rejects files that are not JSON or not a FishApp backup, with distinct messages', async () => {
    await S.importData(file('{nope'));
    expect(lastToast()).toBe('Import failed — that file isn\'t valid JSON.');
    await S.importData(file({ app: 'Other' }));
    expect(lastToast()).toBe('Import failed — not a FishApp backup.');
  });

  it('merges with dedupe, then resyncs spots, tracks, catches and voyages', async () => {
    await db.idb.put('spots', { lat: 1, lng: 2, name: 'Old', ts: 1 });
    await S.spotsInit(mocks.state.map);
    vi.mocked(catchMod.catchesReload).mockClear();
    vi.mocked(tracks.tracksInit).mockClear();
    vi.mocked(goto.renderTripsList).mockClear();
    await S.importData(file({
      app: 'FishApp', version: 2,
      spots: [{ id: 50, lat: 1, lng: 2, name: 'Old', ts: 1 }, { id: 51, lat: 5, lng: 6, name: 'New', ts: 2 }],
      catches: [{ id: 9, lat: 1, lng: 1, species: 'Bass', ts: 4 }],
    }));
    expect(lastToast()).toBe('Imported 1 spots, 1 catches · 1 already present');
    expect(S.Spots.all.map((s) => s.name).sort()).toEqual(['New', 'Old']);
    expect(S.Spots.all.some((s) => s.id === 51)).toBe(false);          // ids are reassigned
    expect(Object.keys(S.Spots.markers)).toHaveLength(2);
    expect(catchMod.catchesReload).toHaveBeenCalledTimes(1);
    expect(tracks.tracksInit).toHaveBeenCalledTimes(1);
    expect(goto.renderTripsList).toHaveBeenCalledTimes(1);

    await S.importData(file({ app: 'FishApp', spots: [{ lat: 5, lng: 6, name: 'New', ts: 2 }] }));
    expect(lastToast()).toBe('Nothing new to import — it was all already here');
  });

  it('a store failure mid-import is reported honestly and still resyncs', async () => {
    vi.mocked(catchMod.catchesReload).mockClear();
    db.idb.failPut = new Error('quota');
    await S.importData(file({ app: 'FishApp', spots: [{ lat: 9, lng: 9, name: 'Z', ts: 9 }] }));
    expect(lastToast()).toBe('Import stopped: quota. Some records may already be saved.');
    expect(catchMod.catchesReload).toHaveBeenCalled();
    expect(S.spotsStore.getState().importing).toBe(false);
  });
});
