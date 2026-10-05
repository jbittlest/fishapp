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
      mapProgrammatic(() => window._map.setView(ll, Math.max(window._map.getZoom(), 14)));
      Spots.markers[s.id] && Spots.markers[s.id].openPopup();
    };
    item.querySelector('.del').onclick = async () => {
      if (!confirm('Delete "' + s.name + '"?')) return;
      await deleteSpot(s.id);
    };
    box.appendChild(item);
  });
}

/* Called on every GPS fix. Rebuilding the whole list each second is wasteful — the list
   only shows 2-decimal nm, so throttle to a few seconds and skip when barely moved. */
let _spotDistTs = 0, _spotDistLL = null;
function refreshSpotDistances() {
  const panel = document.getElementById('panel-spots');
  if (panel.classList.contains('hidden')) return;   // list not visible → nothing to update
  const now = Date.now();
  if (now - _spotDistTs < 3000) return;
  const here = GPS.lastLatLng;
  if (here && _spotDistLL && here.distanceTo(_spotDistLL) < 5) { _spotDistTs = now; return; }
  _spotDistTs = now; _spotDistLL = here;
  renderSpotsList();
}

/* ---- Export / import ----
   A backup has to contain everything irreplaceable. It used to save only spots and
   tracks, so anyone who exported, switched phones and imported lost every logged
   catch and every voyage — the two things that can't be re-created, and the data the
   whole bite-pattern engine is built on. */
async function exportData() {
  const grab = async (store) => { try { return await idb.getAll(store); } catch (e) { return []; } };
  const data = {
    app: 'FishApp', version: 2, exported: new Date().toISOString(),
    spots: await grab('spots'),
    tracks: await grab('tracks'),
    catches: await grab('catches'),
    trips: await grab('trips'),
    // area metadata only — the tile blobs are gigabytes and are re-downloadable
    areas: (await grab('areas')).map((a) => Object.assign({}, a, { data: undefined })),
  };
  const counts = ['spots', 'tracks', 'catches', 'trips'].map((k) => data[k].length + ' ' + k);
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fishapp-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  /* Attach, then revoke on a delay. Revoking in the same turn as click() — on an
     anchor that was never in the document — could hand the download machinery a
     dead URL, so you'd get a toast saying "exported" and no file. */
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  toast('Backup exported — ' + counts.join(', '));
}

/* Stable identity for a record, so re-importing the same backup doesn't duplicate
   everything. Previously every import deleted the id and re-inserted under a new
   autoIncrement key, so importing twice gave you two of each, forever. */
function _importKey(r) {
  return [r.ts || r.start || '', r.name || '', r.lat || '', r.lng || ''].join('|');
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    toast('Import failed — that file isn\'t valid JSON.');
    return;
  }
  if (!data || data.app !== 'FishApp') {
    toast('Import failed — not a FishApp backup.');
    return;
  }
  const added = {}, skipped = {};
  try {
    for (const store of ['spots', 'tracks', 'catches', 'trips']) {
      const incoming = Array.isArray(data[store]) ? data[store] : [];
      if (!incoming.length) continue;
      let existing = [];
      try { existing = await idb.getAll(store); } catch (e) { /* empty store */ }
      const seen = new Set(existing.map(_importKey));
      added[store] = 0; skipped[store] = 0;
      for (const rec of incoming) {
        if (seen.has(_importKey(rec))) { skipped[store]++; continue; }
        seen.add(_importKey(rec));
        const copy = Object.assign({}, rec);
        delete copy.id;
        await idb.put(store, copy);
        added[store]++;
      }
    }
    const parts = Object.keys(added).map((k) => added[k] + ' ' + k).filter((s) => !s.startsWith('0 '));
    const dupes = Object.keys(skipped).reduce((a, k) => a + skipped[k], 0);
    toast(parts.length ? ('Imported ' + parts.join(', ') + (dupes ? ' · ' + dupes + ' already present' : ''))
      : 'Nothing new to import — it was all already here');
  } catch (e) {
    // Be honest about WHICH failure this was: a valid backup that hit a full store
    // used to be reported as "not a FishApp backup".
    toast('Import stopped: ' + ((e && e.message) || e) + '. Some records may already be saved.');
  } finally {
    /* Always resync the UI. It used to jump straight to the catch on failure, leaving
       the list and markers disagreeing with what was actually in the database. */
    try {
      Spots.all = await idb.getAll('spots');
      Spots.layer.clearLayers(); Spots.markers = {};
      Spots.all.forEach(addSpotMarker);
      renderSpotsList();
      renderTracksList();
      if (typeof Catch !== 'undefined') {
        Catch.all = await idb.getAll('catches');
        if (Catch.layer && typeof addCatchMarker === 'function') {
          Catch.layer.clearLayers(); Catch.markers = {};
          Catch.all.forEach(addCatchMarker);
        }
        if (typeof renderCatchList === 'function') renderCatchList();
      }
      if (typeof renderTripsList === 'function') renderTripsList();
    } catch (e) { /* UI refresh is best-effort */ }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
