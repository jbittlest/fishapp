import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { getMap } from './app.js';
import { refuseDataOverlay } from './sst.js';
import { toast } from '../services/ui';

/* Animated rain radar — RainViewer (free, CORS-ok). Preloads the last ~2 hours of radar
   frames (plus any forecast nowcast frames) and cycles them like a video. Online only. */
'use strict';

export const Rain = {
  on: false,
  frames: [],       // [{ time, layer, forecast }]
  idx: 0,
  playing: false,
  timer: null,
  _gen: 0,          // bumps on every enable/disable; a stale async continuation checks it and bails
};

export const RAIN_FRAME_MS = 500;

/* Loop scrubber state for features/weather/MapLegends (replaces #rain-bar / #rain-play /
   #rain-scrub / #rain-time). */
/**
 * @typedef {{ on: boolean, loading: boolean, frameCount: number, idx: number, playing: boolean,
 *   timeLabel: string, isForecast: boolean }} RainView
 */
/** @type {import('zustand/vanilla').StoreApi<RainView>} */
export const rainStore = createStore(() => /** @type {RainView} */ ({
  on: false, loading: false, frameCount: 0, idx: 0, playing: false, timeLabel: '', isForecast: false,
}));

export async function rainEnable(on) {
  Rain.on = on;
  const gen = ++Rain._gen;
  if (on) {
    if (!navigator.onLine) {
      toast('Rain radar needs internet');
      /* Legacy unticked the box but left Rain.on = true. Refuse completely: module state off
         and the Layers toggle corrected without re-running the enabler — and without
         rewriting the saved choice, so rain radar comes back on the next launch with signal
         (legacy only unticked the box; see refuseDataOverlay in sst.js). */
      Rain.on = false;
      refuseDataOverlay('rain');
      rainStore.setState({ on: false, loading: false });
      return;
    }
    rainStore.setState({ on: true, loading: true });
    await buildRainFrames(gen);
    /* The user may have switched rain off (or off and on again) while the frame list loaded.
       Only the newest enable may show anything — legacy re-showed the bar and radar here. */
    if (gen !== Rain._gen || !Rain.on) return;
    rainStore.setState({ loading: false });
    if (Rain.frames.length) showRainFrame(Rain.frames.length - 1); // latest, static
    rainStop();
  } else {
    rainStop();
    const map = getMap();
    Rain.frames.forEach((f) => { if (map) map.removeLayer(f.layer); });
    Rain.frames = [];
    rainStore.setState({ on: false, loading: false, frameCount: 0, idx: 0, playing: false, timeLabel: '', isForecast: false });
  }
}

export async function buildRainFrames(gen) {
  rainStop();
  const map = getMap();
  Rain.frames.forEach((f) => { if (map) map.removeLayer(f.layer); });
  Rain.frames = [];
  try {
    const d = await fetch('https://api.rainviewer.com/public/weather-maps.json').then((r) => r.json());
    if (gen != null && (gen !== Rain._gen || !Rain.on)) return;   // superseded while loading: add nothing
    const past = (d.radar && d.radar.past) || [];
    const now = (d.radar && d.radar.nowcast) || [];
    past.concat(now).forEach((fr) => {
      const layer = L.tileLayer(
        d.host + fr.path + '/256/{z}/{x}/{y}/4/1_1.png', // color scheme 4, smoothed, show snow
        { opacity: 0, maxZoom: 20, attribution: 'RainViewer', className: 'rain-tiles' }
      ).addTo(getMap());
      layer.setZIndex(4);
      Rain.frames.push({ time: fr.time, layer, forecast: now.indexOf(fr) >= 0 });
    });
    if (!Rain.frames.length) toast('No radar frames available right now');
    // scrubber: max = frames - 1, parked on the newest frame
    rainStore.setState({ frameCount: Rain.frames.length, idx: Math.max(0, Rain.frames.length - 1) });
  } catch (e) {
    if (gen != null && gen !== Rain._gen) return;
    toast('Could not load rain radar');
  }
}

/** "fcst 2:40 PM" for nowcast frames — a forecast frame is never shown as observed radar. */
export function rainFrameLabel(f) {
  const dt = new Date(f.time * 1000);
  const t = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (f.forecast ? 'fcst ' : '') + t;
}

export function showRainFrame(i) {
  if (!Rain.frames.length) return;
  Rain.idx = ((i % Rain.frames.length) + Rain.frames.length) % Rain.frames.length;
  Rain.frames.forEach((f, j) => f.layer.setOpacity(j === Rain.idx ? 0.75 : 0));
  const f = Rain.frames[Rain.idx];
  rainStore.setState({ idx: Rain.idx, timeLabel: rainFrameLabel(f), isForecast: !!f.forecast, frameCount: Rain.frames.length });
}

/* Drag the timeline: pause and jump to that radar frame */
export function rainScrub(v) {
  if (Rain.playing) rainStop();
  showRainFrame(parseInt(v, 10));
}

export function rainPlay() {
  if (Rain.frames.length < 2 || !navigator.onLine) return;
  Rain.playing = true;
  updateRainBtn();
  Rain.timer = setInterval(() => showRainFrame(Rain.idx + 1), RAIN_FRAME_MS);
}

export function rainStop() {
  Rain.playing = false;
  clearInterval(Rain.timer);
  Rain.timer = null;
  updateRainBtn();
  if (Rain.frames.length) showRainFrame(Rain.idx);
}

export function rainTogglePlay() { Rain.playing ? rainStop() : rainPlay(); }

export function updateRainBtn() {
  rainStore.setState({ playing: Rain.playing });
}
