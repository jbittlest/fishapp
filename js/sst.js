/* Sea surface temperature overlay + multi-day time-lapse loop.
   Source: NOAA CoastWatch ERDDAP (JPL MUR SST, ~1 km daily). Unlike the fixed global
   palette, ERDDAP lets us STRETCH the colour scale to the LOCAL temperature range, so small
   breaks (1-2°F) show a big colour change. Scale is auto-centred on the local water temp.
   Rendered as a per-view image overlay (one request per day) — online only. */
'use strict';

const SST = {
  on: false,
  frames: [],       // [{ date, ov }] oldest -> newest image overlays (preloaded)
  idx: 0,
  playing: false,
  timer: null,
  range: null,      // [minC, maxC] colour scale
  palette: localStorage.getItem('fishapp.sstpal') || 'BlueWhiteRed',
  _moveTimer: null,
  _moveBound: false,
};

/* Legend bar CSS gradient per palette (cold -> warm) */
const SST_PALETTE_BAR = {
  BlueWhiteRed: 'linear-gradient(to right,#1f6fe0,#8fc9e8,#f4f4f4,#f2a03d,#d81f1f)',
  Rainbow: 'linear-gradient(to right,#3b1c8c,#2b6fe0,#23c3d8,#37d46a,#e8e23d,#f2803d,#d81f1f)',
  Ocean: 'linear-gradient(to right,#123a59,#2e6f9e,#4a90c2,#89c0de,#d3ebf7)',
  BlackRedWhite: 'linear-gradient(to right,#4a0000,#a80f0f,#e81f1f,#f4a0a0,#ffe6e6)',
};

const SST_LOOP_DAYS = 5;
const SST_LAG_DAYS = 2;    // ERDDAP MUR is ~1-2 days behind; 2 is safe
const SST_FRAME_MS = 800;
const C_TO_F = (c) => c * 9 / 5 + 32;

function sstDate(back) {
  const d = new Date(Date.now() - (back != null ? back : SST_LAG_DAYS) * 86400000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

async function sstEnable(on) {
  SST.on = on;
  const legend = document.getElementById('sst-legend');
  if (on) {
    if (!navigator.onLine) { toast('SST needs internet'); document.getElementById('ovl-sst').checked = false; return; }
    await sstDetermineRange();
    buildSstFrames();
    if (legend) legend.classList.remove('hidden');
    sstUpdateLegend();
    showFrame(SST.frames.length - 1);   // latest, static
    sstStop();
    if (!SST._moveBound) {
      window._map.on('moveend', () => {
        if (!SST.on) return;
        clearTimeout(SST._moveTimer);
        SST._moveTimer = setTimeout(() => { sstDetermineRange().then(() => { buildSstFrames(); sstUpdateLegend(); showFrame(SST.frames.length - 1); }); }, 1100);
      });
      SST._moveBound = true;
    }
  } else {
    sstStop();
    SST.frames.forEach((f) => window._map.removeLayer(f.ov));
    SST.frames = [];
    if (legend) legend.classList.add('hidden');
  }
}

/* Stretch the colour scale to the ACTUAL min/max water temp in view, so the full rainbow
   (blue→red) maps to exactly the temps present — maximum colour difference per degree.
   Samples a grid of points via Open-Meteo (CORS-ok; ERDDAP's own data fetch is CORS-blocked). */
async function sstDetermineRange() {
  const b = window._map.getBounds();
  const nLat = 5, nLon = 6;
  const lats = [], lons = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const lat = b.getSouth() + (b.getNorth() - b.getSouth()) * (i + 0.5) / nLat;
      const lon = b.getWest() + (b.getEast() - b.getWest()) * (j + 0.5) / nLon;
      lats.push(lat.toFixed(3));
      lons.push((((lon + 540) % 360) - 180).toFixed(3));
    }
  }
  try {
    let d = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') + '&current=sea_surface_temperature').then((r) => r.json());
    if (!Array.isArray(d)) d = [d];
    const vals = d.map((x) => x.current && x.current.sea_surface_temperature)
      .filter((v) => v != null && !isNaN(v)).sort((a, x) => a - x);
    if (vals.length >= 3) {
      // 10th–90th percentile: clip the coldest/warmest outlier corners so the MAIN water
      // body spans the full blue→red rainbow (max colour contrast where you're fishing)
      const lo = vals[Math.floor(vals.length * 0.10)];
      const hi = vals[Math.ceil(vals.length * 0.90) - 1];
      if (hi - lo >= 0.4) { SST.range = [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10]; return; }
      const mid = (lo + hi) / 2; SST.range = [Math.round((mid - 0.5) * 10) / 10, Math.round((mid + 0.5) * 10) / 10]; return;
    }
  } catch (e) { /* fall through */ }
  SST.range = [13, 23];   // fallback °C
}

function sstImgUrl(date) {
  const b = window._map.getBounds();
  const w = Math.min(1100, Math.max(500, window._map.getSize().x));
  const h = Math.max(1, Math.round(w * (b.getNorth() - b.getSouth()) / (b.getEast() - b.getWest())));
  // griddap .transparentPng honours .colorBar (palette + range); WMS ignores the palette.
  const q = 'analysed_sst%5B(' + date + 'T09:00:00Z)%5D' +
    '%5B(' + b.getSouth().toFixed(4) + '):(' + b.getNorth().toFixed(4) + ')%5D' +
    '%5B(' + b.getWest().toFixed(4) + '):(' + b.getEast().toFixed(4) + ')%5D';
  const cb = encodeURIComponent(SST.palette + '|C|Linear|' + SST.range[0] + '|' + SST.range[1] + '|');
  return 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.transparentPng?' + q +
    '&.size=' + w + '|' + h + '&.colorBar=' + cb;
}

function buildSstFrames() {
  sstStop();
  SST.frames.forEach((f) => window._map.removeLayer(f.ov));
  SST.frames = [];
  const b = window._map.getBounds();
  const bounds = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
  for (let d = SST_LAG_DAYS + SST_LOOP_DAYS - 1; d >= SST_LAG_DAYS; d--) {
    const date = sstDate(d);
    const ov = L.imageOverlay(sstImgUrl(date), bounds, { opacity: 0, interactive: false });
    ov.addTo(window._map);
    SST.frames.push({ date, ov });
  }
}

function showFrame(i) {
  if (!SST.frames.length) return;
  SST.idx = ((i % SST.frames.length) + SST.frames.length) % SST.frames.length;
  SST.frames.forEach((f, j) => f.ov.setOpacity(j === SST.idx ? 0.75 : 0));
  const el = document.getElementById('sst-date');
  if (el) el.textContent = SST.frames[SST.idx].date + (SST.playing ? ' ▸' : '');
}

function sstUpdateLegend() {
  const ends = document.querySelector('#sst-legend .sst-ends');
  if (ends && SST.range) {
    ends.innerHTML = '<span>' + Math.round(C_TO_F(SST.range[0])) + '°F</span>' +
      '<span>' + Math.round(C_TO_F(SST.range[1])) + '°F</span>';
  }
  const bar = document.querySelector('#sst-legend .sst-bar');
  if (bar) bar.style.background = SST_PALETTE_BAR[SST.palette] || SST_PALETTE_BAR.Rainbow;
  const sel = document.getElementById('sst-palette');
  if (sel && sel.value !== SST.palette) sel.value = SST.palette;
}

function sstSetPalette(name) {
  SST.palette = name;
  localStorage.setItem('fishapp.sstpal', name);
  if (!SST.on) return;
  buildSstFrames();           // re-render frames with the new palette
  sstUpdateLegend();
  showFrame(SST.frames.length - 1);
  sstStop();
}

function sstPlay() {
  if (SST.frames.length < 2 || !navigator.onLine) return;
  SST.playing = true;
  updateSstPlayBtn();
  SST.timer = setInterval(() => showFrame(SST.idx + 1), SST_FRAME_MS);
}

function sstStop() {
  SST.playing = false;
  clearInterval(SST.timer);
  SST.timer = null;
  updateSstPlayBtn();
  if (SST.frames.length) showFrame(SST.idx);
}

function sstTogglePlay() { SST.playing ? sstStop() : sstPlay(); }

function updateSstPlayBtn() {
  const btn = document.getElementById('sst-play');
  if (btn) btn.textContent = SST.playing ? '⏸ Pause' : '▶ Play ' + SST_LOOP_DAYS + '-day loop';
}
