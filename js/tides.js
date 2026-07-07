/* Tides (NOAA CO-OPS) + Solunar bite times + sun/moon — the "Tides & Times" panel.
   Tides need internet; solunar/sun/moon are computed offline. */
'use strict';

const Tides = { stations: [], loaded: false };

async function tidesInit() {
  try { Tides.stations = await fetch('./data/tide-stations-ca.json').then((r) => r.json()); Tides.loaded = true; } catch (e) {}
}

function nearestTideStation(ll) {
  let best = null, bd = Infinity;
  Tides.stations.forEach((s) => {
    const d = (s.la - ll.lat) ** 2 + (s.lo - ll.lng) ** 2;
    if (d < bd) { bd = d; best = s; }
  });
  return best;
}

function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }

async function loadTidesTimes() {
  const ll = GPS.lastLatLng || window._map.getCenter();
  /* ---- Solunar + sun/moon (offline) ---- */
  renderSunMoonSolunar(ll);
  /* ---- Tides (online) ---- */
  const box = document.getElementById('tide-body');
  const st = Tides.stations.length ? nearestTideStation(ll) : null;
  if (!st) { box.innerHTML = '<p class="hint">No tide station data.</p>'; return; }
  document.getElementById('tide-station').textContent = st.n;
  if (!navigator.onLine) { box.innerHTML = '<p class="hint">Connect to the internet to load tide predictions.</p>'; return; }
  box.innerHTML = '<p class="hint">Loading tides…</p>';
  try {
    const now = new Date(), end = new Date(now.getTime() + 2 * 86400000);
    // hi/lo works for every station (incl. subordinate ones with no time-series)
    const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=fishapp&datum=MLLW' +
      '&time_zone=lst_ldt&units=english&format=json&product=predictions&interval=hilo&station=' + st.id +
      '&begin_date=' + ymd(now) + '&end_date=' + ymd(end);
    const hilo = await fetch(url).then((r) => r.json());
    const hl = hilo.predictions || [];
    renderTideGraph(hl);
    renderHiLo(hl);
  } catch (e) {
    box.innerHTML = '<p class="hint">Could not load tides.</p>';
  }
}

/* Build a smooth tide curve from the hi/lo points via cosine interpolation
   (the natural shape of a tide between extremes) — works for all stations. */
function renderTideGraph(hilo) {
  const box = document.getElementById('tide-body');
  if (hilo.length < 2) { box.innerHTML = '<p class="hint">No tide data.</p>'; return; }
  const ext = hilo.map((p) => ({ t: new Date(p.t.replace(' ', 'T')).getTime(), v: parseFloat(p.v) }));
  const pts = [];
  for (let i = 0; i < ext.length - 1; i++) {
    const a = ext[i], b = ext[i + 1];
    for (let k = 0; k < 24; k++) {
      const f = k / 24, t = a.t + (b.t - a.t) * f;
      const v = a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
      pts.push({ t, v });
    }
  }
  pts.push({ t: ext[ext.length - 1].t, v: ext[ext.length - 1].v });
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const W = 320, H = 90, pad = 4;
  const x = (t) => pad + (t - t0) / (t1 - t0) * (W - 2 * pad);
  const y = (v) => H - pad - (v - vmin) / (vmax - vmin || 1) * (H - 2 * pad);
  let d = 'M' + pts.map((p) => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' L');
  const nowX = x(Date.now());
  const area = d + ' L' + x(t1).toFixed(1) + ',' + (H - pad) + ' L' + x(t0).toFixed(1) + ',' + (H - pad) + ' Z';
  let marks = '';
  hilo.forEach((p) => {
    const t = new Date(p.t.replace(' ', 'T')).getTime();
    if (t < t0 || t > t1) return;
    marks += `<circle cx="${x(t).toFixed(1)}" cy="${y(parseFloat(p.v)).toFixed(1)}" r="2.5" fill="#3dd464"/>`;
  });
  box.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="tide-svg" preserveAspectRatio="none">` +
    `<path d="${area}" fill="rgba(74,163,224,0.25)"/>` +
    `<path d="${d}" fill="none" stroke="#4aa3e0" stroke-width="1.5"/>` +
    (nowX >= pad && nowX <= W - pad ? `<line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="${H}" stroke="#e8b23d" stroke-width="1" stroke-dasharray="3 2"/>` : '') +
    marks + `</svg>`;
}

function renderHiLo(hilo) {
  const box = document.getElementById('tide-hilo');
  const now = Date.now();
  box.innerHTML = hilo.slice(0, 8).map((p) => {
    const t = new Date(p.t.replace(' ', 'T'));
    const past = t.getTime() < now;
    return `<div class="tt-row${past ? ' past' : ''}"><span>${p.type === 'H' ? '⬆ High' : '⬇ Low'}</span>` +
      `<span>${fmtTime(t)}</span><span>${parseFloat(p.v).toFixed(1)} ft</span></div>`;
  }).join('');
}

function renderSunMoonSolunar(ll) {
  const now = new Date();
  const sun = Astro.sunTimes(now, ll.lat, ll.lng);
  const ill = Astro.moonIllumination(now);
  const mt = Astro.moonTimes(now, ll.lat, ll.lng);
  document.getElementById('sun-moon').innerHTML =
    `<div class="tt-row"><span>🌅 Sunrise</span><span>${fmtTime(sun.sunrise)}</span></div>` +
    `<div class="tt-row"><span>🌇 Sunset</span><span>${fmtTime(sun.sunset)}</span></div>` +
    `<div class="tt-row"><span>${Astro.moonPhaseName(ill.phase)}</span><span>${Math.round(ill.fraction * 100)}% lit</span></div>` +
    (mt.rise ? `<div class="tt-row"><span>🌙 Moonrise</span><span>${fmtTime(mt.rise)}</span></div>` : '') +
    (mt.set ? `<div class="tt-row"><span>🌙 Moonset</span><span>${fmtTime(mt.set)}</span></div>` : '');

  const periods = Astro.solunar(now, ll.lat, ll.lng);
  const nowMs = Date.now();
  document.getElementById('solunar').innerHTML = periods.map((p) => {
    const active = nowMs >= p.start && nowMs <= p.end;
    const past = p.end < nowMs;
    return `<div class="tt-row solunar-${p.type}${active ? ' active' : ''}${past ? ' past' : ''}">` +
      `<span>${p.type === 'major' ? '🎣 Major' : '🐟 Minor'}${active ? ' • NOW' : ''}</span>` +
      `<span>${fmtTime(p.start)} – ${fmtTime(p.end)}</span></div>`;
  }).join('');
}
