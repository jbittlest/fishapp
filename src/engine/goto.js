import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { idb } from './db.js';
import { GPS, bearingBetween, gpsIsStale, mapProgrammatic, nmBetween, requestWakeLock, setFollow } from './gps.js';
import { escapeHtml } from './spots.js';
import { Tracks, trackDistanceNm, tracksHaveUnsaved } from './tracks.js';
import { compass } from './weather.js';
import { fmtDur, getRouteSpeedKn } from './nav.js';
import { awakeSyncBackgroundLocation } from './awake.js';
import { applyPendingUpdate, getMap } from './app.js';
import { closeCard, closePanels, confirmDialog, openCard, toast, uiStore, updateCard } from '../services/ui';
import { saveOrShareFile } from '../services/native';

/* "Go To" navigation: pick a destination, steer a direct course with live
   distance/bearing/ETA, and save the finished voyage to an archive.
   Live stats are fed from gps.js via navOnFix → gotoOnFix.

   Port note: the banner (#goto-banner) and the voyage list (#trips-list) used to be
   written straight into the DOM. They are published through `gotoStore` (the live run,
   read by the Go-To card and the nav pill) and `tripsStore` (the saved archive, read by
   the Voyages section and the history card). */
'use strict';

export const Goto = {
  active: false,
  dest: null,         // L.LatLng destination
  destName: '',
  startTs: 0,
  startLL: null,      // L.LatLng where the voyage began
  planNm: 0,          // straight-line distance at start
  track: [],          // [lat,lng] breadcrumb of the voyage
  maxKn: 0,
  line: null,         // course line (bow → active waypoint): ink casing + signal core
  destMarker: null,
  shown: {},          // saved-trip id -> layer group on map
  route: null,        // [L.LatLng] when following a multi-point route
  legIdx: 0,          // index of the waypoint we're currently steering to
  routeLine: null,    // the remaining route ahead of the active leg
  saved: {},          // id -> saved trip record (last load)
  unsaved: [],        // voyages whose IndexedDB write failed — kept in memory, retryable
  _lastPt: null, _lastTs: 0, _arrived: false, _ending: false,
  _arrivedNm: 0,      // the (largest) arrival radius in force while _arrived — sets the exit threshold
  _run: 0,            // increments per started run; async paths check it after an await
  _lastFrom: null, _hooked: false, _loadSeq: 0, _unsavedSeq: 0,
};

/* ---- View stores ---- */
/**
 * @typedef {Object} GotoView
 * @property {boolean} active
 * @property {boolean} arriving      inside the arrival radius (hysteresis in gotoOnFix)
 * @property {boolean} ending        Arrived / Stop is being processed (double-tap guard)
 * @property {string} name           destination name, or "WP k of N" on a route
 * @property {boolean} isRoute
 * @property {number} wpIndex        1-based waypoint being steered to (routes)
 * @property {number} wpCount
 * @property {boolean} hasFix        false until a position exists for this run
 * @property {number|null} distNm    headline distance: the whole remaining run on a route
 * @property {number|null} distMi
 * @property {number|null} legNm     distance to the active waypoint (routes only)
 * @property {string} legText        "leg 0.84 nm" on a route, else ""
 * @property {number|null} brgDeg    true bearing to the active waypoint; null with no fix
 * @property {string} brgCompass     "SE" (or "" with no fix)
 * @property {number|null} steerDeg  signed turn relative to the course over ground: + right, - left
 * @property {'on-course'|'right'|'left'|null} steerDir
 * @property {string} steerText      "on course" | "turn 12° right" | "turn 8° left" | "" (no heading yet)
 * @property {string} steerLine      legacy banner line: "steer 123° SE" ("steer —" with no fix)
 * @property {string} etaText        legacy line: "ETA 2:40 PM · 1h 5m @20kn" or "ETA —"
 * @property {string} etaClock       "2:40 PM" or ""
 * @property {number|null} etaAt
 * @property {number|null} ttgSec    time to go
 * @property {string} ttgText        "1h 5m"
 * @property {boolean} etaPlanned    ETA uses the planned cruise speed, not live SOG
 * @property {number|null} etaSpeedKn
 * @property {string} distText       legacy distance line
 * @property {number} breadcrumbs    recorded points this run (Stop asks first above 2)
 */
/** @type {GotoView} */
const GOTO_IDLE = {
  active: false, arriving: false, ending: false, name: '', isRoute: false, wpIndex: 0, wpCount: 0, hasFix: false,
  distNm: null, distMi: null, legNm: null, legText: '', brgDeg: null, brgCompass: '',
  steerDeg: null, steerDir: null, steerText: '', steerLine: '', etaText: 'ETA —', etaClock: '', etaAt: null,
  ttgSec: null, ttgText: '', etaPlanned: false, etaSpeedKn: null, distText: '', breadcrumbs: 0,
};
/** @type {import('zustand/vanilla').StoreApi<GotoView>} */
export const gotoStore = createStore(() => /** @type {GotoView} */ ({ ...GOTO_IDLE }));

/**
 * @typedef {Object} TripItem
 * @property {number|string} id
 * @property {string} name
 * @property {string} destName
 * @property {number} start
 * @property {number} end
 * @property {number} actualNm
 * @property {number} planNm
 * @property {number} avgKn
 * @property {number} maxKn
 * @property {boolean} unsaved       the write failed; only in memory until it is retried or saved as a file
 * @property {string} error
 * @typedef {Object} TripsView
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {string} error
 * @property {TripItem[]} items      newest first (unsaved ones on top)
 * @property {Record<string, boolean>} shown
 */
/** @type {import('zustand/vanilla').StoreApi<TripsView>} */
export const tripsStore = createStore(() => /** @type {TripsView} */ ({ status: 'idle', error: '', items: [], shown: {} }));

export async function gotoStart(latlng, name) {
  /* Diverting mid-run used to wipe the breadcrumb, start time and max speed with no
     warning — the ✕ button asks before discarding a voyage, this path didn't.
     Resolves false when the user backs out, so callers don't half-apply a new run. */
  if (Goto.active && Goto.track.length > 2) {
    const ok = await confirmDialog({
      title: 'Voyage in progress',
      message: 'You have a voyage in progress. Start a new one and discard it?',
      confirmLabel: 'Discard and start', destructive: true,
    });
    if (!ok) return false;
  }
  gotoClearLayers();
  Goto._run++;
  Goto.active = true;
  Goto.route = null; Goto.legIdx = 0;   // plain single-destination run unless gotoStartRoute sets these
  Goto.dest = L.latLng(latlng.lat, latlng.lng);
  Goto.destName = (name || 'Destination').trim();
  Goto.startTs = Date.now();
  /* Read the position now (after the question), not when it was asked — and only a LIVE one.
     An hours-old last fix used to become the start: the card then showed a distance, bearing
     and ETA measured from wherever the boat was hours ago, as if they were live. With no fresh
     fix the run waits for GPS and gotoOnFix takes the first real fix as the start. */
  Goto.startLL = (typeof GPS !== 'undefined' && GPS.lastLatLng && !gpsIsStale()) ? GPS.lastLatLng : null;
  Goto.track = []; Goto._lastPt = null; Goto._lastTs = 0; Goto.maxKn = 0; Goto._arrived = false; Goto._arrivedNm = 0;
  if (Goto.startLL) { Goto.track.push([Goto.startLL.lat, Goto.startLL.lng]); Goto.planNm = nmBetween(Goto.startLL, Goto.dest); }
  else Goto.planNm = 0;

  const map = getMap();
  if (map) {
    Goto.destMarker = L.marker(Goto.dest, {
      icon: gotoDestIcon(Goto.destName), interactive: false, keyboard: false, zIndexOffset: 800,
    }).addTo(map);
  }

  if (typeof requestWakeLock === 'function') requestWakeLock();   // keep GPS alive
  gotoUpdateBanner(Goto.startLL, null);
  awakeSyncBackgroundLocation();                                   // iPhone app: GPS with the screen locked
  toast('Navigating to ' + Goto.destName + (Goto.startLL ? '' : ' — waiting for GPS'));
  closeCard();                                                     // (was: map.closePopup())
  return true;
}

/* Follow a multi-point route: steer to waypoint 1, then auto-advance through the
   rest as each is reached. Reuses the single-destination banner + course line.
   Resolves true once the route is running, false if nothing started. */
export async function gotoStartRoute(pts) {
  if (!pts || pts.length < 2) {
    toast('Drop at least 2 points first');
    return false;
  }
  const route = pts.map((p) => L.latLng(p.lat, p.lng));
  if ((await gotoStart(route[0], 'WP 1')) === false) return false;   // user kept the voyage in progress
  Goto.route = route;
  Goto.legIdx = 0;
  gotoRouteLabel();
  gotoRefreshDestMarker();
  gotoUpdateBanner(Goto.startLL, null);
  toast('Route started — ' + route.length + ' waypoints. Follow the course line.');
  return true;
}
export function gotoRouteLabel() {
  if (!Goto.route) return;
  Goto.destName = 'WP ' + (Goto.legIdx + 1) + ' of ' + Goto.route.length;
}
/* nm still to run: the active leg plus every leg after it */
export function gotoRouteRemainingNm(from) {
  if (!Goto.route) return null;
  let nm = from ? nmBetween(from, Goto.dest) : 0;
  for (let i = Goto.legIdx; i < Goto.route.length - 1; i++) nm += nmBetween(Goto.route[i], Goto.route[i + 1]);
  return nm;
}

/** Pure: the steer cue from the bearing to the mark and the boat's heading / course. */
export function gotoSteerCue(brg, hd) {
  if (brg == null || hd == null || !isFinite(brg) || !isFinite(hd)) return { deg: null, dir: null, text: '' };
  const diff = ((brg - hd + 540) % 360) - 180;
  if (Math.abs(diff) <= 5) return { deg: diff, dir: 'on-course', text: 'on course' };
  return diff > 0
    ? { deg: diff, dir: 'right', text: 'turn ' + Math.round(diff) + '° right' }
    : { deg: diff, dir: 'left', text: 'turn ' + Math.round(-diff) + '° left' };
}

/** Pure: ETA over `etaNm` — live speed if moving (> 1 kn), else the planned cruise speed. */
export function gotoEta(etaNm, kn, plannedKn, now) {
  const spd = (kn != null && kn > 1) ? kn : (plannedKn || 0);
  const planned = !(kn != null && kn > 1);
  if (!(spd > 0) || etaNm == null || !isFinite(etaNm)) {
    return { text: 'ETA —', clock: '', at: null, ttgSec: null, ttgText: '', planned: planned, speedKn: spd > 0 ? spd : null };
  }
  const hrs = etaNm / spd;
  const at = new Date(now + hrs * 3600000);
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return {
    text: 'ETA ' + clock + ' · ' + fmtDur(hrs * 3600) + (planned ? ' @' + Math.round(spd) + 'kn' : ''),
    clock: clock, at: at.getTime(), ttgSec: hrs * 3600, ttgText: fmtDur(hrs * 3600), planned: planned, speedKn: spd,
  };
}

export function gotoUpdateBanner(ll, kn) {
  const dest = Goto.dest;
  if (!dest) return;
  const from = ll || Goto.startLL;
  /* With no position at all there is no distance, bearing or ETA to give. It used to
     show the 0 nm plan distance, "steer 0° N" and an ETA of "now" — every one invented. */
  const remNm = from ? nmBetween(from, dest) : null;
  const brg = from ? bearingBetween(from, dest) : null;

  // steer hint from GPS heading, if we have one
  /* Fall back to course-over-ground. Reading coords.heading alone meant the steer
     arrow — the one cue telling you WHICH WAY to turn — vanished on any device that
     reports null below a speed threshold, while the status bar showed a good heading. */
  let hd = (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.heading != null && !isNaN(GPS.last.coords.heading)) ? GPS.last.coords.heading : null;
  if (hd == null && typeof GPS !== 'undefined' && GPS.heading != null) hd = GPS.heading;
  const steer = from ? gotoSteerCue(brg, hd) : gotoSteerCue(null, null);

  // On a route the useful ETA is to the FINISH, not just the next waypoint.
  const routeRem = from ? gotoRouteRemainingNm(from) : null;
  const etaNm = routeRem != null ? routeRem : remNm;

  // ETA — use live speed if moving, else the planned cruise speed from Nav tools
  const eta = gotoEta(etaNm, kn, getRouteSpeedKn(), Date.now());

  // On a route the headline distance is the whole remaining run (not just the hop to the
  // next waypoint, which drops to ~0 as you pass each mark). Show the leg distance small.
  const headNm = routeRem != null ? routeRem : remNm;
  gotoStore.setState({
    active: Goto.active,
    arriving: Goto._arrived,
    name: Goto.destName,
    isRoute: !!Goto.route,
    wpIndex: Goto.route ? Goto.legIdx + 1 : 0,
    wpCount: Goto.route ? Goto.route.length : 0,
    hasFix: !!from,
    distNm: headNm,
    distMi: headNm != null ? headNm * 1.15078 : null,
    legNm: Goto.route ? remNm : null,
    legText: (Goto.route && remNm != null) ? 'leg ' + remNm.toFixed(2) + ' nm' : '',
    brgDeg: brg,
    brgCompass: brg != null && typeof compass === 'function' ? compass(brg) : '',
    steerDeg: steer.deg, steerDir: steer.dir, steerText: steer.text,
    steerLine: brg != null ? 'steer ' + Math.round(brg) + '° ' + (typeof compass === 'function' ? compass(brg) : '') : 'steer —',
    etaText: eta.text, etaClock: eta.clock, etaAt: eta.at, ttgSec: eta.ttgSec, ttgText: eta.ttgText,
    etaPlanned: eta.planned, etaSpeedKn: eta.speedKn,
    distText: headNm != null
      ? headNm.toFixed(2) + ' nm (' + (headNm * 1.15078).toFixed(1) + ' mi)' + (routeRem != null && remNm != null ? ' · leg ' + remNm.toFixed(2) + ' nm' : '')
      : '—',
    breadcrumbs: Goto.track.length,
  });

  // redraw the course line from where we are to the active waypoint …
  Goto._lastFrom = from;
  gotoDrawCourse(from, dest);
}

/* ---- Map symbology (DESIGN §5): ink casing under a signal core, round caps; the leg
   starts ahead of the bow, not under the hull (a line touching the hull's tip made the
   own-ship read backwards). Colours come from CSS classes — SVG attributes can't use var(). */
export const GOTO_BOW_PX = 26;
export function gotoBowStart(map, from, dest) {
  try {
    const a = map.latLngToLayerPoint(from), b = map.latLngToLayerPoint(dest);
    const d = a.distanceTo(b);
    if (!(d > GOTO_BOW_PX * 1.5)) return from;      // mark is right under the boat: draw from the hull
    const k = GOTO_BOW_PX / d;
    return map.layerPointToLatLng(L.point(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k));
  } catch (e) { return from; }
}
function casedLine(latlngs, ahead) {
  const opts = { interactive: false, lineCap: 'round', lineJoin: 'round' };
  return L.layerGroup([
    L.polyline(latlngs, { ...opts, weight: 7.5, className: 'nav-route-casing' + (ahead ? ' nav-route-casing--ahead' : '') }),
    L.polyline(latlngs, { ...opts, weight: 3.5, className: 'nav-route-core' + (ahead ? ' nav-route-core--ahead' : ''), dashArray: ahead ? '10 8' : undefined }),
  ]);
}
export function gotoDrawCourse(from, dest) {
  const map = getMap();
  if (!map) return;
  if (!Goto._hooked) {
    Goto._hooked = true;
    // the bow offset is in screen pixels — redraw when the scale changes
    map.on('zoomend', () => { if (Goto.active && Goto.dest) gotoDrawCourse(Goto._lastFrom, Goto.dest); });
  }
  if (Goto.line) { map.removeLayer(Goto.line); Goto.line = null; }
  if (from) Goto.line = casedLine([gotoBowStart(map, from, dest), dest], false).addTo(map);

  // …and the rest of the route ahead of it, so there's a line to follow
  if (Goto.routeLine) { map.removeLayer(Goto.routeLine); Goto.routeLine = null; }
  if (Goto.route && Goto.legIdx < Goto.route.length - 1) {
    Goto.routeLine = casedLine(Goto.route.slice(Goto.legIdx), true).addTo(map);
  }
}

/* Destination: ink disc, signal ring, white centre, name on an ink chip beside it. */
export function gotoDestIcon(name) {
  return L.divIcon({
    className: 'nav-dest', iconSize: [28, 28], iconAnchor: [14, 14],
    html: '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">' +
      '<circle cx="14" cy="14" r="10" class="nav-dest__disc"/><circle cx="14" cy="14" r="3.5" class="nav-dest__dot"/></svg>' +
      (name ? '<span class="map-chip nav-dest__chip">' + escapeHtml(name) + '</span>' : ''),
  });
}
function gotoRefreshDestMarker() {
  if (!Goto.destMarker) return;
  Goto.destMarker.setLatLng(Goto.dest);
  Goto.destMarker.setIcon(gotoDestIcon(Goto.destName));
}

/* Arrival radius scales with speed — a boat at 25 kn crosses a fixed 148 m circle
   in twelve seconds, which one slow fix can straddle entirely. */
export function gotoArrivalNm(kn) {
  const base = 0.08;
  if (kn == null || !isFinite(kn) || kn <= 6) return base;
  return Math.min(0.25, base + (kn - 6) * 0.006);
}
/* Where "arriving" clears again. Legacy cleared it at a fixed 0.12 nm — 1.5x the 0.08 nm base
   radius. But the radius grows with speed (up to 0.25 nm), so at speed the exit sat INSIDE the
   entry radius: anywhere between the two the state flipped on every fix, re-toasting
   "Arriving at…" and moving the Arrived button under the user's thumb. Exit at 1.5x the radius
   that was in force, never below the legacy 0.12 nm. */
export const GOTO_ARRIVE_EXIT_MIN_NM = 0.12;
export const GOTO_ARRIVE_EXIT_FACTOR = 1.5;
export function gotoArrivalExitNm(entryNm) {
  const e = (entryNm != null && isFinite(entryNm) && entryNm > 0) ? entryNm : 0;
  return Math.max(GOTO_ARRIVE_EXIT_MIN_NM, e * GOTO_ARRIVE_EXIT_FACTOR);
}
/* Have we finished this leg? Either we're inside the arrival circle, or we've
   crossed the plane through the waypoint — i.e. the mark is now behind the beam
   relative to the leg we were running. */
export function gotoLegIsDone(ll, rem, kn) {
  if (rem < gotoArrivalNm(kn)) return true;
  const prev = Goto.legIdx > 0 ? Goto.route[Goto.legIdx - 1] : Goto.startLL;
  if (!prev) return false;
  const legBrg = bearingBetween(prev, Goto.dest);
  const toDest = bearingBetween(ll, Goto.dest);
  const off = Math.abs(((toDest - legBrg + 540) % 360) - 180);
  /* >90° means the waypoint is behind us along the leg. Require a sane distance
     too, so a wild fix right on top of the mark can't skip the rest of the route. */
  return off > 90 && rem < 2;
}

/* Called every GPS fix (from navOnFix). */
export function gotoOnFix(ll, kn) {
  if (!Goto.active || !ll) return;
  if (!Goto._lastPt || ll.distanceTo(Goto._lastPt) >= 10 || Date.now() - Goto._lastTs > 5000) {
    Goto.track.push([ll.lat, ll.lng]); Goto._lastPt = ll; Goto._lastTs = Date.now();
  }
  if (kn != null) Goto.maxKn = Math.max(Goto.maxKn, kn);
  if (!Goto.startLL) { Goto.startLL = ll; Goto.planNm = nmBetween(ll, Goto.dest); }  // GPS came late

  let rem = nmBetween(ll, Goto.dest);

  /* Following a route: advance when we reach a waypoint — or when we've passed it.
     Proximity alone wasn't enough: set wide around a headland by a current and you'd
     never come inside the radius, so the app kept steering you BACK to a mark you'd
     already cleared. Loop, so a GPS gap across several short legs catches up too. */
  if (Goto.route) {
    let advanced = 0;
    while (Goto.legIdx < Goto.route.length - 1 &&
           gotoLegIsDone(ll, rem, kn) && advanced < Goto.route.length) {
      Goto.legIdx++;
      Goto.dest = Goto.route[Goto.legIdx];
      advanced++;
      rem = nmBetween(ll, Goto.dest);
    }
    if (advanced) {
      gotoRouteLabel();
      // move the destination pin (and its name chip) forward to the new active waypoint —
      // it used to stay frozen on WP 1 for the whole voyage while the banner advanced
      gotoRefreshDestMarker();
      Goto._arrived = false; Goto._arrivedNm = 0;
      toast('WP ' + Goto.legIdx + ' reached — steering to WP ' + (Goto.legIdx + 1));
      gotoUpdateBanner(ll, kn);
      return;
    }
  }

  const arriveNm = gotoArrivalNm(kn);
  if (rem < arriveNm && !Goto._arrived) {
    Goto._arrived = true;
    Goto._arrivedNm = arriveNm;
    toast('Arriving at ' + Goto.destName + ' — tap Arrived to log it');
  } else if (Goto._arrived) {
    // the exit follows the widest radius seen while arriving, so speeding up can't make it flap
    Goto._arrivedNm = Math.max(Goto._arrivedNm || 0, arriveNm);
    if (rem >= gotoArrivalExitNm(Goto._arrivedNm)) { Goto._arrived = false; Goto._arrivedNm = 0; }
  }
  gotoUpdateBanner(ll, kn);
}

export function gotoArrive() { return gotoEnd(true); }
export async function gotoCancel() {
  if (Goto.track.length > 2) {
    const run = Goto._run;
    const ok = await confirmDialog({
      title: 'Stop navigating?',
      message: 'End navigation without saving this voyage?',
      confirmLabel: 'End without saving', destructive: true,
    });
    if (!ok) return;
    // ended (Arrived) or replaced by a new Go-To while the question was up — nothing to cancel
    if (!Goto.active || Goto._run !== run) return;
  }
  await gotoEnd(false);
}

export async function gotoEnd(save) {
  /* `Goto.active` isn't cleared until after the await below, so a double-tap on
     ✓ Arrived — easy on a wet screen in a seaway — used to write the voyage twice. */
  if (Goto._ending) return;
  Goto._ending = true;
  gotoStore.setState({ ending: true });
  const run = Goto._run;
  try {
  if (save) {
    if (Goto.track.length >= 2 && Goto.startLL) {
      const actualNm = trackDistanceNm(Goto.track);
      const end = Date.now();
      const durS = (end - Goto.startTs) / 1000;
      const trip = {
        name: Goto.route ? ('Route · ' + Goto.route.length + ' waypoints') : ('To ' + Goto.destName),
        dest: { lat: Goto.dest.lat, lng: Goto.dest.lng, name: Goto.destName },
        start: Goto.startTs, end: end,
        planNm: Goto.planNm, actualNm: actualNm,
        avgKn: durS > 10 ? actualNm / (durS / 3600) : 0, maxKn: Goto.maxKn,
        points: Goto.track,
      };
      try {
        await idb.put('trips', trip);
        renderTripsList();
        toast('Voyage saved — ' + actualNm.toFixed(1) + ' nm in ' + fmtDur((end - Goto.startTs) / 1000));
      } catch (e) {
        /* The write used to fail silently (quota, private mode, storage gone) and the
           voyage simply vanished. Say so, and keep it in memory where it can be retried
           or saved as a file. */
        gotoKeepUnsaved(trip, e);
      }
    } else {
      toast('Voyage too short to save');
    }
  }
  // A new Go-To started while the save was in flight — don't tear down the new run.
  if (Goto._run === run) {
    Goto.active = false;
    Goto._arrived = false; Goto._arrivedNm = 0;
    gotoClearLayers();
    gotoStore.setState({ ...GOTO_IDLE, ending: true });
  }
  } finally {
    Goto._ending = false;
    gotoStore.setState({ ending: false });
    awakeSyncBackgroundLocation();
    /* We're no longer "busy", so a held-back app update can land now. Without this
       the toast promised "applies when you stop" and then never did. Not while a
       voyage that failed to save exists only in memory — a reload would lose it. */
    gotoApplyUpdateIfSafe();
  }
}

/* A reload into a waiting app update loses EVERYTHING held only in memory — a voyage whose
   write failed here, and equally a track whose write failed in tracks.js. Each module used to
   check only its own list, so ending a Go-To reloaded away an unsaved track (and stopping a
   recording, an unsaved voyage). Until app.js's updateWouldInterrupt() checks both
   (docs/requests/navigation.md #1), every hand-over to applyPendingUpdate goes through here. */
export function navUnsavedInMemory() {
  return gotoHasUnsaved() || (typeof tracksHaveUnsaved === 'function' && tracksHaveUnsaved());
}
export function gotoApplyUpdateIfSafe() {
  if (navUnsavedInMemory()) return false;
  applyPendingUpdate();
  return true;
}

export function gotoClearLayers() {
  const map = getMap();
  if (Goto.line) { if (map) map.removeLayer(Goto.line); Goto.line = null; }
  if (Goto.routeLine) { if (map) map.removeLayer(Goto.routeLine); Goto.routeLine = null; }
  if (Goto.destMarker) { if (map) map.removeLayer(Goto.destMarker); Goto.destMarker = null; }
  Goto._lastFrom = null;
}

function errMsg(e) { return (e && e.message) || String(e || 'unknown error'); }

function gotoKeepUnsaved(trip, e) {
  const id = 'unsaved-' + (++Goto._unsavedSeq);
  Goto.unsaved.unshift({ ...trip, id: id, _error: errMsg(e) });
  publishTrips();
  toast('Voyage NOT saved — storage error (' + errMsg(e) + '). It is kept until the app closes: retry or save it as a file from Spots & tracks.',
    { action: { label: 'Retry', run: () => { tripRetrySave(id); } }, ms: 9000 });
}

/** True while a voyage exists only in memory (its storage write failed). */
export function gotoHasUnsaved() { return Goto.unsaved.length > 0; }

/** Retry the storage write of a voyage that failed to save. Resolves true when saved. */
export async function tripRetrySave(id) {
  const rec = Goto.unsaved.find((t) => t.id === id);
  if (!rec) return false;
  const copy = { ...rec };
  delete copy.id; delete copy._error;
  let key;
  try {
    key = await idb.put('trips', copy);
  } catch (e) {
    rec._error = errMsg(e);
    publishTrips();
    toast('Still could not save the voyage — ' + errMsg(e));
    return false;
  }
  /* The saved copy has a new IndexedDB key. Anything still pointing at 'unsaved-N' — the path
     on the chart, the open history card — is moved over to it once the list has reloaded;
     the card used to say "This voyage is no longer saved" right after a successful save. */
  const wasShown = !!Goto.shown[id];
  hideTripLayer(id);
  Goto.unsaved = Goto.unsaved.filter((t) => t.id !== id);
  // the record is in storage now under `key`; list it there straight away (the reload below confirms it)
  const saved = (key != null) ? { ...copy, id: key } : null;
  if (saved) Goto.saved[key] = saved;
  if (saved && wasShown) drawTripLayer(saved);
  const c = uiStore.getState().card;
  if (c && c.kind === 'history' && c.data && c.data.type === 'trip' && c.data.id === id) {
    if (saved) updateCard(c.id, { id: saved.id }); else closeCard('history');
  }
  publishTrips();
  toast('Voyage saved');
  await renderTripsList();
  if (!Goto.active) gotoApplyUpdateIfSafe();
  return true;
}

/** Hand an unsaved voyage to the share sheet / a download as a FishApp backup file
 *  (Spots & tracks → Import brings it back). */
export async function tripSaveAsFile(id) {
  const rec = Goto.unsaved.find((t) => t.id === id);
  if (!rec) return;
  const copy = { ...rec };
  delete copy.id; delete copy._error;
  const data = { app: 'FishApp', version: 2, exported: new Date().toISOString(), spots: [], tracks: [], catches: [], trips: [copy] };
  try {
    await saveOrShareFile({ name: 'fishapp-voyage-' + new Date(rec.start).toISOString().slice(0, 10) + '.json', mime: 'application/json', data: JSON.stringify(data, null, 1), title: rec.name });
  } catch (e) { toast('Could not save the file — ' + errMsg(e)); }
}

/* ---- Voyage archive ---- */
function tripSummary(t, unsaved) {
  return {
    id: t.id, name: t.name || 'Voyage', destName: (t.dest && t.dest.name) || '',
    start: t.start || 0, end: t.end || t.start || 0,
    actualNm: Number(t.actualNm) || 0, planNm: Number(t.planNm) || 0,
    avgKn: Number(t.avgKn) || 0, maxKn: Number(t.maxKn) || 0,
    unsaved: !!unsaved, error: unsaved ? (t._error || '') : '',
  };
}
function publishTrips(patch) {
  const saved = Object.keys(Goto.saved).map((k) => Goto.saved[k]).sort((a, b) => b.start - a.start);
  /** @type {Record<string, boolean>} */
  const shown = {};
  Object.keys(Goto.shown).forEach((k) => { shown[k] = true; });
  tripsStore.setState({
    items: [...Goto.unsaved.map((t) => tripSummary(t, true)), ...saved.map((t) => tripSummary(t, false))],
    shown: shown,
    ...(patch || {}),
  });
}
export function gotoFindTrip(id) {
  return Goto.saved[id] || Goto.unsaved.find((t) => t.id === id) || null;
}

/* Load the archive into tripsStore (was: render #trips-list). Kept under its old name —
   the backup import calls it after adding records. */
export async function renderTripsList() {
  const seq = ++Goto._loadSeq;
  if (tripsStore.getState().status !== 'ready') tripsStore.setState({ status: 'loading', error: '' });
  try {
    const all = await idb.getAll('trips');
    if (seq !== Goto._loadSeq) return;
    Goto.saved = {};
    (all || []).forEach((t) => { Goto.saved[t.id] = t; });
    publishTrips({ status: 'ready', error: '' });
  } catch (e) {
    if (seq !== Goto._loadSeq) return;
    publishTrips({ status: 'error', error: errMsg(e) });
  }
}
export const loadTrips = renderTripsList;

function hideTripLayer(id) {
  const map = getMap();
  if (Goto.shown[id]) { if (map) map.removeLayer(Goto.shown[id]); delete Goto.shown[id]; }
}

/* Draw a saved voyage's path + destination pin (no map moves). Returns the polyline. */
function drawTripLayer(rec) {
  const map = getMap();
  if (!map || !rec || !rec.points || !rec.points.length) return null;
  const poly = L.polyline(rec.points, { className: 'nav-track-line', weight: 2.5, lineCap: 'round', dashArray: '1 6', interactive: false });
  const layers = [poly];
  if (rec.dest && isFinite(rec.dest.lat) && isFinite(rec.dest.lng)) {
    layers.push(L.marker([rec.dest.lat, rec.dest.lng], { icon: gotoDestIcon(rec.dest.name), interactive: false, keyboard: false }));
  }
  Goto.shown[rec.id] = L.layerGroup(layers).addTo(map);
  return poly;
}

/* Under way — a Go-To running or a track recording — the boat's own position comes first.
   Showing an old voyage then must not switch Follow off (it has no auto-refollow, so the boat
   ran off-screen), and, during a Go-To, must not open a card over the Go-To card (only one
   card shows at a time, so the steering guidance vanished mid-voyage). Legacy kept the
   banner up and Follow on there too. */
export function navUnderWay() {
  return !!(Goto.active || (Tracks && Tracks.recording));
}

/* Show / hide a saved voyage on the chart (accepts the record or its id). Showing it
   closes the sheet, fits the map to the path and opens its history card. Follow is
   turned off: with it on, the next fix snapped the chart straight back to the boat.
   Under way (see navUnderWay) Follow stays on and, during a Go-To, no card opens. */
export function gotoToggleTripPath(t) {
  const rec = (t && typeof t === 'object') ? (gotoFindTrip(t.id) || t) : gotoFindTrip(t);
  if (!rec) return;
  const map = getMap();
  if (Goto.shown[rec.id]) {
    hideTripLayer(rec.id);
    const c = uiStore.getState().card;
    if (c && c.kind === 'history' && c.data && c.data.type === 'trip' && c.data.id === rec.id) closeCard('history');
  } else if (map && rec.points && rec.points.length) {
    const poly = drawTripLayer(rec);
    closePanels();
    const underWay = navUnderWay();
    if (!underWay) setFollow(false);
    try { if (poly) mapProgrammatic(() => map.fitBounds(poly.getBounds(), { padding: [40, 40] })); } catch (e) {}
    if (Goto.active) toast('Voyage shown on the chart — Follow stays on while you navigate');
    else openCard('history', { type: 'trip', id: rec.id });
  }
  publishTrips();
}
export const toggleTripShown = gotoToggleTripPath;

/** Delete a saved (or unsaved) voyage after an in-app confirm. Resolves true if deleted. */
export async function deleteTrip(id) {
  const ok = await confirmDialog({ title: 'Delete this voyage?', confirmLabel: 'Delete', destructive: true });
  if (!ok) return false;
  if (!gotoFindTrip(id)) return false;               // already gone while the question was up
  hideTripLayer(id);
  const c = uiStore.getState().card;
  if (c && c.kind === 'history' && c.data && c.data.type === 'trip' && c.data.id === id) closeCard('history');
  if (Goto.unsaved.some((t) => t.id === id)) {
    Goto.unsaved = Goto.unsaved.filter((t) => t.id !== id);
    publishTrips();
    return true;
  }
  try {
    await idb.del('trips', id);
  } catch (e) {
    toast('Could not delete the voyage — ' + errMsg(e));
    return false;
  }
  await renderTripsList();
  return true;
}
