/* Animated rain radar — RainViewer (free, CORS-ok). Preloads the last ~2 hours of radar
   frames (plus any forecast nowcast frames) and cycles them like a video. Online only. */
'use strict';

const Rain = {
  on: false,
  frames: [],       // [{ time, layer, forecast }]
  idx: 0,
  playing: false,
  timer: null,
};

const RAIN_FRAME_MS = 500;

async function rainEnable(on) {
  Rain.on = on;
  const bar = document.getElementById('rain-bar');
  if (on) {
    if (!navigator.onLine) { toast('Rain radar needs internet'); document.getElementById('ovl-rain').checked = false; return; }
    await buildRainFrames();
    if (bar) bar.classList.remove('hidden');
    if (Rain.frames.length) showRainFrame(Rain.frames.length - 1); // latest, static
    rainStop();
  } else {
    rainStop();
    Rain.frames.forEach((f) => window._map.removeLayer(f.layer));
    Rain.frames = [];
    if (bar) bar.classList.add('hidden');
  }
}

async function buildRainFrames() {
  rainStop();
  Rain.frames.forEach((f) => window._map.removeLayer(f.layer));
  Rain.frames = [];
  try {
    const d = await fetch('https://api.rainviewer.com/public/weather-maps.json').then((r) => r.json());
    const past = (d.radar && d.radar.past) || [];
    const now = (d.radar && d.radar.nowcast) || [];
    past.concat(now).forEach((fr) => {
      const layer = L.tileLayer(
        d.host + fr.path + '/256/{z}/{x}/{y}/4/1_1.png', // color scheme 4, smoothed, show snow
        { opacity: 0, maxZoom: 20, attribution: 'RainViewer', className: 'rain-tiles' }
      ).addTo(window._map);
      layer.setZIndex(4);
      Rain.frames.push({ time: fr.time, layer, forecast: now.indexOf(fr) >= 0 });
    });
    if (!Rain.frames.length) toast('No radar frames available right now');
    const sc = document.getElementById('rain-scrub');
    if (sc) { sc.max = Math.max(0, Rain.frames.length - 1); sc.value = sc.max; }
  } catch (e) {
    toast('Could not load rain radar');
  }
}

function showRainFrame(i) {
  if (!Rain.frames.length) return;
  Rain.idx = ((i % Rain.frames.length) + Rain.frames.length) % Rain.frames.length;
  Rain.frames.forEach((f, j) => f.layer.setOpacity(j === Rain.idx ? 0.75 : 0));
  const f = Rain.frames[Rain.idx];
  const el = document.getElementById('rain-time');
  if (el) {
    const dt = new Date(f.time * 1000);
    const t = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.textContent = (f.forecast ? 'fcst ' : '') + t + (Rain.playing ? ' ▸' : '');
  }
  const sc = document.getElementById('rain-scrub');
  if (sc && +sc.value !== Rain.idx) sc.value = Rain.idx;
}

/* Drag the timeline: pause and jump to that radar frame */
function rainScrub(v) {
  if (Rain.playing) rainStop();
  showRainFrame(parseInt(v, 10));
}

function rainPlay() {
  if (Rain.frames.length < 2 || !navigator.onLine) return;
  Rain.playing = true;
  updateRainBtn();
  Rain.timer = setInterval(() => showRainFrame(Rain.idx + 1), RAIN_FRAME_MS);
}

function rainStop() {
  Rain.playing = false;
  clearInterval(Rain.timer);
  Rain.timer = null;
  updateRainBtn();
  if (Rain.frames.length) showRainFrame(Rain.idx);
}

function rainTogglePlay() { Rain.playing ? rainStop() : rainPlay(); }

function updateRainBtn() {
  const b = document.getElementById('rain-play');
  if (b) b.textContent = Rain.playing ? '⏸' : '▶';
}
