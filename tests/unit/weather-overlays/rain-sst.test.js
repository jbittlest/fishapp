// @vitest-environment jsdom
/* Rain radar and SST overlays: offline refusal, toggle-off races, labels, URLs, range maths. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { res, settle } from './fixtures.js';

const h = vi.hoisted(() => ({ added: [], removed: [] }));

vi.mock('../../../src/engine/gps.js', () => ({
  mapBoundsClamped: () => ({ s: 33.1, n: 34.2, w: -119.3, e: -117.9 }),
}));
vi.mock('../../../src/engine/app.js', () => {
  const map = {
    getSize: () => ({ x: 800, y: 600 }),
    on: () => {},
    addLayer: (l) => { h.added.push(l); return map; },
    removeLayer: (l) => { h.removed.push(l); return map; },
    hasLayer: () => false,
  };
  return { getMap: () => map };
});
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));

import { reportDataOverlay } from '../../../src/engine/layers.js';
import { uiStore } from '../../../src/services/ui';
import { Rain, rainStore, rainEnable, rainFrameLabel, rainScrub } from '../../../src/engine/rain.js';
import {
  SST, sstStore, sstEnable, sstDate, sstRangeFrom, sstImgUrl, sstSavedPalette, sstSetPalette, sstTogglePlay, C_TO_F,
  SST_PALETTE_BAR, SST_PALETTES, getSstRange,
} from '../../../src/engine/sst.js';

const radar = {
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [{ time: 1761400000, path: '/v2/radar/a' }, { time: 1761400600, path: '/v2/radar/b' }],
    nowcast: [{ time: 1761401200, path: '/v2/radar/c' }],
  },
};

beforeEach(() => {
  h.added.length = 0; h.removed.length = 0;
  vi.restoreAllMocks();
  reportDataOverlay.mockClear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe('rain radar', () => {
  afterEach(async () => { await rainEnable(false); });

  it('offline: refuses, leaves module state OFF and corrects the toggle', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await rainEnable(true);
    expect(Rain.on).toBe(false);
    expect(reportDataOverlay).toHaveBeenCalledWith('rain', false);
    expect(rainStore.getState().on).toBe(false);
    expect(uiStore.getState().toast.msg).toBe('Rain radar needs internet');
  });

  it('an offline refusal at boot keeps the saved choice (legacy only unticked the box)', async () => {
    // reportDataOverlay persists in layers.js; simulate that write
    reportDataOverlay.mockImplementation((id, on) => {
      const p = JSON.parse(localStorage.getItem('fishapp.layers') || '{}');
      localStorage.setItem('fishapp.layers', JSON.stringify({ ...p, [id]: on }));
    });
    localStorage.setItem('fishapp.layers', JSON.stringify({ base: 'ocean', rain: true, sst: true }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await rainEnable(true);
    expect(reportDataOverlay).toHaveBeenCalledWith('rain', false);    // the toggle is corrected…
    expect(JSON.parse(localStorage.getItem('fishapp.layers'))).toEqual({ base: 'ocean', rain: true, sst: true });   // …the pref is not
    await sstEnable(true);
    expect(reportDataOverlay).toHaveBeenCalledWith('sst', false);
    expect(JSON.parse(localStorage.getItem('fishapp.layers')).sst).toBe(true);
    // nothing saved yet: nothing is left behind either
    localStorage.removeItem('fishapp.layers');
    await rainEnable(true);
    expect(localStorage.getItem('fishapp.layers')).toBeNull();
    reportDataOverlay.mockReset();
  });

  it('loads frames, parks on the newest, labels nowcast frames "fcst"', async () => {
    globalThis.fetch = vi.fn(() => res(radar));
    await rainEnable(true);
    const s = rainStore.getState();
    expect(s.frameCount).toBe(3);
    expect(s.idx).toBe(2);
    expect(s.isForecast).toBe(true);
    expect(s.timeLabel).toMatch(/^fcst /);
    expect(s.loading).toBe(false);
    expect(fetch).toHaveBeenCalledWith('https://api.rainviewer.com/public/weather-maps.json');
    expect(h.added[0]._url).toBe('https://tilecache.rainviewer.com/v2/radar/a/256/{z}/{x}/{y}/4/1_1.png');
    rainScrub('0');
    expect(rainStore.getState().isForecast).toBe(false);
    expect(rainStore.getState().timeLabel).not.toMatch(/fcst/);
  });

  it('turned off while loading: nothing is added to the map afterwards', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve(radar) }); }));
    const p = rainEnable(true);
    await settle(1);
    await rainEnable(false);
    release();
    await p;
    expect(h.added).toHaveLength(0);
    expect(rainStore.getState().on).toBe(false);
    expect(Rain.frames).toHaveLength(0);
  });

  it('frame label', () => {
    expect(rainFrameLabel({ time: 1761400000, forecast: false })).not.toMatch(/fcst/);
    expect(rainFrameLabel({ time: 1761400000, forecast: true })).toMatch(/^fcst \d/);
  });
});

describe('SST', () => {
  afterEach(async () => { await sstEnable(false); });

  it('sstDate is the UTC day, 2 days back by default', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T03:00:00Z'));
    expect(sstDate()).toBe('2026-10-23');
    expect(sstDate(0)).toBe('2026-10-25');
    expect(sstDate(6)).toBe('2026-10-19');
  });

  it('range: 10th–90th percentile, at least a degree wide, null under 3 samples', () => {
    const vals = [10, 11, 12, 13, 14, 15, 16, 17, 18, 30, null, NaN];
    expect(sstRangeFrom(vals)).toEqual([11, 18]);
    expect(sstRangeFrom([15.1, 15.2, 15.3])).toEqual([14.7, 15.7]);
    expect(sstRangeFrom([15, null])).toBeNull();
  });

  it('C_TO_F', () => {
    expect(C_TO_F(0)).toBe(32);
    expect(C_TO_F(20)).toBe(68);
  });

  it('image URL keeps the ERDDAP griddap shape with the palette and range', () => {
    SST.range = [14.2, 18.9];
    SST.palette = 'Rainbow';
    const u = sstImgUrl('2026-10-23');
    expect(u).toBe('https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.transparentPng?' +
      'analysed_sst%5B(2026-10-23T09:00:00Z)%5D%5B(33.1000):(34.2000)%5D%5B(-119.3000):(-117.9000)%5D' +
      '&.size=800|629&.colorBar=' + encodeURIComponent('Rainbow|C|Linear|14.2|18.9|'));
  });

  it('saved palette: survives blocked storage and ignores unknown names', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(sstSavedPalette()).toBe('BlueWhiteRed');
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('Nope');
    expect(sstSavedPalette()).toBe('BlueWhiteRed');
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('Ocean');
    expect(sstSavedPalette()).toBe('Ocean');
  });

  it('every palette has a legend gradient', () => {
    for (const p of SST_PALETTES) expect(SST_PALETTE_BAR[p]).toMatch(/^linear-gradient/);
  });

  it('palette change persists, survives a quota error, rejects unknown names', () => {
    sstSetPalette('Ocean');
    expect(sstStore.getState().palette).toBe('Ocean');
    expect(localStorage.getItem('fishapp.sstpal')).toBe('Ocean');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => sstSetPalette('Rainbow')).not.toThrow();
    sstSetPalette('<script>');
    expect(SST.palette).toBe('Rainbow');
  });

  it('offline: refuses, module state OFF, toggle corrected', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await sstEnable(true);
    expect(SST.on).toBe(false);
    expect(reportDataOverlay).toHaveBeenCalledWith('sst', false);
    expect(uiStore.getState().toast.msg).toBe('SST needs internet');
  });

  it('turned off while the range loads: no overlay is painted afterwards', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve([]) }); }));
    const p = sstEnable(true);
    await settle(1);
    await sstEnable(false);
    release();
    await p;
    expect(h.added).toHaveLength(0);
    expect(sstStore.getState().on).toBe(false);
  });

  it('Play tapped while the first range is sampled: the loop is queued, then built with that range', async () => {
    vi.useFakeTimers();
    let release;
    const samples = Array.from({ length: 30 }, (_, i) => ({ current: { sea_surface_temperature: 15 + (i % 10) * 0.3 } }));
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve(samples) }); }));
    SST.range = [1, 2];                              // a stale range from an earlier session
    const p = sstEnable(true);
    sstTogglePlay();
    expect(sstStore.getState()).toMatchObject({ playing: true, loadingLoop: true });
    expect(h.added).toHaveLength(0);                 // nothing built with no / a stale range
    release();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(h.added).toHaveLength(5);                 // the 5-day loop, not a static frame
    expect(h.added.every((ov) => !ov._url.includes(encodeURIComponent('|C|Linear|1|2|')))).toBe(true);
    expect(sstStore.getState()).toMatchObject({ playing: true, loadingLoop: true });   // still "Loading loop…"
    await vi.advanceTimersByTimeAsync(15000);        // preload timeout → the loop starts
    expect(sstStore.getState()).toMatchObject({ playing: true, loadingLoop: false });
    expect(SST.timer).not.toBeNull();
    sstTogglePlay();
    expect(sstStore.getState().playing).toBe(false);
  });

  it('Stop while the first range is still sampled builds nothing early (one static frame afterwards)', async () => {
    vi.useFakeTimers();
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve([]) }); }));
    SST.range = [1, 2];
    const p = sstEnable(true);
    sstTogglePlay();
    sstTogglePlay();
    expect(h.added).toHaveLength(0);
    expect(sstStore.getState()).toMatchObject({ playing: false, loadingLoop: false });
    release();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(h.added).toHaveLength(1);
    expect(getSstRange()).toEqual([13, 23]);         // the fallback, sampled now — not the stale one
  });

  it('legend °F ends are published with the image that uses that range', async () => {
    vi.useFakeTimers();
    const samples = Array.from({ length: 30 }, (_, i) => ({ current: { sea_surface_temperature: 15 + (i % 10) * 0.3 } }));
    globalThis.fetch = vi.fn(() => res(samples));
    const p = sstEnable(true);
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(h.added).toHaveLength(1);                 // one static frame
    expect(sstStore.getState().rangeF).toBeNull();   // not before the image is revealed
    await vi.advanceTimersByTimeAsync(8000);         // load timeout → reveal
    const r = getSstRange();
    expect(sstStore.getState().rangeF).toEqual([Math.round(C_TO_F(r[0])), Math.round(C_TO_F(r[1]))]);
    expect(h.added[0]._url).toContain(encodeURIComponent('|C|Linear|' + r[0] + '|' + r[1] + '|'));
    expect(sstStore.getState().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
