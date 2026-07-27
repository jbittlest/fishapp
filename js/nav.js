/* Navigation & safety: route planner, measure tool, anchor alarm, trip stats.
   Route/measure use map taps (intercepted before tap-to-inspect when a mode is active). */
'use strict';

const Nav = {
  mode: null,                                  // 'route' | 'measure' | null
  route: { line: null, markers: [], pts: [], legLayer: null },
  measure: { line: null, a: null, layer: null },
  anchor: { ll: null, circle: null, marker: null, radiusFt: 150, watching: false, dragging: false,
    snoozeUntil: 0, snoozeFt: 0, blind: false, outCount: 0, audio: null, alarmTimer: null },
  trip: { active: false, start: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null },
};

function navInit(map) {
  Nav.measure.layer = L.layerGroup().addTo(map);
  Nav.route.layerGroup = L.layerGroup().addTo(map);
  Nav.route.legLayer = L.layerGroup().addTo(map);   // per-leg distance labels (redrawn each change)
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
  if (Nav.mode === 'route') { document.getElementById('btn-route-add').classList.add('active'); toast('Tap the map to drop your first navigation point'); }
  else if (Nav.mode === 'measure') { document.getElementById('btn-measure').classList.add('active'); measureReset(); toast('Tap two points to measure'); }
}

/* ---- Route planner ----
   Tap to drop numbered waypoints; consecutive points connect into a route. Each
   point is draggable (nudge the line around an island), and every leg shows its
   own distance both on the map and in the panel breakdown. */
function routeIcon(n) {
  return L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    html: '<div class="route-pt">' + n + '</div>' });
}
function routeAddPoint(ll) {
  Nav.route.pts.push(ll);
  const m = L.marker(ll, { draggable: true, icon: routeIcon(Nav.route.pts.length), zIndexOffset: 1000 })
    .addTo(Nav.route.layerGroup);
  m.on('drag', () => { const i = Nav.route.markers.indexOf(m); if (i >= 0) { Nav.route.pts[i] = m.getLatLng(); routeRedraw(); } });
  Nav.route.markers.push(m);
  routeRedraw();
  // Walk the user through building the route, one tap at a time.
  const n = Nav.route.pts.length;
  if (typeof toast === 'function') {
    toast(n === 1
      ? '📍 Navigation point 1 dropped — click another point on the map to make a route'
      : '📍 Point ' + n + ' added — keep tapping to extend, or press ▶ Start route');
  }
}
/* Turn the planned points into a live navigation line you can follow. */
function routeStart() {
  if (Nav.route.pts.length < 2) {
    if (typeof toast === 'function') toast('Drop at least 2 points first — tap ➕ Add points, then tap the map');
    return;
  }
  if (Nav.mode === 'route') navSetMode('route');          // leave add-points mode
  if (typeof closePanels === 'function') closePanels();   // get the panel out of the way
  if (typeof gotoStartRoute === 'function') gotoStartRoute(Nav.route.pts);
  /* Take the planning line down. gotoStartRoute copies the points, so leaving the
     draggable blue planner on the map let you drag a waypoint clear of a shoal,
     watch the blue line move, and still be steered over the shoal by the green one. */
  routeClear();
}
function routeRedraw() {
  // route line
  if (Nav.route.line) Nav.route.layerGroup.removeLayer(Nav.route.line);
  Nav.route.line = null;
  if (Nav.route.pts.length >= 2) {
    Nav.route.line = L.polyline(Nav.route.pts, { color: '#1a6fb5', weight: 3, dashArray: '6 4' }).addTo(Nav.route.layerGroup);
  }
  // Note: markers keep their creation number (append gets the next number, undo
  // removes the last) so we must NOT setIcon() here — doing so mid-drag would
  // rebuild the dragged marker's DOM element and cancel the drag.
  Nav.route.legLayer.clearLayers();
  for (let i = 1; i < Nav.route.pts.length; i++) {
    const a = Nav.route.pts[i - 1], b = Nav.route.pts[i];
    const nm = nmBetween(a, b);
    const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
    L.marker(mid, { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0],
      html: '<div class="route-leg">' + nm.toFixed(1) + ' nm</div>' }) }).addTo(Nav.route.legLayer);
  }
  routeStats();
}
function routeStats() {
  const out = document.getElementById('route-stats');
  if (!out) return;
  const pts = Nav.route.pts;
  const startBtn = document.getElementById('btn-route-start');
  if (startBtn) startBtn.disabled = pts.length < 2;
  if (pts.length < 2) {
    out.innerHTML = pts.length === 1
      ? 'Navigation point 1 dropped — click another point on the map to make a route.'
      : 'Tap “➕ Add points”, then click the map to drop navigation points. Each leg shows its distance; drag a point to adjust.';
    return;
  }
  const spd = parseFloat(document.getElementById('route-speed').value) || 0;
  const gph = parseFloat(document.getElementById('route-gph').value) || 0;
  let total = 0;
  const legs = [];
  for (let i = 1; i < pts.length; i++) {
    const nm = nmBetween(pts[i - 1], pts[i]);
    total += nm;
    legs.push('<div class="rt-leg"><span>Leg ' + i + '→' + (i + 1) + '</span>' +
      '<span>' + nm.toFixed(2) + ' nm · ' + Math.round(bearingBetween(pts[i - 1], pts[i])) + '°</span></div>');
  }
  const hrs = spd > 0 ? total / spd : 0;
  out.innerHTML =
    '<div class="rt-total"><b>' + total.toFixed(1) + ' nm</b> total' +
    (spd > 0 ? ' · ' + fmtDur(hrs * 3600) + ' at ' + spd + ' kn' : '') +
    (spd > 0 && gph > 0 ? ' · ' + (hrs * gph).toFixed(1) + ' gal' : '') +
    ' · ' + pts.length + ' points</div>' +
    legs.join('') +
    '<div class="hint" style="margin-top:6px">Press ▶ Start route to follow it — you\'ll get a green course line, steer bearing and ETA, advancing waypoint to waypoint.</div>';
}
function routeClear() {
  Nav.route.layerGroup.clearLayers();
  Nav.route.legLayer.clearLayers();
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
  /* Dropping the anchor on an hour-old position puts the watch circle miles from
     the boat, so every fix reads "outside" — or worse, none ever does. */
  if (typeof gpsIsStale === 'function' && gpsIsStale()) {
    toast('GPS is stale — wait for a fresh fix before dropping the anchor watch'); return;
  }
  if (typeof GPS !== 'undefined' && GPS.coarse) {
    toast('GPS is only ±' + Math.round(GPS.accuracy || 0) + 'm right now — wait for a tighter fix'); return;
  }
  anchorRaise();
  Nav.anchor.ll = ll;
  Nav.anchor.radiusFt = anchorReadRadius();
  Nav.anchor.circle = L.circle(ll, { radius: anchorRadiusM(), color: '#e8453d', weight: 2, fillColor: '#e8453d', fillOpacity: 0.1 }).addTo(window._map);
  Nav.anchor.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">⚓</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(window._map);
  Nav.anchor.watching = true; Nav.anchor.dragging = false;
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.blind = false; Nav.anchor.outCount = 0;
  unlockAudio();          // this tap is a user gesture — unlock audio so the alarm can beep later
  requestWakeLock();      // keep the screen on so GPS keeps running (iOS suspends when locked)
  /* Same gesture starts the background keep-alive and asks for notification
     permission, so the alarm can still reach you if the app isn't in front. */
  if (typeof awakeAcquire === 'function') awakeAcquire('anchor');
  if (typeof awakeAskNotify === 'function') awakeAskNotify();
  anchorPersist();
  updateAnchorUi();
  toast('⚓ Anchor watch on (' + Nav.anchor.radiusFt + ' ft) — keep the app open, screen on');
}
function anchorReadRadius() {
  const el = document.getElementById('anchor-radius');
  const v = el ? parseInt(el.value, 10) : NaN;
  return (isFinite(v) && v > 0) ? v : 150;
}
function anchorRaise() {
  stopAnchorAlarm();
  if (Nav.anchor.circle) window._map.removeLayer(Nav.anchor.circle);
  if (Nav.anchor.marker) window._map.removeLayer(Nav.anchor.marker);
  Nav.anchor.circle = Nav.anchor.marker = Nav.anchor.ll = null;
  Nav.anchor.watching = false; Nav.anchor.dragging = false;
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.blind = false; Nav.anchor.outCount = 0;
  if (typeof awakeRelease === 'function') awakeRelease('anchor');
  anchorPersist();
  updateAnchorUi();
}

/* The watch is the one feature people go to sleep trusting, so it must not live
   only in memory — a reload, a tab eviction or an OS kill would silently end it
   with the boat still swinging. */
function anchorPersist() {
  try {
    if (Nav.anchor.watching && Nav.anchor.ll) {
      localStorage.setItem('fishapp.anchor', JSON.stringify({
        lat: Nav.anchor.ll.lat, lng: Nav.anchor.ll.lng, radiusFt: Nav.anchor.radiusFt, ts: Date.now(),
      }));
    } else localStorage.removeItem('fishapp.anchor');
  } catch (e) {}
}
function anchorRestore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('fishapp.anchor') || 'null'); } catch (e) {}
  if (!s || !isFinite(s.lat) || !isFinite(s.lng)) return;
  if (Date.now() - (s.ts || 0) > 36 * 3600e3) { try { localStorage.removeItem('fishapp.anchor'); } catch (e) {} return; }
  Nav.anchor.ll = L.latLng(s.lat, s.lng);
  Nav.anchor.radiusFt = s.radiusFt || 150;
  const el = document.getElementById('anchor-radius');
  if (el) el.value = Nav.anchor.radiusFt;
  Nav.anchor.circle = L.circle(Nav.anchor.ll, { radius: anchorRadiusM(), color: '#e8453d', weight: 2, fillColor: '#e8453d', fillOpacity: 0.1 }).addTo(window._map);
  Nav.anchor.marker = L.marker(Nav.anchor.ll, { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">⚓</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(window._map);
  Nav.anchor.watching = true;
  updateAnchorUi();
  /* Audio can't be unlocked without a gesture, so grab the first one that comes
     along — and say so meanwhile, rather than let them believe a silent watch is armed. */
  const prime = () => {
    unlockAudio();
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.removeEventListener(ev, prime));
    if (typeof toast === 'function') toast('⚓ Anchor watch alarm armed');
  };
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, prime, { passive: true }));
  if (typeof toast === 'function') toast('⚓ Anchor watch restored — tap anywhere once to re-enable the alarm sound');
}

function updateAnchorUi() {
  // keep the always-visible banner in step with the panel's own status line
  if (typeof awakeUpdateUi === 'function') awakeUpdateUi();
  const btn = document.getElementById('btn-anchor');
  if (btn) btn.textContent = Nav.anchor.watching ? '⚓ Raise anchor / stop watch' : '⚓ Drop anchor here';
  const s = document.getElementById('anchor-status');
  if (!s) return;
  if (!Nav.anchor.watching) { s.textContent = ''; return; }
  if (Nav.anchor.blind) { s.textContent = '⚠️ NO GPS — the watch cannot see you drift'; return; }
  const snoozed = Nav.anchor.snoozeUntil > Date.now();
  s.textContent = 'Watching — alarms if you drift past ' + Nav.anchor.radiusFt + ' ft' +
    (snoozed ? ' · snoozed ' + Math.ceil((Nav.anchor.snoozeUntil - Date.now()) / 60000) + ' min' : '');
}
function anchorToggle() { Nav.anchor.watching ? anchorRaise() : anchorDrop(); }

/* Changing the radius mid-watch used to do nothing at all: the value was read
   only when dropping. Someone whose alarm won't stop would have to raise the
   watch entirely to widen it — leaving the boat unwatched. */
function anchorRadiusChanged() {
  if (!Nav.anchor.watching) return;
  Nav.anchor.radiusFt = anchorReadRadius();
  if (Nav.anchor.circle) Nav.anchor.circle.setRadius(anchorRadiusM());
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.outCount = 0;
  anchorPersist();
  if (Nav.anchor.ll && GPS.lastLatLng) navAnchorEvaluate(GPS.lastLatLng);
  updateAnchorUi();
}

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
  /* Push it outside the app too. An on-screen overlay is no use if the phone is
     face-down on the chart table with another app in front. */
  if (typeof awakeNotify === 'function') {
    awakeNotify(Nav.anchor.blind ? '⚠️ Anchor watch blind' : '⚠️ ANCHOR DRAGGING',
      Nav.anchor.blind
        ? 'No GPS fix — the watch cannot see whether you are moving. Open FishApp.'
        : 'You have drifted past the ' + Nav.anchor.radiusFt + ' ft watch circle.');
  }
}
function stopAnchorAlarm() {
  clearInterval(Nav.anchor.alarmTimer);
  Nav.anchor.alarmTimer = null;
  const overlay = document.getElementById('anchor-alarm');
  if (overlay) overlay.classList.add('hidden');
}
/* Silence for a while — NOT forever. This used to set a `dismissed` latch that was
   cleared only by returning inside the circle, so silencing an alarm while actually
   dragging disabled the watch for the rest of the night no matter how far you went.
   Now it re-arms on a timer, and immediately if the drift keeps growing. */
const ANCHOR_SNOOZE_MS = 5 * 60000;
const ANCHOR_REARM_GROWTH = 1.25;     // …or 25% further out, whichever comes first
function anchorDismissAlarm() {
  stopAnchorAlarm();
  Nav.anchor.dragging = false;
  Nav.anchor.outCount = 0;
  Nav.anchor.snoozeUntil = Date.now() + ANCHOR_SNOOZE_MS;
  Nav.anchor.snoozeFt = (Nav.anchor.ll && GPS.lastLatLng)
    ? Math.round(GPS.lastLatLng.distanceTo(Nav.anchor.ll) * FT_PER_M)
    : Nav.anchor.radiusFt;
  updateAnchorUi();
  if (typeof toast === 'function') toast('🔕 Alarm snoozed 5 min — it re-arms automatically, or sooner if you keep drifting');
}
/* GPS went quiet while the watch is armed. "No new fix" is indistinguishable from
   "not moving", so the watch is blind — and staying silent about that is worse
   than a false alarm. */
function navOnGpsStale() {
  if (!Nav.anchor.watching || Nav.anchor.blind) return;
  Nav.anchor.blind = true;
  updateAnchorUi();
  const el = document.getElementById('aa-dist');
  if (el) el.textContent = 'NO GPS — the anchor watch cannot see you drift';
  startAnchorAlarm();
  if (typeof toast === 'function') toast('⚠️ Anchor watch blind — no GPS fix for a minute');
}
function navOnGpsLost() { navOnGpsStale(); }
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
  const t = Nav.trip;
  if (t.active) {
    // pause: bank the elapsed active time so far, and stop accumulating
    t.accMs = (t.accMs || 0) + (Date.now() - (t.segStart || t.start));
    t.active = false;
  } else if (t.start) {
    // resume: keep the accumulated distance/time, start a fresh active segment
    t.active = true;
    t.segStart = Date.now();
    t.lastLL = GPS.lastLatLng;   // don't count distance travelled while paused
  } else {
    // start a brand-new trip
    Nav.trip = { active: true, start: Date.now(), segStart: Date.now(), accMs: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: GPS.lastLatLng };
  }
  updateTripUi();
}
function tripReset() { Nav.trip = { active: false, start: 0, segStart: 0, accMs: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null }; updateTripUi(); }
function updateTripUi() {
  const btn = document.getElementById('btn-trip');
  if (btn) btn.textContent = Nav.trip.active ? '⏸ Pause trip' : (Nav.trip.start ? '▶ Resume trip' : '▶ Start trip');
  const out = document.getElementById('trip-stats');
  if (!out) return;
  const t = Nav.trip;
  const dur = (t.accMs || 0) + (t.active ? Date.now() - (t.segStart || t.start) : 0);
  out.innerHTML = '<div class="tt-row"><span>Distance</span><span><b>' + t.dist.toFixed(2) + ' nm</b></span></div>' +
    '<div class="tt-row"><span>Time</span><span>' + fmtDur(dur / 1000) + '</span></div>' +
    '<div class="tt-row"><span>Max speed</span><span>' + t.maxKn.toFixed(1) + ' kn</span></div>' +
    '<div class="tt-row"><span>Avg speed</span><span>' + (t.nKn ? (t.sumKn / t.nKn).toFixed(1) : '0.0') + ' kn</span></div>';
}

/* Fed from gps.js on every fix */
function navOnFix(ll, kn) {
  /* The anchor alarm goes FIRST and in its own try. It used to run last, so a throw
     anywhere in the trip or Go To blocks above would skip the drift check entirely. */
  try { navAnchorEvaluate(ll); } catch (e) {}

  // trip accumulation
  if (Nav.trip.active) {
    /* Only count real movement. Adding every raw inter-fix delta meant a boat sitting
       on a spot for three hours accumulated miles of pure GPS noise. */
    if (Nav.trip.lastLL) {
      const m = Nav.trip.lastLL.distanceTo(ll);
      const moving = (kn == null) ? m >= NAV_MIN_MOVE_M : (kn > 0.5 && m >= NAV_MIN_MOVE_M);
      if (moving && !(typeof GPS !== 'undefined' && GPS.coarse)) {
        Nav.trip.dist += nmBetween(Nav.trip.lastLL, ll);
        Nav.trip.lastLL = ll;
      }
    } else Nav.trip.lastLL = ll;
    if (kn != null) { Nav.trip.maxKn = Math.max(Nav.trip.maxKn, kn); Nav.trip.sumKn += kn; Nav.trip.nKn++; }
    if (!document.getElementById('panel-tools').classList.contains('hidden')) updateTripUi();
  }
  // live "Go To" navigation guidance
  if (typeof gotoOnFix === 'function') gotoOnFix(ll, kn);
}
const NAV_MIN_MOVE_M = 10;
/* How many consecutive out-of-circle fixes before sounding. One bad fix under a
   bridge shouldn't wake the whole boat; two in a row is a real swing. */
const ANCHOR_CONFIRM_FIXES = 2;

function navAnchorEvaluate(ll) {
  const a = Nav.anchor;
  if (!a.watching || !a.ll || !ll) return;
  if (a.blind) { a.blind = false; stopAnchorAlarm(); updateAnchorUi(); }   // fixes are flowing again

  const distFt = Math.round(ll.distanceTo(a.ll) * FT_PER_M);
  /* Widen the trip line by the fix's own uncertainty so a fuzzy fix can't invent
     a drift that isn't there. */
  const slopFt = Math.round(((typeof GPS !== 'undefined' && GPS.accuracy) || 0) * FT_PER_M);
  const limitFt = a.radiusFt + Math.min(slopFt, a.radiusFt);

  if (distFt > limitFt) {
    a.outCount++;
    const el = document.getElementById('aa-dist');
    if (el) el.textContent = distFt + ' ft from anchor (limit ' + a.radiusFt + ' ft)';
    // A snooze expires on time OR the moment the boat keeps going — whichever first.
    const snoozed = a.snoozeUntil > Date.now() && distFt < a.snoozeFt * ANCHOR_REARM_GROWTH;
    if (!snoozed) { a.snoozeUntil = 0; a.snoozeFt = 0; }
    if (!a.dragging && !snoozed && a.outCount >= ANCHOR_CONFIRM_FIXES) {
      a.dragging = true; startAnchorAlarm(); updateAnchorUi();
    }
  } else {
    a.outCount = 0;
    a.snoozeUntil = 0; a.snoozeFt = 0;
    if (a.dragging) { a.dragging = false; stopAnchorAlarm(); updateAnchorUi(); }
  }
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
