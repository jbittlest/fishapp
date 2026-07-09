/* "Go To" navigation: pick a destination, steer a direct course with live
   distance/bearing/ETA, and save the finished voyage to an archive.
   Live stats are fed from gps.js via navOnFix → gotoOnFix. */
'use strict';

const Goto = {
  active: false,
  dest: null,         // L.LatLng destination
  destName: '',
  startTs: 0,
  startLL: null,      // L.LatLng where the voyage began
  planNm: 0,          // straight-line distance at start
  track: [],          // [lat,lng] breadcrumb of the voyage
  maxKn: 0,
  line: null,         // course polyline (current pos → dest)
  destMarker: null,
  shown: {},          // saved-trip id -> polyline on map
  _lastPt: null, _lastTs: 0, _arrived: false,
};

function gotoStart(latlng, name) {
  gotoClearLayers();
  Goto.active = true;
  Goto.dest = L.latLng(latlng.lat, latlng.lng);
  Goto.destName = (name || 'Destination').trim();
  Goto.startTs = Date.now();
  Goto.startLL = (typeof GPS !== 'undefined' && GPS.lastLatLng) ? GPS.lastLatLng : null;
  Goto.track = []; Goto._lastPt = null; Goto._lastTs = 0; Goto.maxKn = 0; Goto._arrived = false;
  if (Goto.startLL) { Goto.track.push([Goto.startLL.lat, Goto.startLL.lng]); Goto.planNm = nmBetween(Goto.startLL, Goto.dest); }
  else Goto.planNm = 0;

  Goto.destMarker = L.marker(Goto.dest, {
    icon: L.divIcon({ className: '', html: '<div class="goto-pin">🎯</div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
  }).addTo(window._map);
  Goto.destMarker.bindPopup('🎯 ' + escapeHtml(Goto.destName));

  document.getElementById('goto-banner').classList.remove('hidden');
  if (typeof requestWakeLock === 'function') requestWakeLock();   // keep GPS alive
  gotoUpdateBanner(Goto.startLL, null);
  if (typeof toast === 'function') toast('🧭 Navigating to ' + Goto.destName + (Goto.startLL ? '' : ' — waiting for GPS'));
  window._map.closePopup();
}

function gotoUpdateBanner(ll, kn) {
  const dest = Goto.dest;
  if (!dest) return;
  const from = ll || Goto.startLL;
  const remNm = from ? nmBetween(from, dest) : Goto.planNm;
  const brg = from ? bearingBetween(from, dest) : 0;

  // steer hint from GPS heading, if we have one
  let steer = '';
  const hd = (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.heading != null && !isNaN(GPS.last.coords.heading)) ? GPS.last.coords.heading : null;
  if (hd != null && from) {
    const diff = ((brg - hd + 540) % 360) - 180;
    steer = Math.abs(diff) <= 5 ? ' ⬆︎' : (diff > 0 ? ' ↱' + Math.round(diff) + '°' : ' ↰' + Math.round(-diff) + '°');
  }

  // ETA — use live speed if moving, else the planned cruise speed from Nav tools
  let spd = (kn != null && kn > 1) ? kn : (parseFloat((document.getElementById('route-speed') || {}).value) || 0);
  const planned = !(kn != null && kn > 1);
  let eta = 'ETA —';
  if (spd > 0) {
    const hrs = remNm / spd;
    const at = new Date(Date.now() + hrs * 3600000);
    eta = 'ETA ' + at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · ' + fmtDur(hrs * 3600) + (planned ? ' @' + Math.round(spd) + 'kn' : '');
  }

  document.getElementById('gb-name').textContent = Goto.destName;
  document.getElementById('gb-dist').textContent = remNm.toFixed(2) + ' nm (' + (remNm * 1.15078).toFixed(1) + ' mi)';
  document.getElementById('gb-brg').textContent = 'steer ' + Math.round(brg) + '° ' + (typeof compass === 'function' ? compass(brg) : '') + steer;
  document.getElementById('gb-eta').textContent = eta;

  // redraw the course line from where we are to the destination
  if (Goto.line) window._map.removeLayer(Goto.line);
  if (from) Goto.line = L.polyline([from, dest], { color: '#37d67a', weight: 4, opacity: 0.9 }).addTo(window._map);
}

/* Called every GPS fix (from navOnFix). */
function gotoOnFix(ll, kn) {
  if (!Goto.active || !ll) return;
  if (!Goto._lastPt || ll.distanceTo(Goto._lastPt) >= 10 || Date.now() - Goto._lastTs > 5000) {
    Goto.track.push([ll.lat, ll.lng]); Goto._lastPt = ll; Goto._lastTs = Date.now();
  }
  if (kn != null) Goto.maxKn = Math.max(Goto.maxKn, kn);
  if (!Goto.startLL) { Goto.startLL = ll; Goto.planNm = nmBetween(ll, Goto.dest); }  // GPS came late
  gotoUpdateBanner(ll, kn);

  const rem = nmBetween(ll, Goto.dest);
  const banner = document.getElementById('goto-banner');
  if (rem < 0.08 && !Goto._arrived) {
    Goto._arrived = true; banner.classList.add('arriving');
    if (typeof toast === 'function') toast('🎯 Arriving at ' + Goto.destName + ' — tap ✓ Arrived to log it');
  } else if (rem >= 0.12 && Goto._arrived) {
    Goto._arrived = false; banner.classList.remove('arriving');
  }
}

function gotoArrive() { gotoEnd(true); }
function gotoCancel() {
  if (Goto.track.length > 2 && !confirm('End navigation without saving this voyage?')) return;
  gotoEnd(false);
}

async function gotoEnd(save) {
  if (save) {
    if (Goto.track.length >= 2 && Goto.startLL) {
      const actualNm = trackDistanceNm(Goto.track);
      const end = Date.now();
      const durS = (end - Goto.startTs) / 1000;
      const trip = {
        name: 'To ' + Goto.destName,
        dest: { lat: Goto.dest.lat, lng: Goto.dest.lng, name: Goto.destName },
        start: Goto.startTs, end: end,
        planNm: Goto.planNm, actualNm: actualNm,
        avgKn: durS > 10 ? actualNm / (durS / 3600) : 0, maxKn: Goto.maxKn,
        points: Goto.track,
      };
      await idb.put('trips', trip);
      renderTripsList();
      if (typeof toast === 'function') toast('🧭 Voyage saved — ' + actualNm.toFixed(1) + ' nm in ' + fmtDur((end - Goto.startTs) / 1000));
    } else if (typeof toast === 'function') {
      toast('Voyage too short to save');
    }
  }
  Goto.active = false;
  gotoClearLayers();
  document.getElementById('goto-banner').classList.add('hidden');
}

function gotoClearLayers() {
  if (Goto.line) { window._map.removeLayer(Goto.line); Goto.line = null; }
  if (Goto.destMarker) { window._map.removeLayer(Goto.destMarker); Goto.destMarker = null; }
}

/* ---- Voyage archive ---- */
async function renderTripsList() {
  const box = document.getElementById('trips-list');
  if (!box) return;
  const all = await idb.getAll('trips');
  if (!all.length) {
    box.innerHTML = '<p class="empty">No voyages yet. Tap the map → 🧭 Navigate here (or a saved spot → 🧭 Go) to start one.</p>';
    return;
  }
  box.innerHTML = '';
  all.sort((a, b) => b.start - a.start).forEach((t) => {
    const dur = fmtDur((t.end - t.start) / 1000);
    const visible = !!Goto.shown[t.id];
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML =
      '<span class="ico">🧭</span>' +
      '<div class="info"><div class="name">' + escapeHtml(t.name) + '</div>' +
      '<div class="sub">' + t.actualNm.toFixed(1) + ' nm · ' + dur + ' · avg ' + t.avgKn.toFixed(1) + ' kn · ' + new Date(t.start).toLocaleDateString() + '</div></div>' +
      '<button class="show">' + (visible ? '🙈' : '👁') + '</button><button class="del">🗑</button>';
    item.querySelector('.show').onclick = () => gotoToggleTripPath(t);
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete this voyage?')) return;
      if (Goto.shown[t.id]) { window._map.removeLayer(Goto.shown[t.id]); delete Goto.shown[t.id]; }
      await idb.del('trips', t.id);
      renderTripsList();
    };
    box.appendChild(item);
  });
}

function gotoToggleTripPath(t) {
  if (Goto.shown[t.id]) {
    window._map.removeLayer(Goto.shown[t.id]);
    delete Goto.shown[t.id];
  } else {
    const poly = L.polyline(t.points, { color: '#37d67a', weight: 3, opacity: 0.85 });
    const pin = L.marker([t.dest.lat, t.dest.lng], {
      icon: L.divIcon({ className: '', html: '<div class="goto-pin">🎯</div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
    });
    Goto.shown[t.id] = L.layerGroup([poly, pin]).addTo(window._map);
    closePanels();
    window._map.fitBounds(poly.getBounds(), { padding: [40, 40] });
  }
  renderTripsList();
}
