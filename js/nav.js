/* Navigation & safety: route planner, measure tool, anchor alarm, trip stats.
   Route/measure use map taps (intercepted before tap-to-inspect when a mode is active). */
'use strict';

const Nav = {
  mode: null,                                  // 'route' | 'measure' | null
  route: { line: null, markers: [], pts: [] },
  measure: { line: null, a: null, layer: null },
  anchor: { ll: null, circle: null, marker: null, radius: 50, watching: false, alarmed: false },
  trip: { active: false, start: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null },
};

function navInit(map) {
  Nav.measure.layer = L.layerGroup().addTo(map);
  Nav.route.layerGroup = L.layerGroup().addTo(map);
}

/* Returns true if the map tap was consumed by a nav mode (so inspect should skip) */
function navHandleClick(latlng) {
  if (Nav.mode === 'route') { routeAddPoint(latlng); return true; }
  if (Nav.mode === 'measure') { measureClick(latlng); return true; }
  return false;
}

function navSetMode(mode) {
  Nav.mode = (Nav.mode === mode) ? null : mode;
  ['btn-route-add', 'btn-measure'].forEach((id) => { const b = document.getElementById(id); if (b) b.classList.remove('active'); });
  if (Nav.mode === 'route') { document.getElementById('btn-route-add').classList.add('active'); toast('Tap the map to add route points'); }
  else if (Nav.mode === 'measure') { document.getElementById('btn-measure').classList.add('active'); measureReset(); toast('Tap two points to measure'); }
}

/* ---- Route planner ---- */
function routeAddPoint(ll) {
  Nav.route.pts.push(ll);
  const m = L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#1a6fb5', fillOpacity: 1 }).addTo(Nav.route.layerGroup);
  Nav.route.markers.push(m);
  routeRedraw();
}
function routeRedraw() {
  if (Nav.route.line) Nav.route.layerGroup.removeLayer(Nav.route.line);
  if (Nav.route.pts.length >= 2) {
    Nav.route.line = L.polyline(Nav.route.pts, { color: '#1a6fb5', weight: 3, dashArray: '6 4' }).addTo(Nav.route.layerGroup);
  }
  routeStats();
}
function routeStats() {
  let nm = 0;
  for (let i = 1; i < Nav.route.pts.length; i++) nm += nmBetween(Nav.route.pts[i - 1], Nav.route.pts[i]);
  const spd = parseFloat(document.getElementById('route-speed').value) || 0;
  const gph = parseFloat(document.getElementById('route-gph').value) || 0;
  const hrs = spd > 0 ? nm / spd : 0;
  document.getElementById('route-stats').innerHTML =
    '<b>' + nm.toFixed(1) + ' nm</b>' +
    (spd > 0 ? ' · ' + fmtDur(hrs * 3600) + ' at ' + spd + ' kn' : '') +
    (spd > 0 && gph > 0 ? ' · ' + (hrs * gph).toFixed(1) + ' gal' : '');
}
function routeClear() {
  Nav.route.layerGroup.clearLayers();
  Nav.route.line = null; Nav.route.markers = []; Nav.route.pts = [];
  routeStats();
}
function routeUndo() {
  Nav.route.pts.pop();
  const m = Nav.route.markers.pop();
  if (m) Nav.route.layerGroup.removeLayer(m);
  routeRedraw();
}

/* ---- Measure ---- */
function measureReset() { Nav.measure.layer.clearLayers(); Nav.measure.a = null; document.getElementById('measure-out').textContent = ''; }
function measureClick(ll) {
  if (!Nav.measure.a) {
    Nav.measure.layer.clearLayers();
    Nav.measure.a = ll;
    L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#e8b23d', fillOpacity: 1 }).addTo(Nav.measure.layer);
  } else {
    const b = ll;
    L.circleMarker(b, { radius: 5, color: '#fff', weight: 2, fillColor: '#e8b23d', fillOpacity: 1 }).addTo(Nav.measure.layer);
    L.polyline([Nav.measure.a, b], { color: '#e8b23d', weight: 2, dashArray: '5 4' }).addTo(Nav.measure.layer);
    const nm = nmBetween(Nav.measure.a, b), brg = Math.round(bearingBetween(Nav.measure.a, b));
    document.getElementById('measure-out').innerHTML = '<b>' + nm.toFixed(2) + ' nm</b> (' + (nm * 1.15078).toFixed(2) + ' mi) · ' + brg + '°';
    Nav.measure.a = null;
  }
}

/* ---- Anchor alarm ---- */
function anchorDrop() {
  const ll = GPS.lastLatLng;
  if (!ll) { toast('No GPS fix yet'); return; }
  anchorRaise();
  Nav.anchor.ll = ll;
  Nav.anchor.radius = parseInt(document.getElementById('anchor-radius').value, 10) || 50;
  Nav.anchor.circle = L.circle(ll, { radius: Nav.anchor.radius, color: '#e8453d', weight: 2, fillColor: '#e8453d', fillOpacity: 0.1 }).addTo(window._map);
  Nav.anchor.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">⚓</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(window._map);
  Nav.anchor.watching = true; Nav.anchor.alarmed = false;
  updateAnchorUi();
  toast('⚓ Anchor watch on (' + Nav.anchor.radius + ' m)');
}
function anchorRaise() {
  if (Nav.anchor.circle) window._map.removeLayer(Nav.anchor.circle);
  if (Nav.anchor.marker) window._map.removeLayer(Nav.anchor.marker);
  Nav.anchor.circle = Nav.anchor.marker = Nav.anchor.ll = null;
  Nav.anchor.watching = false; Nav.anchor.alarmed = false;
  updateAnchorUi();
}
function updateAnchorUi() {
  const btn = document.getElementById('btn-anchor');
  if (btn) btn.textContent = Nav.anchor.watching ? '⚓ Raise anchor / stop watch' : '⚓ Drop anchor here';
  const s = document.getElementById('anchor-status');
  if (s) s.textContent = Nav.anchor.watching ? 'Watching — alarm if you drift past ' + Nav.anchor.radius + ' m' : '';
}
function anchorToggle() { Nav.anchor.watching ? anchorRaise() : anchorDrop(); }

/* ---- Trip stats ---- */
function tripToggle() {
  if (Nav.trip.active) { Nav.trip.active = false; }
  else { Nav.trip = { active: true, start: Date.now(), dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: GPS.lastLatLng }; }
  updateTripUi();
}
function tripReset() { Nav.trip = { active: false, start: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null }; updateTripUi(); }
function updateTripUi() {
  const btn = document.getElementById('btn-trip');
  if (btn) btn.textContent = Nav.trip.active ? '⏸ Pause trip' : (Nav.trip.start ? '▶ Resume trip' : '▶ Start trip');
  const out = document.getElementById('trip-stats');
  if (!out) return;
  const t = Nav.trip;
  const dur = t.start ? (t.active ? Date.now() - t.start : t._pausedAt || Date.now() - t.start) : 0;
  out.innerHTML = '<div class="tt-row"><span>Distance</span><span><b>' + t.dist.toFixed(2) + ' nm</b></span></div>' +
    '<div class="tt-row"><span>Time</span><span>' + fmtDur(dur / 1000) + '</span></div>' +
    '<div class="tt-row"><span>Max speed</span><span>' + t.maxKn.toFixed(1) + ' kn</span></div>' +
    '<div class="tt-row"><span>Avg speed</span><span>' + (t.nKn ? (t.sumKn / t.nKn).toFixed(1) : '0.0') + ' kn</span></div>';
}

/* Fed from gps.js on every fix */
function navOnFix(ll, kn) {
  // trip accumulation
  if (Nav.trip.active) {
    if (Nav.trip.lastLL) Nav.trip.dist += nmBetween(Nav.trip.lastLL, ll);
    Nav.trip.lastLL = ll;
    if (kn != null) { Nav.trip.maxKn = Math.max(Nav.trip.maxKn, kn); Nav.trip.sumKn += kn; Nav.trip.nKn++; }
    if (!document.getElementById('panel-tools').classList.contains('hidden')) updateTripUi();
  }
  // anchor drift alarm
  if (Nav.anchor.watching && Nav.anchor.ll) {
    const dist = ll.distanceTo(Nav.anchor.ll);
    if (dist > Nav.anchor.radius && !Nav.anchor.alarmed) {
      Nav.anchor.alarmed = true;
      anchorAlarm(Math.round(dist));
    } else if (dist <= Nav.anchor.radius) {
      Nav.anchor.alarmed = false;
    }
  }
}

function anchorAlarm(dist) {
  toast('⚠️ ANCHOR DRAGGING — ' + dist + ' m from anchor!');
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.5, 1].forEach((dt) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + dt);
      g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + dt + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dt + 0.35);
      o.start(ac.currentTime + dt); o.stop(ac.currentTime + dt + 0.4);
    });
  } catch (e) {}
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
