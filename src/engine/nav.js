import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { GPS, bearingBetween, gpsIsStale, nmBetween, requestWakeLock } from './gps.js';
import { awakeAcquire, awakeApply, awakeAskNotify, awakeKeepAliveOk, awakeNotify, awakeRelease, awakeUpdateUi } from './awake.js';
import { gotoOnFix, gotoStartRoute } from './goto.js';
import { getMap } from './app.js';
import { closePanels, toast } from '../services/ui';
import { haptic, isNativeShell, nativeAnchorSilence, nativeAnchorWatch } from '../services/native';

/* Navigation & safety: route planner, measure tool, anchor alarm, trip stats.
   Route/measure use map taps (intercepted before tap-to-inspect when a mode is active).

   Port note: this module used to write its panel, the anchor overlay and the trip table
   straight into the DOM. It now publishes plain data through `navStore` (below) and the
   React Tools panel / AnchorAlarm render it. Every safety loop — anchor evaluation, the
   blind watchdog hook, the beeping alarm — still lives here, driven by GPS fixes and
   timers, never by React. */
'use strict';

export const Nav = {
  mode: null,                                  // 'route' | 'measure' | null
  route: { line: null, markers: [], pts: [], legLayer: null, speedKn: 20, gph: 8 },
  measure: { line: null, a: null, layer: null, result: null },
  anchor: { ll: null, circle: null, marker: null, radiusFt: 150, watching: false, dragging: false,
    snoozeUntil: 0, snoozeFt: 0, blind: false, outCount: 0, audio: null, alarmTimer: null,
    field: '150',          // what the panel's radius field holds (read on drop / commit)
    alarmText: '',         // the overlay's distance / NO GPS line
    alarmDistFt: null,
    outside: false },      // the last evaluated fix was outside the watch circle (+ slop)
  trip: { active: false, start: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null },
};

/* ---- Planner cruise speed + fuel burn ----
   These used to live only in the Tools panel's two inputs, and the Go-To ETA and First Mate
   read them straight out of the DOM — so both broke whenever the panel wasn't on screen.
   They are engine state now, and persisted so a cruise speed survives a reload. Legacy
   semantics kept: an empty / non-positive value means "no planned speed" (0). */
export const ROUTE_SPEED_KEY = 'fishapp.routeSpeed';
export const ROUTE_GPH_KEY = 'fishapp.routeGph';
function readStoredNum(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return dflt;
    const n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  } catch (e) { return dflt; }
}
function cleanNum(n) { const v = parseFloat(n); return isFinite(v) && v > 0 ? v : 0; }
Nav.route.speedKn = readStoredNum(ROUTE_SPEED_KEY, 20);
Nav.route.gph = readStoredNum(ROUTE_GPH_KEY, 8);

/* ---- View store: what the Tools panel, the anchor overlay and the Go-To ETA read ----
   Plain data only (never HTML). Flat fields so React selectors return primitives. */
/**
 * @typedef {{ from: number, to: number, nm: number, brg: number }} NavLeg
 * @typedef {Object} NavView
 * @property {'route'|'measure'|null} mode
 * @property {number} routePts          planned points
 * @property {NavLeg[]} routeLegs
 * @property {number|null} routeTotalNm  null with fewer than 2 points
 * @property {number|null} routeHrs      time at the planned speed (null when the speed is 0)
 * @property {string} routeDurText       fmtDur of routeHrs ("1h 5m")
 * @property {number|null} routeGal      fuel at the planned burn (null when speed or gph is 0)
 * @property {number} routeSpeedKn
 * @property {number} routeGph
 * @property {string} routeSummary       the legacy one-line summary (plain text)
 * @property {string} routeHint          guidance under the planner
 * @property {{nm: number, mi: number, brg: number}|null} measure
 * @property {boolean} measurePending    first point placed, waiting for the second
 * @property {boolean} anchorWatching
 * @property {boolean} anchorBlind
 * @property {boolean} anchorDragging
 * @property {boolean} anchorOutside    the last fix was outside the circle (e.g. still out while snoozed)
 * @property {number} anchorRadiusFt
 * @property {string} anchorField        the radius field's text
 * @property {number} anchorSnoozeUntil  ms epoch, 0 = not snoozed
 * @property {string} anchorStatus       status line (recomputed live by the panel)
 * @property {string} anchorButton
 * @property {boolean} alarmVisible
 * @property {boolean} alarmBlind
 * @property {number|null} alarmDistFt
 * @property {string} alarmText
 * @property {boolean} tripActive
 * @property {number} tripStart          0 = never started
 * @property {number} tripSegStart
 * @property {number} tripAccMs
 * @property {number} tripDistNm
 * @property {number|null} tripMaxKn     null until a speed sample exists
 * @property {number|null} tripAvgKn
 * @property {string} tripButton
 */
/** @type {import('zustand/vanilla').StoreApi<NavView>} */
export const navStore = createStore(() => /** @type {NavView} */ ({
  mode: null,
  routePts: 0, routeLegs: [], routeTotalNm: null, routeHrs: null, routeDurText: '', routeGal: null,
  routeSpeedKn: Nav.route.speedKn, routeGph: Nav.route.gph, routeSummary: '',
  routeHint: 'Tap “Add points”, then click the map to drop navigation points. Each leg shows its distance; drag a point to adjust.',
  measure: null, measurePending: false,
  anchorWatching: false, anchorBlind: false, anchorDragging: false, anchorOutside: false, anchorRadiusFt: 150, anchorField: '150',
  anchorSnoozeUntil: 0, anchorStatus: '', anchorButton: 'Drop anchor here',
  alarmVisible: false, alarmBlind: false, alarmDistFt: null, alarmText: '',
  tripActive: false, tripStart: 0, tripSegStart: 0, tripAccMs: 0, tripDistNm: 0, tripMaxKn: null, tripAvgKn: null,
  tripButton: 'Start trip',
}));

export function getRouteSpeedKn() { return Nav.route.speedKn; }
export function getRouteGph() { return Nav.route.gph; }
export function setRouteSpeedKn(n) {
  Nav.route.speedKn = cleanNum(n);
  try { localStorage.setItem(ROUTE_SPEED_KEY, String(Nav.route.speedKn)); } catch (e) {}
  routeStats();
}
export function setRouteGph(n) {
  Nav.route.gph = cleanNum(n);
  try { localStorage.setItem(ROUTE_GPH_KEY, String(Nav.route.gph)); } catch (e) {}
  routeStats();
}

export function navInit(map) {
  Nav.measure.layer = L.layerGroup().addTo(map);
  Nav.route.layerGroup = L.layerGroup().addTo(map);
  Nav.route.legLayer = L.layerGroup().addTo(map);   // per-leg distance labels (redrawn each change)
  routeStats();
  updateTripUi();
}

/* Returns true if the map tap was consumed by a nav mode (so inspect should skip) */
export function navHandleClick(latlng) {
  if (Nav.mode === 'route') { routeAddPoint(latlng); return true; }
  if (Nav.mode === 'measure') { measureClick(latlng); return true; }
  return false;
}

export function navSetMode(mode) {
  Nav.mode = (Nav.mode === mode) ? null : mode;
  navStore.setState({ mode: Nav.mode });
  if (Nav.mode === 'route') { toast('Tap the map to drop your first navigation point'); }
  else if (Nav.mode === 'measure') { measureReset(); toast('Tap two points to measure'); }
}

/* ---- Route planner ----
   Tap to drop numbered waypoints; consecutive points connect into a route. Each
   point is draggable (nudge the line around an island), and every leg shows its
   own distance both on the map and in the panel breakdown. */
export function routeIcon(n) {
  // 36 px hit area around a 24 px disc: these are dragged with a wet thumb
  return L.divIcon({ className: 'nav-plan-icon', iconSize: [36, 36], iconAnchor: [18, 18],
    html: '<div class="nav-plan-pt">' + n + '</div>' });
}
export function routeAddPoint(ll) {
  Nav.route.pts.push(ll);
  const m = L.marker(ll, { draggable: true, keyboard: false, icon: routeIcon(Nav.route.pts.length), zIndexOffset: 1000 })   // drag-only: not an unlabelled focusable "button"
    .addTo(Nav.route.layerGroup);
  m.on('drag', () => { const i = Nav.route.markers.indexOf(m); if (i >= 0) { Nav.route.pts[i] = m.getLatLng(); routeRedraw(); } });
  Nav.route.markers.push(m);
  routeRedraw();
  // Walk the user through building the route, one tap at a time.
  const n = Nav.route.pts.length;
  toast(n === 1
    ? 'Navigation point 1 dropped — click another point on the map to make a route'
    : 'Point ' + n + ' added — keep tapping to extend, or press Start route');
}
/* Turn the planned points into a live navigation line you can follow.
   Async: handing over to Go-To may ask "discard the voyage in progress?". The planner is
   only taken down once Go-To has actually started — it used to be cleared even when the
   user answered "keep my voyage", throwing away the route they had just planned. */
export async function routeStart() {
  if (Nav.route.pts.length < 2) {
    toast('Drop at least 2 points first — tap Add points, then tap the map');
    return;
  }
  const started = await gotoStartRoute(Nav.route.pts);
  if (!started) return;                                 // user kept the voyage in progress — keep the plan too
  if (Nav.mode === 'route') navSetMode('route');          // leave add-points mode
  closePanels();                                          // get the panel out of the way
  /* Take the planning line down. gotoStartRoute copies the points, so leaving the
     draggable blue planner on the map let you drag a waypoint clear of a shoal,
     watch the blue line move, and still be steered over the shoal by the green one. */
  routeClear();
}
export function routeRedraw() {
  // route line (ink casing under a dashed core — the plan, not yet the course to steer)
  if (Nav.route.line) Nav.route.layerGroup.removeLayer(Nav.route.line);
  Nav.route.line = null;
  if (Nav.route.pts.length >= 2) {
    Nav.route.line = L.layerGroup([
      L.polyline(Nav.route.pts, { className: 'nav-plan-casing', weight: 6, interactive: false }),
      L.polyline(Nav.route.pts, { className: 'nav-plan-line', weight: 2.5, dashArray: '6 4', interactive: false }),
    ]).addTo(Nav.route.layerGroup);
  }
  // Note: markers keep their creation number (append gets the next number, undo
  // removes the last) so we must NOT setIcon() here — doing so mid-drag would
  // rebuild the dragged marker's DOM element and cancel the drag.
  Nav.route.legLayer.clearLayers();
  for (let i = 1; i < Nav.route.pts.length; i++) {
    const a = Nav.route.pts[i - 1], b = Nav.route.pts[i];
    const nm = nmBetween(a, b);
    const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
    L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nav-leg-icon', iconSize: [0, 0],
      html: '<span class="map-chip nav-leg-chip">' + nm.toFixed(1) + ' nm</span>' }) }).addTo(Nav.route.legLayer);
  }
  routeStats();
}
/** Pure: the planner breakdown for a list of points at a speed / burn (legacy routeStats maths). */
export function routeSummarize(pts, spd, gph) {
  let total = 0;
  const legs = [];
  for (let i = 1; i < pts.length; i++) {
    const nm = nmBetween(pts[i - 1], pts[i]);
    total += nm;
    legs.push({ from: i, to: i + 1, nm: nm, brg: Math.round(bearingBetween(pts[i - 1], pts[i])) });
  }
  const hrs = spd > 0 ? total / spd : 0;
  const summary = total.toFixed(1) + ' nm total' +
    (spd > 0 ? ' · ' + fmtDur(hrs * 3600) + ' at ' + spd + ' kn' : '') +
    (spd > 0 && gph > 0 ? ' · ' + (hrs * gph).toFixed(1) + ' gal' : '') +
    ' · ' + pts.length + ' points';
  return {
    totalNm: total, legs: legs,
    hrs: spd > 0 ? hrs : null,
    durText: spd > 0 ? fmtDur(hrs * 3600) : '',
    gal: spd > 0 && gph > 0 ? hrs * gph : null,
    summary: summary,
  };
}
export function routeStats() {
  const pts = Nav.route.pts;
  const spd = getRouteSpeedKn();
  const gph = getRouteGph();
  if (pts.length < 2) {
    navStore.setState({
      routePts: pts.length, routeLegs: [], routeTotalNm: null, routeHrs: null, routeDurText: '', routeGal: null,
      routeSpeedKn: spd, routeGph: gph, routeSummary: '',
      routeHint: pts.length === 1
        ? 'Navigation point 1 dropped — click another point on the map to make a route.'
        : 'Tap “Add points”, then click the map to drop navigation points. Each leg shows its distance; drag a point to adjust.',
    });
    return;
  }
  const s = routeSummarize(pts, spd, gph);
  navStore.setState({
    routePts: pts.length, routeLegs: s.legs, routeTotalNm: s.totalNm, routeHrs: s.hrs, routeDurText: s.durText,
    routeGal: s.gal, routeSpeedKn: spd, routeGph: gph, routeSummary: s.summary,
    routeHint: 'Press Start route to follow it — you\'ll get a course line, steer bearing and ETA, advancing waypoint to waypoint.',
  });
}
export function routeClear() {
  Nav.route.layerGroup.clearLayers();
  Nav.route.legLayer.clearLayers();
  Nav.route.line = null; Nav.route.markers = []; Nav.route.pts = [];
  routeStats();
}
export function routeUndo() {
  Nav.route.pts.pop();
  const m = Nav.route.markers.pop();
  if (m) Nav.route.layerGroup.removeLayer(m);
  routeRedraw();
}

/* ---- Measure ---- */
export function measureReset() {
  Nav.measure.layer.clearLayers(); Nav.measure.a = null; Nav.measure.result = null;
  navStore.setState({ measure: null, measurePending: false });
}
/** The on-chart measure label (plain text: digits and units only, so no escaping needed). */
export function measureChipText(r) {
  return r.nm.toFixed(r.nm < 10 ? 2 : 1) + ' nm · ' + r.brg + '°T';
}
export function measureClick(ll) {
  if (!Nav.measure.a) {
    Nav.measure.layer.clearLayers();
    Nav.measure.a = ll;
    Nav.measure.result = null;
    L.circleMarker(ll, { radius: 5, weight: 2, className: 'nav-measure-pt', interactive: false }).addTo(Nav.measure.layer);
    navStore.setState({ measure: null, measurePending: true });
  } else {
    const b = ll;
    L.circleMarker(b, { radius: 5, weight: 2, className: 'nav-measure-pt', interactive: false }).addTo(Nav.measure.layer);
    L.polyline([Nav.measure.a, b], { weight: 2, dashArray: '5 4', className: 'nav-measure-line', interactive: false }).addTo(Nav.measure.layer);
    const nm = nmBetween(Nav.measure.a, b), brg = Math.round(bearingBetween(Nav.measure.a, b));
    Nav.measure.result = { nm: nm, mi: nm * 1.15078, brg: brg };
    /* The answer also goes ON the chart, at the line's midpoint like a route leg's chip: the
       measure mode keeps working with the Tools sheet closed (legacy: close the panel, tap two
       points), and the result used to exist only in that closed sheet — a bare dashed line. */
    const mid = L.latLng((Nav.measure.a.lat + b.lat) / 2, (Nav.measure.a.lng + b.lng) / 2);
    L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nav-leg-icon', iconSize: [0, 0],
      html: '<span class="map-chip nav-leg-chip nav-measure-chip">' + measureChipText(Nav.measure.result) + '</span>' }) }).addTo(Nav.measure.layer);
    navStore.setState({ measure: Nav.measure.result, measurePending: false });
    Nav.measure.a = null;
  }
}

/* ---- Anchor alarm ---- */
export const FT_PER_M = 3.28084;
export function anchorRadiusM() { return Nav.anchor.radiusFt / FT_PER_M; }

/* The anchor glyph (Lucide "anchor" geometry) on an ink disc ringed in alert red. */
export function anchorIcon() {
  return L.divIcon({ className: 'nav-anchor-icon', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="nav-anchor-pin"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/></svg></div>' });
}
function anchorDrawLayers() {
  const map = getMap();
  if (!map || !Nav.anchor.ll) return;
  Nav.anchor.circle = L.circle(Nav.anchor.ll, { radius: anchorRadiusM(), weight: 2, className: 'nav-anchor-circle', interactive: false }).addTo(map);
  Nav.anchor.marker = L.marker(Nav.anchor.ll, { icon: anchorIcon(), interactive: false, keyboard: false }).addTo(map);
}

export function anchorDrop() {
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
  anchorDrawLayers();
  Nav.anchor.watching = true; Nav.anchor.dragging = false;
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.blind = false; Nav.anchor.outCount = 0;
  Nav.anchor.alarmText = ''; Nav.anchor.alarmDistFt = null; Nav.anchor.outside = false;
  unlockAudio();          // this tap is a user gesture — unlock audio so the alarm can beep later
  requestWakeLock();      // keep the screen on so GPS keeps running (iOS suspends when locked)
  /* Same gesture starts the background keep-alive and asks for notification
     permission, so the alarm can still reach you if the app isn't in front. */
  if (typeof awakeAcquire === 'function') awakeAcquire('anchor');
  if (typeof awakeAskNotify === 'function') awakeAskNotify();
  anchorPersist();
  anchorSyncNative();     // iPhone app: arm the native monitor that keeps watching with the phone locked
  updateAnchorUi();
  toast('Anchor watch on (' + Nav.anchor.radiusFt + ' ft) — ' + anchorScreenCopy(isNativeShell()).armed);
}

/* ---- What the watch tells you to do with the phone ----
   In a browser iOS stops GPS the moment the phone locks, so the watch only works with the app in
   front and the screen on. In the iPhone app the native monitor (anchorSyncNative) keeps watching
   with the phone locked, so "keep the screen on" is wrong there — the thing that does stop it is
   closing the app. Every line the watch shows about it comes from here (the drop toast, the watch
   band in awake.js, the Tools panel's no-GPS notice). */
export const ANCHOR_SCREEN_COPY = {
  web: {
    armed: 'keep the app open, screen on',
    band: 'keep the screen on',
    blind: 'Keep the app in front with the screen on until GPS comes back.',
  },
  // device-neutral: the same app runs on iPad
  native: {
    armed: 'keeps watching with the screen locked. Don\'t close the app.',
    band: 'OK to lock the screen',
    blind: 'Give the device a clear view of the sky — the watch picks up again on its own when GPS comes back.',
  },
};
/** The anchor watch's screen wording for the iPhone app (`native`) or a browser.
 *  @param {boolean} native */
export function anchorScreenCopy(native) {
  return native ? ANCHOR_SCREEN_COPY.native : ANCHOR_SCREEN_COPY.web;
}

/* ---- Native iOS shell: the locked-screen anchor monitor ----
   With the phone locked iOS can suspend the web view's JavaScript, so in the iPhone app the
   drift check above can simply stop running. NativeBridge.swift keeps its own copy of the watch
   (centre + radius) and, while the app is in the background, checks every CoreLocation fix
   against it and raises a notification plus an alarm tone. It only knows about a watch we hand
   it, so every change to the watch — drop, restore, radius change, raise — is mirrored here.
   In the foreground the web watch keeps owning the alarm. A no-op in the browser. */
export function anchorSyncNative() {
  const a = Nav.anchor;
  try {
    if (a.watching && a.ll) {
      nativeAnchorWatch({ on: true, lat: a.ll.lat, lng: a.ll.lng, radiusM: anchorRadiusM() });
    } else {
      nativeAnchorWatch({ on: false });
    }
  } catch (e) { /* the web watch never depends on the bridge */ }
}
/* The radius the panel's field holds. Was a DOM read of #anchor-radius; the field now
   commits its text here (on change, not per keystroke — see anchorRadiusChanged). */
export function anchorReadRadius() {
  const v = parseInt(String(Nav.anchor.field), 10);
  return (isFinite(v) && v > 0) ? v : 150;
}
export function anchorSetRadiusField(value) {
  Nav.anchor.field = value == null ? '' : String(value);
  navStore.setState({ anchorField: Nav.anchor.field });
}
export function anchorRaise() {
  stopAnchorAlarm();
  anchorPrimeStop();
  const map = getMap();
  if (map && Nav.anchor.circle) map.removeLayer(Nav.anchor.circle);
  if (map && Nav.anchor.marker) map.removeLayer(Nav.anchor.marker);
  Nav.anchor.circle = Nav.anchor.marker = Nav.anchor.ll = null;
  Nav.anchor.watching = false; Nav.anchor.dragging = false;
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.blind = false; Nav.anchor.outCount = 0;
  Nav.anchor.alarmText = ''; Nav.anchor.alarmDistFt = null; Nav.anchor.outside = false;
  if (typeof awakeRelease === 'function') awakeRelease('anchor');
  anchorPersist();
  anchorSyncNative();     // disarm the native monitor too, or it would alarm for a watch that is off
  updateAnchorUi();
}

/* The watch is the one feature people go to sleep trusting, so it must not live
   only in memory — a reload, a tab eviction or an OS kill would silently end it
   with the boat still swinging. */
export function anchorPersist() {
  try {
    if (Nav.anchor.watching && Nav.anchor.ll) {
      localStorage.setItem('fishapp.anchor', JSON.stringify({
        lat: Nav.anchor.ll.lat, lng: Nav.anchor.ll.lng, radiusFt: Nav.anchor.radiusFt, ts: Date.now(),
      }));
    } else localStorage.removeItem('fishapp.anchor');
  } catch (e) {}
}
export function anchorRestore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('fishapp.anchor') || 'null'); } catch (e) {}
  /* No watch to restore: make sure the iPhone app's native monitor isn't still holding one from
     before this page loaded (it outlives a web reload), or it would alarm for a watch that no
     longer exists anywhere the user can raise it. */
  if (!s || !isFinite(s.lat) || !isFinite(s.lng)) { anchorSyncNative(); return; }
  if (Date.now() - (s.ts || 0) > 36 * 3600e3) {
    try { localStorage.removeItem('fishapp.anchor'); } catch (e) {}
    anchorSyncNative();
    return;
  }
  Nav.anchor.ll = L.latLng(s.lat, s.lng);
  Nav.anchor.radiusFt = s.radiusFt || 150;
  anchorSetRadiusField(Nav.anchor.radiusFt);
  anchorDrawLayers();
  Nav.anchor.watching = true;
  /* Take the same keep-alive the drop gesture takes. A restored watch used not to, so after
     a reload the watch banner was hidden and the background keep-alive (and, in the iPhone
     app, background GPS) stayed off with the boat still swinging. The keep-alive audio can
     only start from a gesture: until the first tap below the banner honestly says it
     isn't running. */
  if (typeof awakeAcquire === 'function') awakeAcquire('anchor');
  anchorSyncNative();     // re-arm the iPhone app's locked-screen monitor with the restored circle
  updateAnchorUi();
  /* Audio can't be unlocked without a gesture, so grab the first one that comes
     along — and say so meanwhile, rather than let them believe a silent watch is armed. */
  anchorPrimeArm();
  toast('Anchor watch restored — tap anywhere once to re-enable the alarm sound');
}

/* ---- Re-arming a restored watch's sound from the next real gesture ----
   The legacy handler ran on the first pointerdown / touchstart and removed itself whatever
   happened. On a phone those are NOT user activation (iOS WebKit unlocks audio on touchend /
   click), so the unlock failed, nothing retried, and the toast still said "armed" over a
   watch that would beep silently. Now it listens to the events that do count, and only stops
   listening — and only says "armed" — once the alarm's audio context is actually running and
   the background keep-alive is actually playing (or isn't used, as in the iPhone app).
   Until then every further tap tries again. Capture phase: a control that stops propagation
   must not hide the gesture from us. */
export const ANCHOR_PRIME_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'];
export const ANCHOR_PRIME_SETTLE_MS = 1500;     // never wait on a resume()/play() that hangs
/** @type {((e?: Event) => void) | null} */
let _primeHandler = null;

/** True once the alarm can actually sound: audio context running + keep-alive OK. */
export function anchorAudioReady() {
  const ac = Nav.anchor.audio;
  return !!(ac && ac.state === 'running') && (typeof awakeKeepAliveOk !== 'function' || awakeKeepAliveOk());
}
/** Resolves once every promise has settled, or after `ms`, whichever comes first. Never rejects. */
function settleWithin(promises, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    Promise.all(promises.map((p) => Promise.resolve(p).catch(() => {})))
      .then(() => { clearTimeout(t); resolve(undefined); });
  });
}
export function anchorPrimeStop() {
  const h = _primeHandler;
  _primeHandler = null;
  if (!h || typeof document === 'undefined') return;
  ANCHOR_PRIME_EVENTS.forEach((ev) => document.removeEventListener(ev, h, true));
}
/** True while a restored watch is still waiting for a gesture to re-enable its sound. */
export function anchorPrimePending() { return !!_primeHandler; }
export function anchorPrimeArm() {
  anchorPrimeStop();
  if (typeof document === 'undefined') return;
  const handler = () => {
    if (_primeHandler !== handler) return;
    if (!Nav.anchor.watching) { anchorPrimeStop(); return; }
    // This event IS a gesture: resume the alarm's audio context and (re)start the keep-alive from it.
    const unlocked = unlockAudio();
    requestWakeLock();
    const keepAlive = (typeof awakeApply === 'function') ? awakeApply() : undefined;
    settleWithin([unlocked, keepAlive], ANCHOR_PRIME_SETTLE_MS).then(() => {
      if (_primeHandler !== handler) return;           // already armed by an earlier tap, or raised
      if (!Nav.anchor.watching) { anchorPrimeStop(); return; }
      if (!anchorAudioReady()) return;                 // not yet — keep listening, the next tap retries
      anchorPrimeStop();
      toast('Anchor watch alarm armed');
    });
  };
  _primeHandler = handler;
  ANCHOR_PRIME_EVENTS.forEach((ev) => document.addEventListener(ev, handler, { capture: true, passive: true }));
}

/** Pure: the panel's status line (legacy copy, emoji removed). `now` makes the snooze countdown live. */
export function anchorStatusText(a, now) {
  if (!a.watching) return '';
  if (a.blind) return 'NO GPS — the watch cannot see you drift';
  const snoozed = a.snoozeUntil > now;
  return 'Watching — alarms if you drift past ' + a.radiusFt + ' ft' +
    (snoozed ? ' · snoozed ' + Math.ceil((a.snoozeUntil - now) / 60000) + ' min' : '');
}
/* Publish the anchor half of the view (cheap; called on every out-of-circle fix too). */
export function anchorPublish() {
  const a = Nav.anchor;
  navStore.setState({
    anchorWatching: a.watching, anchorBlind: a.blind, anchorDragging: a.dragging, anchorOutside: !!a.outside,
    anchorRadiusFt: a.radiusFt, anchorField: a.field, anchorSnoozeUntil: a.snoozeUntil,
    anchorStatus: anchorStatusText(a, Date.now()),
    anchorButton: a.watching ? 'Raise anchor / stop watch' : 'Drop anchor here',
    alarmVisible: !!a.alarmTimer, alarmBlind: a.blind, alarmDistFt: a.alarmDistFt, alarmText: a.alarmText,
  });
}
export function updateAnchorUi() {
  // keep the always-visible banner in step with the panel's own status line
  if (typeof awakeUpdateUi === 'function') awakeUpdateUi();
  anchorPublish();
}
export function anchorToggle() { Nav.anchor.watching ? anchorRaise() : anchorDrop(); }

/* Changing the radius mid-watch used to do nothing at all: the value was read
   only when dropping. Someone whose alarm won't stop would have to raise the
   watch entirely to widen it — leaving the boat unwatched.
   Called when the radius field commits (blur / Enter), with the field's text. */
export function anchorRadiusChanged(value) {
  if (value !== undefined) anchorSetRadiusField(value);
  if (!Nav.anchor.watching) return;
  Nav.anchor.radiusFt = anchorReadRadius();
  if (Nav.anchor.circle) Nav.anchor.circle.setRadius(anchorRadiusM());
  Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0; Nav.anchor.outCount = 0;
  anchorPersist();
  anchorSyncNative();     // the native monitor checks against the same, new radius
  /* Re-evaluate only against a LIVE position. While the watch is blind the last fix is
     stale, and evaluating it cleared `blind` and stopped the no-GPS alarm on a position
     from minutes ago. Only a real new fix may end a blind alarm. */
  if (Nav.anchor.ll && GPS.lastLatLng && !Nav.anchor.blind && !gpsIsStale()) navAnchorEvaluate(GPS.lastLatLng);
  updateAnchorUi();
}

/* Unlock the Web Audio context from a user tap (iOS blocks audio otherwise).
   Returns a promise that settles when the resume attempt does (never rejects), so the
   restored-watch primer can check whether the context really started. iOS Safari also has an
   'interrupted' state (a call, Siri) that needs the same resume. */
export function unlockAudio() {
  let resumed = null;
  try {
    if (!Nav.anchor.audio) Nav.anchor.audio = new (window.AudioContext || window.webkitAudioContext)();
    const st = Nav.anchor.audio.state;
    if (st === 'suspended' || st === 'interrupted') {
      const r = Nav.anchor.audio.resume();
      if (r && typeof r.catch === 'function') resumed = r.catch(() => {});
    }
    const o = Nav.anchor.audio.createOscillator(), g = Nav.anchor.audio.createGain();
    g.gain.value = 0.0001; o.connect(g); g.connect(Nav.anchor.audio.destination);
    o.start(); o.stop(Nav.anchor.audio.currentTime + 0.02);   // silent priming blip
  } catch (e) {}
  return resumed || Promise.resolve();
}

export function startAnchorAlarm() {
  clearInterval(Nav.anchor.alarmTimer);
  Nav.anchor.alarmTimer = setInterval(anchorBeep, 2000);   // repeat until dismissed / back in circle
  anchorPublish();                                         // overlay up (AnchorAlarm reads alarmVisible)
  anchorBeep();
  /* Push it outside the app too. An on-screen overlay is no use if the phone is
     face-down on the chart table with another app in front. */
  if (typeof awakeNotify === 'function') {
    awakeNotify(Nav.anchor.blind ? 'Anchor watch blind' : 'ANCHOR DRAGGING',
      Nav.anchor.blind
        ? 'No GPS fix — the watch cannot see whether you are moving. Open FishApp.'
        : 'You have drifted past the ' + Nav.anchor.radiusFt + ' ft watch circle.');
  }
}
export function stopAnchorAlarm() {
  clearInterval(Nav.anchor.alarmTimer);
  Nav.anchor.alarmTimer = null;
  anchorPublish();
}
/* Silence for a while — NOT forever. This used to set a `dismissed` latch that was
   cleared only by returning inside the circle, so silencing an alarm while actually
   dragging disabled the watch for the rest of the night no matter how far you went.
   Now it re-arms on a timer, and immediately if the drift keeps growing. */
export const ANCHOR_SNOOZE_MS = 5 * 60000;
export const ANCHOR_REARM_GROWTH = 1.25;     // …or 25% further out, whichever comes first
export function anchorDismissAlarm() {
  stopAnchorAlarm();
  Nav.anchor.dragging = false;
  Nav.anchor.outCount = 0;
  Nav.anchor.snoozeUntil = Date.now() + ANCHOR_SNOOZE_MS;
  Nav.anchor.snoozeFt = (Nav.anchor.ll && GPS.lastLatLng)
    ? Math.round(GPS.lastLatLng.distanceTo(Nav.anchor.ll) * FT_PER_M)
    : Nav.anchor.radiusFt;
  /* The iPhone app's native monitor may be sounding too (it alarms while we were in the
     background); Silence there is the same 5-minute snooze, never a latch. */
  try { nativeAnchorSilence(); } catch (e) {}
  updateAnchorUi();
  toast('Alarm snoozed 5 min — it re-arms automatically, or sooner if you keep drifting');
}
/* GPS went quiet while the watch is armed. "No new fix" is indistinguishable from
   "not moving", so the watch is blind — and staying silent about that is worse
   than a false alarm. */
export function navOnGpsStale() {
  if (!Nav.anchor.watching) return;
  if (Nav.anchor.blind) {
    /* Already blind. This used to return here unconditionally, so one tap on Silence muted
       a blind watch for the rest of the night (the watchdog keeps calling, nothing ever
       re-armed it). Silence is the same snooze as for a drag alarm: once it runs out with
       GPS still gone, sound again. */
    if (!Nav.anchor.alarmTimer && !(Nav.anchor.snoozeUntil > Date.now())) {
      Nav.anchor.snoozeUntil = 0; Nav.anchor.snoozeFt = 0;
      Nav.anchor.alarmText = 'NO GPS — the anchor watch cannot see you drift';
      startAnchorAlarm();
      updateAnchorUi();
    }
    return;
  }
  Nav.anchor.blind = true;
  Nav.anchor.alarmText = 'NO GPS — the anchor watch cannot see you drift';
  updateAnchorUi();
  startAnchorAlarm();
  toast('Anchor watch blind — no GPS fix for a minute');
}
export function navOnGpsLost() { navOnGpsStale(); }
export function anchorBeep() {
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);   // no-op on iOS, works on Android
  haptic();                                                              // the iPhone app's equivalent
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
export function tripToggle() {
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
export function tripReset() { Nav.trip = { active: false, start: 0, segStart: 0, accMs: 0, dist: 0, maxKn: 0, sumKn: 0, nKn: 0, lastLL: null }; updateTripUi(); }
/** Pure: active trip time in ms at `now` (banked segments + the running one). */
export function tripDurationMs(t, now) {
  return (t.accMs || 0) + (t.active ? now - (t.segStart || t.start) : 0);
}
export function updateTripUi() {
  const t = Nav.trip;
  navStore.setState({
    tripActive: !!t.active, tripStart: t.start || 0, tripSegStart: t.segStart || 0, tripAccMs: t.accMs || 0,
    tripDistNm: t.dist,
    // no speed sample yet is "unknown", not 0.0 kn
    tripMaxKn: t.nKn ? t.maxKn : null,
    tripAvgKn: t.nKn ? t.sumKn / t.nKn : null,
    tripButton: t.active ? 'Pause trip' : (t.start ? 'Resume trip' : 'Start trip'),
  });
}

/* Fed from gps.js on every fix */
export function navOnFix(ll, kn) {
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
    updateTripUi();
  }
  // live "Go To" navigation guidance
  if (typeof gotoOnFix === 'function') gotoOnFix(ll, kn);
}
export const NAV_MIN_MOVE_M = 10;
/* How many consecutive out-of-circle fixes before sounding. One bad fix under a
   bridge shouldn't wake the whole boat; two in a row is a real swing. */
export const ANCHOR_CONFIRM_FIXES = 2;

export function navAnchorEvaluate(ll) {
  const a = Nav.anchor;
  if (!a.watching || !a.ll || !ll) return;
  if (a.blind) {
    /* Fixes are flowing again. `dragging` is cleared together with `blind`: a drag alarm
       that went blind used to keep dragging=true here, so when GPS came back with the boat
       STILL outside the circle the check below saw "already alarming" and never restarted
       the alarm it had just stopped — silence while the anchor dragged. */
    a.blind = false; a.dragging = false; stopAnchorAlarm(); updateAnchorUi();
  }

  const distFt = Math.round(ll.distanceTo(a.ll) * FT_PER_M);
  /* Widen the trip line by the fix's own uncertainty so a fuzzy fix can't invent
     a drift that isn't there. */
  const slopFt = Math.round(((typeof GPS !== 'undefined' && GPS.accuracy) || 0) * FT_PER_M);
  const limitFt = a.radiusFt + Math.min(slopFt, a.radiusFt);

  if (distFt > limitFt) {
    a.outCount++;
    a.outside = true;
    a.alarmText = distFt + ' ft from anchor (limit ' + a.radiusFt + ' ft)';
    a.alarmDistFt = distFt;
    // A snooze expires on time OR the moment the boat keeps going — whichever first.
    const snoozed = a.snoozeUntil > Date.now() && distFt < a.snoozeFt * ANCHOR_REARM_GROWTH;
    if (!snoozed) { a.snoozeUntil = 0; a.snoozeFt = 0; }
    if (!a.dragging && !snoozed && a.outCount >= ANCHOR_CONFIRM_FIXES) {
      a.dragging = true; startAnchorAlarm(); updateAnchorUi();
    } else anchorPublish();
  } else {
    /* Back inside clears the snooze — and the panel has to hear about it, or it kept showing
       "snoozed N min" over a watch that is in fact armed again. Publish only on a change:
       this branch runs on every quiet fix of the night. */
    const changed = a.outside || a.outCount !== 0 || a.snoozeUntil !== 0;
    a.outside = false;
    a.outCount = 0;
    a.snoozeUntil = 0; a.snoozeFt = 0;
    if (a.dragging) { a.dragging = false; stopAnchorAlarm(); updateAnchorUi(); }
    else if (changed) anchorPublish();
  }
}

export function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
