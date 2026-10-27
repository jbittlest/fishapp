/* Chart-view links (#v=south,west,north,east): what a protected-area page's button opens. The app
 * (engine/spots.js) frames the box and nothing else — no pin, no card, so a no-take reserve or a
 * no-entry Special Closure never arrives as a fishing spot to save or start a Go-To to. Pins the
 * generator's link (tools/web) to the app's parser on the real bundled MPA data, and guards the
 * parser like the spot-link one: anyone can write a link. */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('../data-spots-offline/_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('../data-spots-offline/_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('../data-spots-offline/_mocks.js')).appMock());
vi.mock('../../../src/engine/nav.js', async () => (await import('../data-spots-offline/_mocks.js')).navMock());
vi.mock('../../../src/engine/goto.js', async () => (await import('../data-spots-offline/_mocks.js')).gotoMock());
vi.mock('../../../src/engine/tracks.js', async () => (await import('../data-spots-offline/_mocks.js')).tracksMock());
vi.mock('../../../src/engine/catch.js', async () => (await import('../data-spots-offline/_mocks.js')).catchMock());
vi.mock('../../../src/engine/reefs.js', () => ({ reefsRefreshNearest: vi.fn() }));
vi.mock('../../../src/services/native', () => ({
  saveOrShareFile: vi.fn(async () => 'downloaded'),
  isNativeShell: vi.fn(() => false),
  shareText: vi.fn(async () => 'copied'),
}));

const S = await import('../../../src/engine/spots.js');
const db = await import('../../../src/engine/db.js');
const gps = await import('../../../src/engine/gps.js');
const goto = await import('../../../src/engine/goto.js');
const ui = await import('../../../src/services/ui');
const mocks = await import('../data-spots-offline/_mocks.js');
const { viewLink, spotLink } = await import('../../../tools/web/lib.mjs');
const { buildPlaces } = await import('../../../tools/web/places.mjs');

const ROOT = path.resolve(__dirname, '../../..');
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8'));
const SITE = 'https://example.test/fishapp/';
const POINT_LOBOS = '#v=36.50000,-121.95000,36.52333,-121.93000';

const lastToast = () => (ui.uiStore.getState().toast || { msg: '' }).msg;
const card = () => ui.uiStore.getState().card;
/** Put a URL in the address bar without firing hashchange. */
const setUrl = (u) => history.replaceState(null, '', u);

beforeEach(async () => {
  Object.values(db.idb.stores).forEach((m) => m.clear());
  mocks.state.lastLatLng = null;
  mocks.state.map = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 9);
  S.dismissSharedSpot();
  S.Spots.all = []; S.Spots.markers = {}; S.Spots.layer = null;
  ui.uiStore.setState({ modal: null, card: null, panel: null, dialogs: [], toast: null });
  vi.mocked(gps.setFollow).mockClear();
  vi.mocked(goto.gotoStart).mockClear();
  setUrl('/');
  await S.spotsInit(mocks.state.map);
});

describe('the place pages’ link and the app agree', () => {
  it('every bundled MPA’s view link parses back to its outline box (5 decimals)', () => {
    const mpas = buildPlaces(data('mpa-ca.json'), []).filter((p) => p.kind === 'mpa');
    expect(mpas.length).toBeGreaterThan(100);
    expect(mpas.some((p) => /Special Closure/.test(p.name))).toBe(true);
    const r5 = (x) => Number(x.toFixed(5));
    for (const p of mpas) {
      const b = S.parseViewLink(new URL(viewLink(SITE, p.box)).hash);
      expect(b, p.name).toEqual({ south: r5(p.box.minLat), west: r5(p.box.minLng), north: r5(p.box.maxLat), east: r5(p.box.maxLng) });
    }
  });
  it('a view link is not a spot link, and a spot link is not a view link', () => {
    expect(S.isSpotLink(POINT_LOBOS)).toBe(false);
    expect(S.parseSpotLink(POINT_LOBOS)).toBeNull();
    const spot = new URL(spotLink(SITE, 33.7, -118.4, 'Reef')).hash;
    expect(S.isViewLink(spot)).toBe(false);
    expect(S.isViewLink('#s=33.7,-118.4&v=1,2,3,4')).toBe(false);   // both: it is a spot link
  });
});

describe('opening a view link', () => {
  it('frames the box with follow off — no pin, no card, nothing to save or navigate to', () => {
    setUrl('/fishapp/?x=1' + POINT_LOBOS);
    expect(S.handleViewLink()).toBe(true);
    expect(mocks.state.map.fitBounds).toHaveBeenCalledWith([[36.5, -121.95], [36.52333, -121.93]], { maxZoom: S.VIEW_LINK_MAX_ZOOM, padding: [24, 24] });
    expect(gps.setFollow).toHaveBeenCalledWith(false);
    expect(card()).toBeNull();
    expect(S.Shared.spot).toBeNull();
    expect(S.Shared.marker).toBeNull();
    expect(ui.uiStore.getState().modal).toBeNull();
    expect(goto.gotoStart).not.toHaveBeenCalled();
    // reload-safe: the fragment is gone, the rest of the address is untouched
    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/fishapp/?x=1');
  });

  it('rejects malformed boxes with a toast and leaves the chart where it was', () => {
    const bad = [
      '#v=36.5,-121.95,36.52',                    // three numbers
      '#v=36.5,-121.95,36.52,-121.93,1',          // five
      '#v=91,-121.95,92,-121.93',                 // latitude out of range
      '#v=36.5,-181,36.52,-121.93',               // longitude out of range
      '#v=36.52,-121.95,36.5,-121.93',            // south above north
      '#v=36.5,179,36.52,-179',                   // across the antimeridian
      '#v=1e1,-121.95,36.52,-121.93',             // not plain decimal degrees
      '#v=0x1f,-121.95,36.52,-121.93',
      '#v=' + '1'.repeat(100),
      '#v=',
      '#v',
    ];
    for (const hash of bad) {
      ui.uiStore.setState({ toast: null });
      setUrl('/' + hash);
      expect(S.handleViewLink(), hash).toBe(false);
      expect(location.hash, hash).toBe('');
      expect(lastToast(), hash).toMatch(/chart link is damaged/);
    }
    expect(mocks.state.map.fitBounds).not.toHaveBeenCalled();
    expect(gps.setFollow).not.toHaveBeenCalled();
  });

  it('leaves unrelated fragments alone', () => {
    setUrl('/#section-2');
    expect(S.handleViewLink()).toBe(false);
    expect(location.hash).toBe('#section-2');
    expect(lastToast()).toBe('');
  });

  it('the boot / hashchange intake handles view links, and spot links still open their card', () => {
    S.spotLinksInit();                       // boot: no link in the address bar
    setUrl('/' + POINT_LOBOS);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(mocks.state.map.fitBounds).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    expect(location.hash).toBe('');
    setUrl('/#s=33.7745,-118.4239&n=Rockpile');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(card()).toMatchObject({ kind: 'shared-spot', data: { name: 'Rockpile' } });
    expect(mocks.state.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('a damaged spot link never falls through to a view', () => {
    setUrl('/#s=99,1&v=36.5,-121.95,36.52,-121.93');
    S.spotLinksInit();
    expect(lastToast()).toMatch(/spot link is damaged/);
    expect(mocks.state.map.fitBounds).not.toHaveBeenCalled();
  });
});
