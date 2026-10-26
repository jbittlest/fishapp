// @vitest-environment jsdom
/* Load flows of the weather panel: cache-first, poisoned-cache guard, quota errors, offline,
   the 10-day latch, area forecasts kept apart from the boat's, the wind loop and the HUD
   water temperature. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { nowPayload, fc10Payload, res, settle } from './fixtures.js';

vi.mock('../../../src/engine/gps.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    GPS: { lastLatLng: null },
    gpsStore: createStore(() => ({ fixAt: 0 })),
    formatCoord: (v, axis) => Math.abs(v).toFixed(3) + (axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')),
    nmBetween: (a, b) => a.distanceTo(b) / 1852,
  };
});
vi.mock('../../../src/engine/app.js', async () => {
  const Lf = (await import('leaflet')).default;
  const map = {
    getSize: () => ({ x: 200, y: 240 }),
    containerPointToLatLng: ([x, y]) => Lf.latLng(33.9 - y / 1000, -118.5 + x / 1000),
    getCenter: () => Lf.latLng(33.8, -118.4),
    getZoom: () => 10,
    getBounds: () => Lf.latLngBounds([33.6, -118.6], [34.0, -118.2]),
    on: () => {},
    addLayer: () => map,
    removeLayer: () => map,
    hasLayer: () => false,
  };
  return {
    getMap: () => map,
    readJSON: (key, fallback) => {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch (e) { return fallback; }
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (e) { try { localStorage.removeItem(key); } catch (e2) {} return fallback; }
    },
  };
});
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));

import { GPS } from '../../../src/engine/gps.js';
import { setDataOverlay } from '../../../src/engine/layers.js';
import { uiStore } from '../../../src/services/ui';
import {
  WX, wxStore, conditionsStore, loadNow24, loadForecast10, loadWeatherPanel, setWeatherTab, showAreaForecast,
  windScrub, windLoopStop, windLoopToggle, windOverlayEnable, wxInit, refreshBoatWater, boatWaterAutoAllowed, wxOnReconnect,
  FC10_KEY, FC10_AREA_KEY,
} from '../../../src/engine/weather.js';

const isForecastNow = (u) => u.startsWith('https://api.open-meteo.com/v1/forecast?') && u.includes('forecast_days=2') && u.includes('&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m');
const isMarineNow = (u) => u.startsWith('https://marine-api.open-meteo.com/v1/marine?') && u.includes('&hourly=wave_height,wave_period');
const isWater = (u) => u.includes('&current=sea_surface_temperature&temperature_unit=fahrenheit');
const isFc10 = (u) => u.includes('forecast_days=10');
const isMarine10 = (u) => u.includes('forecast_days=8');
const isCurrentWind = (u) => u.includes('&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn');

/** Hourly loop payload: 48 hours from an hour ago, every hour `kn` knots. */
function hourlyLoop(kn) {
  const time = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + (i - 1) * 3600000).toISOString().slice(0, 13) + ':00');
  return { time, wind_speed_10m: time.map(() => kn), wind_direction_10m: time.map(() => 0) };
}
/** Live-wind payload for the 4 arrow points of the mocked 200×240 map. */
function currentWind(kn) {
  return Array.from({ length: 4 }, () => ({ current: { wind_speed_10m: kn, wind_direction_10m: 90 } }));
}
/** The knot labels of the arrows on the wind layer. */
function arrowSpeeds() {
  return WX.layer.getLayers().map((m) => /(\d+)<\/div><\/div>$/.exec(m.options.icon.options.html)[1]);
}

let routes;
function route(u) {
  for (const [test, fn] of routes) if (test(u)) return fn(u);
  return res({ error: true }, false);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  GPS.lastLatLng = null;
  WX._loadingNow = false; WX._fcLoading.clear(); WX._loadingFc = false; WX._fcTarget = null;
  WX._fc10loaded = false; WX._fcLoc = null; WX._waterAt = 0; WX._waterBusy = false; WX._waterLL = null;
  routes = [
    [isWater, () => res({ current: { sea_surface_temperature: 64.2 } })],
    [isForecastNow, () => res(nowPayload().wx)],
    [isMarineNow, () => res(nowPayload().marine)],
    [isFc10, () => res(fc10Payload().wx)],
    [isMarine10, () => res(fc10Payload().marine)],
  ];
  globalThis.fetch = vi.fn((u) => route(String(u)));
  conditionsStore.setState({ waterF: null, at: 0, lat: null, lng: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('loadNow24', () => {
  it('offline with nothing saved: offline state, no request', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await loadNow24();
    expect(wxStore.getState().now.status).toBe('offline');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('online: renders, then caches the payload (with its location)', async () => {
    await loadNow24();
    const s = wxStore.getState().now;
    expect(s.status).toBe('ready');
    expect(s.locLabel).toMatch(/^At map center — /);
    const saved = JSON.parse(localStorage.getItem('fishapp.lastwx'));
    expect(saved.lat).toBeCloseTo(33.8);
    expect(saved.wx.current).toBeTruthy();
    // request shape unchanged
    const urls = fetch.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('latitude=33.800&longitude=-118.400&timezone=auto&forecast_days=2'))).toBe(true);
  });

  it('a poisoned cache is deleted instead of bricking the panel (offline)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    localStorage.setItem('fishapp.lastwx', JSON.stringify({ wx: { current: {} }, ts: Date.now(), lat: 33.8, lng: -118.4 }));
    await loadNow24();
    expect(localStorage.getItem('fishapp.lastwx')).toBeNull();
    expect(wxStore.getState().now.status).toBe('offline');
  });

  it('a storage quota error after a good render keeps the render', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await loadNow24();
    expect(wxStore.getState().now.status).toBe('ready');
  });

  it('a failed refresh over a saved copy keeps the saved copy and says it failed', async () => {
    localStorage.setItem('fishapp.lastwx', JSON.stringify(nowPayload('2026-10-25', { ts: Date.now() - 3600000, lat: 33.8, lng: -118.4 })));
    routes = [[() => true, () => Promise.reject(new Error('down'))]];
    await loadNow24();
    const s = wxStore.getState().now;
    expect(s.status).toBe('ready');
    expect(s.refreshFailed).toBe(true);
  });

  it('nothing saved and the fetch fails: error state', async () => {
    routes = [[() => true, () => Promise.reject(new Error('down'))]];
    await loadNow24();
    expect(wxStore.getState().now.status).toBe('error');
  });

  it('at the boat: publishes the water temperature near the boat for the HUD', async () => {
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    await loadNow24();
    await settle();
    const c = conditionsStore.getState();
    expect(c.waterF).toBeCloseTo(64.2);
    expect(c.lat).toBeCloseTo(33.7);
    expect(c.at).toBeGreaterThan(0);
    expect(wxStore.getState().now.locLabel).toMatch(/^At your position — /);
  });

  it('dedupes rapid re-opens while a fetch is in flight', async () => {
    const a = loadNow24();
    const b = loadNow24();
    await Promise.all([a, b]);
    expect(fetch.mock.calls.filter((c) => isForecastNow(c[0]))).toHaveLength(1);
  });
});

describe('10-day', () => {
  it('the boat forecast is cached under fishapp.fc10 (bite + conditions watch read it)', async () => {
    await loadForecast10();
    expect(JSON.parse(localStorage.getItem(FC10_KEY)).wx.daily).toBeTruthy();
    expect(wxStore.getState().fc10.status).toBe('ready');
    expect(WX._fc10loaded).toBe(true);
  });

  it('an area forecast never overwrites the boat forecast', async () => {
    const boat = { lat: 33.8, lng: -118.4, ts: Date.now(), marker: 'boat' };
    localStorage.setItem(FC10_KEY, JSON.stringify(boat));
    await loadWeatherPanel({ ll: { lat: 34.2, lng: -119.5 } });
    await settle();
    expect(JSON.parse(localStorage.getItem(FC10_KEY)).marker).toBe('boat');
    const area = JSON.parse(localStorage.getItem(FC10_AREA_KEY));
    expect(area.lat).toBeCloseTo(34.2);
    const fc = wxStore.getState().fc10;
    expect(fc.forArea).toBe(true);
    expect(fc.locLabel).toMatch(/^For this area — /);
    expect(wxStore.getState().tab).toBe('10day');
    expect(fetch.mock.calls.some((c) => isFc10(c[0]) && c[0].includes('latitude=34.200&longitude=-119.500'))).toBe(true);
  });

  it('opening without a point resets to the Now tab and clears the area', async () => {
    await loadWeatherPanel({ ll: { lat: 34.2, lng: -119.5 } });
    await loadWeatherPanel(null);
    expect(wxStore.getState().tab).toBe('now');
    expect(WX._fcLoc).toBeNull();
    expect(WX._fc10loaded).toBe(false);
  });

  it('switching place mid-load never shows the old place under the new heading', async () => {
    let releaseBoat;
    routes = [
      [(u) => isFc10(u) && u.includes('latitude=33.800'), () => new Promise((r) => { releaseBoat = () => r({ ok: true, json: () => Promise.resolve(fc10Payload().wx) }); })],
      [isFc10, () => res(fc10Payload().wx)],
      [isMarine10, () => res(fc10Payload().marine)],
      [() => true, () => res(nowPayload().wx)],
    ];
    const boatLoad = loadForecast10();
    await settle(2);
    await loadForecast10({ lat: 34.2, lng: -119.5 });
    expect(wxStore.getState().fc10.forArea).toBe(true);
    const areaDays = wxStore.getState().fc10.days;
    releaseBoat();
    await boatLoad;
    expect(wxStore.getState().fc10.forArea).toBe(true);
    expect(wxStore.getState().fc10.days).toBe(areaDays);         // untouched by the late boat payload
    expect(localStorage.getItem(FC10_KEY)).not.toBeNull();         // …which is still cached for bite.js
  });

  describe('switching away and back while the first place is still loading', () => {
    let failBoat;
    beforeEach(() => {
      routes = [
        [(u) => isFc10(u) && u.includes('latitude=33.800'), () => new Promise((_, rej) => { failBoat = () => rej(new Error('down')); })],
        [isFc10, () => res(fc10Payload().wx)],
        [isMarine10, () => res(fc10Payload().marine)],
      ];
    });

    it('repaints the saved copy, and a late failure only flags it (no endless spinner)', async () => {
      localStorage.setItem(FC10_KEY, JSON.stringify(fc10Payload('2026-10-25', { ts: Date.now() - 3600000, lat: 33.8, lng: -118.4 })));
      const boatLoad = loadForecast10();                       // here: cache painted, refresh in flight
      expect(wxStore.getState().fc10).toMatchObject({ status: 'ready', refreshing: true });
      await loadForecast10({ lat: 34.2, lng: -119.5 });        // an area forecast…
      expect(wxStore.getState().fc10).toMatchObject({ forArea: true, refreshing: false });
      await loadForecast10();                                  // …then "Back to my position"
      const fc = wxStore.getState().fc10;
      expect(fc.forArea).toBe(false);
      expect(fc.status).toBe('ready');                         // the saved copy is back on screen
      expect(fc.days.length).toBeGreaterThan(0);
      expect(fc.refreshing).toBe(true);                        // …and the first load is still running
      failBoat();
      await boatLoad;
      expect(wxStore.getState().fc10).toMatchObject({ status: 'ready', refreshFailed: true, refreshing: false });
    });

    it('nothing saved: the late failure shows the error state instead of a spinner', async () => {
      const boatLoad = loadForecast10();
      await settle(2);
      await loadForecast10({ lat: 34.2, lng: -119.5 });
      await loadForecast10();
      expect(wxStore.getState().fc10.status).toBe('loading');
      failBoat();
      await boatLoad;
      expect(wxStore.getState().fc10).toMatchObject({ status: 'error', refreshing: false, days: [] });
    });

    it('going offline after switching away never leaves the refresh spinner on', async () => {
      const boatLoad = loadForecast10();
      await settle(2);
      expect(wxStore.getState().fc10.refreshing).toBe(true);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      await loadForecast10({ lat: 34.2, lng: -119.5 });
      expect(wxStore.getState().fc10).toMatchObject({ status: 'offline', refreshing: false });
      failBoat();
      await boatLoad;
      expect(wxStore.getState().fc10).toMatchObject({ status: 'offline', refreshing: false, forArea: true });
    });
  });

  it('"Back to my position" names what "here" is: the boat\'s last fix, even after it is lost', async () => {
    await loadForecast10({ lat: 34.2, lng: -119.5 });
    expect(wxStore.getState().fc10.hereAtBoat).toBe(false);   // no fix ever → map centre
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    await loadForecast10({ lat: 34.21, lng: -119.5 });
    expect(wxStore.getState().fc10.hereAtBoat).toBe(true);
  });

  it('a fix arriving while an area is shown updates the "Back to…" label', async () => {
    const { gpsStore } = await import('../../../src/engine/gps.js');
    wxInit({ on: () => {} });
    await loadForecast10({ lat: 34.2, lng: -119.5 });
    expect(wxStore.getState().fc10.hereAtBoat).toBe(false);
    gpsStore.setState({ fixAt: Date.now() });
    expect(wxStore.getState().fc10.hereAtBoat).toBe(true);
    gpsStore.setState({ fixAt: 0 });
  });

  it('setWeatherTab loads the 10-day once; a failure clears the latch', async () => {
    routes = [[() => true, () => Promise.reject(new Error('down'))]];
    setWeatherTab('10day');
    expect(WX._fc10loaded).toBe(true);
    await settle();
    expect(WX._fc10loaded).toBe(false);
    expect(wxStore.getState().fc10.status).toBe('error');
  });

  it('offline with nothing saved: offline state', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await loadForecast10();
    expect(wxStore.getState().fc10.status).toBe('offline');
  });

  it('showAreaForecast opens the weather panel through the shared path', () => {
    showAreaForecast(L.latLng(34.1, -119.2));
    const s = uiStore.getState();
    expect(s.panel).toBe('weather');
    expect(s.panelData.ll).toEqual({ lat: 34.1, lng: -119.2 });
  });
});

describe('wind overlay loop', () => {
  beforeEach(() => {
    wxInit({ on: () => {} });
    WX.frames = null; WX._building = null; WX.playing = false;
  });

  it('a failed scrub download is caught (no unhandled rejection) and says so', async () => {
    windOverlayEnable(true);
    routes = [[() => true, () => Promise.reject(new Error('down'))]];
    await expect(windScrub('5')).resolves.toBeUndefined();
    expect(uiStore.getState().toast.msg).toBe('Could not load wind forecast');
    expect(wxStore.getState().wind.loading).toBe(false);
    windOverlayEnable(false);
  });

  it('scrub shows the requested hour with a time label; Stop resets it to now', async () => {
    windOverlayEnable(true);
    const time = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + (i - 1) * 3600000).toISOString().slice(0, 13) + ':00');
    routes = [[() => true, () => res([{ hourly: { time, wind_speed_10m: time.map(() => 10), wind_direction_10m: time.map(() => 0) } }])]];
    await windScrub('3');
    expect(wxStore.getState().wind.hour).toBe(3);
    expect(wxStore.getState().wind.timeLabel).not.toBe('');
    windLoopStop();
    // the label goes back to "now" in the same step that draws live wind
    await settle();
    expect(wxStore.getState().wind.timeLabel).toBe('');
    expect(wxStore.getState().wind.hour).toBe(0);
    windOverlayEnable(false);
  });

  it('Stop while offline keeps the hour label: the arrows still show that hour', async () => {
    windOverlayEnable(true);
    routes = [[() => true, () => res([{ hourly: hourlyLoop(10) }])]];
    await windScrub('5');
    const label = wxStore.getState().wind.timeLabel;
    expect(label).not.toBe('');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    windLoopStop();
    await settle();
    expect(wxStore.getState().wind.timeLabel).toBe(label);
    expect(uiStore.getState().toast.msg).toBe('Wind overlay needs internet');
    windOverlayEnable(false);
    expect(wxStore.getState().wind.timeLabel).toBe('');
  });

  it('a pan just before a scrub can no longer put live wind under the forecast label', async () => {
    const handlers = {};
    wxInit({ on: (ev, fn) => { handlers[ev] = fn; } });
    windOverlayEnable(true);
    routes = [
      [isCurrentWind, () => res(currentWind(33))],
      [() => true, () => res([{ hourly: hourlyLoop(10) }])],
    ];
    await settle();
    await windScrub('3');                       // frames now fresh for this view
    vi.useFakeTimers();
    handlers['moveend zoomend']();              // a pan queues a live refresh in 900 ms
    await windScrub('6');                       // …and the finger scrubs within that time
    const label = wxStore.getState().wind.timeLabel;
    const calls = fetch.mock.calls.filter((c) => isCurrentWind(c[0])).length;
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await settle();
    expect(fetch.mock.calls.filter((c) => isCurrentWind(c[0])).length).toBe(calls);   // the queued refresh was cancelled
    expect(wxStore.getState().wind).toMatchObject({ hour: 6, timeLabel: label });
    expect(arrowSpeeds()).toEqual(['10']);
    windOverlayEnable(false);
  });

  it('a live refresh still in flight when the user scrubs is dropped', async () => {
    let releaseLive;
    routes = [
      [isCurrentWind, () => new Promise((r) => { releaseLive = () => r({ ok: true, json: () => Promise.resolve(currentWind(33)) }); })],
      [() => true, () => res([{ hourly: hourlyLoop(10) }])],
    ];
    windOverlayEnable(true);                    // starts the live refresh
    await windScrub('4');                       // forecast hour drawn while it is in flight
    const label = wxStore.getState().wind.timeLabel;
    expect(label).not.toBe('');
    releaseLive();
    await settle();
    expect(wxStore.getState().wind).toMatchObject({ hour: 4, timeLabel: label });
    expect(arrowSpeeds()).toEqual(['10']);      // still the forecast arrows, not 33 kn live ones
    windOverlayEnable(false);
  });

  it('play auto-enables the overlay through setDataOverlay (no checkbox)', async () => {
    WX.overlayOn = false;
    routes = [[() => true, () => Promise.reject(new Error('down'))]];
    await windLoopToggle();
    expect(setDataOverlay).toHaveBeenCalledWith('wind', true);
  });

  it('play offline refuses with a toast', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await windLoopToggle();
    expect(uiStore.getState().toast.msg).toBe('Wind loop needs internet');
  });
});

describe('refreshBoatWater throttle', () => {
  afterEach(() => { WX.overlayOn = false; uiStore.setState({ panel: null }); });

  it('needs a fix, and never fires twice within two minutes', async () => {
    expect(refreshBoatWater(true)).toBe(false);        // no fix
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    expect(refreshBoatWater(true)).toBe(true);
    await settle();
    expect(refreshBoatWater(true)).toBe(false);
    expect(refreshBoatWater(false)).toBe(false);
  });

  it('privacy: GPS fixes never send the boat position unless a weather feature is in use', () => {
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    uiStore.setState({ panel: null });
    WX.overlayOn = false;
    expect(boatWaterAutoAllowed()).toBe(false);
    expect(refreshBoatWater(false)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    uiStore.setState({ panel: 'tides' });
    expect(refreshBoatWater(false)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('samples automatically while the Weather panel is open', () => {
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    uiStore.setState({ panel: 'weather' });
    expect(refreshBoatWater(false)).toBe(true);
    expect(fetch.mock.calls.some((c) => isWater(c[0]))).toBe(true);
  });

  it('samples automatically while the wind overlay is on', () => {
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    WX.overlayOn = true;
    expect(boatWaterAutoAllowed()).toBe(true);
    expect(refreshBoatWater(false)).toBe(true);
  });

  it('a GPS fix with no weather feature in use sends nothing', async () => {
    const { gpsStore } = await import('../../../src/engine/gps.js');
    wxInit({ on: () => {} });
    GPS.lastLatLng = L.latLng(33.7, -118.3);
    gpsStore.setState({ fixAt: Date.now() });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    gpsStore.setState({ fixAt: 0 });
  });
});

describe('wxOnReconnect', () => {
  afterEach(() => { wxStore.setState({ tab: 'now' }); WX._fc10loaded = false; });

  it('does nothing offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    wxOnReconnect();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('back online: refreshes Now, and the 10-day when it is in use', async () => {
    wxOnReconnect();
    await settle();
    expect(fetch.mock.calls.some((c) => isForecastNow(c[0]))).toBe(true);
    expect(fetch.mock.calls.some((c) => isFc10(c[0]))).toBe(false);
    wxStore.setState({ tab: '10day' });
    wxOnReconnect();
    await settle();
    expect(fetch.mock.calls.some((c) => isFc10(c[0]))).toBe(true);
  });
});
