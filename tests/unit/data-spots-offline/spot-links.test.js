/* Shared-spot links (engine/spots.js): the outbound link format, the inbound parser as a guard
 * against hostile URLs (anyone can write one), the boot / hashchange intake with fragment
 * cleanup, the pending spot surviving a reload of its tab, keeping the spot clear of its card,
 * and the shared card's Save / Navigate / Dismiss paths. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';
import { spotLink } from '../../../tools/web/lib.mjs';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('./_mocks.js')).appMock());
vi.mock('../../../src/engine/nav.js', async () => (await import('./_mocks.js')).navMock());
vi.mock('../../../src/engine/goto.js', async () => (await import('./_mocks.js')).gotoMock());
vi.mock('../../../src/engine/tracks.js', async () => (await import('./_mocks.js')).tracksMock());
vi.mock('../../../src/engine/catch.js', async () => (await import('./_mocks.js')).catchMock());
vi.mock('../../../src/engine/reefs.js', () => ({ reefsRefreshNearest: vi.fn() }));
vi.mock('../../../src/services/native', () => ({
  saveOrShareFile: vi.fn(async () => 'downloaded'),
  isNativeShell: vi.fn(() => false),
  shareText: vi.fn(async () => 'copied'),
}));

const S = await import('../../../src/engine/spots.js');
const db = await import('../../../src/engine/db.js');
const gps = await import('../../../src/engine/gps.js');
const nav = await import('../../../src/engine/nav.js');
const goto = await import('../../../src/engine/goto.js');
const native = await import('../../../src/services/native');
const ui = await import('../../../src/services/ui');
const { SITE } = await import('../../../src/services/site');
const { openAboutKeepingCard } = await import('../../../src/shell/Onboarding');
const mocks = await import('./_mocks.js');

const lastToast = () => (ui.uiStore.getState().toast || { msg: '' }).msg;
const card = () => ui.uiStore.getState().card;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ROCKPILE = '#s=33.77450,-118.42390&n=Rockpile';
const SHARED_KEY = 'fishapp.sharedSpot';

/** Put a URL in the address bar without firing hashchange. */
const setUrl = (u) => history.replaceState(null, '', u);

/** A reload of the tab: everything in memory goes (marker, pending spot, card, map), the address
 *  bar and sessionStorage stay. Then the boot reads the links again. */
function reloadAndBoot() {
  const kept = sessionStorage.getItem(SHARED_KEY);
  if (S.Shared.marker) S.Shared.marker.remove();
  S.Shared.marker = null; S.Shared.spot = null;
  ui.uiStore.setState({ card: null, panel: null, modal: null, toast: null });   // the watcher sees the card go…
  if (kept == null) sessionStorage.removeItem(SHARED_KEY); else sessionStorage.setItem(SHARED_KEY, kept);   // …a reload never ran it
  mocks.state.map = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 9);
  vi.mocked(gps.setFollow).mockClear();
  return S.spotLinksInit();
}

/** A map stub that can place a point on screen: a 375 px wide phone chart, spot projected at `y`. */
function placingMap(y) {
  const m = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 14);
  m.latLngToContainerPoint = vi.fn(() => L.point(187, y));
  m.getContainer = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  m.panBy = vi.fn();
  return m;
}

beforeEach(async () => {
  Object.values(db.idb.stores).forEach((m) => m.clear());
  mocks.state.lastLatLng = null;
  mocks.state.map = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 9);
  S.dismissSharedSpot();
  sessionStorage.clear();
  S.Spots.all = []; S.Spots.markers = {}; S.Spots._editing = null;
  S.Spots.layer = null;
  ui.uiStore.setState({ modal: null, card: null, panel: null, dialogs: [], toast: null });
  vi.mocked(gps.setFollow).mockClear();
  vi.mocked(native.shareText).mockClear();
  vi.mocked(goto.gotoStart).mockClear();
  setUrl('/');
  await S.spotsInit(mocks.state.map);
});

describe('link format', () => {
  it('is SITE.siteUrl + #s=lat,lng (5 decimals) &n=encoded name', () => {
    expect(S.spotShareUrl({ lat: 33.7745, lng: -118.4239, name: 'Rockpile' })).toBe(SITE.siteUrl + ROCKPILE);
    expect(S.spotShareUrl({ lat: 33.7745, lng: -118.4239, name: 'Tom & Jerry #2' }, 'https://x.test/'))
      .toBe('https://x.test/#s=33.77450,-118.42390&n=Tom%20%26%20Jerry%20%232');
  });

  it('round-trips position and name through the parser', () => {
    const names = ['Rockpile', 'Tom & Jerry #2 = 50% off?', 'Pier+point', 'Isla Ñandú', 'Kelp 🐟 line', 'a/b?c=d&n=x', ''];
    for (const name of names) {
      const url = S.spotShareUrl({ lat: 33.123456, lng: -118.987654, name });
      expect(S.parseSpotLink(new URL(url).hash)).toEqual({ lat: 33.12346, lng: -118.98765, name });
    }
    // southern / western hemispheres and the poles' edges
    expect(S.parseSpotLink(new URL(S.spotShareUrl({ lat: -90, lng: 179.99999, name: 'S' })).hash)).toEqual({ lat: -90, lng: 179.99999, name: 'S' });
  });

  it('folds a longitude from a neighbouring world copy into range', () => {
    expect(S.spotShareUrl({ lat: 33.9, lng: 241.6, name: 'W' }, 'u')).toBe('u#s=33.90000,-118.40000&n=W');
    expect(S.spotShareUrl({ lat: 33.9, lng: -478.4, name: 'W' }, 'u')).toBe('u#s=33.90000,-118.40000&n=W');
    expect(S.wrapLng(180)).toBe(-180);
  });

  it('has no link for a spot without a real position', () => {
    for (const spot of [null, {}, { lat: null, lng: 1 }, { lat: 'x', lng: 1 }, { lat: NaN, lng: 1 }, { lat: 91, lng: 1 }, { lat: 0, lng: 0 }]) {
      expect(S.spotShareUrl(spot)).toBeNull();
    }
  });

  it('cleans and caps the name it sends', () => {
    const long = 'x'.repeat(500);
    const url = S.spotShareUrl({ lat: 33, lng: -118, name: '  Rock\npile\u202E  ' + long });
    const back = S.parseSpotLink(new URL(url).hash);
    expect(back.name.startsWith('Rock pile x')).toBe(true);
    expect([...back.name]).toHaveLength(S.SHARED_NAME_MAX);
  });

  it('carries the spot type, so a Hazard arrives as one', () => {
    expect(S.spotShareUrl({ lat: 33.7745, lng: -118.4239, name: 'Rock awash, east end', type: 'hazard' }, 'u'))
      .toBe('u#s=33.77450,-118.42390&t=hazard&n=Rock%20awash%2C%20east%20end');
    for (const t of S.SPOT_TYPES.map((x) => x.id)) {
      const url = S.spotShareUrl({ lat: 33.7, lng: -118.4, name: 'A', type: t });
      expect(S.parseSpotLink(new URL(url).hash)).toEqual({ lat: 33.7, lng: -118.4, name: 'A', type: t });
    }
    // a record with no or an unknown type (older backups) shares without one
    expect(S.spotShareUrl({ lat: 33.7, lng: -118.4, name: 'A', type: 'kelp' }, 'u')).toBe('u#s=33.70000,-118.40000&n=A');
  });

  it('the web pages’ spotLink makes the same link the app parses', () => {
    const base = 'https://example.test/fishapp/';
    expect(spotLink(base, 33.7745, -118.4239, 'Rockpile')).toBe(base + ROCKPILE);
    expect(spotLink(base, 33.7745, -118.4239, 'Reef', 'wreck')).toBe(S.spotShareUrl({ lat: 33.7745, lng: -118.4239, name: 'Reef', type: 'wreck' }, base));
    expect(S.parseSpotLink(new URL(spotLink(base, 33.7745, -118.4239, 'Reef', 'wreck')).hash))
      .toEqual({ lat: 33.7745, lng: -118.4239, name: 'Reef', type: 'wreck' });
  });

  it('drops half an emoji from a name, so Share never throws on encodeURIComponent', async () => {
    const broken = JSON.parse('"Kelp \\ud83d"');               // what a backup can hold: a lone high surrogate
    expect(() => encodeURIComponent(broken)).toThrow(URIError);
    expect(S.cleanSpotName(broken)).toBe('Kelp');
    expect(S.cleanSpotName('a\udc00b🐟c')).toBe('ab🐟c');   // lone low surrogate out, the whole fish kept
    expect(S.spotShareUrl({ lat: 33.7, lng: -118.4, name: broken }, 'u')).toBe('u#s=33.70000,-118.40000&n=Kelp');
    expect(await S.shareSpot({ lat: 33.7, lng: -118.4, name: broken })).toBe('copied');
    expect(native.shareText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Spot: Kelp' }));
  });
});

describe('parsing hostile links', () => {
  it('ignores fragments that are not spot links', () => {
    for (const h of ['', '#', '#map', '#settings=1', '#ss=1,2', '#/s=1,2', '#n=Rockpile', '#x=1&sx=2']) {
      expect(S.isSpotLink(h)).toBe(false);
      expect(S.parseSpotLink(h)).toBeNull();
    }
    expect(S.isSpotLink('#s')).toBe(true);
    expect(S.isSpotLink('#n=a&s=1,2')).toBe(true);
  });

  it('rejects anything that is not two plain decimal degrees in range', () => {
    const bad = [
      '#s=', '#s', '#s=abc,def', '#s=NaN,1', '#s=1,NaN', '#s=Infinity,1', '#s=1e1,2', '#s=0x10,1', '#s=33.7',
      '#s=33.7,', '#s=,-118', '#s=1,2,3', '#s=33.7;-118.4', '#s=91,0', '#s=-90.00001,0', '#s=0,180.001',
      '#s=0,-181', '#s=1000,1', '#s=0,0', '#s=33.7%2C-118.4%00', '#s=--1,2', '#s=33.7.1,2',
      '#s=' + '1'.repeat(5000) + ',2', '#s=33.' + '7'.repeat(40) + ',-118.4',
    ];
    for (const h of bad) expect(S.parseSpotLink(h), h).toBeNull();
  });

  it('accepts a hand-written link: no #, no name, spaces, few decimals, + signs from URL encoding', () => {
    expect(S.parseSpotLink('s=33.7,-118.4')).toEqual({ lat: 33.7, lng: -118.4, name: '' });
    expect(S.parseSpotLink('#s=33.7%2C%20-118.4&n=')).toEqual({ lat: 33.7, lng: -118.4, name: '' });
    expect(S.parseSpotLink('#s=33.774501234,-118.4&n=A')).toEqual({ lat: 33.7745, lng: -118.4, name: 'A' });
    expect(S.parseSpotLink('#n=Rock+pile&s=33.7,-118.4')).toEqual({ lat: 33.7, lng: -118.4, name: 'Rock pile' });
  });

  it('keeps markup in a name as literal text (it is only ever rendered as text)', () => {
    const r = S.parseSpotLink('#s=33.7,-118.4&n=' + encodeURIComponent('<script>alert(1)</script>'));
    expect(r.name).toBe('<script>alert(1)</script>');
    // once saved, the marker HTML escapes it like any other spot name
    expect(S.spotMarkerHtml({ name: r.name, type: 'fish' })).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('strips control, bidi and zero-width characters and collapses whitespace', () => {
    expect(S.cleanSpotName('Rock\u0000\u0007pile')).toBe('Rock pile');
    expect(S.cleanSpotName('\u202Eelip\u202C kcoR')).toBe('elip kcoR');
    expect(S.cleanSpotName('A\u2066B\u2069\u200FC\uFEFF\u200BD\u2028E')).toBe('A B C D E');
    expect(S.cleanSpotName('  line\r\n\tbreak  ')).toBe('line break');
    expect(S.cleanSpotName('\u0085\u009F')).toBe('');
    expect(S.cleanSpotName(null)).toBe('');
    expect(S.cleanSpotName(42)).toBe('42');
  });

  it('caps huge names at SHARED_NAME_MAX characters without splitting an emoji', () => {
    const t0 = Date.now();
    const r = S.parseSpotLink('#s=33.7,-118.4&n=' + 'A'.repeat(1_000_000));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.name).toBe('A'.repeat(S.SHARED_NAME_MAX));
    const fish = S.cleanSpotName('🐟'.repeat(S.SHARED_NAME_MAX + 5));
    expect([...fish]).toHaveLength(S.SHARED_NAME_MAX);
    expect(fish).not.toMatch(LONE_SURROGATE);
  });

  it('survives a malformed percent escape instead of throwing', () => {
    expect(S.parseSpotLink('#s=33.7,-118.4&n=100%25%E0%A4%A')).toEqual({ lat: 33.7, lng: -118.4, name: expect.any(String) });
  });

  it('takes a type only when it is one of SPOT_TYPES — anything else is dropped, never trusted', () => {
    const bad = ['', 'Hazard', 'HAZARD', ' hazard', 'hazard ', 'kelp', '__proto__', 'constructor', 'toString',
      'hazard"><img src=x onerror=alert(1)>', 'fish%20x', 'x'.repeat(5000)];
    for (const t of bad) {
      const r = S.parseSpotLink('#s=33.7,-118.4&n=A&t=' + encodeURIComponent(t));
      expect(r, t).toEqual({ lat: 33.7, lng: -118.4, name: 'A' });
      expect(Object.prototype.hasOwnProperty.call(r, 'type'), t).toBe(false);
    }
    expect(S.parseSpotLink('#t=hazard&s=33.7,-118.4')).toEqual({ lat: 33.7, lng: -118.4, name: '', type: 'hazard' });
    expect(S.parseSpotLink('#t=hazard')).toBeNull();            // a type is no position
  });
});

describe('opening a link', () => {
  it('flies there with follow off, opens the card and clears the fragment', () => {
    setUrl('/fishapp/?v=2' + ROCKPILE);
    expect(S.handleSpotLink()).toBe(true);

    expect(card()).toMatchObject({ kind: 'shared-spot', data: { lat: 33.7745, lng: -118.4239, name: 'Rockpile' }, latlng: { lat: 33.7745, lng: -118.4239 } });
    expect(gps.setFollow).toHaveBeenCalledWith(false);
    // not animated: the card measures where the spot is on screen as soon as it is laid out
    expect(mocks.state.map.setView).toHaveBeenCalledWith([33.7745, -118.4239], 14, { animate: false });
    // reload-safe: the fragment is gone, the rest of the address is untouched
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/fishapp/');
    expect(location.search).toBe('?v=2');
    expect(location.href.endsWith('#')).toBe(false);
  });

  it('draws a pending marker whose name is a text node, never markup', () => {
    const name = '<img src=x onerror=alert(1)>';
    setUrl('/#s=33.7,-118.4&n=' + encodeURIComponent(name));
    S.handleSpotLink();
    const el = S.Shared.marker.options.icon.options.html;
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.classList.contains('spot-mk--shared')).toBe(true);
    const chip = el.querySelector('.spot-mk__chip');
    expect(chip.textContent).toBe(name);
    expect(chip.children).toHaveLength(0);
    expect(el.querySelector('img')).toBeNull();
    expect(S.Shared.marker.options.title).toBe('Shared spot: ' + name);
  });

  it('a malformed spot link is cleared with a toast and shows nothing', () => {
    setUrl('/#s=99,1&n=Nope');
    expect(S.handleSpotLink()).toBe(false);
    expect(location.hash).toBe('');
    expect(lastToast()).toMatch(/spot link is damaged/);
    expect(card()).toBeNull();
    expect(mocks.state.map.setView).not.toHaveBeenCalled();
    expect(gps.setFollow).not.toHaveBeenCalled();
  });

  it('leaves unrelated fragments alone', () => {
    setUrl('/#section-2');
    expect(S.handleSpotLink()).toBe(false);
    expect(location.hash).toBe('#section-2');
    expect(card()).toBeNull();
    expect(lastToast()).toBe('');
  });

  it('handles a link opened while the app is running (hashchange)', () => {
    S.spotLinksInit();                       // boot: no link in the address bar
    expect(card()).toBeNull();
    setUrl('/' + ROCKPILE);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(card()).toMatchObject({ kind: 'shared-spot', data: { name: 'Rockpile' } });
    expect(location.hash).toBe('');
    // a second link replaces the first: one pending marker, not two
    const first = S.Shared.marker;
    setUrl('/#s=33.5,-118.1&n=Second');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(S.Shared.spot).toEqual({ lat: 33.5, lng: -118.1, name: 'Second' });
    expect(S.Shared.marker).not.toBe(first);
  });

  it('a spot already in my spots gets the card but no second marker', async () => {
    await S.createSpot({ lat: 33.7745, lng: -118.4239, name: 'My rockpile' });
    setUrl('/' + ROCKPILE);
    S.handleSpotLink();
    expect(S.Shared.spot).toBeNull();
    expect(S.Shared.marker).toBeNull();
    expect(card().kind).toBe('shared-spot');
  });

  it('the boot read finishing later drops the pending marker if the spot was already saved', async () => {
    await db.idb.put('spots', { lat: 33.774504, lng: -118.423896, name: 'Mine', type: 'fish', notes: '', ts: 1 });
    S.Spots.all = [];                        // the boot read has not landed yet
    setUrl('/' + ROCKPILE);
    S.handleSpotLink();
    expect(S.Shared.marker).not.toBeNull();
    await S.spotsInit(mocks.state.map);
    expect(S.Shared.marker).toBeNull();
    expect(S.Shared.spot).toBeNull();
  });

  it('tapping the pending marker brings the card back (unless the route tool takes the tap)', () => {
    setUrl('/' + ROCKPILE);
    S.handleSpotLink();
    ui.closeCard();
    S.Shared.marker.fire('click');
    expect(card().kind).toBe('shared-spot');
    ui.closeCard();
    vi.mocked(nav.navHandleClick).mockReturnValueOnce(true);
    S.Shared.marker.fire('click');
    expect(card()).toBeNull();
  });

  it('a shared Hazard is drawn as one: its glyph and the alert keyline class, under the dashed ring', () => {
    setUrl('/#s=33.7,-118.4&t=hazard&n=' + encodeURIComponent('Rock awash'));
    S.handleSpotLink();
    expect(card().data).toEqual({ lat: 33.7, lng: -118.4, name: 'Rock awash', type: 'hazard' });
    const el = S.Shared.marker.options.icon.options.html;
    expect([...el.classList]).toEqual(['spot-mk', 'spot-mk--shared', 'spot-mk--hazard']);
    expect(el.querySelector('.spot-mk__disc path').getAttribute('d')).toBe('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3');
    // no type (an older link) → the generic pin
    setUrl('/' + ROCKPILE);
    S.handleSpotLink();
    expect(S.Shared.marker.options.icon.options.html.className).toBe('spot-mk spot-mk--shared spot-mk--other');
  });
});

describe('a reload of the tab (service-worker update, iOS tab eviction)', () => {
  it('cleared fragment plus reload restores the card, the marker and the view, follow off', () => {
    setUrl('/fishapp/' + ROCKPILE);
    S.spotLinksInit();
    expect(location.hash).toBe('');
    expect(reloadAndBoot()).toBe(true);
    expect(card()).toMatchObject({ kind: 'shared-spot', data: { lat: 33.7745, lng: -118.4239, name: 'Rockpile' } });
    expect(S.Shared.spot).toEqual({ lat: 33.7745, lng: -118.4239, name: 'Rockpile' });
    expect(S.Shared.marker).not.toBeNull();
    expect(gps.setFollow).toHaveBeenCalledWith(false);
    expect(mocks.state.map.setView).toHaveBeenCalledWith([33.7745, -118.4239], 14, { animate: false });
    // and again: it lasts as long as it is pending, not one reload
    expect(reloadAndBoot()).toBe(true);
    expect(card().kind).toBe('shared-spot');
  });

  it('keeps the type, and the name stays cleaned, across the reload', () => {
    setUrl('/#s=33.7,-118.4&t=hazard&n=' + encodeURIComponent('Rock‮ awash'));
    S.spotLinksInit();
    reloadAndBoot();
    expect(card().data).toEqual({ lat: 33.7, lng: -118.4, name: 'Rock awash', type: 'hazard' });
    expect(S.Shared.marker.options.icon.options.html.classList.contains('spot-mk--hazard')).toBe(true);
  });

  it('a card the user had closed comes back as the marker only: no fly, no card, follow untouched', () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    ui.closeCard();
    expect(reloadAndBoot()).toBe(true);
    expect(card()).toBeNull();
    expect(S.Shared.marker).not.toBeNull();
    expect(gps.setFollow).not.toHaveBeenCalled();
    expect(mocks.state.map.setView).not.toHaveBeenCalled();
    // its marker still brings the card back — and then a reload restores the card again
    S.Shared.marker.fire('click');
    expect(card().kind).toBe('shared-spot');
    reloadAndBoot();
    expect(card().kind).toBe('shared-spot');
  });

  it('Dismiss forgets it: nothing comes back', () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    S.dismissSharedSpot();
    expect(sessionStorage.getItem(SHARED_KEY)).toBeNull();
    expect(reloadAndBoot()).toBe(false);
    expect(card()).toBeNull();
    expect(S.Shared.marker).toBeNull();
    expect(mocks.state.map.setView).not.toHaveBeenCalled();
  });

  it('once saved it is one of my spots: forgotten when its card closes, so a reload leaves it to the spot marker', async () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    S.saveSharedSpot(card().data);
    expect(await S.saveSpot({ name: 'Rockpile', type: 'fish', notes: '' })).toBe(true);
    // the card is still up (it now says "Already in your spots"): a reload brings that back
    expect(sessionStorage.getItem(SHARED_KEY)).not.toBeNull();
    ui.closeCard();
    expect(sessionStorage.getItem(SHARED_KEY)).toBeNull();
    expect(reloadAndBoot()).toBe(false);
    expect(S.Shared.marker).toBeNull();
  });

  it('a spot that turns out to be mine after the boot read is forgotten, card closed or not', async () => {
    await db.idb.put('spots', { lat: 33.7745, lng: -118.4239, name: 'Mine', type: 'fish', notes: '', ts: 1 });
    setUrl('/' + ROCKPILE);
    S.Spots.all = [];
    S.spotLinksInit();
    ui.closeCard();
    S.Spots.all = [];                        // the reload's boot read has not landed yet
    expect(reloadAndBoot()).toBe(true);      // marker only, for now
    await S.spotsInit(mocks.state.map);
    expect(S.Shared.marker).toBeNull();
    expect(sessionStorage.getItem(SHARED_KEY)).toBeNull();
  });

  it('a new link replaces the pending one; a chart-view link keeps its view and gets the marker only', () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    setUrl('/#s=33.5,-118.1&n=Second');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    reloadAndBoot();
    expect(card().data).toEqual({ lat: 33.5, lng: -118.1, name: 'Second' });

    setUrl('/#v=33.4,-118.6,33.6,-118.2');
    reloadAndBoot();
    expect(mocks.state.map.fitBounds).toHaveBeenCalled();
    expect(mocks.state.map.setView).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    expect(S.Shared.spot).toEqual({ lat: 33.5, lng: -118.1, name: 'Second' });
  });

  it('a damaged record is dropped, and blocked storage never breaks a link', () => {
    for (const bad of ['{', 'null', '{"lat":0,"lng":0,"card":true}', '{"lat":"x","lng":1}', '{"lat":95,"lng":1,"card":true}']) {
      sessionStorage.setItem(SHARED_KEY, bad);
      expect(S.spotLinksInit(), bad).toBe(false);
      expect(card()).toBeNull();
      expect(sessionStorage.getItem(SHARED_KEY)).toBeNull();
    }
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    try {
      setUrl('/' + ROCKPILE);
      expect(S.spotLinksInit()).toBe(true);
      expect(card().kind).toBe('shared-spot');
      ui.closeCard();
    } finally {
      set.mockRestore(); get.mockRestore();
    }
  });
});

describe('keeping the spot clear of its card', () => {
  /* Phone, 375 px wide: the HUD ends at 80, the tab bar starts 76 px above the screen's bottom,
     and the card docks 194 px up (above the zoom keys), growing upward. */
  const phone = (h, cardH) => ({ top: 80, bottom: h - 76, card: { left: 12, right: 363, bottom: h - 194, top: h - 194 - cardH } });

  it('375×553 (iPhone SE, Safari): the card leaves no band above, so the spot goes in the strip under it', () => {
    const room = phone(553, 272);             // card 87–359, as measured
    const { x, y } = S.sharedSpotClearPoint({ x: 187, y: 177 }, room);
    expect(x).toBe(187);
    expect(y).toBe(Math.round((359 + 477) / 2));
    expect(y - S.SHARED_CLEAR_PX).toBeGreaterThanOrEqual(room.card.bottom);
    expect(y + S.SHARED_CLEAR_PX).toBeLessThanOrEqual(room.bottom);
  });

  it('390×664 with a two-line name, 375×667: still clear of the card', () => {
    for (const [h, cardH, at] of [[664, 294, 212], [667, 272, 213]]) {
      const room = phone(h, cardH);
      const { y } = S.sharedSpotClearPoint({ x: 187, y: at }, room);
      const clearAbove = y + S.SHARED_CLEAR_PX <= room.card.top && y - S.SHARED_CLEAR_PX >= room.top;
      const clearBelow = y - S.SHARED_CLEAR_PX >= room.card.bottom && y + S.SHARED_CLEAR_PX <= room.bottom;
      expect(clearAbove || clearBelow, String(h)).toBe(true);
    }
  });

  it('a tall phone: the band between the HUD and the card, its middle', () => {
    const room = phone(844, 272);             // card 378–650
    expect(S.sharedSpotClearPoint({ x: 195, y: 422 }, room)).toEqual({ x: 195, y: Math.round((80 + 378) / 2) });
  });

  it('moving it, keeps a long name chip out from under the control column — never past the card edge', () => {
    const room = { ...phone(664, 294), right: 330, chip: 168 };      // 390 wide, zoom keys from x 330
    const to = S.sharedSpotClearPoint({ x: 195, y: 212 }, room);
    expect(to.x + 19 + 168 + 8).toBeLessThanOrEqual(330);
    expect(S.sharedSpotClearPoint({ x: 195, y: 212 }, { ...room, chip: 60 }).x).toBe(195);   // a short name fits
    expect(S.sharedSpotClearPoint({ x: 195, y: 212 }, { ...room, right: 200 }).x).toBe(12 + S.SHARED_CLEAR_PX);
  });

  it('leaves a spot that is already in the clear where it is (and a desktop card off to the side)', () => {
    expect(S.sharedSpotClearPoint({ x: 195, y: 229 }, phone(844, 272))).toBeNull();
    const desk = { top: 90, bottom: 900, card: { left: 88, right: 488, top: 600, bottom: 888 } };
    expect(S.sharedSpotClearPoint({ x: 640, y: 450 }, desk)).toBeNull();
    // narrow desktop window: the centre is over the card's column but well above it
    expect(S.sharedSpotClearPoint({ x: 450, y: 450 }, desk)).toBeNull();
  });

  it('no band is wide enough: the wider one', () => {
    const room = { top: 80, bottom: 500, card: { left: 0, right: 375, top: 110, bottom: 460 } };
    expect(S.sharedSpotClearPoint({ x: 187, y: 300 }, room).y).toBe(Math.round((460 + 500) / 2));
  });

  it('moves the chart once, for the card the link opened — before it is painted, not on a marker tap', () => {
    mocks.state.map = placingMap(177);
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    const id = card().id;
    expect(S.placeSharedSpotClear(id + 1, phone(553, 272))).toBe(false);   // some other card
    expect(S.placeSharedSpotClear(id, phone(553, 272))).toBe(true);
    expect(mocks.state.map.panBy).toHaveBeenCalledTimes(1);
    expect(mocks.state.map.panBy).toHaveBeenCalledWith([0, 177 - 418], { animate: false });
    expect(S.placeSharedSpotClear(id, phone(553, 272))).toBe(false);       // once
    ui.closeCard();
    S.Shared.marker.fire('click');                                         // the user's own tap: leave the view
    expect(S.placeSharedSpotClear(card().id, phone(553, 272))).toBe(false);
    expect(mocks.state.map.panBy).toHaveBeenCalledTimes(1);
  });

  it('does not move a spot that is already clear, and copes with a map that cannot place points', () => {
    mocks.state.map = placingMap(229);
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    expect(S.placeSharedSpotClear(card().id, phone(844, 272))).toBe(false);
    expect(mocks.state.map.panBy).not.toHaveBeenCalled();
    mocks.state.map = mocks.mapStub(L.latLngBounds([33, -119], [34, -118]), 9);   // no latLngToContainerPoint
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    expect(S.placeSharedSpotClear(card().id, phone(553, 272))).toBe(false);
  });
});

describe('first run: the notice’s privacy link', () => {
  it('opens About, and the shared card it covered comes back once About is closed', () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    const before = card();
    openAboutKeepingCard();
    expect(ui.uiStore.getState().panel).toBe('about');
    expect(card()).toBeNull();
    ui.closePanels();
    expect(card()).toMatchObject({ kind: 'shared-spot', data: before.data, latlng: before.latlng });
  });

  it('not when About gives way to another sheet, or another card opened meanwhile', () => {
    setUrl('/' + ROCKPILE);
    S.spotLinksInit();
    openAboutKeepingCard();
    ui.openPanel('more');
    ui.closePanels();
    expect(card()).toBeNull();

    S.Shared.marker.fire('click');
    openAboutKeepingCard();
    ui.uiStore.setState({ card: { id: 999, kind: 'inspect', data: {} } });   // desktop: a chart tap beside the sheet
    ui.closePanels();
    expect(card().kind).toBe('inspect');
  });

  it('with no card under the notice it just opens About', () => {
    openAboutKeepingCard();
    ui.closePanels();
    expect(card()).toBeNull();
  });
});

describe('the shared card actions', () => {
  const shared = { lat: 33.7745, lng: -118.4239, name: 'Rockpile' };

  it('Save opens the editor prefilled; saving makes it one of my spots at the exact position', async () => {
    S.showSharedSpot(shared);
    S.saveSharedSpot(shared);
    expect(ui.uiStore.getState().modal).toMatchObject({ name: 'spot', data: { isNew: true, lat: 33.7745, lng: -118.4239, name: 'Rockpile', type: 'fish' } });
    expect(await S.saveSpot({ name: 'Rockpile', type: 'fish', notes: '' })).toBe(true);
    expect(S.Spots.all).toHaveLength(1);
    expect(S.Spots.all[0]).toMatchObject({ lat: 33.7745, lng: -118.4239, name: 'Rockpile' });
    expect(S.Shared.marker).toBeNull();      // its own spot marker draws it now
    expect(S.Shared.spot).toBeNull();
    expect(S.spotsStore.getState().items.some((x) => S.sameSpotPosition(x, shared))).toBe(true);
  });

  it('Save prefills the type the link carried, so a Hazard is not saved as a fishing spot', () => {
    S.saveSharedSpot({ ...shared, type: 'hazard' });
    expect(ui.uiStore.getState().modal.data).toMatchObject({ isNew: true, type: 'hazard' });
    S.saveSharedSpot({ ...shared, type: 'bogus' });
    expect(ui.uiStore.getState().modal.data.type).toBe('fish');
  });

  it('Navigate starts a Go-To with the name and keeps the pending marker', async () => {
    S.showSharedSpot(shared);
    expect(await S.navigateToSharedSpot(shared)).toBe(true);
    expect(goto.gotoStart).toHaveBeenCalledWith({ lat: 33.7745, lng: -118.4239 }, 'Rockpile');
    expect(card()).toBeNull();
    expect(S.Shared.marker).not.toBeNull();
    await S.navigateToSharedSpot({ lat: 33.7745, lng: -118.4239, name: '' });
    expect(goto.gotoStart).toHaveBeenLastCalledWith({ lat: 33.7745, lng: -118.4239 }, 'Shared spot');
  });

  it('Dismiss takes it off the chart and closes the card', () => {
    S.showSharedSpot(shared);
    S.dismissSharedSpot();
    expect(S.Shared.marker).toBeNull();
    expect(S.Shared.spot).toBeNull();
    expect(card()).toBeNull();
  });

  it('sameSpotPosition matches within the 5-decimal precision of a link, nothing wider', () => {
    expect(S.sameSpotPosition({ lat: 33.774504, lng: -118.423896 }, shared)).toBe(true);
    expect(S.sameSpotPosition({ lat: 33.77452, lng: -118.4239 }, shared)).toBe(false);
    expect(S.sameSpotPosition({ lat: 33.7745, lng: 241.5761 }, shared)).toBe(true);
    expect(S.sameSpotPosition(null, shared)).toBe(false);
  });
});

describe('sharing a spot', () => {
  it('hands text, link and title to the platform share; says "Link copied" when it copied', async () => {
    expect(await S.shareSpot({ id: 1, lat: 33.7745, lng: -118.4239, name: 'Rockpile' })).toBe('copied');
    expect(native.shareText).toHaveBeenCalledWith({ text: 'Spot: Rockpile', url: SITE.siteUrl + ROCKPILE, title: 'Rockpile · ' + SITE.brandName });
    expect(lastToast()).toBe('Link copied');
  });

  it('no toast when a share sheet took it or was closed', async () => {
    vi.mocked(native.shareText).mockResolvedValueOnce('shared');
    expect(await S.shareSpot({ lat: 33.7745, lng: -118.4239, name: 'A' })).toBe('shared');
    vi.mocked(native.shareText).mockResolvedValueOnce('cancelled');
    expect(await S.shareSpot({ lat: 33.7745, lng: -118.4239, name: 'A' })).toBe('cancelled');
    expect(lastToast()).toBe('');
  });

  it('a spot without a real position is not shared', async () => {
    expect(await S.shareSpot({ lat: NaN, lng: 1, name: 'Broken' })).toBe('cancelled');
    expect(native.shareText).not.toHaveBeenCalled();
    expect(lastToast()).toMatch(/no position to share/);
  });

  it('never rejects (both buttons fire and forget): a failure is a toast', async () => {
    vi.mocked(native.shareText).mockRejectedValueOnce(new Error('bridge gone'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await S.shareSpot({ lat: 33.7745, lng: -118.4239, name: 'A' })).toBe('cancelled');
      expect(lastToast()).toBe('Could not share this spot — bridge gone');
    } finally {
      err.mockRestore();
    }
  });

  it('sends the spot’s type with it', async () => {
    await S.shareSpot({ lat: 33.7745, lng: -118.4239, name: 'Rock awash', type: 'hazard' });
    expect(vi.mocked(native.shareText).mock.calls[0][0].url).toBe(SITE.siteUrl + '#s=33.77450,-118.42390&t=hazard&n=Rock%20awash');
  });

  it('what it sends opens the same spot', async () => {
    await S.shareSpot({ lat: 32.71234, lng: -117.17777, name: 'Point Loma kelp' });
    const { url } = vi.mocked(native.shareText).mock.calls[0][0];
    setUrl('/' + new URL(url).hash);
    S.handleSpotLink();
    expect(card().data).toEqual({ lat: 32.71234, lng: -117.17777, name: 'Point Loma kelp' });
  });
});
