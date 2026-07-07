/* Track recording: breadcrumb trail of where you've driven the boat */
'use strict';

const Tracks = {
  recording: false,
  points: [],          // [lat, lng] pairs of the active recording
  startedAt: null,
  line: null,          // live polyline
  shown: {},           // id -> polyline of saved tracks currently on the map
  _lastPt: null,
  _lastTs: 0,
};

function trackToggle() {
  if (Tracks.recording) trackStop(); else trackStart();
}

function trackStart() {
  Tracks.recording = true;
  Tracks.points = [];
  Tracks.startedAt = Date.now();
  Tracks._lastPt = null;
  Tracks.line = L.polyline([], { color: '#ff9f43', weight: 4, opacity: 0.9 }).addTo(window._map);
  document.getElementById('btn-track').classList.add('recording');
  toast('Recording track — tap ⏺ again to stop');
}

async function trackStop() {
  Tracks.recording = false;
  document.getElementById('btn-track').classList.remove('recording');
  if (Tracks.line) { window._map.removeLayer(Tracks.line); Tracks.line = null; }

  if (Tracks.points.length < 2) {
    toast('Track too short — not saved');
    return;
  }
  const track = {
    name: 'Track ' + new Date(Tracks.startedAt).toLocaleString(),
    points: Tracks.points,
    start: Tracks.startedAt,
    end: Date.now(),
    nm: trackDistanceNm(Tracks.points),
  };
  await idb.put('tracks', track);
  renderTracksList();
  toast('Track saved (' + track.nm.toFixed(2) + ' nm)');
}

/* Called from gps.js on every fix */
function trackOnFix(ll, ts) {
  if (!Tracks.recording) return;
  // record a point at most every 5s or if moved >10 m
  if (Tracks._lastPt) {
    const moved = ll.distanceTo(Tracks._lastPt);
    if (moved < 10 && ts - Tracks._lastTs < 5000) return;
  }
  Tracks.points.push([ll.lat, ll.lng]);
  Tracks._lastPt = ll;
  Tracks._lastTs = ts;
  if (Tracks.line) Tracks.line.addLatLng(ll);
}

function trackDistanceNm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    m += L.latLng(points[i - 1]).distanceTo(L.latLng(points[i]));
  }
  return m / 1852;
}

async function renderTracksList() {
  const box = document.getElementById('tracks-list');
  const all = await idb.getAll('tracks');
  if (!all.length) {
    box.innerHTML = '<p class="empty">No tracks recorded yet.</p>';
    return;
  }
  box.innerHTML = '';
  all.sort((a, b) => b.start - a.start).forEach((t) => {
    const visible = !!Tracks.shown[t.id];
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML =
      `<span class="ico">〰️</span>` +
      `<div class="info"><div class="name">${escapeHtml(t.name)}</div>` +
      `<div class="sub">${t.nm.toFixed(2)} nm · ${new Date(t.start).toLocaleDateString()}</div></div>` +
      `<button class="show">${visible ? '🙈' : '👁'}</button><button class="del">🗑</button>`;
    item.querySelector('.show').onclick = () => {
      if (Tracks.shown[t.id]) {
        window._map.removeLayer(Tracks.shown[t.id]);
        delete Tracks.shown[t.id];
      } else {
        Tracks.shown[t.id] = L.polyline(t.points, { color: '#ff9f43', weight: 3, opacity: 0.8 }).addTo(window._map);
        closePanels();
        window._map.fitBounds(Tracks.shown[t.id].getBounds(), { padding: [40, 40] });
      }
      renderTracksList();
    };
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete this track?')) return;
      if (Tracks.shown[t.id]) { window._map.removeLayer(Tracks.shown[t.id]); delete Tracks.shown[t.id]; }
      await idb.del('tracks', t.id);
      renderTracksList();
    };
    box.appendChild(item);
  });
}
