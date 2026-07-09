/* Navigation & safety: route planner, measure tool, anchor alarm, trip stats.
   Route/measure use map taps (intercepted before tap-to-inspect when a mode is active). */
'use strict';

const Nav = {
  mode: null,                                  // 'route' | 'measure' | null
  route: { line: null, markers: [], pts: [] },
  measure: { line: null, a: null, layer: null },
  anchor: { ll: null, circle: null, marker: null, radiusFt: 150, watching: false, dragging: false, dismissed: false, audio: null, alarmTimer: null },
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
const FT_PER_M = 3.28084;
function anchorRadiusM() { return Nav.anchor.radiusFt / FT_PER_M; }

function anchorDrop() {
  const ll = GPS.lastLatLng;
  if (!ll) { toast('No GPS fix yet — wait for a fix, then drop'); return; }
  anchorRaise();
  Nav.anchor.ll = ll;
  Nav.anchor.radiusFt = parseInt(document.getElementById('anchor-radius').value, 10) || 150;
  Nav.anchor.circle = L.circle(ll, { radius: anchorRadiusM(), color: '#e8453d', weight: 2, fillColor: '#e8453d', fillOpacity: 0.1 }).addTo(window._map);
  Nav.anchor.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">⚓</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(window._map);
  Nav.anchor.watching = true; Nav.anchor.dragging = false; Nav.anchor.dismissed = false;
  unlockAudio();          // this tap is a user gesture — unlock audio so the alarm can beep later
  requestWakeLock();      // keep the screen on so GPS keeps running (iOS suspends when locked)
  updateAnchorUi();
  toast('⚓ Anchor watch on (' + Nav.anchor.radiusFt + ' ft) — keep the app open, screen on');
}
function anchorRaise() {
  stopAnchorAlarm();
  if (Nav.anchor.circle) window._map.removeLayer(Nav.anchor.circle);
  if (Nav.anchor.marker) window._map.removeLayer(Nav.anchor.marker);
  Nav.anchor.circle = Nav.anchor.marker = Nav.anchor.ll = null;
  Nav.anchor.watching = false; Nav.anchor.dragging = false; Nav.anchor.dismissed = false;
  updateAnchorUi();
}
function updateAnchorUi() {
  const btn = document.getElementById('btn-anchor');
  if (btn) btn.textContent = Nav.anchor.watching ? '⚓ Raise anchor / stop watch' : '⚓ Drop anchor here';
  const s = document.getElementById('anchor-status');
  if (s) s.textContent = Nav.anchor.watching ? 'Watching — alarms if you drift past ' + Nav.anchor.radiusFt + ' ft' : '';
}
function anchorToggle() { Nav.anchor.watching ? anchorRaise() : anchorDrop(); }

/* Unlock the Web Audio context from a user tap (iOS blocks audio otherwise) */
function unlockAudio() {
  try {
    if (!Nav.anchor.audio) Nav.anchor.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (Nav.anchor.audio.state === 'suspended') Nav.anchor.audio.resume();
    const o = Nav.anchor.audio.createOscillator(), g = Nav.anchor.audio.createGain();
    g.gain.value = 0.0001; o.connect(g); g.connect(Nav.anchor.audio.destination);
    o.start(); o.stop(Nav.anchor.audio.currentTime + 0.02);   // silent priming blip
  } catch (e) {}
}

function startAnchorAlarm() {
  const overlay = document.getElementById('anchor-alarm');
  if (overlay) overlay.classList.remove('hidden');
  anchorBeep();
  clearInterval(Nav.anchor.alarmTimer);
  Nav.anchor.alarmTimer = setInterval(anchorBeep, 2000);   // repeat until dismissed / back in circle
}
function stopAnchorAlarm() {
  clearInterval(Nav.anchor.alarmTimer);
  Nav.anchor.alarmTimer = null;
  const overlay = document.getElementById('anchor-alarm');
  if (overlay) overlay.classList.add('hidden');
}
function anchorDismissAlarm() {   // silence but keep watching
  stopAnchorAlarm();
  Nav.anchor.dragging = false;
  Nav.anchor.dismissed = true;
}
function anchorBeep() {
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);   // no-op on iOS, works on Android
  const ac = Nav.anchor.audio;
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  [0, 0.45, 0.9].forEach((dt) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 920; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, ac.currentTime + dt);
    g.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + dt + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dt + 0.4);
    o.start(ac.currentTime + dt); o.stop(ac.currentTime + dt + 0.42);
  });
}

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
  // live "Go To" navigation guidance
  if (typeof gotoOnFix === 'function') gotoOnFix(ll, kn);
  // anchor drift alarm
  if (Nav.anchor.watching && Nav.anchor.ll) {
    const distFt = Math.round(ll.distanceTo(Nav.anchor.ll) * FT_PER_M);
    if (distFt > Nav.anchor.radiusFt) {
      if (!Nav.anchor.dragging && !Nav.anchor.dismissed) { Nav.anchor.dragging = true; startAnchorAlarm(); }
      const el = document.getElementById('aa-dist');
      if (el) el.textContent = distFt + ' ft from anchor (limit ' + Nav.anchor.radiusFt + ' ft)';
    } else {
      Nav.anchor.dismissed = false;
      if (Nav.anchor.dragging) { Nav.anchor.dragging = false; stopAnchorAlarm(); }
    }
  }
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
