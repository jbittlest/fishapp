/* GPS position, boat marker, follow mode, wake lock */
'use strict';

const GPS = {
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

const KNOTS_PER_MS = 1.94384; // m/s -> knots

/* A fix this old means we've gone blind — the OS stopped delivering, the tab was
   frozen, or permission was pulled. Anything that keeps you safe (anchor watch)
   has to notice, because "no new fix" looks exactly like "not moving". */
const GPS_STALE_MS = 60000;
/* Above this the position is a cell-tower/wifi guess, not a GPS lock. Still shown
   (better than a blank screen) but not trusted to move a distance total. */
const GPS_COARSE_M = 100;
/* No boat does 200 kn. A jump faster than this is multipath or a provider glitch. */
const GPS_MAX_MPS = 103;

function gpsIsStale() { return !GPS.lastFixTs || (Date.now() - GPS.lastFixTs) > GPS_STALE_MS; }

/* Reject fixes that would poison everything downstream. One bogus (0,0) used to
   pan the map to the Atlantic, add thousands of nm to the trip and track, and set
   off the anchor alarm — all from a single bad callback. */
function gpsFixIsSane(c) {
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

/* Cache the status-bar element refs — gpsOnFix runs every fix, so avoid re-querying the DOM. */
const _gpsEl = {};
function gpsEl(id) { return _gpsEl[id] || (_gpsEl[id] = document.getElementById(id)); }

function gpsStart(map) {
  if (!('geolocation' in navigator)) {
    toast('GPS not available on this device');
    return;
  }
  GPS.watchId = navigator.geolocation.watchPosition(
    (pos) => gpsOnFix(map, pos),
    (err) => {
      const el = document.getElementById('gps-acc');
      const dot = document.getElementById('gps-dot');
      dot.className = 'dot';
      el.textContent = err.code === 1 ? 'GPS DENIED' : 'NO GPS';
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

function gpsOnFix(map, pos) {
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
      radius: c.accuracy || 0, weight: 1, color: '#4aa3e0',
      fillColor: '#4aa3e0', fillOpacity: 0.12, interactive: false,
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

  /* Status bar */
  gpsEl('gps-dot').className = 'dot ' + (GPS.accuracy != null && GPS.accuracy <= 20 ? 'ok' : 'warn');
  gpsEl('gps-acc').textContent = GPS.accuracy != null ? '±' + Math.round(GPS.accuracy) + 'm' : '±?';
  const kn = c.speed !== null && !isNaN(c.speed) ? (c.speed * KNOTS_PER_MS) : null;
  gpsEl('stat-speed').textContent = kn !== null ? kn.toFixed(1) : '—';
  gpsEl('stat-heading').textContent = heading !== null ? Math.round(heading) : '—';
  gpsEl('stat-coords').innerHTML =
    formatCoord(c.latitude, 'lat') + '<br>' + formatCoord(c.longitude, 'lon');

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
  GPS.lastFixTs = Date.now();

  trackOnFix(ll, pos.timestamp, kn); // feed track recorder
  if (typeof navOnFix === 'function') navOnFix(ll, kn); // feed trip stats + anchor alarm
  if (typeof updateEmergency === 'function' && !document.getElementById('panel-emergency').classList.contains('hidden')) updateEmergency();
  refreshSpotDistances();
}

function boatIcon(heading) {
  const rot = heading !== null ? heading : 0;
  const showArrow = heading !== null;
  const svg = showArrow
    ? `<svg width="40" height="40" viewBox="0 0 40 40" style="transform:rotate(${rot}deg)">
         <path d="M20 4 L30 32 L20 26 L10 32 Z" fill="#2ecc71" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
       </svg>`
    : `<svg width="40" height="40" viewBox="0 0 40 40">
         <circle cx="20" cy="20" r="9" fill="#2ecc71" stroke="#fff" stroke-width="3"/>
       </svg>`;
  return L.divIcon({ className: 'boat-icon', html: svg, iconSize: [40, 40], iconAnchor: [20, 20] });
}

/* Wrap a deliberate "take me to this place" map move. The auto-refollow timer
   watches zoomstart, which can't otherwise tell a user pinch from setView/fitBounds
   — so tapping ➜ on a distant mark got silently yanked back to the boat. */
function mapProgrammatic(fn) {
  GPS._programmaticMove = true;
  clearTimeout(GPS._progTimer);
  try { fn(); } finally {
    GPS._progTimer = setTimeout(() => { GPS._programmaticMove = false; }, 800);
  }
}

function setFollow(on) {
  GPS.follow = on;
  document.getElementById('btn-follow').classList.toggle('active', on);
  if (on && GPS.lastLatLng) window._map.panTo(GPS.lastLatLng);
}

/* Keep the screen awake the whole time the app is open (iOS 16.4+, Android).
   The OS drops the lock whenever the app is hidden, so we re-acquire on every
   return-to-visible and after any interaction. Toggleable; on by default. */
const WakeLock = {
  lock: null,
  enabled: localStorage.getItem('fishapp.wake') !== 'off',
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
      this.lock.addEventListener('release', () => { this.lock = null; });
    } catch (e) { this.lock = null; }
    finally { this._pending = false; }
  },
  async release() {
    if (this.lock) { try { await this.lock.release(); } catch (e) {} this.lock = null; }
  },
  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('fishapp.wake', on ? 'on' : 'off');
    if (on) this.acquire(); else this.release();
    const s = document.getElementById('wake-status');
    if (s) s.textContent = !this.supported ? 'Not supported on this device/browser'
      : (on ? 'Screen stays on while the app is open' : 'Off — phone may sleep normally');
  },
};
/* Re-acquire whenever the app comes back to the foreground or the user interacts
   (some browsers only grant the lock right after a gesture). */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') WakeLock.acquire(); });
['pointerdown', 'touchstart', 'click'].forEach((ev) => document.addEventListener(ev, () => WakeLock.acquire(), { passive: true }));

/* back-compat alias used elsewhere (gpsStart, anchor drop) */
function requestWakeLock() { WakeLock.acquire(); }

/* ---- Geo math ---- */
function bearingBetween(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/* Current map bounds clamped to VALID lat/lon so data requests never get a wrapped
   (< -180 or > 180) or whole-world box that errors or blows up memory. */
function mapBoundsClamped() {
  const b = window._map.getBounds();
  let w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  if (e - w >= 359) { w = -179.9; e = 179.9; }        // spans the world → cap to valid full range
  w = Math.max(-180, Math.min(179, w));
  e = Math.min(180, Math.max(w + 0.05, e));
  s = Math.max(-85, Math.min(84, s));
  n = Math.min(85, Math.max(s + 0.05, n));
  return { s: s, n: n, w: w, e: e };
}

function formatCoord(v, axis) {
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

function nmBetween(a, b) { return a.distanceTo(b) / 1852; } // meters -> nautical miles
