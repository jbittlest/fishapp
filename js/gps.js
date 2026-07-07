/* GPS position, boat marker, follow mode, wake lock */
'use strict';

const GPS = {
  watchId: null,
  last: null,          // last GeolocationPosition
  lastLatLng: null,
  follow: true,
  marker: null,
  accCircle: null,
  wakeLock: null,
  _hadFirstFix: false,
};

const KNOTS_PER_MS = 1.94384; // m/s -> knots

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
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 }
  );
  requestWakeLock();
}

function gpsOnFix(map, pos) {
  GPS.last = pos;
  const c = pos.coords;
  const ll = L.latLng(c.latitude, c.longitude);

  /* Heading: device heading if moving, else bearing from previous point */
  let heading = null;
  if (c.heading !== null && !isNaN(c.heading) && c.speed !== null && c.speed > 0.3) {
    heading = c.heading;
  } else if (GPS.lastLatLng && ll.distanceTo(GPS.lastLatLng) > 3) {
    heading = bearingBetween(GPS.lastLatLng, ll);
  }

  /* Boat marker */
  if (!GPS.marker) {
    GPS.marker = L.marker(ll, { icon: boatIcon(heading), zIndexOffset: 1000, interactive: false }).addTo(map);
    GPS.accCircle = L.circle(ll, {
      radius: c.accuracy || 0, weight: 1, color: '#4aa3e0',
      fillColor: '#4aa3e0', fillOpacity: 0.12, interactive: false,
    }).addTo(map);
  } else {
    GPS.marker.setLatLng(ll);
    if (heading !== null) GPS.marker.setIcon(boatIcon(heading));
    GPS.accCircle.setLatLng(ll).setRadius(c.accuracy || 0);
  }

  /* Status bar */
  const dot = document.getElementById('gps-dot');
  dot.className = 'dot ' + (c.accuracy <= 20 ? 'ok' : 'warn');
  document.getElementById('gps-acc').textContent = '±' + Math.round(c.accuracy) + 'm';
  const kn = c.speed !== null && !isNaN(c.speed) ? (c.speed * KNOTS_PER_MS) : null;
  document.getElementById('stat-speed').textContent = kn !== null ? kn.toFixed(1) : '—';
  document.getElementById('stat-heading').textContent = heading !== null ? Math.round(heading) : '—';
  document.getElementById('stat-coords').innerHTML =
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

  trackOnFix(ll, pos.timestamp); // feed track recorder
  if (typeof navOnFix === 'function') navOnFix(ll, kn); // feed trip stats + anchor alarm
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

function setFollow(on) {
  GPS.follow = on;
  document.getElementById('btn-follow').classList.toggle('active', on);
  if (on && GPS.lastLatLng) window._map.panTo(GPS.lastLatLng);
}

/* Keep the screen awake while navigating (iOS 16.4+, Android) */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      GPS.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* not critical */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

/* ---- Geo math ---- */
function bearingBetween(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function formatCoord(v, axis) {
  const hemi = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const abs = Math.abs(v);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return deg + '°' + min.toFixed(3) + "'" + hemi;
}

function nmBetween(a, b) { return a.distanceTo(b) / 1852; } // meters -> nautical miles
