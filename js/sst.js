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
  _moveTimer: null,
  _moveBound: false,
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

/* Centre the colour scale on the local water temp for maximum sensitivity */
async function sstDetermineRange() {
  const c = window._map.getCenter();
  try {
    const d = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' +
      c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) + '&current=sea_surface_temperature').then((r) => r.json());
    const t = d.current && d.current.sea_surface_temperature;
    if (t != null && !isNaN(t)) { SST.range = [Math.round(t) - 4, Math.round(t) + 4]; return; }
  } catch (e) { /* fall through */ }
  SST.range = [13, 23];   // fallback °C
}

function sstImgUrl(date) {
  const b = window._map.getBounds();
  const w = Math.min(1100, Math.max(500, window._map.getSize().x));
  const h = Math.max(1, Math.round(w * (b.getNorth() - b.getSouth()) / (b.getEast() - b.getWest())));
  return 'https://coastwatch.pfeg.noaa.gov/erddap/wms/jplMURSST41/request?service=WMS&version=1.3.0&request=GetMap' +
    '&layers=jplMURSST41:analysed_sst&styles=&crs=CRS:84' +
    '&bbox=' + b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth() +
    '&width=' + w + '&height=' + h + '&format=image/png&transparent=true' +
    '&colorBarMinimum=' + SST.range[0] + '&colorBarMaximum=' + SST.range[1] + '&colorBarPalette=Rainbow' +
    '&time=' + date;
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
