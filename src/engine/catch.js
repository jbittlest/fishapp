import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { idb } from './db.js';
import { GPS, formatCoord, gpsIsStale, mapProgrammatic, setFollow } from './gps.js';
import { escapeHtml } from './spots.js';
import { navHandleClick } from './nav.js';
import { MS_TO_FT, compass } from './weather.js';
import { Astro } from './astro.js';
import { Tides, nearestTideStation, ymd, noaaTimeMs } from './tides.js';
import { getMap } from './app.js';
import { closeCard, closeModal, closePanels, confirmDialog, openCard, openModal, toast, uiStore } from '../services/ui';
import { saveOrShareFile } from '../services/native';

/* Catch log — record catches with species/size/photo, auto-capture conditions
   (water temp, tide phase, moon, wind), map markers, list, and simple stats.

   Port note: the legacy module drove #modal-catch, #catch-list and #catch-stats and bound
   Leaflet popups. It now publishes plain data through catchStore; React renders the list
   (features/tides/CatchLogSection), the modal (CatchModal, modal name 'catch') and the map
   card (CatchCard, card kind 'catch'). Records, IndexedDB, markers and the save guards
   stay here. */
'use strict';

export const Catch = {
  layer: null,
  all: [],
  markers: {},
  /* The open "Log a catch" session: { session, lat, lng, from, photo, photoPending, photoSeq }.
     Position is fixed when the modal opens. null when the modal is closed. */
  _editing: null,
  _photo: null,   // data URL (mirror of the open session's photo)
  _saving: false,
  loaded: false,
};

/* ------------------------------------------------------------------ view state */
/**
 * @typedef {Object} CatchCond   conditions captured at the catch (all optional — older or
 *   imported records carry fewer; numbers are what the bite engine compares)
 * @property {number} [sst]          water temp °F
 * @property {number} [waveFt]
 * @property {string} [tide]         'incoming' | 'outgoing'
 * @property {number} [minsToTideChange]
 * @property {number} [tidePct]
 * @property {number|null} [tideRangeFt]
 * @property {string} [tideStation]
 * @property {string} [moon]         phase name (legacy records: emoji + name)
 * @property {number} [moonLit]
 * @property {number} [moonPhase]
 * @property {string} [solunar]      'major' | 'minor' | 'off'
 * @property {string} [lightPhase]   'dawn' | 'dusk' | 'day' | 'night'
 * @property {number|null} [minsFromLightChange]
 * @property {number} [windKn]
 * @property {number} [windDir]
 * @property {number|null} [gustKn]
 * @property {number|null} [airF]
 * @property {number|null} [cloudPct]
 * @property {number|null} [pressureHpa]
 * @property {number} [pressureTrend3h]
 * @property {string} [pressureTrend] 'rising' | 'falling' | 'steady'
 * @property {string} [wind]         display string "12kn NW"
 */
/**
 * @typedef {Object} CatchView   one logged catch, React-safe
 * @property {number} id
 * @property {number|null} lat   null when the record has no usable position (a bad backup import)
 * @property {number|null} lng
 * @property {number} ts
 * @property {string} species
 * @property {string} length     inches, as typed
 * @property {string} weight     lb, as typed
 * @property {string} bait
 * @property {string} notes
 * @property {string|null} photo  a validated data:image URL, else null
 * @property {CatchCond} cond
 */
/**
 * @typedef {Object} CatchModalView
 * @property {number} session       changes on every open (keys the form)
 * @property {{ lat: number, lng: number }|null} at   position fixed at open
 * @property {'gps'|'gps-stale'|'map'} from   where `at` came from: a live fix, the LAST fix
 *   (signal lost / older than GPS_STALE_MS — never presented as live), or the chart centre
 * @property {number} fixTs         Date.now() of that GPS fix (0 = unknown / not GPS)
 * @property {string|null} photo    downscaled preview (data URL)
 * @property {boolean} photoBusy    a picked photo is still decoding
 * @property {string|null} photoError
 * @property {boolean} saving       a save is in flight (any session — the re-entry guard is global)
 */
/**
 * @typedef {Object} CatchLogView
 * @property {boolean} loaded
 * @property {string|null} error     the log couldn't be read (IndexedDB)
 * @property {CatchView[]} items     newest first
 * @property {number} total
 * @property {Array<{ species: string, count: number }>} top   up to 4, most caught first
 * @property {CatchModalView} modal
 */
/** @type {import('zustand/vanilla').StoreApi<CatchLogView>} */
export const catchStore = createStore(() => /** @type {CatchLogView} */ ({
  loaded: false,
  error: null,
  items: [],
  total: 0,
  top: [],
  modal: { session: 0, at: null, from: 'gps', fixTs: 0, photo: null, photoBusy: false, photoError: null, saving: false },
}));

function publishModal(patch) {
  catchStore.setState((s) => ({ modal: { ...s.modal, ...patch } }));
}

/* Only ever render a photo that is an image data URL. Records come back from backup
   imports, and the legacy popup interpolated c.photo straight into an <img src="…"> —
   a crafted backup could inject markup. SVG is refused too (it is a document, not a photo). */
export function isSafePhotoUrl(s) {
  return typeof s === 'string' && /^data:image\/(?!svg)[a-z0-9.+-]+[;,]/i.test(s);
}

/* Moon names saved by the legacy app led with a moon-phase emoji and a space, then the name
   ("<emoji> Full Moon"); the app shows none. Strips anything before the first letter. */
export function cleanMoonName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/^[^A-Za-z]+/, '').trim();
}

const str = (v) => (v == null ? '' : String(v));

/* A catch's position, or null when it has none we can use. Backup imports (spots.js importData)
   write records with no coordinate checks; one record with a missing or non-numeric lat/lng
   made L.marker throw "Invalid LatLng" inside the load loop, and the whole log then sat on
   "Loading your catches…" forever. Numeric strings are accepted (Leaflet accepts them too);
   '' / null / NaN / out-of-range are not — formatCoord would print them as 0°00.000'N, a
   position that was never recorded. Pure. */
const coordNum = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));
export function catchPos(c) {
  if (!c) return null;
  const lat = coordNum(c.lat), lng = coordNum(c.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/* Conditions as the card / list / share card may render them. Imported cond fields are
   untrusted: a number where a string belongs made cap() throw, an object reached React as a
   child — either way the card fell back to "Couldn't show this". Keeps finite numbers for the
   numeric keys and non-empty strings for the text keys; drops everything else. Pure. */
const COND_NUM = ['sst', 'waveFt', 'minsToTideChange', 'tidePct', 'tideRangeFt', 'moonLit', 'moonPhase',
  'minsFromSunrise', 'minsFromSunset', 'minsFromLightChange', 'windKn', 'windDir', 'gustKn', 'airF',
  'cloudPct', 'pressureHpa', 'pressureTrend3h'];
const COND_STR = ['tide', 'tideStation', 'moon', 'solunar', 'lightPhase', 'pressureTrend', 'wind'];
/** @returns {CatchCond} */
export function condToView(cond) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!cond || typeof cond !== 'object') return out;
  COND_NUM.forEach((k) => { const v = cond[k]; if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; });
  COND_STR.forEach((k) => { const v = cond[k]; if (typeof v === 'string' && v.trim()) out[k] = v; });
  return out;
}

/** @returns {CatchView} */
export function catchToView(c) {
  const pos = catchPos(c);
  return {
    id: c.id, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, ts: c.ts,
    species: str(c.species) || 'Catch',
    length: str(c.length), weight: str(c.weight), bait: str(c.bait), notes: str(c.notes),
    photo: isSafePhotoUrl(c.photo) ? c.photo : null,
    cond: condToView(c.cond),
  };
}

/* Stats + list, as the legacy renderCatchList computed them: total, the top 4 species by
   count (exact, case-sensitive grouping), newest first. A record with no species (backup
   imports) counts as "Catch", the same default a save with an empty species field gets.
   Pure. */
export function catchListView(all) {
  if (!all.length) return { items: [], total: 0, top: [] };
  const bySpecies = {};
  all.forEach((c) => { const k = c.species || 'Catch'; bySpecies[k] = (bySpecies[k] || 0) + 1; });
  const top = Object.entries(bySpecies).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([species, count]) => ({ species, count }));
  const items = all.slice().sort((a, b) => b.ts - a.ts).map(catchToView);
  return { items, total: all.length, top };
}

/* Publish Catch.all to the list / stats / cards. (Name kept from the legacy DOM renderer —
   spots.js backup import still calls it after rebuilding markers.) */
export function renderCatchList() {
  catchStore.setState({ ...catchListView(Catch.all), loaded: Catch.loaded, error: null });
}

/* ------------------------------------------------------------------ map layer */
export async function catchInit(map) {
  Catch.layer = L.layerGroup().addTo(map);
  try {
    const all = await idb.getAll('catches');
    Catch.all = Array.isArray(all) ? all : [];
  } catch (e) {
    // Say so instead of spinning forever; the list offers Retry (catchesReload).
    catchStore.setState({ error: 'Couldn’t open your catch log on this device.' });
    throw e;
  }
  /* One bad record must not take the rest of the log with it: markers go on per record, and
     the list is published whatever happened (so a broken record can still be found and
     deleted — legacy recovered by re-rendering on every Tools open; this port has no such
     re-render). */
  addCatchMarkers(Catch.all);
  Catch.loaded = true;
  /* Render the list too. Without this, opening Nav Tools before the load resolved
     showed "No catches logged yet" over a map covered in catch markers — and it
     never corrected itself until the panel was closed and reopened. */
  renderCatchList();
}

/* Re-read the log from IndexedDB and rebuild every marker (backup import replaces the
   whole store underneath us). */
export async function catchesReload() {
  try {
    const all = await idb.getAll('catches');
    Catch.all = Array.isArray(all) ? all : [];
  } catch (e) {
    catchStore.setState({ error: 'Couldn’t open your catch log on this device.' });
    return;
  }
  if (Catch.layer) {
    Catch.layer.clearLayers(); Catch.markers = {};
    addCatchMarkers(Catch.all);
  }
  Catch.loaded = true;
  renderCatchList();
}

/* Draw a marker per record; a record that can't be drawn is skipped, never fatal.
   Returns how many were drawn. */
export function addCatchMarkers(list) {
  let n = 0;
  (list || []).forEach((c) => {
    try { if (addCatchMarker(c)) n++; } catch (e) { /* skip this record; the list still shows it */ }
  });
  return n;
}

/* Map symbology (DESIGN.md §5): ink disc with a line fish glyph, name on an ink chip.
   Colours come from tokens via inline style until the shell carries a .catch-pin rule
   (docs/requests/tides-bite-catch.md). Glyph: Lucide "fish" (ISC). */
const FISH_PATHS = [
  'M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z',
  'M18 12v.5',
  'M16 17.93a9.77 9.77 0 0 1 0-11.86',
  'M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33',
  'M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4',
  'm16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98',
];
/* Geometry: the marker's Leaflet box is ONLY the 26 px disc (anchored on its centre), with a
   transparent 44 px hit extension like spots' .spot-mk::before. The species chip hangs below
   the box and takes no pointer events. The box used to be 140×50 (legacy 90×44) and every
   transparent pixel of it was the tap target, so a chart tap within ~70 px of a catch —
   inspect, a route-planner point, a measure point — opened the catch card instead. */
export const CATCH_PIN_PX = 26;
export function catchMarkerHtml(c) {
  const glyph = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    FISH_PATHS.map((d) => '<path d="' + d + '"/>').join('') + '</svg>';
  return '<div class="catch-pin__wrap" style="position:relative;width:' + CATCH_PIN_PX + 'px;height:' + CATCH_PIN_PX + 'px">' +
    '<span class="catch-pin__hit" style="position:absolute;inset:-9px;border-radius:50%"></span>' +   // 44px hit area
    '<span class="catch-pin__disc" style="position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;' +
    'background:var(--chart-ink);color:var(--text-1);box-shadow:var(--e1)">' + glyph + '</span>' +
    '<span class="map-chip catch-pin__label" style="position:absolute;top:' + (CATCH_PIN_PX + 3) + 'px;left:50%;' +
    'transform:translateX(-50%);max-width:140px;overflow:hidden;text-overflow:ellipsis;pointer-events:none">' +
    escapeHtml(c.species || 'Catch') + '</span></div>';
}

/* Returns true when a marker was drawn. A record with no usable position gets none (it still
   lists, so it can be opened and deleted). */
export function addCatchMarker(c) {
  // A log that loads before the map layer exists (or a failed catchInit) must not make a
  // save throw after the record is already written.
  if (!Catch.layer) return false;
  const pos = catchPos(c);
  if (!pos) return false;
  const m = L.marker([pos.lat, pos.lng], {
    icon: L.divIcon({
      className: 'catch-pin', html: catchMarkerHtml(c),
      iconSize: [CATCH_PIN_PX, CATCH_PIN_PX], iconAnchor: [CATCH_PIN_PX / 2, CATCH_PIN_PX / 2],
    }),
    title: c.species || 'Catch',
  });
  /* Leaflet popup → the docked map card (features/tides/CatchCard). When the route planner or
     the measure tool is active the tap is theirs, and snaps to the catch's exact position —
     the same rule as a saved spot. */
  m.on('click', () => {
    if (typeof navHandleClick === 'function' && navHandleClick(L.latLng(pos.lat, pos.lng))) return;
    openCatchCard(c.id);
  });
  m.addTo(Catch.layer);
  Catch.markers[c.id] = m;
  return true;
}

export function openCatchCard(id) {
  const c = Catch.all.find((x) => x.id === id);
  if (!c) return;
  const pos = catchPos(c);
  openCard('catch', { id }, pos || undefined);
}

/* The list's "show me": fly to the catch and open its card. mapProgrammatic + setFollow(false)
   so the auto-refollow timer doesn't yank the map back to the boat. A record with no usable
   position just opens its card (nowhere to fly to). */
export function goToCatch(id) {
  const c = Catch.all.find((x) => x.id === id);
  const map = getMap();
  if (!c || !map) return;
  closePanels();
  const pos = catchPos(c);
  if (pos) {
    setFollow(false);
    mapProgrammatic(() => map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 14)));
  }
  openCatchCard(id);
}

/* ---- Modal ---- */
let _session = 0;
export function openCatchModal() {
  const map = getMap();
  const ll = GPS.lastLatLng || (map ? map.getCenter() : null);
  if (!ll) { toast('Waiting for the map — try again in a moment'); return; }
  /* The catch is still pinned to GPS.lastLatLng (legacy), but a lost or old fix is labelled as
     the LAST fix with its age — never presented as "your GPS position" (DESIGN.md §0.7). */
  const from = GPS.lastLatLng ? (gpsIsStale() ? 'gps-stale' : 'gps') : 'map';
  const fixTs = GPS.lastLatLng ? (GPS.lastFixTs || 0) : 0;
  Catch._editing = {
    session: ++_session, lat: ll.lat, lng: ll.lng, from,
    photo: null, photoPending: null, photoSeq: 0,
  };
  Catch._photo = null;
  /* Clear the file input too, or picking the SAME photo again fires no change event
     and the catch saves with no picture while the user watched themselves attach one.
     (The modal host mounts a fresh form — and a fresh <input type=file> — per session.) */
  publishModal({
    session: Catch._editing.session, at: { lat: ll.lat, lng: ll.lng }, from, fixTs,
    photo: null, photoBusy: false, photoError: null, saving: Catch._saving,
  });
  openModal('catch', { session: Catch._editing.session });
}

export function closeCatchModal() {
  closeModal('catch');
  Catch._editing = null;
  Catch._photo = null;
  publishModal({ photo: null, photoBusy: false, photoError: null });
}

/* A detached canvas for image work (downscaling a photo, drawing the share card). Not app
   DOM: nothing is attached to the document. */
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(0, Math.round(w)); cv.height = Math.max(0, Math.round(h));
  return cv;
}

export const PHOTO_ERROR = 'Couldn’t read that photo. Try another one, or save the catch without it.';
export const PHOTO_WAIT_MS = 15000;

export function onCatchPhoto(file) {
  const e = Catch._editing;
  if (!file || !e) return;
  /* Each pick takes a ticket, and a decode only lands in the session that asked for it:
     a slow decode used to arrive after the modal was closed and reopened and attach
     the old fish's photo to the new one. */
  const seq = ++e.photoSeq;
  const current = () => Catch._editing === e && e.photoSeq === seq;
  publishModal({ photoBusy: true, photoError: null });
  e.photoPending = new Promise((resolve) => {
    /* The legacy pipeline had no error path: an image the browser couldn't decode
       (some HEIC, a corrupt file) was dropped silently and the catch saved without it. */
    const fail = () => { if (current()) publishModal({ photoBusy: false, photoError: PHOTO_ERROR }); resolve(); };
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      // downscale to keep storage small
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        try {
          const max = 900, sc = Math.min(1, max / Math.max(img.width, img.height));
          const cv = makeCanvas(img.width * sc, img.height * sc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          const url = cv.toDataURL('image/jpeg', 0.75);
          if (!isSafePhotoUrl(url)) { fail(); return; }   // a 0×0 canvas gives "data:,"
          if (e.photoSeq === seq) e.photo = url;
          if (current()) { Catch._photo = url; publishModal({ photo: url, photoBusy: false, photoError: null }); }
        } catch (err) { fail(); return; }
        resolve();
      };
      img.src = /** @type {string} */ (reader.result);
    };
    try { reader.readAsDataURL(file); } catch (err) { fail(); }
  });
}

export function clearCatchPhoto() {
  const e = Catch._editing;
  if (!e) return;
  e.photoSeq++;            // drop any decode still running
  e.photo = null; e.photoPending = null;
  Catch._photo = null;
  publishModal({ photo: null, photoBusy: false, photoError: null });
}

/**
 * Save the open session's catch. `fields` is the form, read by the modal at the moment Save
 * was tapped. Resolves true when the catch was written.
 * @param {{ species?: string, length?: string, weight?: string, bait?: string, notes?: string }} fields
 */
export async function saveCatch(fields) {
  const e = Catch._editing;
  /* Guard re-entry. captureConditions makes three network calls, so Save could sit
     there for tens of seconds looking like it did nothing — a second tap logged the
     fish twice, with two markers and a skewed bite model. */
  if (!e || Catch._saving) return false;
  Catch._saving = true;
  publishModal({ saving: true });   // the button shows "Saving…" and is disabled
  try {
    /* Read the form BEFORE the await — the conditions lookup is slow and the fields
       shouldn't be able to change underneath it. (The modal hands us a snapshot.) */
    const f = fields || {};
    const c = {
      lat: e.lat, lng: e.lng, ts: Date.now(),
      species: str(f.species).trim() || 'Catch',
      length: str(f.length).trim(),
      weight: str(f.weight).trim(),
      bait: str(f.bait).trim(),
      notes: str(f.notes).trim(),
      photo: e.photo || null, cond: {},
    };
    /* A photo still decoding when Save was tapped was silently left behind. Wait for it —
       but never let a decode that hangs hold the fish hostage (saved without it). */
    if (e.photoPending) {
      try { await Promise.race([e.photoPending, new Promise((r) => setTimeout(r, PHOTO_WAIT_MS))]); } catch (err) { /* saved without it */ }
      c.photo = e.photo || null;
    }
    /* Conditions are a bonus; the CATCH is the thing that must not be lost. If the
       lookup throws or times out, save the fish anyway — this used to reject and
       leave the modal open with nothing written and no error shown. */
    try { c.cond = await captureConditions(L.latLng(e.lat, e.lng)) || {}; } catch (err) { c.cond = {}; }
    const id = await idb.put('catches', c);
    c.id = id;
    Catch.all.push(c);
    addCatchMarker(c);
    /* Close only the session this save belongs to. Closing and reopening the modal during a
       slow save used to have the old save close the NEW modal, discarding what was typed. */
    if (Catch._editing === e) closeCatchModal();
    toast('Catch logged');
    renderCatchList();
    return true;
  } catch (err) {
    toast('Couldn\'t save that catch: ' + ((err && err.message) || err));
    return false;
  } finally {
    Catch._saving = false;
    publishModal({ saving: false });
  }
}

/* Upper bound on the online part of captureConditions (the lookups run in parallel). With the
   photo wait (PHOTO_WAIT_MS) in front, Save resolves in under a minute on any signal. */
export const CAPTURE_WAIT_MS = 40000;

/* Auto-capture the conditions at the moment/place of the catch.

   These records are the raw material for the bite-pattern engine (bite.js), so values are
   stored as NUMBERS wherever they'll be compared later — the human-readable strings are kept
   alongside purely for the popup. Anything not captured at catch time is gone forever, which
   is why this grabs more than the UI currently displays. */
export async function captureConditions(ll) {
  const cond = {};
  const now = new Date();
  /* ONE "now" for the whole snapshot, declared out here. It used to be declared inside the
     solunar try below, so the tide block at the end threw a ReferenceError on every call —
     swallowed by its catch — and no catch since commit 0d79399 recorded tide state, minutes
     to the turn or tide stage: the bite engine's three tide dimensions never trained. */
  const nowMs = now.getTime();
  /* Guarded like every other block here. This was the one section running bare, so a
     malformed solunar return threw straight out of saveCatch — and the fish, not just
     the conditions, was silently never written. */
  try {
    const ill = Astro.moonIllumination(now);
    cond.moon = Astro.moonPhaseName(ill.phase);
    cond.moonLit = Math.round(ill.fraction * 100);
    cond.moonPhase = +ill.phase.toFixed(3);        // 0-1, numeric for matching
    // solunar: was it a major/minor period?
    const per = Astro.solunar(now, ll.lat, ll.lng);
    const act = Array.isArray(per) ? per.find((p) => nowMs >= p.start && nowMs <= p.end) : null;
    cond.solunar = act ? act.type : 'off';
  } catch (e) { /* non-fatal — the catch itself matters more */ }

  /* Light phase and minutes to the nearest sunrise/sunset — dawn/dusk proximity is one of
     the strongest timing signals in fishing, and it can't be reconstructed after the fact. */
  try {
    const st = Astro.sunTimes(now, ll.lat, ll.lng);
    const mins = (a, b) => Math.round((a - b) / 60000);
    const dSunrise = st.sunrise ? mins(now, st.sunrise) : null;
    const dSunset = st.sunset ? mins(now, st.sunset) : null;
    cond.minsFromSunrise = dSunrise;
    cond.minsFromSunset = dSunset;
    if (dSunrise != null && dSunset != null) {
      const nearest = Math.abs(dSunrise) <= Math.abs(dSunset) ? dSunrise : dSunset;
      cond.minsFromLightChange = nearest;
      cond.lightPhase = Math.abs(nearest) <= 60 ? (Math.abs(dSunrise) <= Math.abs(dSunset) ? 'dawn' : 'dusk')
        : (dSunrise > 0 && dSunset < 0 ? 'day' : 'night');
    }
  } catch (e) { /* non-fatal */ }

  if (navigator.onLine) {
    /* The three lookups are independent (each writes its own keys), so they run side by side
       instead of one after another: back to back, each under the 30 s global fetch timeout,
       a weak signal held Save for ~2 minutes. And the whole lot is capped at CAPTURE_WAIT_MS —
       the global timeout only covers the response headers, so a stalled body could otherwise
       hold the fish hostage indefinitely. Whatever arrived by then is kept. */
    const marine = (async () => {
      try {
        const d = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + ll.lat.toFixed(3) +
          '&longitude=' + ll.lng.toFixed(3) + '&current=sea_surface_temperature,wave_height&temperature_unit=fahrenheit').then((r) => r.json());
        if (d.current) {
          if (d.current.sea_surface_temperature != null) cond.sst = Math.round(d.current.sea_surface_temperature);
          // wave height was being fetched and thrown away — keep it, it's a bite factor
          if (d.current.wave_height != null) cond.waveFt = +(d.current.wave_height * MS_TO_FT).toFixed(1);
        }
      } catch (e) {}
    })();
    const weather = (async () => {
      try {
        /* Barometric pressure AND its trend. Trend matters more than the absolute value —
           fish notoriously go off on a sharp rise after a front — and it needs the last few
           hours of history, which only exists at capture time. */
        const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + ll.lat.toFixed(3) +
          '&longitude=' + ll.lng.toFixed(3) +
          '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,pressure_msl,cloud_cover' +
          '&hourly=pressure_msl&past_hours=6&forecast_hours=1' +
          '&wind_speed_unit=kn&temperature_unit=fahrenheit').then((r) => r.json());
        if (w.current) {
          cond.windKn = Math.round(w.current.wind_speed_10m);
          cond.windDir = Math.round(w.current.wind_direction_10m);
          cond.gustKn = w.current.wind_gusts_10m != null ? Math.round(w.current.wind_gusts_10m) : null;
          cond.airF = w.current.temperature_2m != null ? Math.round(w.current.temperature_2m) : null;
          cond.cloudPct = w.current.cloud_cover != null ? Math.round(w.current.cloud_cover) : null;
          cond.pressureHpa = w.current.pressure_msl != null ? +w.current.pressure_msl.toFixed(1) : null;
          cond.wind = cond.windKn + 'kn ' + compass(cond.windDir);   // display string (unchanged)
        }
        const ph = w.hourly && w.hourly.pressure_msl;
        if (ph && ph.length >= 4 && cond.pressureHpa != null) {
          const past = ph.filter((v) => v != null);
          const threeAgo = past[Math.max(0, past.length - 4)];
          if (threeAgo != null) {
            cond.pressureTrend3h = +(cond.pressureHpa - threeAgo).toFixed(1);
            cond.pressureTrend = cond.pressureTrend3h > 1 ? 'rising'
              : (cond.pressureTrend3h < -1 ? 'falling' : 'steady');
          }
        }
      } catch (e) {}
    })();
    const tide = (async () => {
      if (!(Tides.stations && Tides.stations.length)) return;
      try {
        const st = nearestTideStation(ll);
        const r = await fetch('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=fishapp&datum=MLLW&time_zone=lst_ldt&units=english&format=json&product=predictions&interval=hilo&station=' + st.id +
          '&begin_date=' + ymd(new Date(nowMs - 86400000)) + '&end_date=' + ymd(new Date(nowMs + 86400000))).then((x) => x.json());
        // NOAA lst_ldt, parsed device-local (noaaTimeMs) — never UTC
        const hl = (r.predictions || []).map((p) => ({ t: noaaTimeMs(p.t), type: p.type, v: parseFloat(p.v) }));
        tideStateAt(hl, nowMs, cond);
        cond.tideStation = st.id;
      } catch (e) {}
    })();
    let capTimer;
    await Promise.race([
      Promise.all([marine, weather, tide]),
      new Promise((r) => { capTimer = setTimeout(r, CAPTURE_WAIT_MS); }),
    ]);
    clearTimeout(capTimer);
  }
  // A copy: a lookup still running past the cap writes into `cond`, never into the saved record.
  return { ...cond };
}

/* Tide state at `nowMs` from hi/lo predictions [{t, type, v}] — same semantics as the bite
   engine's reconstruction (bite.js biteCondAt): an 'H' next means the tide is coming in.
   Writes tide / minsToTideChange / tidePct / tideRangeFt into `cond`. Pure apart from that. */
export function tideStateAt(hl, nowMs, cond) {
  const next = hl.find((p) => p.t > nowMs);
  const prev = hl.filter((p) => p.t <= nowMs).pop();
  if (next) {
    cond.tide = (next.type === 'H' ? 'incoming' : 'outgoing');
    // Minutes to the turn, and how far through the cycle — slack vs mid-flow is a much
    // sharper signal than direction alone, and it can't be recovered later.
    cond.minsToTideChange = Math.round((next.t - nowMs) / 60000);
    if (prev) {
      const span = next.t - prev.t;
      if (span > 0) cond.tidePct = Math.round(((nowMs - prev.t) / span) * 100);
      cond.tideRangeFt = (next.v != null && prev.v != null) ? +Math.abs(next.v - prev.v).toFixed(1) : null;
    }
  }
  return cond;
}

/* Delete a catch. Always asks first ("Delete this catch?") unless the caller already did
   (opts.confirmed). Resolves true when it was deleted. */
export async function deleteCatch(id, opts) {
  if (!(opts && opts.confirmed)) {
    const c0 = Catch.all.find((c) => c.id === id);
    const ok = await confirmDialog({
      title: 'Delete this catch?',
      message: c0 ? (c0.species || 'Catch') + ', ' + new Date(c0.ts).toLocaleDateString() + '.' : undefined,
      confirmLabel: 'Delete', destructive: true,
    });
    if (!ok) return false;
  }
  // Re-check after the dialog: it may already be gone (deleted from the card, or a backup
  // import replaced the log while the question was up).
  if (!Catch.all.some((c) => c.id === id)) return false;
  try {
    await idb.del('catches', id);
  } catch (err) {
    toast('Couldn\'t delete that catch: ' + ((err && err.message) || err));
    return false;
  }
  if (Catch.markers[id]) { if (Catch.layer) Catch.layer.removeLayer(Catch.markers[id]); delete Catch.markers[id]; }
  Catch.all = Catch.all.filter((c) => c.id !== id);
  const card = uiStore.getState().card;
  if (card && card.kind === 'catch' && card.data && card.data.id === id) closeCard('catch');
  renderCatchList();
  return true;
}

/* One line of captured conditions for the share card / list, no emoji:
   "64°F water · incoming tide · Full Moon". */
export function catchCondLine(cond, sep) {
  const c = cond || {};
  return [
    c.sst != null ? c.sst + '°F water' : '',
    c.tide ? c.tide + ' tide' : '',
    c.moon ? cleanMoonName(c.moon) : '',
  ].filter(Boolean).join(sep || ' · ');
}

/* Build a shareable catch card (photo + details) and share/download it.
   1080×1080 PNG → saveOrShareFile: the share sheet in the iOS app (and iPhone Safari),
   a download elsewhere. Resolves to what happened. */
export async function makeCatchCard(c) {
  try {
    const S = 1080, F = ' Barlow, -apple-system,"Segoe UI",Roboto,sans-serif';
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext('2d');
    const photo = isSafePhotoUrl(c.photo) ? c.photo : null;
    // background: the photo (cover) or the ink gradient with a fish glyph
    let drewPhoto = false;
    if (photo) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.onerror = res; img.src = photo; });
      if (img.naturalWidth) {
        const r = Math.max(S / img.width, S / img.height);
        ctx.drawImage(img, (S - img.width * r) / 2, (S - img.height * r) / 2, img.width * r, img.height * r);
        drewPhoto = true;
      }
    }
    if (!drewPhoto) {
      const bg = ctx.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#0B131C'); bg.addColorStop(1, '#152230');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
      drawFish(ctx, S / 2 - 200, S / 2 - 320, 400, 'rgba(243,246,249,0.9)', 1.6);
    }
    // bottom scrim + text
    const g = ctx.createLinearGradient(0, S * 0.4, 0, S);
    g.addColorStop(0, 'rgba(6,11,17,0)'); g.addColorStop(1, 'rgba(6,11,17,0.92)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#F3F6F9';
    ctx.font = '700 82px' + F; ctx.fillText(c.species || 'Catch', 56, S - 268);
    const size = [c.length ? c.length + '"' : '', c.weight ? c.weight + ' lb' : ''].filter(Boolean).join('   ·   ');
    ctx.font = '500 46px' + F; if (size) ctx.fillText(size, 56, S - 206);
    const l2 = catchCondLine(condToView(c.cond), '    ·    ');
    ctx.fillStyle = 'rgba(243,246,249,0.9)'; ctx.font = '500 38px' + F; if (l2) ctx.fillText(l2, 56, S - 150);
    ctx.fillStyle = 'rgba(243,246,249,0.72)'; ctx.font = '500 34px' + F;
    // No usable position (a bad import): leave it off rather than print 0°00.000'N.
    const pos = catchPos(c);
    ctx.fillText(new Date(c.ts).toLocaleDateString() + (pos ? '    ' + formatCoord(pos.lat, 'lat') + '  ' + formatCoord(pos.lng, 'lon') : ''), 56, S - 100);
    drawFish(ctx, 56, S - 80, 44, '#FFB547', 2.4);
    ctx.fillStyle = '#FFB547'; ctx.font = '700 42px' + F; ctx.fillText('FishApp', 112, S - 44);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) { toast('Could not make card'); return 'failed'; }
    const name = (c.species || 'catch').replace(/\s+/g, '_') + '.png';
    const how = await saveOrShareFile({ name, mime: 'image/png', data: blob, title: 'My catch' });
    if (how === 'downloaded') toast('Catch card saved');
    return how;
  } catch (e) {
    toast('Could not make card');
    return 'failed';
  }
}

/* The Lucide fish glyph (24-unit grid) stroked onto a canvas at (x, y), `size` px square. */
function drawFish(ctx, x, y, size, color, stroke) {
  if (typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  FISH_PATHS.forEach((d) => ctx.stroke(new Path2D(d)));
  ctx.restore();
}
