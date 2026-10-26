import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { idb } from './db.js';
import { GPS, bearingBetween, mapProgrammatic, nmBetween, setFollow } from './gps.js';
import * as tracksMod from './tracks.js';
import * as catchMod from './catch.js';
import { catchesReload } from './catch.js';
import * as gotoMod from './goto.js';
import { gotoStart } from './goto.js';
import { navHandleClick } from './nav.js';
import { reefsRefreshNearest } from './reefs.js';
import { getMap } from './app.js';
import {
  closeCard, closeModal, closePanels, confirmDialog, isPanelOpen, openCard, openModal, toast, uiStore,
} from '../services/ui';
import { isNativeShell, saveOrShareFile } from '../services/native';
/* Map symbology for spot + reef markers and MPA polygons. Imported here (not by a lazy
   component) because the markers are drawn at boot, long before any spots UI is opened. */
import '../features/spots/spots-map.css';

/* Saved spots (waypoints): create, edit, list, map markers, export/import */
'use strict';

/* ---- Spot types ----
   The stored `type` ids are unchanged from the legacy app (backups and existing IndexedDB
   records carry them). Labels are the legacy select's option text; the emoji are gone —
   the map draws a line glyph instead (SPOT_GLYPHS) and React uses <Icon>. */
/** @typedef {'fish'|'anchor'|'hazard'|'ramp'|'wreck'|'other'} SpotType */
/** @type {Array<{id: SpotType, label: string}>} */
export const SPOT_TYPES = [
  { id: 'fish', label: 'Fishing spot' },
  { id: 'anchor', label: 'Anchorage' },
  { id: 'hazard', label: 'Hazard' },
  { id: 'ramp', label: 'Ramp / dock' },
  { id: 'wreck', label: 'Wreck / structure' },
  { id: 'other', label: 'Other' },
];
/** type id → <Icon> name used by the React UI ('life-buoy' is drawn locally by the spots feature). */
export const SPOT_ICONS = { fish: 'fish', anchor: 'anchor', hazard: 'alert', ramp: 'life-buoy', wreck: 'ship', other: 'pin' };
/** @param {string} t */
export function spotTypeLabel(t) {
  const f = SPOT_TYPES.find((x) => x.id === t);
  return f ? f.label : 'Other';
}
/* Line glyphs for the map markers (24 grid, round caps — the same drawings as the UI icons).
   SVG markup is static; only the spot name is user text and it goes through escapeHtml. */
export const SPOT_GLYPHS = {
  fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
  anchor: '<path d="M12 6v16"/><path d="m19 13 2-1a9 9 0 0 1-18 0l2 1"/><path d="M9 11h6"/><circle cx="12" cy="4" r="2"/>',
  hazard: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  ramp: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
  wreck: '<path d="M12 2v2"/><path d="M12 9.189V13"/><path d="M19 12V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 19A11.6 11.6 0 0 0 21 13l-8.188-3.639a2 2 0 0 0-1.624 0L3 13.001a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 20c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  other: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};
/** @param {string} type @param {number} [size] */
export function spotGlyphSvg(type, size) {
  const s = size || 16;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SPOT_GLYPHS[type] || SPOT_GLYPHS.other) + '</svg>';
}

export const Spots = {
  layer: null,       // L.LayerGroup
  all: [],
  markers: {},       // id -> marker
  _editing: null,    // spot being edited, or {lat,lng} for new
};

/* ---- View store (what React draws) ----
   Plain data only. `items` is the sorted list the Spots panel shows: nearest-first from the
   last GPS fix, else newest-first (legacy order). Distances are only re-published while the
   panel is open (refreshSpotDistances), exactly as the legacy list only re-rendered then. */
/**
 * @typedef {Object} Spot
 * @property {number} id
 * @property {number} lat
 * @property {number} lng
 * @property {string} name
 * @property {string} type
 * @property {string} notes
 * @property {number} ts
 */
/** @typedef {Spot & { distNm: number|null, brgDeg: number|null }} SpotRow */
/**
 * @typedef {Object} SpotsView
 * @property {'loading'|'ready'|'error'} status
 * @property {string} error
 * @property {SpotRow[]} items
 * @property {boolean} hasFix       distances are from a GPS fix (else the list is newest-first)
 * @property {boolean} saving       the spot editor's Save is in flight
 * @property {boolean} exporting
 * @property {boolean} importing
 */
/** @type {import('zustand/vanilla').StoreApi<SpotsView>} */
export const spotsStore = createStore(() => /** @type {SpotsView} */ ({
  status: 'loading',
  error: '',
  items: [],
  hasFix: false,
  saving: false,
  exporting: false,
  importing: false,
}));

/* Another group's module may or may not export a given hook yet (the ports land
   independently). Look it up by name at call time so a missing one is skipped, not a crash.
   (A static `import { x }` of a name that is not exported fails the whole module graph.) */
function optionalFn(mod, ...names) {
  for (const n of names) {
    let f;
    try { f = mod ? /** @type {any} */ (mod)[n] : undefined; } catch (e) { f = undefined; }   // strict proxies throw on unknown keys
    if (typeof f === 'function') return f;
  }
  return null;
}

function theMap() { return getMap() || window._map || null; }

export async function spotsInit(map) {
  if (!Spots.layer) Spots.layer = L.layerGroup().addTo(map);
  spotsStore.setState({ status: 'loading', error: '' });
  try {
    Spots.all = await idb.getAll('spots');
  } catch (e) {
    /* Storage unavailable (private mode, blocked IndexedDB). Say so instead of showing an
       empty list that reads as "you have no spots". */
    Spots.all = [];
    spotsStore.setState({ status: 'error', error: (e && e.message) || String(e) });
    throw e;
  }
  rebuildSpotMarkers();
  spotsStore.setState({ status: 'ready', error: '' });
  publishSpots();
}

/** Retry after a failed load (the panel's Retry button). */
export function spotsReload() {
  const map = theMap();
  if (!map) return Promise.resolve();
  return spotsInit(map).catch(() => {});
}

function rebuildSpotMarkers() {
  if (!Spots.layer) return;
  Spots.layer.clearLayers(); Spots.markers = {};
  Spots.all.forEach(addSpotMarker);
}

/** Marker HTML: an ink disc with a white type glyph, and the name on an ink chip. */
export function spotMarkerHtml(spot) {
  return '<div class="spot-mk spot-mk--' + escapeHtml(spot.type || 'other') + '">' +
    '<span class="spot-mk__disc">' + spotGlyphSvg(spot.type, 16) + '</span>' +
    '<span class="map-chip spot-mk__chip">' + escapeHtml(spot.name) + '</span></div>';
}

export function addSpotMarker(spot) {
  if (!Spots.layer) return;
  /* Idempotent: the assistant used to call this after pushing into Spots.all, and
     spotsChanged() also reconciles markers — never draw the same spot twice. */
  if (Spots.markers[spot.id]) { Spots.layer.removeLayer(Spots.markers[spot.id]); delete Spots.markers[spot.id]; }
  const icon = L.divIcon({
    className: 'spot-mk-wrap',
    html: spotMarkerHtml(spot),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  const m = L.marker([spot.lat, spot.lng], { icon, title: spot.name, alt: spot.name, riseOnHover: true });
  /* Leaflet popups are gone: a tap opens the spot's map card (Navigate / Edit / Delete).
     When the route planner or the measure tool is active the tap is theirs — a saved spot
     is the most natural waypoint there is, so it snaps to the spot's exact position. */
  m.on('click', () => {
    const ll = L.latLng(spot.lat, spot.lng);
    if (typeof navHandleClick === 'function' && navHandleClick(ll)) return;
    openSpotCard(spot.id);
  });
  m.addTo(Spots.layer);
  Spots.markers[spot.id] = m;
}

/** Open the spot's map card. The card reads the live record from spotsStore by id, so an
 *  edit made while it is open shows up, and a delete closes it. */
export function openSpotCard(id) {
  const s = Spots.all.find((x) => x.id === id);
  if (!s) return;
  publishSpots();
  openCard('spot', { id: s.id }, { lat: s.lat, lng: s.lng });
}

/* ---- Sorting / distances (pure) ---- */
/** Nearest-first from `here` (an L.LatLng), else newest-first. Returns a new array. */
export function sortSpots(all, here) {
  return all.slice().sort((a, b) => {
    if (!here) return b.ts - a.ts;
    return here.distanceTo(L.latLng(a.lat, a.lng)) - here.distanceTo(L.latLng(b.lat, b.lng));
  });
}
/** Distance (nm) and true bearing (°) from `here` to a spot; nulls without a fix. */
export function spotDistBrg(here, spot) {
  if (!here || spot == null || spot.lat == null || spot.lng == null) return { distNm: null, brgDeg: null };
  const ll = L.latLng(spot.lat, spot.lng);
  const from = L.latLng(here.lat, here.lng);
  return { distNm: nmBetween(from, ll), brgDeg: Math.round(bearingBetween(from, ll)) % 360 };
}

function publishSpots() {
  const here = GPS.lastLatLng;
  const items = sortSpots(Spots.all, here).map((s) => /** @type {SpotRow} */ (Object.assign({}, s, spotDistBrg(here, s))));
  spotsStore.setState({ items, hasFix: !!here });
}

/** Re-sort and re-publish after anything mutates Spots.all (First Mate creates/deletes spots,
 *  an import, a save). Also reconciles the map markers with Spots.all. Unthrottled. */
export function spotsChanged() {
  if (Spots.layer) {
    const ids = new Set(Spots.all.map((s) => s.id));
    Object.keys(Spots.markers).forEach((k) => {
      // object keys are strings; spot ids are autoIncrement numbers
      if (!ids.has(Number(k)) && !ids.has(k)) { Spots.layer.removeLayer(Spots.markers[k]); delete Spots.markers[k]; }
    });
    Spots.all.forEach((s) => { if (!Spots.markers[s.id]) addSpotMarker(s); });
  }
  /* Republish only — never touch `status`. Only a completed read (spotsInit, the import
     resync) may say 'ready': spotsInit sets Spots.layer BEFORE awaiting the read, and the
     panel calls this on mount, so flipping 'loading' → 'ready' here showed "No spots yet"
     to a user who has spots, whenever the panel opened during the boot read. */
  publishSpots();
}
/** Legacy name — First Mate still calls it after creating a spot. */
export function renderSpotsList() { spotsChanged(); }

/* ---- Modal ---- */
/** Open the spot editor: a new spot ({lat,lng} plus optional name/type/notes prefills, e.g.
 *  a reef saved as a spot) or an existing one (has an id). Opens the React modal 'spot'. */
export function openSpotModal(spotOrLatLng) {
  if (!spotOrLatLng) return;
  Spots._editing = spotOrLatLng;
  const isNew = !spotOrLatLng.id;
  openModal('spot', {
    isNew,
    lat: spotOrLatLng.lat,
    lng: spotOrLatLng.lng,
    name: spotOrLatLng.name || '',
    type: spotOrLatLng.type || 'fish',
    notes: spotOrLatLng.notes || '',
    /* what an empty name will be saved as (legacy default), shown as the placeholder */
    defaultName: 'Spot ' + (Spots.all.length + 1),
  });
}

/* Re-entry guard: a double-tap on Save used to write two copies of a new spot (the second
   tap ran while the first write was still committing, with _editing still set). */
let _savingSpot = false;

/** Save the spot being edited with the modal's fields. Resolves true when it is committed to
 *  storage (never toasts "saved" before the write commits — db.js resolves on commit). On a
 *  failure the modal stays open with the user's text, and a toast says nothing was saved. */
export async function saveSpot(fields) {
  if (_savingSpot) return false;
  const e = Spots._editing;
  if (!e) return false;
  const f = fields || {};
  const spot = {
    id: e.id,
    lat: e.lat, lng: e.lng,
    name: String(f.name || '').trim() || 'Spot ' + (Spots.all.length + 1),
    type: SPOT_TYPES.some((t) => t.id === f.type) ? f.type : (e.type || 'fish'),
    notes: String(f.notes || '').trim(),
    ts: e.ts || Date.now(),
  };
  if (spot.id === undefined) delete spot.id;
  _savingSpot = true;
  spotsStore.setState({ saving: true });
  try {
    const id = await idb.put('spots', spot);
    spot.id = spot.id || id;

    if (Spots.markers[spot.id] && Spots.layer) { Spots.layer.removeLayer(Spots.markers[spot.id]); delete Spots.markers[spot.id]; }
    const i = Spots.all.findIndex((s) => s.id === spot.id);
    if (i >= 0) Spots.all[i] = spot; else Spots.all.push(spot);
    addSpotMarker(spot);
    spotsChanged();
    /* Only close the editor if it is still editing THIS spot — it may have been cancelled
       and reopened for another one while the write was committing. */
    if (Spots._editing === e) closeSpotModal();
    toast('Spot saved');
    return true;
  } catch (err) {
    toast('Spot not saved — ' + ((err && err.message) || err) + '. Your text is still in the editor.', { ms: 6000 });
    return false;
  } finally {
    _savingSpot = false;
    spotsStore.setState({ saving: false });
  }
}

export function closeSpotModal() {
  closeModal('spot');
  Spots._editing = null;
}

/** Delete a spot (record, marker, list entry). No confirmation here — the UI asks first
 *  (confirmDeleteSpot); First Mate's delete_waypoint acts on an explicit request. */
export async function deleteSpot(id) {
  await idb.del('spots', id);
  if (Spots.markers[id] && Spots.layer) { Spots.layer.removeLayer(Spots.markers[id]); delete Spots.markers[id]; }
  Spots.all = Spots.all.filter((s) => s.id !== id);
  const c = uiStore.getState().card;
  if (c && c.kind === 'spot' && c.data && c.data.id === id) closeCard('spot');
  spotsChanged();
  return true;
}

/** The UI's delete: in-app confirm (destructive), then delete. Resolves true if deleted. */
export async function confirmDeleteSpot(spot) {
  if (!spot) return false;
  const ok = await confirmDialog({
    title: 'Delete "' + spot.name + '"?',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!ok) return false;
  // Re-check after the await: First Mate or another tap may have removed it meanwhile.
  if (!Spots.all.some((s) => s.id === spot.id)) return false;
  try {
    await deleteSpot(spot.id);
    toast('"' + spot.name + '" deleted');
    return true;
  } catch (e) {
    toast('Could not delete "' + spot.name + '" — ' + ((e && e.message) || e));
    return false;
  }
}

/* ---- Map moves from the list / card ----
   setFollow(false) + mapProgrammatic so the auto-refollow timer does not yank the view back
   to the boat while you are looking at the spot. */
export function flyToSpot(spot) {
  const map = theMap();
  if (!map || !spot) return;
  const ll = L.latLng(spot.lat, spot.lng);
  closePanels();
  setFollow(false);
  mapProgrammatic(() => map.setView(ll, Math.max(map.getZoom(), 14)));
  openSpotCard(spot.id);
}

/** Go: start a Go-To to the spot. gotoStart may ask before discarding a voyage in progress,
 *  so it is awaited (it resolves false when the user backs out). */
export async function navigateToSpot(spot) {
  if (!spot) return false;
  closeCard('spot');
  return !!(await gotoStart({ lat: spot.lat, lng: spot.lng }, spot.name));
}

/** Create a spot without the editor (First Mate's place_waypoint, voice "mark this spot").
 *  Resolves with the stored spot once the write has committed. */
export async function createSpot(o) {
  const spot = { lat: o.lat, lng: o.lng, name: o.name || 'Spot ' + (Spots.all.length + 1), type: o.type || 'fish', notes: o.notes || '', ts: Date.now() };
  const id = await idb.put('spots', spot);
  spot.id = spot.id || id;
  Spots.all.push(spot);
  addSpotMarker(spot);
  spotsChanged();
  return spot;
}

/* ---- List panel ---- */
/* Called on every GPS fix. Rebuilding the whole list each second is wasteful — the list
   only shows 2-decimal nm, so throttle to a few seconds and skip when barely moved. */
export let _spotDistTs = 0, _spotDistLL = null;
export function refreshSpotDistances() {
  if (!isPanelOpen('spots')) return;   // list not visible → nothing to update
  const now = Date.now();
  if (now - _spotDistTs < 3000) return;
  const here = GPS.lastLatLng;
  if (here && _spotDistLL && here.distanceTo(_spotDistLL) < 5) { _spotDistTs = now; return; }
  _spotDistTs = now; _spotDistLL = here;
  publishSpots();
  if (typeof reefsRefreshNearest === 'function') reefsRefreshNearest();
}

/* ---- Export / import ----
   A backup has to contain everything irreplaceable. It used to save only spots and
   tracks, so anyone who exported, switched phones and imported lost every logged
   catch and every voyage — the two things that can't be re-created, and the data the
   whole bite-pattern engine is built on. */
/** Local calendar date YYYY-MM-DD (a backup made at 8 pm is today's, not tomorrow's UTC). */
export function localYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export async function exportData() {
  if (spotsStore.getState().exporting) return;   // a double-tap must not open two share sheets
  spotsStore.setState({ exporting: true });
  try {
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
    /* The download goes through the platform: the share sheet in the iOS app (Save to Files,
       AirDrop…), Web Share on a phone browser, a normal download on desktop. (The legacy
       blob-anchor trick produced no file at all inside the native WKWebView shell.) */
    const res = await saveOrShareFile({
      name: 'fishapp-backup-' + localYmd(new Date()) + '.json',
      mime: 'application/json',
      data: JSON.stringify(data, null, 1),
      title: 'FishApp backup',
    });
    if (res === 'cancelled') { toast('Export cancelled — no backup was saved'); return; }
    /* In the iOS app the bridge only HANDS the file to the share sheet: saveOrShareFile
       returns before the sheet is even up and never hears whether it was saved or dismissed.
       "Exported" would be claimed even when the user cancelled — say what is actually known. */
    if (isNativeShell()) { toast('Backup ready — choose where to save it (' + counts.join(', ') + ')', { ms: 6000 }); return; }
    toast('Backup exported — ' + counts.join(', '));
  } catch (e) {
    toast('Export failed — ' + ((e && e.message) || e));
  } finally {
    spotsStore.setState({ exporting: false });
  }
}

/* Stable identity for a record, so re-importing the same backup doesn't duplicate
   everything. Previously every import deleted the id and re-inserted under a new
   autoIncrement key, so importing twice gave you two of each, forever.
   Catches have no `name` — their species stands in, so two different fish logged at the
   same second and place are not collapsed into one. */
export function _importKey(r) {
  return [r.ts || r.start || '', r.name || r.species || '', r.lat || '', r.lng || ''].join('|');
}

export async function importData(file) {
  if (!file) return;
  if (spotsStore.getState().importing) return;
  spotsStore.setState({ importing: true });
  try {
    await importDataInner(file);
  } finally {
    spotsStore.setState({ importing: false });
  }
}

async function importDataInner(file) {
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
       the list and markers disagreeing with what was actually in the database.
       Each step is independent: one module failing to refresh must not skip the others. */
    await resyncAfterImport();
  }
}

async function resyncAfterImport() {
  const step = async (fn) => { try { await fn(); } catch (e) { /* UI refresh is best-effort */ } };
  await step(async () => {
    Spots.all = await idb.getAll('spots');
    rebuildSpotMarkers();
    if (Spots.layer) spotsStore.setState({ status: 'ready', error: '' });
    publishSpots();
  });
  // Tracks: the tracks module's reload (tracksInit loads saved tracks into tracksStore).
  await step(async () => {
    const reload = optionalFn(tracksMod, 'tracksReload', 'tracksInit');
    if (reload) { await reload(); return; }
    const store = /** @type {any} */ (tracksMod).tracksStore;
    if (store && typeof store.setState === 'function') {
      const all = await idb.getAll('tracks');
      store.setState({ saved: all.sort((a, b) => b.start - a.start) });
    }
  });
  // Catches: the catch module's reload rebuilds Catch.all, its markers and its list.
  await step(async () => {
    if (typeof catchesReload === 'function') { await catchesReload(); return; }
    const Catch = /** @type {any} */ (catchMod).Catch;
    if (Catch) {
      Catch.all = await idb.getAll('catches');
      const addMarker = optionalFn(catchMod, 'addCatchMarker');
      if (Catch.layer && addMarker) {
        Catch.layer.clearLayers(); Catch.markers = {};
        Catch.all.forEach(addMarker);
      }
      const render = optionalFn(catchMod, 'renderCatchList');
      if (render) render();
    }
  });
  // Voyages: the goto module's reload of the saved-voyage archive.
  await step(async () => {
    const reload = optionalFn(gotoMod, 'tripsReload', 'voyagesReload', 'loadTrips', 'renderTripsList');
    if (reload) await reload();
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
