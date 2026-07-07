/* Weather: Windy-style wind arrow overlay + forecast panel (Open-Meteo, free, no key) */
'use strict';

const WX = {
  overlayOn: false,
  layer: null,          // L.layerGroup of wind arrows
  _moveTimer: null,
  _lastPanelData: null,
};

const MS_TO_FT = 3.28084;

function wxInit(map) {
  WX.layer = L.layerGroup();
  map.on('moveend zoomend', () => {
    if (!WX.overlayOn || WX.playing) return;   // don't clobber an active forecast loop
    clearTimeout(WX._moveTimer);
    WX._moveTimer = setTimeout(refreshWindOverlay, 900);
  });
}

function windOverlayEnable(on) {
  WX.overlayOn = on;
  const bar = document.getElementById('wind-bar');
  if (on) {
    WX.layer.addTo(window._map);
    refreshWindOverlay();
    if (bar) bar.classList.remove('hidden');
  } else {
    windLoopStop(true);   // silent (don't redraw current)
    window._map.removeLayer(WX.layer);
    if (bar) bar.classList.add('hidden');
  }
}

/* ---- Wind forecast loop: animate the arrows through the next 24 h ---- */
const WIND_LOOP_HOURS = 24;
const WIND_FRAME_MS = 650;

async function windLoopBuild() {
  const map = window._map, size = map.getSize(), step = 95;
  const lats = [], lons = [], pts = [];
  for (let px = step / 2; px < size.x; px += step) {
    for (let py = step / 2 + 40; py < size.y; py += step) {
      const ll = map.containerPointToLatLng([px, py]);
      if (Math.abs(ll.lat) > 80) continue;
      lats.push(ll.lat.toFixed(3));
      lons.push(((ll.lng + 540) % 360 - 180).toFixed(3));
      pts.push(ll);
    }
  }
  if (!pts.length) return false;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') +
    '&longitude=' + lons.join(',') +
    '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=2&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error('http ' + r.status);
  let data = await r.json();
  if (!Array.isArray(data)) data = [data];
  WX.pts = pts;
  WX.frames = data;
  WX.times = (data[0] && data[0].hourly) ? data[0].hourly.time : [];
  const now = Date.now();
  WX.startIdx = Math.max(0, WX.times.findIndex((t) => new Date(t).getTime() >= now - 3600000));
  return true;
}

function windShowHour(offset) {
  if (!WX.frames) return;
  WX.idx = offset;
  const i = WX.startIdx + offset;
  WX.layer.clearLayers();
  WX.frames.forEach((d, p) => {
    const h = d.hourly;
    if (!h || h.wind_speed_10m[i] == null) return;
    L.marker(WX.pts[p], {
      icon: windArrowIcon(h.wind_speed_10m[i], h.wind_direction_10m[i]),
      interactive: false, keyboard: false,
    }).addTo(WX.layer);
  });
  const el = document.getElementById('wind-time');
  if (el && WX.times[i]) {
    el.textContent = new Date(WX.times[i]).toLocaleString([], { weekday: 'short', hour: 'numeric' }) +
      (WX.playing ? ' ▸' : '');
  }
}

async function windLoopToggle() {
  if (WX.playing) { windLoopStop(); return; }
  if (!navigator.onLine) { toast('Wind loop needs internet'); return; }
  if (!WX.overlayOn) {
    document.getElementById('ovl-wind').checked = true;
    document.getElementById('ovl-wind').dispatchEvent(new Event('change'));
  }
  try {
    toast('Loading wind forecast…');
    if (!(await windLoopBuild())) return;
    WX.playing = true;
    updateWindBtn();
    windShowHour(0);
    WX.timer = setInterval(() => windShowHour((WX.idx + 1) % WIND_LOOP_HOURS), WIND_FRAME_MS);
  } catch (e) {
    toast('Could not load wind forecast');
  }
}

function windLoopStop(silent) {
  WX.playing = false;
  clearInterval(WX.timer);
  WX.timer = null;
  updateWindBtn();
  if (!silent && WX.overlayOn) refreshWindOverlay(); // back to current wind
}

function updateWindBtn() {
  const b = document.getElementById('wind-play');
  if (b) b.textContent = WX.playing ? '⏸' : '▶';
}

/* ---- Wind arrow overlay ---- */

function windColor(kn) {
  if (kn < 7) return '#4aa3e0';    // light air — blue
  if (kn < 14) return '#3dd464';   // nice breeze — green
  if (kn < 21) return '#e8c93d';   // getting sporty — yellow
  if (kn < 28) return '#f2803d';   // small craft advisory feel — orange
  return '#e8453d';                // stay home — red
}

function windArrowIcon(kn, dirFrom) {
  const rot = (dirFrom + 180) % 360; // meteo direction = FROM; arrow points where wind GOES
  const color = windColor(kn);
  const html =
    `<div style="text-align:center;pointer-events:none">` +
    `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${rot}deg)">` +
    `<path d="M17 3 L23 21 L17 17 L11 21 Z" fill="${color}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>` +
    `</svg>` +
    `<div style="font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;margin-top:-6px">${Math.round(kn)}</div>` +
    `</div>`;
  return L.divIcon({ className: '', html, iconSize: [34, 42], iconAnchor: [17, 21] });
}

async function refreshWindOverlay() {
  if (!navigator.onLine) { toast('Wind overlay needs internet'); return; }
  const map = window._map;
  const size = map.getSize();
  const step = 95; // px between arrows
  const lats = [], lons = [], pts = [];
  for (let px = step / 2; px < size.x; px += step) {
    for (let py = step / 2 + 40; py < size.y; py += step) {
      const ll = map.containerPointToLatLng([px, py]);
      if (Math.abs(ll.lat) > 80) continue;
      lats.push(ll.lat.toFixed(3));
      lons.push(((ll.lng + 540) % 360 - 180).toFixed(3));
      pts.push(ll);
    }
  }
  if (!pts.length) return;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') +
      '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn';
    const r = await fetch(url);
    if (!r.ok) throw new Error('http ' + r.status);
    let data = await r.json();
    if (!Array.isArray(data)) data = [data];
    WX.layer.clearLayers();
    data.forEach((d, i) => {
      if (!d.current || d.current.wind_speed_10m === null) return;
      const kn = d.current.wind_speed_10m;
      L.marker(pts[i], {
        icon: windArrowIcon(kn, d.current.wind_direction_10m),
        interactive: false,
        keyboard: false,
      }).addTo(WX.layer);
    });
  } catch (e) {
    toast('Could not load wind data');
  }
}

/* ---- Forecast panel ---- */

async function loadWeatherPanel() {
  const ll = GPS.lastLatLng || window._map.getCenter();
  const locEl = document.getElementById('wx-loc');
  const curEl = document.getElementById('wx-current');
  const hrEl = document.getElementById('wx-hourly');
  const staleEl = document.getElementById('wx-stale');
  locEl.textContent = (GPS.lastLatLng ? 'At your position — ' : 'At map center — ') +
    formatCoord(ll.lat, 'lat') + ' ' + formatCoord(ll.lng, 'lon');

  let data = null;
  if (navigator.onLine) {
    curEl.innerHTML = '<p class="hint">Loading forecast…</p>';
    hrEl.innerHTML = '';
    try {
      const common = 'latitude=' + ll.lat.toFixed(3) + '&longitude=' + ll.lng.toFixed(3) +
        '&timezone=auto&forecast_days=2';
      const [wx, marine] = await Promise.all([
        fetch('https://api.open-meteo.com/v1/forecast?' + common +
          '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m' +
          '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation_probability' +
          '&wind_speed_unit=kn&temperature_unit=fahrenheit').then((r) => r.json()),
        fetch('https://marine-api.open-meteo.com/v1/marine?' + common +
          '&current=wave_height,wave_direction,wave_period' +
          '&hourly=wave_height,wave_period').then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      data = { wx, marine: marine && !marine.error ? marine : null, ts: Date.now(), lat: ll.lat, lng: ll.lng };
      localStorage.setItem('fishapp.lastwx', JSON.stringify(data));
    } catch (e) { /* fall through to cache */ }
  }
  if (!data) {
    data = JSON.parse(localStorage.getItem('fishapp.lastwx') || 'null');
    if (!data) {
      curEl.innerHTML = '<p class="hint">No internet and no saved forecast yet. Open this panel once while online.</p>';
      hrEl.innerHTML = '';
      staleEl.textContent = '';
      return;
    }
  }
  renderWeather(data);
}

function dirArrow(deg) {
  // arrow showing where the wind blows TOWARD
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round(((deg % 360) / 45)) % 8];
}
function compass(deg) {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round(((deg % 360) / 45)) % 8];
}

function renderWeather(data) {
  const curEl = document.getElementById('wx-current');
  const hrEl = document.getElementById('wx-hourly');
  const staleEl = document.getElementById('wx-stale');
  const c = data.wx.current;
  const mc = data.marine && data.marine.current;

  let cards =
    card('WIND', Math.round(c.wind_speed_10m) + '<small> kn</small>',
      compass(c.wind_direction_10m) + ' ' + dirArrow(c.wind_direction_10m), windColor(c.wind_speed_10m)) +
    card('GUSTS', Math.round(c.wind_gusts_10m) + '<small> kn</small>', '', windColor(c.wind_gusts_10m));
  if (mc && mc.wave_height !== null) {
    cards += card('WAVES', (mc.wave_height * MS_TO_FT).toFixed(1) + '<small> ft</small>',
      '@ ' + Math.round(mc.wave_period) + 's ' + compass(mc.wave_direction), '#4aa3e0');
  }
  cards += card('TEMP', Math.round(c.temperature_2m) + '<small>°F</small>', '', '#e8f1f8');
  curEl.innerHTML = '<div class="wx-cards">' + cards + '</div>';

  /* Hourly: next 24 h from now */
  const h = data.wx.hourly;
  const mh = data.marine && data.marine.hourly;
  const now = Date.now();
  let rows = '';
  for (let i = 0; i < h.time.length && rows.split('wx-row').length <= 24; i++) {
    const t = new Date(h.time[i]).getTime();
    if (t < now - 3600000) continue;
    const hr = new Date(t).toLocaleTimeString([], { hour: 'numeric' });
    const kn = h.wind_speed_10m[i];
    let wave = '';
    if (mh && mh.wave_height[i] !== null && mh.wave_height[i] !== undefined) {
      wave = (mh.wave_height[i] * MS_TO_FT).toFixed(1) + ' ft';
    }
    const rain = h.precipitation_probability ? h.precipitation_probability[i] : null;
    rows += `<div class="wx-row">
      <span class="wx-t">${hr}</span>
      <span class="wx-w" style="color:${windColor(kn)}">${dirArrow(h.wind_direction_10m[i])} ${Math.round(kn)} kn</span>
      <span class="wx-g">G ${Math.round(h.wind_gusts_10m[i])}</span>
      <span class="wx-wv">${wave}</span>
      <span class="wx-r">${rain !== null && rain !== undefined ? rain + '%' : ''}</span>
      <span class="wx-tp">${Math.round(h.temperature_2m[i])}°</span>
    </div>`;
  }
  hrEl.innerHTML = rows;

  const ageMin = Math.round((Date.now() - data.ts) / 60000);
  staleEl.textContent = ageMin > 10
    ? '⚠️ Saved forecast from ' + (ageMin > 120 ? Math.round(ageMin / 60) + ' hours' : ageMin + ' min') + ' ago (offline)'
    : 'Forecast: Open-Meteo · updated just now';
}

function card(label, big, sub, color) {
  return `<div class="wx-card"><div class="wx-lbl">${label}</div>` +
    `<div class="wx-big" style="color:${color}">${big}</div>` +
    `<div class="wx-sub">${sub}</div></div>`;
}
