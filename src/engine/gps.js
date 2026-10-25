import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { refreshSpotDistances } from './spots.js';
import { trackOnFix } from './tracks.js';
import { awakeUpdateUi } from './awake.js';
import { navOnFix, navOnGpsLost, navOnGpsStale } from './nav.js';
import { toast } from '../services/ui';

/* GPS position, boat marker, follow mode, wake lock */
'use strict';

export const GPS = {
  watchId: null,
  last: null,          // last GeolocationPosition
  lastLatLng: null,
  lastFixTs: 0,        // Date.now() of the last ACCEPTED fix — 0 means "never had one"
  heading: null,       // resolved heading (device heading, else course over ground)
  accuracy: null,      // metres, from the last accepted fix
  coarse: false,       // true when the last fix was too fuzzy to trust for distance work
  follow: true,
  marker: null,
  accCircle: null,
  wakeLock: null,
  _hadFirstFix: false,
};

/* What the HUD, the Emergency sheet and everything else on screen read. Plain data only.
   status: 'searching' (no fix yet) | 'fix' | 'denied' (permission refused) | 'lost' (error)
   quality: 'ok' (≤20 m) | 'warn' (coarser) | 'none' — the legacy dot colours. */
/**
 * @typedef {Object} GpsView
 * @property {'searching'|'fix'|'denied'|'lost'} status
 * @property {'ok'|'warn'|'none'} quality
 * @property {number|null} accM
 * @property {number|null} sogKn
 * @property {number|null} cogDeg
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {number} fixAt
 * @property {boolean} follow
 */
/** @type {import('zustand/vanilla').StoreApi<GpsView>} */
export const gpsStore = createStore(() => /** @type {GpsView} */ ({
  status: 'searching',
  quality: 'none',
  accM: null,
  sogKn: null,
  cogDeg: null,
  lat: null,
  lng: null,
  fixAt: 0,
  follow: true,
}));

export const KNOTS_PER_MS = 1.94384; // m/s -> knots

/* A fix this old means we've gone blind — the OS stopped delivering, the tab was
   frozen, or permission was pulled. Anything that keeps you safe (anchor watch)
   has to notice, because "no new fix" looks exactly like "not moving". */
export const GPS_STALE_MS = 60000;
/* Above this the position is a cell-tower/wifi guess, not a GPS lock. Still shown
   (better than a blank screen) but not trusted to move a distance total. */
export const GPS_COARSE_M = 100;
/* No boat does 200 kn. A jump faster than this is multipath or a provider glitch. */
export const GPS_MAX_MPS = 103;

export function gpsIsStale() { return !GPS.lastFixTs || (Date.now() - GPS.lastFixTs) > GPS_STALE_MS; }

/* Reject fixes that would poison everything downstream. One bogus (0,0) used to
   pan the map to the Atlantic, add thousands of nm to the trip and track, and set
   off the anchor alarm — all from a single bad callback. */
export function gpsFixIsSane(c) {
  if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return false;
  if (Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return false;
  if (c.latitude === 0 && c.longitude === 0) return false;             // null island
  if (GPS.lastLatLng && GPS.lastFixTs) {
    const dt = (Date.now() - GPS.lastFixTs) / 1000;
    if (dt > 0 && dt < 60) {
      const m = L.latLng(c.latitude, c.longitude).distanceTo(GPS.lastLatLng);
      if (m / dt > GPS_MAX_MPS) return false;                          // teleport
    }
  }
  return true;
}

export function gpsStart(map) {
  if (!('geolocation' in navigator)) {
    toast('GPS not available on this device');
    gpsStore.setState({ status: 'lost', quality: 'none' });
    return;
  }
  GPS.watchId = navigator.geolocation.watchPosition(
    (pos) => gpsOnFix(map, pos),
    (err) => {
      gpsStore.setState({ status: err.code === 1 ? 'denied' : 'lost', quality: 'none' });
      /* Don't leave a stale position looking live: anything that navigates off
         GPS needs to know the feed died, not keep trusting the last fix. */
      if (typeof navOnGpsLost === 'function') navOnGpsLost();
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 }
  );
  requestWakeLock();
  /* Watchdog: watchPosition simply stops calling back when the OS suspends the
     tab or drops the provider — no error fires. Poll for that silence. */
  clearInterval(GPS._staleTimer);
  GPS._staleTimer = setInterval(() => {
    if (gpsIsStale() && typeof navOnGpsStale === 'function') navOnGpsStale();
  }, 15000);
}

export function gpsOnFix(map, pos) {
  const c = pos && pos.coords;
  if (!gpsFixIsSane(c)) return;          // drop it before it reaches any consumer
  GPS.last = pos;
  const ll = L.latLng(c.latitude, c.longitude);
  GPS.accuracy = isFinite(c.accuracy) ? c.accuracy : null;
  GPS.coarse = GPS.accuracy == null || GPS.accuracy > GPS_COARSE_M;

  /* Heading: device heading if moving, else bearing from previous point */
  let heading = null;
  if (c.heading !== null && !isNaN(c.heading) && c.speed !== null && c.speed > 0.3) {
    heading = c.heading;
  } else if (GPS.lastLatLng && ll.distanceTo(GPS.lastLatLng) > 3) {
    heading = bearingBetween(GPS.lastLatLng, ll);
  }
  /* Publish it. The Go To steer arrow used to read coords.heading directly, so it
     vanished on any device that reports null below a speed threshold — even though
     the status bar was showing a perfectly good course-over-ground right next to it. */
  if (heading !== null) GPS.heading = heading;

  /* Boat marker */
  if (!GPS.marker) {
    GPS.marker = L.marker(ll, { icon: boatIcon(heading), zIndexOffset: 1000, interactive: false }).addTo(map);
    GPS._renderedHeading = heading;
    GPS.accCircle = L.circle(ll, {
      radius: c.accuracy || 0, weight: 1, className: 'gps-acc-circle', interactive: false,
    }).addTo(map);
  } else {
    GPS.marker.setLatLng(ll);
    // Rebuilding the SVG divIcon every fix is costly; only redraw on a real heading change.
    if (heading !== null && (GPS._renderedHeading == null ||
        Math.abs(((heading - GPS._renderedHeading + 540) % 360) - 180) >= 3)) {
      GPS.marker.setIcon(boatIcon(heading));
      GPS._renderedHeading = heading;
    }
    GPS.accCircle.setLatLng(ll).setRadius(c.accuracy || 0);
  }

  /* Instruments */
  const kn = c.speed !== null && !isNaN(c.speed) ? (c.speed * KNOTS_PER_MS) : null;
  const now = Date.now();
  gpsStore.setState({
    status: 'fix',
    quality: GPS.accuracy != null && GPS.accuracy <= 20 ? 'ok' : 'warn',
    accM: GPS.accuracy,
    sogKn: kn,
    cogDeg: heading,
    lat: c.latitude,
    lng: c.longitude,
    fixAt: now,
  });

  /* Follow */
  if (GPS.follow) {
    if (!GPS._hadFirstFix) {
      map.setView(ll, Math.max(map.getZoom(), 13));
    } else {
      map.panTo(ll, { animate: true, duration: 0.4 });
    }
  }
  GPS._hadFirstFix = true;
  GPS.lastLatLng = ll;
  GPS.lastFixTs = now;

  trackOnFix(ll, pos.timestamp, kn); // feed track recorder
  if (typeof navOnFix === 'function') navOnFix(ll, kn); // feed trip stats + anchor alarm
  refreshSpotDistances();
}

/* Own-ship: a hull silhouette (pointed bow, square stern) rotated to course — never a generic
   nav arrow, which read backwards once a route line touched its tip. Before any heading is
   known it is a plain disc (direction unknown, said honestly). Colours come from the theme. */
export function boatIcon(heading) {
  const svg = heading !== null
    ? `<svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(${heading}deg)" aria-hidden="true">
         <path d="M22 4.5c3.6 3.7 5.6 8.6 5.6 14.2V39.5H16.4V18.7c0-5.6 2-10.5 5.6-14.2z" class="own-keyline"/>
         <path d="M22 4.5c3.6 3.7 5.6 8.6 5.6 14.2V39.5H16.4V18.7c0-5.6 2-10.5 5.6-14.2z" class="own-hull"/>
       </svg>`
    : `<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
         <circle cx="22" cy="22" r="9" class="own-keyline"/><circle cx="22" cy="22" r="9" class="own-hull"/>
       </svg>`;
  return L.divIcon({ className: 'boat-icon', html: svg, iconSize: [44, 44], iconAnchor: [22, 22] });
}

/* Wrap a deliberate "take me to this place" map move. The auto-refollow timer
   watches zoomstart, which can't otherwise tell a user pinch from setView/fitBounds
   — so tapping ➜ on a distant mark got silently yanked back to the boat. */
export function mapProgrammatic(fn) {
  GPS._programmaticMove = true;
  clearTimeout(GPS._progTimer);
  try { fn(); } finally {
    GPS._progTimer = setTimeout(() => { GPS._programmaticMove = false; }, 800);
  }
}

export function setFollow(on) {
  GPS.follow = on;
  gpsStore.setState({ follow: on });
  if (on && GPS.lastLatLng) window._map.panTo(GPS.lastLatLng);
}

/* What the Device section shows about the screen lock. kind: ok | off | warn | unsupported.
   Report what is ACTUALLY true right now, not what we asked for (see renderStatus). */
/** @type {import('zustand/vanilla').StoreApi<{kind: 'ok'|'off'|'warn'|'unsupported', text: string}>} */
export const wakeStore = createStore(() => ({ kind: /** @type {'ok'|'off'|'warn'|'unsupported'} */ ('off'), text: '' }));

/* Keep the screen awake the whole time the app is open (iOS 16.4+, Android).
   The OS drops the lock whenever the app is hidden, so we re-acquire on every
   return-to-visible and after any interaction. Toggleable; on by default. */
export const WakeLock = {
  lock: null,
  enabled: safeGet('fishapp.wake') !== 'off',
  supported: 'wakeLock' in navigator,
  _pending: false,
  async acquire() {
    if (!this.enabled || !this.supported) return;
    if (document.visibilityState !== 'visible' || this.lock || this._pending) return;
    /* Flag BEFORE the await. `this.lock` is only assigned after it, so one screen
       tap (which fires pointerdown + touchstart + click) used to slip three
       requests past the guard and strand two sentinels that release() could never
       reach — the screen then stayed lit after the user turned the wake lock off. */
    this._pending = true;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.failed = false;
      this.lock.addEventListener('release', () => {
        this.lock = null;
        // the banner and settings line must stop claiming the screen will stay on
        this.renderStatus();
        if (typeof awakeUpdateUi === 'function') awakeUpdateUi();
      });
    } catch (e) {
      /* Record it. Failing silently meant the settings line kept saying "Screen
         stays on while the app is open" when it demonstrably wasn't — and an
         anchor watch was relying on that being true. */
      this.lock = null;
      this.failed = true;
      this.failReason = (e && e.message) || String(e);
    } finally {
      this._pending = false;
      this.renderStatus();
      if (typeof awakeUpdateUi === 'function') awakeUpdateUi();
    }
  },
  async release() {
    if (this.lock) { try { await this.lock.release(); } catch (e) {} this.lock = null; }
    this.renderStatus();
  },
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('fishapp.wake', on ? 'on' : 'off'); } catch (e) {}
    if (on) this.acquire(); else this.release();
    this.renderStatus();
  },
  /* Report what is ACTUALLY true right now, not what we asked for. The text used to
     be written once, optimistically, before the async request had even resolved — so
     it read "Screen stays on while the app is open" on devices where the lock had
     been refused outright. An anchor watch was trusting that sentence. */
  renderStatus() {
    if (!this.supported) { wakeStore.setState({ kind: 'unsupported', text: 'Not supported on this device/browser' }); return; }
    if (!this.enabled) { wakeStore.setState({ kind: 'off', text: 'Off — phone may sleep normally' }); return; }
    if (this.lock) { wakeStore.setState({ kind: 'ok', text: 'Holding the screen on' }); return; }
    if (this.failed) {
      wakeStore.setState({
        kind: 'warn',
        text: 'The browser refused to hold the screen on' + (this.failReason ? ' (' + this.failReason + ')' : '') + ' — it may still sleep',
      });
      return;
    }
    wakeStore.setState({ kind: 'off', text: 'On — holds the screen once the app is in front' });
  },
};
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
/* Re-acquire whenever the app comes back to the foreground or the user interacts
   (some browsers only grant the lock right after a gesture). */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') WakeLock.acquire(); });
['pointerdown', 'touchstart', 'click'].forEach((ev) => document.addEventListener(ev, () => WakeLock.acquire(), { passive: true }));

/* back-compat alias used elsewhere (gpsStart, anchor drop) */
export function requestWakeLock() { WakeLock.acquire(); }

/* ---- Geo math ---- */
export function bearingBetween(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/* Current map bounds clamped to VALID lat/lon so data requests never get a wrapped
   (< -180 or > 180) or whole-world box that errors or blows up memory. */
export function mapBoundsClamped() {
  const b = window._map.getBounds();
  let w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  if (e - w >= 359) { w = -179.9; e = 179.9; }        // spans the world → cap to valid full range
  w = Math.max(-180, Math.min(179, w));
  e = Math.min(180, Math.max(w + 0.05, e));
  s = Math.max(-85, Math.min(84, s));
  n = Math.min(85, Math.max(s + 0.05, n));
  return { s: s, n: n, w: w, e: e };
}

export function formatCoord(v, axis) {
  const hemi = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const abs = Math.abs(v);
  /* Round to thousandths of a minute FIRST, then split. Flooring the degrees and
     rounding the minutes independently could print 25°60.000'N — not a coordinate,
     and this is the number you read to the Coast Guard over VHF. */
  const t = Math.round(abs * 60000);
  const deg = Math.floor(t / 60000);
  const min = (t % 60000) / 1000;
  return deg + '°' + min.toFixed(3) + "'" + hemi;
}

export function nmBetween(a, b) { return a.distanceTo(b) / 1852; } // meters -> nautical miles
