/* Saved spots (waypoints): create, edit, list, map markers, export/import */
'use strict';

const SPOT_ICONS = { fish: '🐟', anchor: '⚓', hazard: '⚠️', ramp: '🛟', wreck: '🚢', other: '📍' };

const Spots = {
  layer: null,       // L.LayerGroup
  all: [],
  markers: {},       // id -> marker
  _editing: null,    // spot being edited, or {lat,lng} for new
};

async function spotsInit(map) {
  Spots.layer = L.layerGroup().addTo(map);
  Spots.all = await idb.getAll('spots');
  Spots.all.forEach(addSpotMarker);
  renderSpotsList();
}

function addSpotMarker(spot) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="spot-icon">${SPOT_ICONS[spot.type] || '📍'}</div>` +
          `<div class="spot-label">${escapeHtml(spot.name)}</div>`,
    iconSize: [90, 44],
    iconAnchor: [45, 26],
  });
  const m = L.marker([spot.lat, spot.lng], { icon });
  m.bindPopup(() => spotPopupHtml(spot));
  m.on('popupopen', () => {
    const el = m.getPopup().getElement();
    const navBtn = el.querySelector('.sp-nav');
    if (navBtn && typeof gotoStart === 'function') navBtn.onclick = () => { m.closePopup(); gotoStart({ lat: spot.lat, lng: spot.lng }, spot.name); };
    el.querySelector('.sp-edit').onclick = () => { m.closePopup(); openSpotModal(spot); };
    el.querySelector('.sp-del').onclick = async () => {
      if (!confirm('Delete "' + spot.name + '"?')) return;
      await deleteSpot(spot.id);
      m.closePopup();
    };
  });
  m.addTo(Spots.layer);
  Spots.markers[spot.id] = m;
}

function spotPopupHtml(spot) {
  let distLine = '';
  if (GPS.lastLatLng) {
    const ll = L.latLng(spot.lat, spot.lng);
    const nm = nmBetween(GPS.lastLatLng, ll);
    const brg = Math.round(bearingBetween(GPS.lastLatLng, ll));
    distLine = `<div style="opacity:.75;font-size:12px">${nm.toFixed(2)} nm &nbsp;·&nbsp; ${brg}°</div>`;
  }
  return `<b>${SPOT_ICONS[spot.type] || '📍'} ${escapeHtml(spot.name)}</b>` +
    distLine +
    (spot.notes ? `<div style="margin-top:4px">${escapeHtml(spot.notes)}</div>` : '') +
    `<div class="popup-btns"><button class="sp-nav">🧭 Go</button><button class="sp-edit">Edit</button><button class="sp-del">Delete</button></div>`;
}

/* ---- Modal ---- */
function openSpotModal(spotOrLatLng) {
  Spots._editing = spotOrLatLng;
  const isNew = !spotOrLatLng.id;
  document.getElementById('spot-modal-title').textContent = isNew ? 'New spot' : 'Edit spot';
  document.getElementById('spot-name').value = spotOrLatLng.name || '';
  document.getElementById('spot-type').value = spotOrLatLng.type || 'fish';
  document.getElementById('spot-notes').value = spotOrLatLng.notes || '';
  document.getElementById('modal-spot').classList.remove('hidden');
  if (isNew) setTimeout(() => document.getElementById('spot-name').focus(), 50);
}

async function saveSpotFromModal() {
  const e = Spots._editing;
  if (!e) return;
  const spot = {
    id: e.id,
    lat: e.lat, lng: e.lng,
    name: document.getElementById('spot-name').value.trim() || 'Spot ' + (Spots.all.length + 1),
    type: document.getElementById('spot-type').value,
    notes: document.getElementById('spot-notes').value.trim(),
    ts: e.ts || Date.now(),
  };
  if (spot.id === undefined) delete spot.id;
  const id = await idb.put('spots', spot);
  spot.id = spot.id || id;

  if (Spots.markers[spot.id]) { Spots.layer.removeLayer(Spots.markers[spot.id]); delete Spots.markers[spot.id]; }
  const i = Spots.all.findIndex((s) => s.id === spot.id);
  if (i >= 0) Spots.all[i] = spot; else Spots.all.push(spot);
  addSpotMarker(spot);
  renderSpotsList();
  closeSpotModal();
  toast('Spot saved 📌');
}

function closeSpotModal() {
  document.getElementById('modal-spot').classList.add('hidden');
  Spots._editing = null;
}

async function deleteSpot(id) {
  await idb.del('spots', id);
  if (Spots.markers[id]) { Spots.layer.removeLayer(Spots.markers[id]); delete Spots.markers[id]; }
  Spots.all = Spots.all.filter((s) => s.id !== id);
  renderSpotsList();
}

/* ---- List panel ---- */
function renderSpotsList() {
  const box = document.getElementById('spots-list');
  if (!Spots.all.length) {
    box.innerHTML = '<p class="empty">No spots yet. Tap 📌 or long-press the map.</p>';
    return;
  }
  const here = GPS.lastLatLng;
  const sorted = Spots.all.slice().sort((a, b) => {
    if (!here) return b.ts - a.ts;
    return here.distanceTo(L.latLng(a.lat, a.lng)) - here.distanceTo(L.latLng(b.lat, b.lng));
  });
  box.innerHTML = '';
  sorted.forEach((s) => {
    const ll = L.latLng(s.lat, s.lng);
    let sub = new Date(s.ts).toLocaleDateString();
    if (here) sub = nmBetween(here, ll).toFixed(2) + ' nm · ' + Math.round(bearingBetween(here, ll)) + '° · ' + sub;
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML =
      `<span class="ico">${SPOT_ICONS[s.type] || '📍'}</span>` +
      `<div class="info"><div class="name">${escapeHtml(s.name)}</div><div class="sub">${sub}</div></div>` +
      `<button class="go">➜</button><button class="del">🗑</button>`;
    item.querySelector('.go').onclick = () => {
      closePanels();
      setFollow(false);
      window._map.setView(ll, Math.max(window._map.getZoom(), 14));
      Spots.markers[s.id] && Spots.markers[s.id].openPopup();
    };
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete "' + s.name + '"?')) return;
      await deleteSpot(s.id);
    };
    box.appendChild(item);
  });
}

function refreshSpotDistances() {
  const panel = document.getElementById('panel-spots');
  if (!panel.classList.contains('hidden')) renderSpotsList();
}

/* ---- Export / import ---- */
async function exportData() {
  const data = {
    app: 'FishApp', version: 1, exported: new Date().toISOString(),
    spots: await idb.getAll('spots'),
    tracks: await idb.getAll('tracks'),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fishapp-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup exported');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const s of data.spots || []) { delete s.id; await idb.put('spots', s); n++; }
    for (const t of data.tracks || []) { delete t.id; await idb.put('tracks', t); }
    Spots.all = await idb.getAll('spots');
    Spots.layer.clearLayers(); Spots.markers = {};
    Spots.all.forEach(addSpotMarker);
    renderSpotsList();
    renderTracksList();
    toast('Imported ' + n + ' spots');
  } catch (e) {
    toast('Import failed — not a FishApp backup?');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
