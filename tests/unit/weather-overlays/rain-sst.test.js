// @vitest-environment jsdom
/* Rain radar and SST overlays: offline refusal, toggle-off races, labels, URLs, range maths. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { res, settle } from './fixtures.js';
import REAL_CAPS from './nowcoast-radar-caps.xml?raw';

const h = vi.hoisted(() => ({ added: [], removed: [], onMap: new Set(), on: {}, bounds: null }));

vi.mock('../../../src/engine/gps.js', () => ({
  mapBoundsClamped: () => ({ s: 33.1, n: 34.2, w: -119.3, e: -117.9 }),
}));
vi.mock('../../../src/engine/app.js', () => {
  const map = {
    getSize: () => ({ x: 800, y: 600 }),
    on: (ev, fn) => { (h.on[ev] = h.on[ev] || []).push(fn); return map; },
    off: (ev, fn) => { h.on[ev] = (h.on[ev] || []).filter((f) => f !== fn); return map; },
    getBounds: () => h.bounds,
    addLayer: (l) => { h.added.push(l); h.onMap.add(l); return map; },
    removeLayer: (l) => { h.removed.push(l); h.onMap.delete(l); return map; },
    hasLayer: (l) => h.onMap.has(l),
  };
  return { getMap: () => map };
});
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));

import { reportDataOverlay } from '../../../src/engine/layers.js';
import { uiStore } from '../../../src/services/ui';
import {
  Rain, rainStore, rainEnable, rainFrameLabel, rainScrub, rainTogglePlay, rainRefresh, parseRadarTimes, pickRadarFrames,
  radarCoversView, RADAR_CAPS_URL, RADAR_WMS, RADAR_LAYER, RAIN_FRAME_MS,
} from '../../../src/engine/rain.js';
import {
  SST, sstStore, sstEnable, sstDate, sstRangeFrom, sstImgUrl, sstSavedPalette, sstSetPalette, sstTogglePlay, C_TO_F,
  SST_PALETTE_BAR, SST_PALETTES, getSstRange,
} from '../../../src/engine/sst.js';

/* The radar layer's real capabilities, as nowCOAST served them on 2026-10-26 (97 mosaics,
   18:04:03Z to 00:32:17Z, one gap of 8 min at 18:27:47Z). */
const MIN = 60000;
const iso = (t) => new Date(t).toISOString();
/** A capabilities document listing `times` (ms) the way nowCOAST does. */
const capsXml = (times) =>
  '<?xml version="1.0" encoding="UTF-8"?><WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Layer>' +
  '<Layer queryable="1" opaque="0"><Name>conus_base_reflectivity_mosaic</Name>' +
  '<Dimension name="time" default="' + iso(times[times.length - 1]).replace('.000', '') + '" units="ISO8601" nearestValue="1">' +
  times.map(iso).join(',') + '</Dimension></Layer></Layer></Capability></WMS_Capabilities>';
/** Mosaics about every 4 minutes (3.5 to 4.5) for `hours` up to `newest`, oldest first. */
function mosaics(newest, hours = 6.5) {
  const out = [];
  for (let t = newest, k = 0; t > newest - hours * 3600e3; k++) { out.push(t); t -= 4 * MIN + (((k * 37) % 61) - 30) * 1000; }
  return out.reverse();
}
const NEWEST = Date.parse('2026-10-27T00:32:17.000Z');
/** The same history `n` mosaics later: new ones are appended, the listed ones stay. */
const later = (n) => mosaics(NEWEST).concat(Array.from({ length: n }, (_, i) => NEWEST + (i + 1) * 4 * MIN + (i % 2) * 9000));
const xmlRes = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, text: () => Promise.resolve(body) });
const fire = (ev) => (h.on[ev] || []).slice().forEach((fn) => fn());

beforeEach(() => {
  h.added.length = 0; h.removed.length = 0; h.onMap.clear(); h.bounds = null;
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

  it('reads the frame list from nowCOAST, parks on the newest, puts only that frame on the map', async () => {
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    const s = rainStore.getState();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(RADAR_CAPS_URL);
    expect(RADAR_CAPS_URL).toBe('https://nowcoast.noaa.gov/geoserver/observations/weather_radar/conus_base_reflectivity_mosaic/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities');
    expect(s).toMatchObject({ on: true, loading: false, playing: false, loadingLoop: false, outside: false });
    expect(s.frameCount).toBe(13);
    expect(s.idx).toBe(12);
    expect(s.timeLabel).toBe(rainFrameLabel({ time: NEWEST }));
    // lazily: one frame's tiles, not the whole loop's
    expect(h.added).toHaveLength(1);
    const layer = h.added[0];
    expect(layer).toBe(Rain.frames[12].layer);
    expect(layer.options.opacity).toBe(0.75);
    expect(Rain.frames.slice(0, 12).every((f) => f.layer.options.opacity === 0)).toBe(true);
    expect(rainStore.getState().idx).toBe(12);
  });

  it('each frame is a plain live WMS layer at its mosaic time: capped at z9, 512 px tiles, CONUS only, NOAA credit', async () => {
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    const layer = Rain.frames[12].layer;
    // not the IndexedDB-backed chart layer of tiles.js: radar is never stored, never downloaded
    expect(Object.getPrototypeOf(layer)).toBe(L.TileLayer.WMS.prototype);
    expect(layer._url).toBe(RADAR_WMS);
    expect(RADAR_WMS).toBe('https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms');
    expect(layer.wmsParams).toMatchObject({
      service: 'WMS', request: 'GetMap', version: '1.1.1', layers: RADAR_LAYER, styles: '',
      format: 'image/png', transparent: true, time: '2026-10-27T00:32:17.000Z', width: 512, height: 512,
    });
    expect(layer.options).toMatchObject({ maxNativeZoom: 9, tileSize: 512, uppercase: true, className: 'rain-tiles', zIndex: 4, updateWhenIdle: true });
    expect(L.latLngBounds(layer.options.bounds).contains([33.77, -118.42])).toBe(true);    // SoCal
    expect(L.latLngBounds(layer.options.bounds).contains([21.3, -157.9])).toBe(false);     // Hawaii
    expect(layer.getAttribution()).toMatch(/NOAA nowCOAST/);
    expect(layer.getAttribution()).toContain('href="https://nowcoast.noaa.gov/"');
    expect(layer.getAttribution()).not.toMatch(/RainViewer/i);
    // only Leaflet options and real WMS parameters: nothing leaks into the GetMap query
    expect(Object.keys(layer.wmsParams).sort()).toEqual(['format', 'height', 'layers', 'request', 'service', 'styles', 'time', 'transparent', 'version', 'width']);
  });

  it('scrubbing shows that frame and its own time, and pauses a running loop', async () => {
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    rainScrub('0');
    const s = rainStore.getState();
    expect(s.idx).toBe(0);
    expect(s.timeLabel).toBe(rainFrameLabel(Rain.frames[0]));
    expect(h.added).toHaveLength(2);                       // the newest, then the scrubbed-to frame
    expect(Rain.frames[0].layer.options.opacity).toBe(0.75);
    expect(Rain.frames[12].layer.options.opacity).toBe(0);
    rainTogglePlay();
    expect(rainStore.getState().playing).toBe(true);
    rainScrub('5');
    expect(rainStore.getState()).toMatchObject({ playing: false, idx: 5 });
  });

  it('Play preloads every frame, shows a spinner until they load, then cycles', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    // three frames still have tiles in flight once they are on the map
    const slow = [Rain.frames[0], Rain.frames[4], Rain.frames[9]];
    slow.forEach((f) => { f.layer.isLoading = () => true; });
    rainTogglePlay();
    expect(h.onMap.size).toBe(13);                         // the whole loop is on the map, invisible
    expect(rainStore.getState()).toMatchObject({ playing: true, loadingLoop: true, idx: 12 });
    await vi.advanceTimersByTimeAsync(RAIN_FRAME_MS * 3);
    expect(rainStore.getState().idx).toBe(12);             // not cycling over half-loaded frames
    slow[0].layer.fire('load');
    slow[1].layer.fire('load');
    expect(rainStore.getState().loadingLoop).toBe(true);
    slow[2].layer.fire('load');
    expect(rainStore.getState()).toMatchObject({ playing: true, loadingLoop: false });
    await vi.advanceTimersByTimeAsync(RAIN_FRAME_MS);
    expect(rainStore.getState().idx).toBe(0);              // wraps from the newest to the oldest
    await vi.advanceTimersByTimeAsync(RAIN_FRAME_MS * 2);
    expect(rainStore.getState().idx).toBe(2);
    expect(rainStore.getState().timeLabel).toBe(rainFrameLabel(Rain.frames[2]));
    rainTogglePlay();
    expect(rainStore.getState()).toMatchObject({ playing: false, loadingLoop: false });
    await vi.advanceTimersByTimeAsync(RAIN_FRAME_MS * 4);
    expect(rainStore.getState().idx).toBe(2);
  });

  it('a frame that never loads does not hold the loop for ever; Stop during the preload starts nothing', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    Rain.frames[3].layer.isLoading = () => true;
    rainTogglePlay();
    expect(rainStore.getState().loadingLoop).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(rainStore.getState()).toMatchObject({ playing: true, loadingLoop: false });
    await vi.advanceTimersByTimeAsync(RAIN_FRAME_MS);
    expect(rainStore.getState().idx).toBe(0);
    rainTogglePlay();                                      // pause

    Rain.frames[3].layer.isLoading = () => true;
    rainTogglePlay();                                      // play: preloading again
    rainTogglePlay();                                      // …and stopped before it loads
    Rain.frames[3].layer.fire('load');
    await vi.advanceTimersByTimeAsync(12000);
    expect(rainStore.getState()).toMatchObject({ playing: false, loadingLoop: false, idx: 0 });
    expect(Rain.timer).toBeNull();
  });

  it('paused: a pan drops the hidden frames an earlier Play loaded (Play loads them again)', async () => {
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    rainTogglePlay();
    expect(h.onMap.size).toBe(13);
    fire('movestart');                                     // playing: the loop keeps every frame
    expect(h.onMap.size).toBe(13);
    rainTogglePlay();
    fire('movestart');
    expect([...h.onMap]).toEqual([Rain.frames[Rain.idx].layer]);
    rainTogglePlay();
    expect(h.onMap.size).toBe(13);
  });

  it('outside the lower 48 the bar says so; panning back clears it', async () => {
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    h.bounds = L.latLngBounds([[19.5, -160], [22.5, -154]]);   // Hawaii
    await rainEnable(true);
    expect(rainStore.getState().outside).toBe(true);
    h.bounds = L.latLngBounds([[33.4, -118.9], [34.1, -117.9]]);   // Santa Monica Bay to Dana Point
    fire('moveend');
    expect(rainStore.getState().outside).toBe(false);
    h.bounds = L.latLngBounds([[52, -136], [56, -129]]);       // straddling the edge still counts
    fire('moveend');
    expect(rainStore.getState().outside).toBe(false);
    await rainEnable(false);
    expect(rainStore.getState().outside).toBe(false);
    expect(h.on.moveend || []).toHaveLength(0);               // unbound with the overlay
    expect(radarCoversView(null)).toBe(true);
  });

  it('refresh: moves on to new mosaics, keeps the layers (and loaded tiles) of unchanged frames', async () => {
    let times = mosaics(NEWEST);
    globalThis.fetch = vi.fn(() => xmlRes(capsXml(times)));
    await rainEnable(true);
    const before = Rain.frames.slice();
    expect(before[before.length - 1].time).toBe(NEWEST);

    await rainRefresh();                                   // nothing new: nothing changes
    expect(Rain.frames).toEqual(before);

    times = later(3);                                      // three new mosaics later
    await rainRefresh();
    const after = Rain.frames;
    expect(after[after.length - 1].time).toBe(times[times.length - 1]);
    const kept = after.filter((f) => before.includes(f));
    expect(kept.length).toBeGreaterThanOrEqual(after.length - 3);   // the clock marks still pick the same mosaics
    expect(rainStore.getState().idx).toBe(after.length - 1);       // parked on the newest: stays on the newest
    expect(rainStore.getState().timeLabel).toBe(rainFrameLabel(after[after.length - 1]));
    before.filter((f) => !after.includes(f)).forEach((f) => expect(h.onMap.has(f.layer)).toBe(false));
  });

  it('refresh: a frame scrubbed back to stays on screen; a failed read keeps the loop', async () => {
    let times = mosaics(NEWEST);
    globalThis.fetch = vi.fn(() => xmlRes(capsXml(times)));
    await rainEnable(true);
    rainScrub('6');
    const shown = Rain.frames[6].time;
    times = later(2);
    await rainRefresh();
    expect(Rain.frames[Rain.idx].time).toBe(shown);
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('offline')));
    const frames = Rain.frames.slice();
    await rainRefresh();
    expect(Rain.frames).toEqual(frames);
    expect(rainStore.getState().frameCount).toBe(frames.length);
  });

  it('a failed first read says so; the refresh brings the loop in once the service answers', async () => {
    globalThis.fetch = vi.fn(() => xmlRes('Service unavailable', false));
    await rainEnable(true);
    expect(uiStore.getState().toast.msg).toBe('Could not load rain radar');
    expect(rainStore.getState()).toMatchObject({ on: true, loading: false, frameCount: 0 });
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainRefresh();
    expect(rainStore.getState()).toMatchObject({ frameCount: 13, idx: 12 });
  });

  it('turned off while loading: nothing is added to the map afterwards', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, text: () => Promise.resolve(REAL_CAPS) }); }));
    const p = rainEnable(true);
    await settle(1);
    await rainEnable(false);
    release();
    await p;
    expect(h.added).toHaveLength(0);
    expect(rainStore.getState().on).toBe(false);
    expect(Rain.frames).toHaveLength(0);
  });

  it('turned off: every frame leaves the map, the refresh timer stops', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => xmlRes(REAL_CAPS));
    await rainEnable(true);
    rainTogglePlay();
    await rainEnable(false);
    expect(h.onMap.size).toBe(0);
    expect(rainStore.getState()).toMatchObject({ on: false, frameCount: 0, playing: false, timeLabel: '' });
    fetch.mockClear();
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('frame label is the mosaic clock time, never a forecast tag', () => {
    expect(rainFrameLabel({ time: NEWEST })).toBe(new Date(NEWEST).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    expect(rainFrameLabel({ time: NEWEST })).not.toMatch(/fcst/i);
  });
});

describe('radar time handling', () => {
  it('parses the TIME values nowCOAST lists for the layer (ms, ascending)', () => {
    const t = parseRadarTimes(REAL_CAPS);
    expect(t).toHaveLength(97);
    expect(iso(t[0])).toBe('2026-10-26T18:04:03.000Z');
    expect(iso(t[96])).toBe('2026-10-27T00:32:17.000Z');
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true);
  });

  it('reads the named layer when the document lists several (the whole radar workspace)', () => {
    const other = '<Layer><Name>alaska_base_reflectivity_mosaic</Name><Dimension name="time" units="ISO8601">2020-01-01T00:00:00.000Z</Dimension></Layer>';
    const doc = REAL_CAPS.replace('<Layer queryable="1"', other + '<Layer queryable="1"');
    expect(parseRadarTimes(doc)).toHaveLength(97);
    expect(parseRadarTimes(doc, 'alaska_base_reflectivity_mosaic')).toEqual([Date.parse('2020-01-01T00:00:00Z')]);
  });

  it('expands a GeoServer interval, and copes with junk', () => {
    const interval = '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension units="ISO8601" name="time">' +
      '2026-10-27T00:00:00.000Z/2026-10-27T00:20:00.000Z/PT4M</Dimension></Layer>';
    expect(parseRadarTimes(interval).map(iso)).toEqual([
      '2026-10-27T00:00:00.000Z', '2026-10-27T00:04:00.000Z', '2026-10-27T00:08:00.000Z',
      '2026-10-27T00:12:00.000Z', '2026-10-27T00:16:00.000Z', '2026-10-27T00:20:00.000Z']);
    // a continuous interval has no period: the radar step is used, counted back from the end
    const cont = interval.replace('PT4M', 'PT0S').replace('00:00:00.000Z/', '23:40:00.000Z/').replace('2026-10-27T23', '2026-10-26T23');
    expect(parseRadarTimes(cont).map(iso)).toEqual(['2026-10-26T23:40:00.000Z', '2026-10-26T23:50:00.000Z',
      '2026-10-27T00:00:00.000Z', '2026-10-27T00:10:00.000Z', '2026-10-27T00:20:00.000Z']);
    expect(parseRadarTimes('<ServiceExceptionReport>no</ServiceExceptionReport>')).toEqual([]);
    expect(parseRadarTimes(capsXml([NEWEST]).replace(iso(NEWEST) + '<', 'nope,' + iso(NEWEST) + '<'))).toEqual([NEWEST]);
    expect(parseRadarTimes(null)).toEqual([]);
  });

  it('picks the newest mosaic plus the one nearest each 10-minute mark over 2 hours', () => {
    const all = parseRadarTimes(REAL_CAPS);
    const f = pickRadarFrames(all);
    expect(f).toHaveLength(13);
    expect(f[12]).toBe(NEWEST);
    expect(f.every((t) => all.includes(t))).toBe(true);
    expect(f.every((t, i) => i === 0 || t > f[i - 1])).toBe(true);
    expect(NEWEST - f[0]).toBeLessThan(125 * MIN);
    // the mosaic nearest each mark from 22:30 to 00:20, then the newest
    expect(f.map((t) => iso(t).slice(11, 19))).toEqual([
      '22:28:08', '22:40:05', '22:48:17', '23:00:10', '23:08:09', '23:19:57', '23:28:13',
      '23:39:57', '23:48:04', '23:59:57', '00:11:58', '00:20:17', '00:32:17']);
    f.slice(0, 12).forEach((t) => {
      const mark = Math.round(t / (10 * MIN)) * 10 * MIN;
      expect(Math.abs(t - mark)).toBeLessThan(5 * MIN);
    });
  });

  it('skips a mark with no mosaic near it (an outage) instead of repeating a frame', () => {
    const all = mosaics(NEWEST).filter((t) => t < NEWEST - 65 * MIN || t > NEWEST - 35 * MIN);   // a 30-minute hole
    const f = pickRadarFrames(all);
    expect(new Set(f).size).toBe(f.length);
    expect(f.length).toBeLessThan(13);
    expect(f.length).toBeGreaterThanOrEqual(10);
    expect(f.filter((t) => t > NEWEST - 65 * MIN && t < NEWEST - 35 * MIN)).toEqual([]);
  });

  it('keeps the same picks as new mosaics arrive (a refresh only loads the new ones)', () => {
    const a = pickRadarFrames(mosaics(NEWEST));
    const b = pickRadarFrames(later(2));
    const shared = b.filter((t) => a.includes(t));
    expect(b[b.length - 1]).toBe(NEWEST + 8 * MIN + 9000);
    expect(shared.length).toBeGreaterThanOrEqual(b.length - 2);
  });

  it('edge cases: nothing listed, one mosaic, a short history', () => {
    expect(pickRadarFrames([])).toEqual([]);
    expect(pickRadarFrames([NEWEST])).toEqual([NEWEST]);
    expect(pickRadarFrames([NaN, NEWEST - 10 * MIN, NEWEST])).toEqual([NEWEST - 10 * MIN, NEWEST]);
    expect(pickRadarFrames(mosaics(NEWEST, 0.5)).length).toBeLessThanOrEqual(4);
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
