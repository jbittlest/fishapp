// @vitest-environment jsdom
/* Fish sightings (iNaturalist) and tap-to-inspect: dates, card data, request shapes, the
   plain-text readings reefs.js reuses, stale-response and offline handling. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { res, settle } from './fixtures.js';

vi.mock('../../../src/engine/gps.js', () => ({
  GPS: { lastLatLng: null },
  mapBoundsClamped: () => ({ s: 33.1, n: 34.2, w: -119.3, e: -117.9 }),
  nmBetween: (a, b) => a.distanceTo(b) / 1852,
  bearingBetween: (a, b) => {
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },
  formatCoord: (v) => v.toFixed(3),
}));
vi.mock('../../../src/engine/app.js', () => {
  const map = { getZoom: () => 10, on: () => {}, addLayer: () => map, removeLayer: () => map, hasLayer: () => false };
  return { getMap: () => map, readJSON: (k, f) => f };
});
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));
vi.mock('../../../src/engine/spots.js', () => ({ openSpotModal: vi.fn() }));
vi.mock('../../../src/engine/goto.js', () => ({ gotoStart: vi.fn(() => Promise.resolve(true)) }));

import { GPS } from '../../../src/engine/gps.js';
import { openSpotModal } from '../../../src/engine/spots.js';
import { gotoStart } from '../../../src/engine/goto.js';
import { uiStore } from '../../../src/services/ui';
import {
  Fish, fishStore, fishInit, fishEnable, fishToast, daysAgo, relTime, fishCardData, fishSearchUrl, FISH_TAXA, FISH_TOAST_FOLLOW_MS,
} from '../../../src/engine/fish.js';
import {
  Inspect, inspectStore, inspectAt, inspectSaveSpot, inspectNavigate, inspectAreaForecast,
  depthText, depthInfo, windText, swellText, sstText, M_TO_FT, M_TO_FATHOM,
} from '../../../src/engine/inspect.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  GPS.lastLatLng = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('fish sightings', () => {
  it('daysAgo / relTime', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T15:00:00'));
    expect(daysAgo('2026-10-25')).toBe(0);
    expect(daysAgo('2026-10-24')).toBe(1);
    expect(daysAgo('2026-09-25')).toBe(30);
    expect(daysAgo('')).toBeNull();
    expect(daysAgo('garbage')).toBeNull();
    expect(relTime(null)).toBe('date unknown');
    expect(relTime(0)).toBe('today');
    expect(relTime(1)).toBe('yesterday');
    expect(relTime(12)).toBe('12 days ago');
    expect(relTime(95)).toBe('3 months ago');
    expect(relTime(38)).toBe('1 month ago');   // was "1 months ago" (audit 2026-10-27)
    expect(relTime(30)).toBe('1 month ago');
    expect(relTime(400)).toBe('1.1 years ago');
  });

  it('request is research-grade, open-geoprivacy only, openly licensed photos, in the clamped view', () => {
    const u = fishSearchUrl({ s: 33.1, n: 34.2, w: -119.3, e: -117.9 });
    expect(u).toBe('https://api.inaturalist.org/v1/observations?taxon_id=' + FISH_TAXA +
      '&nelat=34.2000&nelng=-117.9000&swlat=33.1000&swlng=-119.3000' +
      '&per_page=100&order_by=observed_on&order=desc&geo=true&photos=true' +
      '&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd' +
      '&quality_grade=research&geoprivacy=open');
  });

  it('card data never shows an all-rights-reserved photo, and every photo carries its credit', () => {
    const base = { id: 7, observed_on: '2026-10-20', taxon: { name: 'Paralabrax clathratus', preferred_common_name: 'Kelp Bass' } };
    // first photo all rights reserved, second CC BY: the licensed one is shown, with its own credit
    const mixed = fishCardData({ ...base, photos: [
      { url: 'https://static.inaturalist.org/photos/1/square.jpg', license_code: null, attribution: '(c) Ann, all rights reserved' },
      { url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/square.jpg', license_code: 'cc-by', attribution: '(c) Bo, some rights reserved (CC BY)' },
    ] }, 3);
    expect(mixed.photo).toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/2/small.jpg');
    expect(mixed.photoCredit).toBe('(c) Bo, some rights reserved (CC BY)');
    // only an unlicensed photo: no photo and no credit
    const none = fishCardData({ ...base, photos: [{ url: 'https://static.inaturalist.org/photos/1/square.jpg', license_code: null, attribution: '(c) Ann, all rights reserved' }] }, 3);
    expect(none.photo).toBe('');
    expect(none.photoCredit).toBe('');
    // a licensed photo with no attribution line: the credit is built from the observer and licence
    const built = fishCardData({ ...base, user: { login: 'kelpdiver' }, photos: [{ url: 'https://x.test/photos/3/square.jpg', license_code: 'cc-by-nc' }] }, 3);
    expect(built.photo).toBe('https://x.test/photos/3/small.jpg');
    expect(built.photoCredit).toBe('(c) kelpdiver, some rights reserved (CC BY-NC)');
  });

  it('card data: names, photo, distance/bearing from the boat, safe link', () => {
    GPS.lastLatLng = L.latLng(33.5, -118.5);
    const o = {
      id: 42, uri: 'https://www.inaturalist.org/observations/42', observed_on: '2026-10-20',
      taxon: { name: 'Seriola dorsalis', preferred_common_name: 'California Yellowtail' },
      photos: [{ url: 'https://static.inaturalist.org/photos/1/square.jpg', attribution: '(c) Sam, some rights reserved (CC BY-NC)' }],
      geojson: { coordinates: [-118.4, 33.6] },
    };
    const d = fishCardData(o, 5);
    expect(d.name).toBe('California Yellowtail');
    expect(d.sci).toBe('Seriola dorsalis');
    expect(d.photo).toBe('https://static.inaturalist.org/photos/1/small.jpg');
    expect(d.photoCredit).toMatch(/CC BY-NC/);
    expect(d.when).toBe('5 days ago');
    expect(d.distNm).toBeGreaterThan(0);
    expect(d.brgDeg).toBeGreaterThan(0);
    expect(d.brgDeg).toBeLessThan(90);
    expect(d.url).toBe('https://www.inaturalist.org/observations/42');
    expect(d.recent).toBe(true);
    expect(fishCardData({ ...o, uri: 'javascript:alert(1)' }, 5).url).toBe('https://www.inaturalist.org/observations/42');
  });

  it('card data without GPS / names / photo', () => {
    const d = fishCardData({ taxon: { name: 'Sebastes' } }, null);
    expect(d.name).toBe('Sebastes');
    expect(d.sci).toBe('');
    expect(d.photo).toBe('');
    expect(d.distNm).toBeNull();
    expect(d.when).toBe('date unknown');
    expect(d.recent).toBe(false);
    expect(fishCardData({}, 3).name).toBe('Fish');
  });

  it('enable fetches, publishes a count, and toasts without emoji', async () => {
    const map = { on: () => {} };
    fishInit(map);
    globalThis.fetch = vi.fn(() => res({
      total_results: 2,
      results: [
        { observed_on: '2026-10-20', geojson: { coordinates: [-118.4, 33.6] }, taxon: { name: 'X' } },
        { observed_on: '2025-01-20', geojson: { coordinates: [-118.3, 33.7] }, taxon: { name: 'Y' } },
      ],
    }));
    fishEnable(true);
    await settle();
    expect(fishStore.getState()).toMatchObject({ on: true, status: 'ready', count: 2 });
    expect(uiStore.getState().toast.msg).toBe('2 fish sightings here');
    // each sighting: an invisible 44 px hit disc (drawn first, underneath) + the visible dot
    const layers = Fish.layer.getLayers();
    expect(layers).toHaveLength(4);
    expect(layers.slice(0, 2).map((l) => l.options.className)).toEqual(['wx-fishhit', 'wx-fishhit']);
    expect(layers.slice(0, 2).every((l) => l.options.radius >= 22 && l.options.fillOpacity === 0)).toBe(true);
    expect(layers.slice(2).map((l) => l.options.className)).toEqual(['wx-fishdot wx-fishdot--recent', 'wx-fishdot wx-fishdot--older']);
    // either target opens the sighting's card
    layers[0].fire('click');
    expect(uiStore.getState().card).toMatchObject({ kind: 'fish', latlng: { lat: 33.6, lng: -118.4 } });
    fishEnable(false);
    expect(fishStore.getState().on).toBe(false);
  });
});

describe('fish toasts (rate-limited by kind)', () => {
  beforeEach(() => {
    Fish._toastKind = ''; Fish._toastAt = 0;
    uiStore.setState({ toast: null });
  });

  it('follow mode: a changing count is said at most once a minute', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect(fishToast('result', '12 fish sightings here', true)).toBe(true);
    expect(fishToast('result', '13 fish sightings here', false)).toBe(false);
    expect(fishToast('result', '14 of 200 fish records shown (most recent)', false)).toBe(false);
    vi.advanceTimersByTime(FISH_TOAST_FOLLOW_MS);
    expect(fishToast('result', '15 fish sightings here', false)).toBe(true);
    expect(uiStore.getState().toast.msg).toBe('15 fish sightings here');
  });

  it("the user's own pan or zoom always gets its result", () => {
    expect(fishToast('result', '12 fish sightings here', false)).toBe(true);
    expect(fishToast('result', '3 fish sightings here', true)).toBe(true);
  });

  it('a repeated failure is said once per outage; a good load re-arms it', () => {
    expect(fishToast('error', 'Could not load fish sightings', false)).toBe(true);
    expect(fishToast('error', 'Could not load fish sightings', true)).toBe(false);
    expect(fishToast('result', '4 fish sightings here', false)).toBe(true);
    expect(fishToast('error', 'Could not load fish sightings', false)).toBe(true);
    expect(fishToast('offline', 'Fish sightings need internet', false)).toBe(true);
    expect(fishToast('offline', 'Fish sightings need internet', false)).toBe(false);
  });

  it('a follow-mode pan is not a user action; switching on is', async () => {
    let moveend;
    fishInit({ on: (ev, fn) => { if (ev === 'moveend') moveend = fn; } });
    globalThis.fetch = vi.fn(() => res({ total_results: 1, results: [{ observed_on: '2026-10-20', geojson: { coordinates: [-118.4, 33.6] } }] }));
    fishEnable(true);
    await settle();
    expect(uiStore.getState().toast.msg).toBe('1 fish sightings here');
    uiStore.setState({ toast: null });
    GPS.follow = true;
    vi.useFakeTimers();
    moveend();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(uiStore.getState().toast).toBeNull();      // same kind within a minute, map following the boat
    GPS.follow = false;
    vi.useFakeTimers();
    moveend();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await settle();
    expect(uiStore.getState().toast.msg).toBe('1 fish sightings here');   // the user's own pan
    fishEnable(false);
  });
});

describe('inspect readings as plain text', () => {
  it('depth: land, water ft/m/fathoms, and the states', () => {
    expect(depthText('loading')).toBe('…');
    expect(depthText('offline')).toBe('needs internet');
    expect(depthText('nodata')).toBe('no survey data here');
    expect(depthText('error')).toBe('unavailable');
    expect(depthText(3)).toBe('land (' + Math.round(3 * M_TO_FT) + ' ft above sea)');
    expect(depthText(0)).toMatch(/^land/);
    expect(depthText(-12.9)).toBe((12.9 * M_TO_FT).toFixed(1) + ' ft (12.9 m · ' + (12.9 * M_TO_FATHOM).toFixed(1) + ' fa)');
    expect(depthText(-60)).toBe(Math.round(60 * M_TO_FT) + ' ft (60.0 m · ' + (60 * M_TO_FATHOM).toFixed(1) + ' fa)');
    expect(depthInfo(-10)).toMatchObject({ land: false, m: 10 });
    expect(depthInfo('nodata')).toBeNull();
  });

  it('wind: never "gust 0" for a missing gust', () => {
    expect(windText({ wind_speed_10m: 12.4, wind_direction_10m: 0, wind_gusts_10m: 18.2 })).toBe('12 kn from N gust 18');
    expect(windText({ wind_speed_10m: 12.4, wind_direction_10m: 0, wind_gusts_10m: null })).toBe('12 kn from N gust —');
    expect(windText({ wind_speed_10m: 3, wind_direction_10m: null, wind_gusts_10m: 5 })).toBe('3 kn gust 5');
    expect(windText({ wind_speed_10m: null })).toBe('unavailable');
    expect(windText('offline')).toBe('needs internet');
    expect(windText('loading')).toBe('…');
  });

  it('swell: never "@ 0s" for a missing period', () => {
    expect(swellText({ swell_wave_height: 1, swell_wave_period: 12.4, swell_wave_direction: 270 })).toBe((M_TO_FT).toFixed(1) + ' ft @ 12s W');
    expect(swellText({ swell_wave_height: 1, swell_wave_period: null, swell_wave_direction: null })).toBe((M_TO_FT).toFixed(1) + ' ft');
    expect(swellText({ swell_wave_height: null })).toBe('unavailable');
    expect(swellText('nodata')).toBe('no marine data (inland?)');
  });

  it('water temp', () => {
    expect(sstText(63.44)).toBe('63.4°F');
    expect(sstText('nodata')).toBe('no data');
    expect(sstText(null)).toBe('unavailable');
  });

  it('no markup in any reading', () => {
    for (const s of [depthText(-5), windText({ wind_speed_10m: 3 }), swellText({ swell_wave_height: 1 }), sstText(60)]) {
      expect(s).not.toMatch(/</);
    }
  });
});

describe('inspectAt', () => {
  const routes = (u) => {
    if (u.includes('ImageServer/identify')) return res({ value: '-25.5' });
    if (u.startsWith('https://api.open-meteo.com/')) return res({ current: { wind_speed_10m: 9, wind_direction_10m: 200, wind_gusts_10m: 14 } });
    if (u.startsWith('https://marine-api.open-meteo.com/')) return res({ current: { swell_wave_height: 1.2, swell_wave_period: 11, swell_wave_direction: 250, sea_surface_temperature: 64.1 } });
    return res({}, false);
  };

  it('normalises the longitude, opens the card and fills each reading', async () => {
    globalThis.fetch = vi.fn((u) => routes(String(u)));
    GPS.lastLatLng = L.latLng(33.5, -118.5);
    inspectAt({ lat: 33.6, lng: -478.4 });             // worldCopyJump: one world to the west
    const s0 = inspectStore.getState();
    expect(s0.lng).toBeCloseTo(-118.4);
    expect(s0.results.depth).toBe('loading');
    expect(s0.distNm).toBeGreaterThan(0);
    const card = uiStore.getState().card;
    expect(card.kind).toBe('inspect');
    expect(card.latlng.lng).toBeCloseTo(-118.4);
    await settle();
    const r = inspectStore.getState().results;
    expect(r.depth).toBe(-25.5);
    expect(r.wind.wind_speed_10m).toBe(9);
    expect(r.swell.swell_wave_height).toBe(1.2);
    expect(r.sst).toBe(64.1);
    const urls = fetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain('https://api.open-meteo.com/v1/forecast?latitude=33.600&longitude=-118.400&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn');
  });

  it('offline: "needs internet" straight away, no requests', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.fetch = vi.fn();
    inspectAt({ lat: 33.6, lng: -118.4 });
    expect(inspectStore.getState().results).toEqual({ depth: 'offline', wind: 'offline', swell: 'offline', sst: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a stale response never overwrites a newer tap', async () => {
    let releaseFirst;
    let n = 0;
    globalThis.fetch = vi.fn((u) => {
      n++;
      if (n <= 3) return new Promise((r) => { if (n === 1) releaseFirst = () => r({ ok: true, json: () => Promise.resolve({ value: '-999' }) }); });
      return routes(String(u));
    });
    inspectAt({ lat: 30, lng: -120 });
    inspectAt({ lat: 33.6, lng: -118.4 });
    await settle();
    releaseFirst();
    await settle();
    expect(inspectStore.getState().results.depth).toBe(-25.5);
    expect(inspectStore.getState().lat).toBeCloseTo(33.6);
  });

  it('actions close the card first, then act', async () => {
    globalThis.fetch = vi.fn((u) => routes(String(u)));
    inspectAt({ lat: 33.6, lng: -118.4 });
    inspectSaveSpot();
    expect(uiStore.getState().card).toBeNull();
    expect(openSpotModal).toHaveBeenCalledWith({ lat: 33.6, lng: Inspect.ll.lng });

    inspectAt({ lat: 33.6, lng: -118.4 });
    await expect(inspectNavigate()).resolves.toBe(true);
    expect(gotoStart).toHaveBeenCalledWith(Inspect.ll, 'Pin 33.600, -118.400');

    inspectAt({ lat: 33.6, lng: -118.4 });
    inspectAreaForecast();
    expect(uiStore.getState().panel).toBe('weather');
    expect(uiStore.getState().panelData.ll.lat).toBeCloseTo(33.6);
  });
});
