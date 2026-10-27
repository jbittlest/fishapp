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
import { isNativeShell, saveOrShareFile, shareText } from '../services/native';
import { SITE } from '../services/site';
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
  /* A shared spot that is now one of the user's own (saved from its card, or it already was
     once the boot read finished) is drawn by its spot marker: drop the pending one. Its reload
     record goes too — unless its card is still up, which a reload should bring back (it then
     goes when the card closes). */
  if (Shared.spot && Spots.all.some((x) => sameSpotPosition(x, Shared.spot))) {
    removeSharedMarker();
    Shared.spot = null;
    if (!sharedCardOpen(uiStore.getState())) forgetShared();
  }
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

/* ---- Shared-spot links ----
   Share on a spot sends SITE.siteUrl + '#s=lat,lng&t=type&n=name'. Whoever taps it sees the
   spot in the web app with nothing to install. The position travels in the FRAGMENT, which a
   browser never sends to a server, so no web log anywhere records where somebody fishes.
   The type rides along so a shared Hazard arrives looking like one (and is saved as one).
   An inbound link is untrusted input (anyone can write one): the numbers must be plain decimal
   degrees in range, the type one of SPOT_TYPES or nothing, and the name is cleaned and only
   ever set as text — React text in the card, textContent on the marker — never parsed as
   markup. */

/** Longest name a link carries or shows, in characters (code points). */
export const SHARED_NAME_MAX = 60;
/* C0/C1 controls, line and paragraph separators, zero-width space, BOM, and the bidi marks,
   overrides and isolates (they can make a name read backwards or impersonate another). */
// eslint-disable-next-line no-control-regex
const NAME_JUNK_RE = /[\u0000-\u001F\u007F-\u009F\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
/* Half of an emoji whose other half is gone (a backup's JSON can hold one, as can any code that
   cut a string by UTF-16 units): encodeURIComponent throws on it. With the u flag a whole
   surrogate pair is one code point, so this matches only the unpaired halves. (No lookbehind:
   iOS 16.0-16.3 WebKit cannot parse it, and a regex it cannot parse takes the module down.) */
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/gu;
/* Plain decimal degrees only: optional minus, up to 3 integer digits, up to 10 decimals.
   Number() alone would also take '1e2', '0x1f', 'Infinity' and ''. */
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d{1,10})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,10})?)\s*$/;

/** A name fit to show and to put in a link: junk characters and broken emoji halves out,
 *  whitespace collapsed, at most SHARED_NAME_MAX characters — counted in code points, so an
 *  emoji is never cut in half. */
export function cleanSpotName(raw) {
  const s = String(raw == null ? '' : raw).replace(LONE_SURROGATE_RE, '').replace(NAME_JUNK_RE, ' ')
    .replace(/\s+/g, ' ').trim();
  let out = '', n = 0;
  for (const ch of s) {
    if (++n > SHARED_NAME_MAX) break;
    out += ch;
  }
  return out.trim();
}

/** Longitude folded into [-180, 180). Leaflet reports taps on a neighbouring copy of the world
 *  outside ±180, and a spot marked there must still make a link that passes the range check. */
export function wrapLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** A position worth showing: finite, in range, and not 0,0 (a zeroed value, never a spot). */
function validSpotPos(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;

/** Same place as far as a link can tell (it carries 5 decimals, about 1 m). */
export function sameSpotPosition(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) <= 1e-5 && Math.abs(wrapLng(a.lng) - wrapLng(b.lng)) <= 1e-5;
}

/** A spot type id from a link or a stored record, or undefined when it is not one of SPOT_TYPES
 *  (a link from an older build has none; a hand-written one may have anything). */
function sharedSpotType(t) {
  return SPOT_TYPES.some((x) => x.id === t) ? /** @type {SpotType} */ (t) : undefined;
}

/** The share link for a spot, or null when it has no real position. */
export function spotShareUrl(spot, base) {
  if (!spot || spot.lat == null || spot.lng == null) return null;
  const lat = Number(spot.lat), lng = wrapLng(Number(spot.lng));
  if (!validSpotPos(lat, lng)) return null;
  const type = sharedSpotType(spot.type);
  return (base || SITE.siteUrl) + '#s=' + lat.toFixed(5) + ',' + lng.toFixed(5) + (type ? '&t=' + type : '') +
    '&n=' + encodeURIComponent(cleanSpotName(spot.name));
}

/* The fragment's parameters if it is a shared-spot link (it has an `s` key), else null. Any
   other fragment belongs to someone else and is left alone. URLSearchParams, not
   decodeURIComponent: a stray '%' in a hand-edited link must not throw. */
function spotLinkParams(hash) {
  const frag = String(hash == null ? '' : hash).replace(/^#/, '');
  if (!/(^|&)s(=|&|$)/.test(frag)) return null;
  return new URLSearchParams(frag);
}
/** Is this fragment a shared-spot link (well-formed or not)? */
export function isSpotLink(hash) {
  return spotLinkParams(hash) !== null;
}

/** @typedef {{ lat: number, lng: number, name: string, type?: SpotType }} SharedSpot */

/** A shared-spot fragment → { lat, lng, name, type? }, or null when it is not one or does not
 *  check out. Positions are rounded to the 5 decimals a link carries; a type that is not one of
 *  SPOT_TYPES is dropped, not trusted. @returns {SharedSpot|null} */
export function parseSpotLink(hash) {
  const p = spotLinkParams(hash);
  if (!p) return null;
  const raw = p.get('s') || '';
  if (raw.length > 48) return null;
  const m = COORD_RE.exec(raw);
  if (!m) return null;
  const lat = round5(Number(m[1])), lng = round5(Number(m[2]));
  if (!validSpotPos(lat, lng)) return null;
  return withType({ lat, lng, name: cleanSpotName(p.get('n')) }, p.get('t'));
}

/* The type key only when there is a valid one: a link without a type stays { lat, lng, name }. */
function withType(spot, t) {
  const type = sharedSpotType(t);
  return type ? Object.assign(spot, { type }) : spot;
}

/** The shared spot on the chart that is not (yet) one of the user's spots, and its marker. */
export const Shared = {
  spot: /** @type {SharedSpot|null} */ (null),
  marker: null,      // L.Marker
};

/** Share a spot as a link: the share sheet in the iOS app, Web Share on a phone, else the
 *  clipboard (services/native decides). Nothing is awaited before shareText — Web Share only
 *  opens inside the tap that asked for it. Never rejects: both buttons call it with `void`, so
 *  a throw would be an unhandled rejection and a dead button — a failure says so in a toast. */
export async function shareSpot(spot) {
  try {
    const url = spotShareUrl(spot);
    if (!url) { toast('This spot has no position to share'); return 'cancelled'; }
    const name = cleanSpotName(spot.name);
    const res = await shareText({ text: 'Spot: ' + (name || 'unnamed'), url, title: name ? name + ' · ' + SITE.brandName : SITE.brandName });
    if (res === 'copied') toast('Link copied');
    return res;
  } catch (e) {
    console.error('[share spot]', e);
    toast('Could not share this spot — ' + ((e && e.message) || e));
    return 'cancelled';
  }
}

/* The pending marker is built as DOM so the name can be set with textContent: it came from a
   link, and is never parsed as markup. The disc and its glyph are static, and the type in the
   class is one of SPOT_TYPES (parseSpotLink drops anything else), so a shared Hazard keeps its
   alert keyline. A dashed keyline (spots-map.css) tells it apart from the user's own spots —
   shape, not colour. */
function drawSharedMarker(map, spot) {
  const type = sharedSpotType(spot.type) || 'other';
  const el = document.createElement('div');
  el.className = 'spot-mk spot-mk--shared spot-mk--' + type;
  el.innerHTML = '<span class="spot-mk__disc">' + spotGlyphSvg(type, 16) + '</span>';
  if (spot.name) {
    const chip = document.createElement('span');
    chip.className = 'map-chip spot-mk__chip';
    chip.textContent = spot.name;
    el.appendChild(chip);
  }
  const icon = L.divIcon({ className: 'spot-mk-wrap', html: el, iconSize: [28, 28], iconAnchor: [14, 14] });
  const label = 'Shared spot' + (spot.name ? ': ' + spot.name : '');
  const m = L.marker([spot.lat, spot.lng], { icon, title: label, alt: label, riseOnHover: true, zIndexOffset: 500 });
  // The card can be replaced by any other tap on the chart; the marker brings it back.
  m.on('click', () => {
    const ll = L.latLng(spot.lat, spot.lng);
    if (typeof navHandleClick === 'function' && navHandleClick(ll)) return;
    openSharedSpotCard(spot);
  });
  m.addTo(map);
  Shared.marker = m;
}

function removeSharedMarker() {
  if (!Shared.marker) return;
  Shared.marker.remove();
  Shared.marker = null;
}

export function openSharedSpotCard(spot) {
  if (!spot) return;
  openCard('shared-spot', withType({ lat: spot.lat, lng: spot.lng, name: spot.name || '' }, spot.type), { lat: spot.lat, lng: spot.lng });
}

/** Put a shared spot on the chart and open its card. Follow goes off, as for any "take me
 *  there" move, so the first GPS fix does not pull the view straight back to the boat. On a
 *  first run the card opens under the first-run notice and is there once it is dismissed
 *  (the notice's privacy link hands it back too — shell/Onboarding). The spot is centred here;
 *  once the card is laid out, placeSharedSpotClear moves it out from under the card. */
export function showSharedSpot(s) {
  if (!s || !validSpotPos(Number(s.lat), Number(s.lng))) return false;
  const spot = withType({ lat: round5(Number(s.lat)), lng: round5(Number(s.lng)), name: cleanSpotName(s.name) }, s.type);
  removeSharedMarker();
  // Already one of the user's spots: its own marker is there, so no second one on top.
  Shared.spot = Spots.all.some((x) => sameSpotPosition(x, spot)) ? null : spot;
  writeSharedRec(spot, true);
  const map = theMap();
  if (map) {
    closePanels();
    setFollow(false);
    /* Not animated: the card measures the spot's screen position as soon as it is laid out,
       and a zoom animation would still be on its way there. */
    mapProgrammatic(() => map.setView([spot.lat, spot.lng], Math.max(map.getZoom(), 14), { animate: false }));
    if (Shared.spot) drawSharedMarker(map, spot);
  }
  openSharedSpotCard(spot);
  const c = uiStore.getState().card;
  _placeCardId = map && c ? c.id : 0;
  return true;
}

/* ---- Keeping the spot clear of its card ----
   Seeing WHERE the spot is is the point of a link, and on a phone the card docks across the
   lower chart and grows upward with its content: on a short screen (an iPhone SE, any phone
   Safari with its toolbars) it covers the middle, where the spot was centred. No fixed guess
   fits every screen and name length, so the card, once laid out, hands over its rect and the
   room around it (SharedSpotCard) and the chart moves the spot into the clear band between
   the HUD and the card's top — or, when that band is too thin, into the strip under the card,
   above the tab bar. Moving it, the name chip is kept clear of the control column on the right
   (layers above, zoom keys below). Only the opening a link (or a restore after a reload) made
   moves the chart: a card brought back by a tap on the marker leaves the view where the user
   put it. */

/** Room (px) kept between the spot's centre and the HUD, the card or the tab bar: the disc's
 *  radius and its dashed keyline, and a little air. */
export const SHARED_CLEAR_PX = 26;
/** A band thinner than this (px) is no place to put the spot. */
const SHARED_BAND_MIN = 60;
/** From the spot's centre to its name chip's left edge (spots-map.css: chip at left 33px of the
 *  28px marker), and the air kept between the chip's end and the control column. */
const CHIP_OFFSET_PX = 19;
const CHIP_AIR_PX = 8;
/** The card showSharedSpot opened, until it has been laid out and the spot placed. */
let _placeCardId = 0;

/**
 * Where (viewport px) the shared spot should go so its card does not cover it, or null when it
 * is already in the clear. `pt` is the spot's viewport position. `room`: `top` is the HUD's
 * bottom edge, `bottom` the tab bar's top (the screen's bottom without one), `card` the card's
 * rect; optional `right` is the control column's left edge and `chip` the marker's name chip
 * width, so a moved spot's name is not tucked under the zoom keys. Pure, so it is unit-tested.
 * @param {{x: number, y: number}} pt
 * @param {{top: number, bottom: number, right?: number, chip?: number, card: {top: number, bottom: number, left: number, right: number}}} room
 * @returns {{x: number, y: number}|null}
 */
export function sharedSpotClearPoint(pt, room) {
  const { top, bottom, card } = room;
  const m = SHARED_CLEAR_PX;
  const underCard = pt.x > card.left - m && pt.x < card.right + m && pt.y > card.top - m && pt.y < card.bottom + m;
  if (!underCard && pt.y >= top + m && pt.y <= bottom - m) return null;
  const above = card.top - top, below = bottom - card.bottom;
  const useAbove = above >= SHARED_BAND_MIN || (below < SHARED_BAND_MIN && above >= below);
  const y = Math.round(useAbove ? (top + card.top) / 2 : (card.bottom + bottom) / 2);
  /* Only ever further left, to make room for the name — never past the card's left edge, which
     is where the usable chart starts (the phone's gutter, the desktop rail). */
  const maxX = room.right == null ? Infinity : room.right - CHIP_AIR_PX - CHIP_OFFSET_PX - (room.chip || 0);
  const x = pt.x > maxX ? Math.min(pt.x, Math.max(card.left + m, maxX)) : pt.x;
  return { x: Math.round(x), y };
}

/** SharedSpotCard, once laid out: move the chart so the spot the link opened is not under the
 *  card. Acts once, and only for the card showSharedSpot opened. True when the chart moved. */
export function placeSharedSpotClear(cardId, room) {
  if (!cardId || cardId !== _placeCardId) return false;
  _placeCardId = 0;
  const map = theMap();
  const c = uiStore.getState().card;
  if (!map || !c || c.id !== cardId || !room || !room.card) return false;
  if (typeof map.latLngToContainerPoint !== 'function' || typeof map.panBy !== 'function') return false;
  const p = map.latLngToContainerPoint(L.latLng(c.data.lat, c.data.lng));
  const box = map.getContainer().getBoundingClientRect();
  const pt = { x: box.left + p.x, y: box.top + p.y };
  const mk = Shared.marker && typeof Shared.marker.getElement === 'function' ? Shared.marker.getElement() : null;
  const chip = mk ? mk.querySelector('.spot-mk__chip') : null;
  const to = sharedSpotClearPoint(pt, Object.assign({ chip: chip ? chip.getBoundingClientRect().width : 0 }, room));
  if (!to || (Math.abs(pt.x - to.x) < 1 && Math.abs(pt.y - to.y) < 1)) return false;
  mapProgrammatic(() => map.panBy([pt.x - to.x, pt.y - to.y], { animate: false }));
  return true;
}

/* ---- A pending shared spot survives a reload of its tab ----
   The fragment is cleared as soon as a link is read (Back or a bookmark must not reopen it), so
   the spot lived only in memory — and a reload often comes right after: the service worker
   reloads into a new build a second or two after boot, and iOS Safari reloads a tab it evicted
   while the user was off in Messages. sessionStorage is per tab and gone with it, so the spot
   comes back in the tab that opened it and nowhere else. `card` says whether its card was on
   screen: only then does a reload fly back and reopen it — once the card was closed and the
   user moved on, a reload just redraws the marker and leaves the view and follow alone. */
const SHARED_KEY = 'fishapp.sharedSpot';

/** The stored pending spot, re-checked like a link (it is only ever this tab's own write, but a
 *  bad value must not break the boot): { spot, card } or null. */
function readSharedRec() {
  let raw;
  try { raw = sessionStorage.getItem(SHARED_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let r;
  try { r = JSON.parse(raw); } catch (e) { r = null; }
  const lat = r ? Number(r.lat) : NaN, lng = r ? Number(r.lng) : NaN;
  if (!validSpotPos(lat, lng)) { forgetShared(); return null; }
  return { spot: withType({ lat: round5(lat), lng: round5(lng), name: cleanSpotName(r.name) }, r.type), card: !!r.card };
}

function writeSharedRec(spot, card) {
  watchSharedCard();
  try {
    sessionStorage.setItem(SHARED_KEY, JSON.stringify({ lat: spot.lat, lng: spot.lng, name: spot.name, type: spot.type, card }));
  } catch (e) { /* storage blocked or full: a reload loses the spot, as it did before */ }
}

function forgetShared() {
  try { sessionStorage.removeItem(SHARED_KEY); } catch (e) { /* nothing stored */ }
}

const sharedCardOpen = (st) => !!(st.card && st.card.kind === 'shared-spot');
let _sharedWatch = null;
/* Keep the record's `card` in step with the screen, whatever closes the card (its x, Escape,
   another card, a sheet opening) — and forget the spot when its card closes once it is no
   longer pending (it was already, or has since become, one of the user's spots). */
function watchSharedCard() {
  if (_sharedWatch) return;
  let open = sharedCardOpen(uiStore.getState());
  _sharedWatch = uiStore.subscribe((st) => {
    const now = sharedCardOpen(st);
    if (now === open) return;
    open = now;
    const rec = readSharedRec();
    if (!rec) return;
    if (!now && !Shared.spot) forgetShared();
    else writeSharedRec(rec.spot, now);
  });
}

/** Boot with no spot link: bring back the spot a reload of this tab interrupted. Its card and
 *  the view come back only if the card was on screen and `mayMove` (a chart-view link that has
 *  just framed the chart keeps it); otherwise only the marker. True when something came back. */
function restoreSharedSpot(mayMove) {
  const rec = readSharedRec();
  if (!rec) return false;
  if (rec.card && mayMove) return showSharedSpot(rec.spot);
  const map = theMap();
  if (!map) return false;
  if (Spots.all.some((x) => sameSpotPosition(x, rec.spot))) { forgetShared(); return false; }
  removeSharedMarker();
  Shared.spot = rec.spot;
  drawSharedMarker(map, rec.spot);
  writeSharedRec(rec.spot, false);
  return true;
}

/** Drop the fragment, so a reload, a bookmark or Back does not open the spot again. */
export function clearSpotLinkFragment() {
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* leaving it is harmless */ }
}

/** Handle a shared-spot link in the address bar (at boot, and on hashchange while open).
 *  Returns true when a spot was shown. Other fragments are ignored and left in place. */
export function handleSpotLink() {
  let hash;
  try { hash = window.location.hash; } catch (e) { return false; }
  if (!isSpotLink(hash)) return false;
  clearSpotLinkFragment();
  const s = parseSpotLink(hash);
  if (!s) {
    toast('That spot link is damaged or incomplete — there is no position to show.', { ms: 5000 });
    return false;
  }
  return showSharedSpot(s);
}

/* ---- Chart-view links ----
   The public place pages (tools/web/places.mjs) open a marine protected area with
   '#v=south,west,north,east': the chart frames that box and that is all — no pin, no card,
   nothing to save as a fishing spot or start a Go-To to. A no-take reserve or a no-entry
   Special Closure must never arrive looking like a spot. Untrusted input, like a spot link:
   plain decimal degrees in range and a real box, or the chart does not move. */

/** Closest a chart-view link zooms in: a small closure would otherwise fill the screen. */
export const VIEW_LINK_MAX_ZOOM = 15;
const DEG_RE = /^\s*-?\d{1,3}(?:\.\d{1,10})?\s*$/;

function viewLinkParams(hash) {
  const frag = String(hash == null ? '' : hash).replace(/^#/, '');
  if (!/(^|&)v(=|&|$)/.test(frag)) return null;
  return new URLSearchParams(frag);
}
/** Is this fragment a chart-view link (well-formed or not)? One that is also a spot link is a
 *  spot link. */
export function isViewLink(hash) {
  return !isSpotLink(hash) && viewLinkParams(hash) !== null;
}

/** A chart-view fragment → { south, west, north, east }, or null when it is not one or does not
 *  check out (out of range, inside out, or across the antimeridian). Rounded to 5 decimals. */
export function parseViewLink(hash) {
  if (!isViewLink(hash)) return null;
  const raw = viewLinkParams(hash).get('v') || '';
  if (raw.length > 96) return null;
  const parts = raw.split(',');
  if (parts.length !== 4 || !parts.every((x) => DEG_RE.test(x))) return null;
  const [south, west, north, east] = parts.map((x) => round5(Number(x)));
  const okLat = (x) => Math.abs(x) <= 90, okLng = (x) => Math.abs(x) <= 180;
  if (!okLat(south) || !okLat(north) || !okLng(west) || !okLng(east) || south > north || west > east) return null;
  return { south, west, north, east };
}

/** Frame a box on the chart. Panels close and follow goes off, as for a shared spot, so the
 *  first GPS fix does not pull the view back to the boat. No marker, no card. */
export function showLinkedView(b) {
  const map = theMap();
  if (!b || !map) return false;
  closePanels();
  setFollow(false);
  mapProgrammatic(() => map.fitBounds([[b.south, b.west], [b.north, b.east]], { maxZoom: VIEW_LINK_MAX_ZOOM, padding: [24, 24] }));
  return true;
}

/** Handle a chart-view link in the address bar; true when the chart moved. Other fragments are
 *  ignored and left in place. */
export function handleViewLink() {
  let hash;
  try { hash = window.location.hash; } catch (e) { return false; }
  if (!isViewLink(hash)) return false;
  clearSpotLinkFragment();
  const b = parseViewLink(hash);
  if (!b) {
    toast('That chart link is damaged or incomplete — there is no area to show.', { ms: 5000 });
    return false;
  }
  return showLinkedView(b);
}

let _spotLinksListening = false;
/** Boot: the link the app was opened with, then any link opened while it runs. A spot link
 *  (#s=) or a chart-view link (#v=); a malformed spot link clears the fragment, so it never
 *  falls through to a view. With no spot link, a pending spot from before a reload of this
 *  tab comes back (restoreSharedSpot). */
export function spotLinksInit() {
  const handle = () => handleSpotLink() || handleViewLink();
  if (!_spotLinksListening) {
    _spotLinksListening = true;
    window.addEventListener('hashchange', () => { handle(); });
  }
  let hash = '';
  try { hash = window.location.hash; } catch (e) { /* no address bar to read */ }
  const linked = isSpotLink(hash);
  const shown = handle();
  return linked ? shown : restoreSharedSpot(!shown) || shown;
}

/** The shared card's Save: the spot editor, prefilled — with the type the link carried (a
 *  Hazard stays a Hazard), else Fishing spot — so it can be renamed and retyped first. */
export function saveSharedSpot(s) {
  if (!s) return;
  openSpotModal({ lat: s.lat, lng: s.lng, name: s.name || '', type: sharedSpotType(s.type) || 'fish' });
}

/** The shared card's Navigate: a Go-To to it. The pending marker stays until it is saved or
 *  dismissed, so it can still be saved after the run is cancelled or done. */
export async function navigateToSharedSpot(s) {
  if (!s) return false;
  closeCard('shared-spot');
  return !!(await gotoStart({ lat: s.lat, lng: s.lng }, s.name || 'Shared spot'));
}

/** The shared card's Dismiss: off the chart, nothing kept (not even for a reload). */
export function dismissSharedSpot() {
  removeSharedMarker();
  Shared.spot = null;
  _placeCardId = 0;
  forgetShared();
  closeCard('shared-spot');
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
