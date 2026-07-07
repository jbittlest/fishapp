/* Sea surface temperature overlay + multi-day time-lapse loop
   (NASA GIBS / GHRSST MUR, ~1 km daily). Online-only: date-specific tiles, so not part
   of offline downloads. Use it to SEE temperature breaks and how they move day to day;
   tap anywhere for the exact °F. */
'use strict';

const SST = {
  on: false,
  frames: [],       // [{ date, layer }] oldest -> newest, one tile layer per day (preloaded)
  idx: 0,
  playing: false,
  timer: null,
};

const SST_LOOP_DAYS = 5;   // number of days in the loop
const SST_LAG_DAYS = 2;    // MUR analysis lags ~2 days
const SST_FRAME_MS = 800;  // playback speed

/* UTC date string N days ago, YYYY-MM-DD */
function sstDate(daysBack) {
  const d = new Date(Date.now() - (daysBack != null ? daysBack : SST_LAG_DAYS) * 86400000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function sstLayerFor(date) {
  return L.tileLayer(
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/' +
    date + '/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
    { maxNativeZoom: 7, maxZoom: 20, opacity: 0, attribution: 'NASA GIBS · GHRSST MUR SST', className: 'sst-tiles' }
  );
}

function sstEnable(on) {
  SST.on = on;
  const legend = document.getElementById('sst-legend');
  if (on) {
    if (!navigator.onLine) toast('SST overlay needs internet');
    buildSstFrames();               // preloads all days' tiles
    if (legend) legend.classList.remove('hidden');
    showFrame(SST.frames.length - 1); // show most recent, static
    sstStop();
  } else {
    sstStop();
    SST.frames.forEach((f) => window._map.removeLayer(f.layer));
    SST.frames = [];
    if (legend) legend.classList.add('hidden');
  }
}

function buildSstFrames() {
  sstStop();
  SST.frames.forEach((f) => window._map.removeLayer(f.layer));
  SST.frames = [];
  // oldest -> newest so playback runs forward in time, then loops
  for (let d = SST_LAG_DAYS + SST_LOOP_DAYS - 1; d >= SST_LAG_DAYS; d--) {
    const date = sstDate(d);
    const layer = sstLayerFor(date).addTo(window._map);
    layer.setZIndex(4);
    SST.frames.push({ date, layer });
  }
}

function showFrame(i) {
  if (!SST.frames.length) return;
  SST.idx = ((i % SST.frames.length) + SST.frames.length) % SST.frames.length;
  SST.frames.forEach((f, j) => f.layer.setOpacity(j === SST.idx ? 0.72 : 0));
  const el = document.getElementById('sst-date');
  if (el) el.textContent = SST.frames[SST.idx].date + (SST.playing ? ' ▸' : '');
}

function sstPlay() {
  if (SST.frames.length < 2 || !navigator.onLine) { if (!navigator.onLine) toast('Loop needs internet'); return; }
  SST.playing = true;
  updateSstPlayBtn();
  SST.timer = setInterval(() => showFrame(SST.idx + 1), SST_FRAME_MS);
}

function sstStop() {
  SST.playing = false;
  clearInterval(SST.timer);
  SST.timer = null;
  updateSstPlayBtn();
  if (SST.frames.length) showFrame(SST.idx); // refresh label (drop the ▸)
}

function sstTogglePlay() { SST.playing ? sstStop() : sstPlay(); }

function updateSstPlayBtn() {
  const btn = document.getElementById('sst-play');
  if (btn) btn.textContent = SST.playing ? '⏸ Pause' : '▶ Play ' + SST_LOOP_DAYS + '-day loop';
}
