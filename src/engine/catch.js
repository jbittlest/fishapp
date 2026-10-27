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
import { reviewMoment } from '../services/review';
import { SITE } from '../services/site';

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
    reviewMoment('catch');
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

/* One line of captured conditions, no emoji (the share card draws the same three as chips —
   catchCardConds): "64°F water · incoming tide · Full Moon". */
export function catchCondLine(cond, sep) {
  const c = cond || {};
  return [
    c.sst != null ? c.sst + '°F water' : '',
    c.tide ? c.tide + ' tide' : '',
    c.moon ? cleanMoonName(c.moon) : '',
  ].filter(Boolean).join(sep || ' · ');
}

/* ------------------------------------------------------------------ share card
   A catch card is made to be posted, so it is drawn for strangers' eyes. The position is left
   off unless the angler turns it on for that one card (CatchCardOptions.showPosition): a spot
   is the one thing anglers never give away, and the legacy card printed it on every share.
   Notes stay off too (they tend to say where). Two formats: a square post and a 9:16 story.

   It is an image other people look at, so it is always drawn in the Day palette (tokens.css;
   canvas can't read CSS variables), whatever theme the app is in. */
const CARD_COLOR = {
  ink: '#0B131C',         // --chrome-solid
  inkRgb: '11,19,28',
  deepRgb: '6,11,17',     // --ink-950: the photo scrim
  raised: '#152230',      // --raised
  shoal: '#1B2C3E',       // the no-photo chart art's shallowest tint
  text1: '#F3F6F9', text2: '#B4C0CC', text3: '#8493A3',
  line: 'rgba(196,214,232,0.18)',   // --line-2
  signal: '#FFB547',      // the one accent: the date and the brand mark
};
const CARD_FALLBACK = ', -apple-system, "Segoe UI", Roboto, sans-serif';
const uiFont = (weight, px) => weight + ' ' + px + 'px Barlow' + CARD_FALLBACK;
const instFont = (weight, px) => weight + ' ' + px + 'px "Barlow Semi Condensed", Barlow' + CARD_FALLBACK;
/* Every face the card draws with. main.tsx bundles them all, but the browser only fetches a
   face once something on screen uses it — a card drawn before that came out in the fallback. */
export const CARD_FONT_FACES = ['500 40px Barlow', '600 40px Barlow', '700 40px Barlow', '600 40px "Barlow Semi Condensed"'];
export const CARD_FONT_WAIT_MS = 3000;
export const CARD_PHOTO_WAIT_MS = 8000;
/* Catch photos put the fish a little above the middle (held at chest height), so a tall photo
   cropped to the card keeps it. */
const CARD_PHOTO_FOCUS = 0.42;
/* Stories lay the reply bar over the bottom of a 9:16 image on 16:9 phones (~200 px of 1920);
   the brand line sits above it. */
const STORY_SAFE_BOTTOM = 200;

/** @typedef {'post'|'story'} CatchCardFormat */
/** @type {Record<CatchCardFormat, { w: number, h: number }>} */
export const CATCH_CARD_SIZES = { post: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } };

/**
 * @typedef {Object} CatchCardOptions
 * @property {CatchCardFormat} [format]   'post' (1080×1080, the default) or 'story' (1080×1920)
 * @property {boolean} [showPosition]     print the catch's coordinates. Only an explicit true
 *   does; the share sheet starts every card with it off and never remembers it.
 * @property {Blob|null} [rendered]       the card renderCatchCard already drew with these same
 *   options (the share sheet's preview), shared as is
 */
/**
 * @typedef {Object} CatchCardModel   everything the card prints, as text
 * @property {CatchCardFormat} format
 * @property {string} species
 * @property {string} when            "Oct 24, 2026 · 6:42 AM" ('' for a broken timestamp)
 * @property {Array<{ key: string, label: string, value: string, unit: string }>} stats
 * @property {Array<{ key: string, icon: string, label: string, value: string, chip: string }>} conds
 * @property {string|null} position   null unless this card asked for it
 * @property {{ lead: string, name: string, url: string }} brand
 */

const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const NUMERIC = /^\d+(?:[.,]\d+)?$/;

/* Length and weight as the card prints them. The form only takes numbers, but backup imports
   can carry anything: a value that isn't a plain number is printed as typed, with no unit. */
export function catchCardStats(c) {
  const out = [];
  [['length', 'in', 'Length'], ['weight', 'lb', 'Weight']].forEach(([key, unit, label]) => {
    const v = str(c && c[key]).replace(/\s+/g, ' ').trim();
    if (v) out.push({ key, label, value: v, unit: NUMERIC.test(v) ? unit : '' });
  });
  return out;
}

/* The captured conditions worth a stranger's glance — water temp, tide, moon — for whatever this
   record has (catchCondLine's three, in the same order). */
export function catchCardConds(cond) {
  const c = condToView(cond);
  const out = [];
  if (c.sst != null) out.push({ key: 'water', icon: 'thermo', label: 'Water', value: Math.round(c.sst) + '°F', chip: Math.round(c.sst) + '°F water' });
  if (c.tide) {
    const tide = capFirst(c.tide.trim());
    out.push({ key: 'tide', icon: c.tide === 'outgoing' ? 'tideOut' : 'tideIn', label: 'Tide', value: tide, chip: tide + ' tide' });
  }
  const moon = c.moon ? cleanMoonName(c.moon) : '';
  if (moon) out.push({ key: 'moon', icon: 'moon', label: 'Moon', value: moon, chip: moon });
  return out;
}

export function cardWhen(ts) {
  const d = new Date(typeof ts === 'number' ? ts : NaN);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * What the card prints. Pure.
 * @param {any} c   a CatchView (or a raw record)
 * @param {CatchCardOptions} [opts]
 * @returns {CatchCardModel}
 */
export function catchCardModel(c, opts) {
  const o = opts || {};
  // No usable position (a bad import) stays off even when asked for, rather than print 0°00.000'N.
  const pos = o.showPosition === true ? catchPos(c) : null;
  return {
    format: o.format === 'story' ? 'story' : 'post',
    species: str(c && c.species).replace(/\s+/g, ' ').trim() || 'Catch',
    when: cardWhen(c && c.ts),
    stats: catchCardStats(c),
    conds: catchCardConds(c && c.cond),
    position: pos ? formatCoord(pos.lat, 'lat') + '   ' + formatCoord(pos.lng, 'lon') : null,
    brand: { lead: 'Logged with', name: SITE.brandName, url: SITE.shortUrl },
  };
}

/* "Calico_Bass.png", "Calico_Bass_story.png": no path or reserved characters from the species. */
export function cardFileName(species, format) {
  const clean = Array.from(str(species)).filter((ch) => ch.charCodeAt(0) >= 32 && !'\\/:*?"<>|#%'.includes(ch)).join('');
  const base = clean.trim().replace(/\s+/g, '_').slice(0, 60) || 'catch';
  return base + (format === 'story' ? '_story' : '') + '.png';
}

/* ---- text fitting (pure; `measure(text, font)` is ctx.measureText's width, or a stand-in) */
/** @typedef {(text: string, font: string) => number} MeasureFn */

/* Greedy word wrap into lines no wider than maxWidth. A word wider than a whole line is broken
   between characters (only fitText's last resort ever gets that far). */
export function wrapWords(measure, text, font, maxWidth) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + ' ' + w : w;
    if (measure(next, font) <= maxWidth) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = '';
    for (const ch of Array.from(w)) {
      if (cur && measure(cur + ch, font) > maxWidth) { lines.push(cur); cur = ch; } else cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/* The two-line split whose longer line is shortest, so a headline breaks evenly
   ("Pacific / Bluefin Tuna", not "Pacific Bluefin / Tuna") and can stay bigger. */
export function balancedSplit(measure, text, font) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length < 2) { const t = words.join(' '); return { lines: [t], width: measure(t, font) }; }
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const width = Math.max(measure(a, font), measure(b, font));
    if (!best || width < best.width) best = { lines: [a, b], width };
  }
  return best;
}

/* `text` cut to fit maxWidth, ending in an ellipsis (unchanged when it already fits). Cuts after
   a whole word when that still fills most of the line ("trophy…", not "t…"). */
export function ellipsize(measure, text, font, maxWidth) {
  const s = String(text);
  if (measure(s, font) <= maxWidth) return s;
  const chars = Array.from(s);
  const cut = (n) => chars.slice(0, n).join('').trimEnd() + '…';
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(cut(mid), font) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  if (lo < chars.length && chars[lo] !== ' ' && chars[lo - 1] !== ' ') {
    const space = chars.lastIndexOf(' ', lo - 1);
    if (space > 0 && measure(cut(space), font) >= maxWidth * 0.6) return cut(space);
  }
  return cut(lo);
}

/**
 * Fit a headline into maxWidth at the largest size it can take: one line while that keeps it at
 * least `oneLineFloor` of maxSize; else the fewest lines (balanced when two, up to maxLines) that
 * fit at a bigger size than one line could; else one line shrunk to fit. Last resort (one
 * enormous word, a pasted paragraph): minSize, wrapped, broken and ellipsized. The lines never
 * exceed maxWidth and never number more than maxLines.
 * @param {MeasureFn} measure
 * @param {string} text
 * @param {{ maxWidth: number, maxSize: number, minSize: number, maxLines?: number, oneLineFloor?: number, step?: number, font: (px: number) => string }} o
 * @returns {{ size: number, font: string, lines: string[] }}
 */
export function fitText(measure, text, o) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const maxLines = Math.max(1, o.maxLines || 1), step = o.step || 2;
  const floor = o.oneLineFloor == null ? 0.8 : o.oneLineFloor;
  let one = 0;
  for (let s = o.maxSize; s >= o.minSize; s -= step) {
    if (measure(t, o.font(s)) <= o.maxWidth) { one = s; break; }
  }
  if (one && (maxLines === 1 || one >= o.maxSize * floor)) return { size: one, font: o.font(one), lines: [t] };
  for (let k = 2; k <= maxLines; k++) {
    for (let s = o.maxSize; s > one && s >= o.minSize; s -= step) {
      const f = o.font(s);
      if (k === 2) {
        const b = balancedSplit(measure, t, f);
        if (b.lines.length === 2 && b.width <= o.maxWidth) return { size: s, font: f, lines: b.lines };
      } else {
        const wl = wrapWords(measure, t, f, o.maxWidth);
        // joined back unchanged = no word had to be broken
        if (wl.length <= k && wl.join(' ') === t) return { size: s, font: f, lines: wl };
      }
    }
  }
  if (one) return { size: one, font: o.font(one), lines: [t] };
  const f = o.font(o.minSize);
  const lines = wrapWords(measure, t, f, o.maxWidth);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    lines.length = maxLines - 1;
    lines.push(ellipsize(measure, rest, f, o.maxWidth));
  }
  return { size: o.minSize, font: f, lines };
}

/* Chips flow left to right and wrap: rows of chip indexes, each row no wider than maxWidth. */
export function flowRows(widths, maxWidth, gap) {
  const rows = [];
  let row = [], used = 0;
  widths.forEach((w, i) => {
    if (row.length && used + gap + w > maxWidth) { rows.push(row); row = []; used = 0; }
    used += (row.length ? gap : 0) + w;
    row.push(i);
  });
  if (row.length) rows.push(row);
  return rows;
}

/* Source rectangle that cover-fits an iw×ih photo into a dw×dh box: centred across, and at
   `focusY` (0 top … 1 bottom) of whatever height is cropped away. */
export function photoCoverRect(iw, ih, dw, dh, focusY = 0.5) {
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale, sh = dh / scale;
  return { sx: (iw - sw) / 2, sy: Math.min(Math.max(0, (ih - sh) * focusY), ih - sh), sw, sh };
}

/* How bright a photo is under the text, 0…1, from RGBA pixels: the mean pulled toward the
   brightest tenth (a white hull or sun glare under the species is what hurts legibility). */
export function photoLuma(data) {
  const n = Math.floor((data ? data.length : 0) / 4);
  if (!n) return 0.5;
  const ls = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    ls[i] = l; sum += l;
  }
  ls.sort();
  return 0.5 * (sum / n) + 0.5 * ls[Math.min(n - 1, Math.floor(n * 0.9))];
}

/* Opacity of the ink scrim behind the text: white type stays readable on a bright deck or a
   sunlit sea, and a dark photo isn't buried deeper than it needs. */
export function scrimAlpha(luma) {
  const l = Number.isFinite(luma) ? luma : 0.5;
  const t = Math.min(1, Math.max(0, (l - 0.2) / 0.55));
  return +(0.62 + 0.28 * t).toFixed(3);
}

/* ---- drawing */
const TIDE_WAVES = [
  'M2 16c1.6 0 2.4-1.5 4-1.5S8.4 16 10 16s2.4-1.5 4-1.5 2.4 1.5 4 1.5 2.4-1.5 4-1.5',
  'M2 20.5c1.6 0 2.4-1.5 4-1.5s2.4 1.5 4 1.5 2.4-1.5 4-1.5 2.4 1.5 4 1.5 2.4-1.5 4-1.5',
];
/* 24-unit line glyphs, the app's Icon set (Lucide, ISC; tide from ui/Icon.tsx with its arrow
   pointing the way the water is going). */
const CARD_GLYPHS = {
  fish: FISH_PATHS,
  thermo: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z'],
  moon: ['M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401'],
  tideIn: ['M12 3v8', 'M9 6l3-3 3 3', ...TIDE_WAVES],
  tideOut: ['M12 3v8', 'M9 8l3 3 3-3', ...TIDE_WAVES],
  pin: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', 'M15 10a3 3 0 1 1-6 0 3 3 0 1 1 6 0'],
};

function drawGlyph(ctx, name, x, y, size, color, stroke) {
  const paths = CARD_GLYPHS[name];
  if (!paths || typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  paths.forEach((d) => ctx.stroke(new Path2D(d)));
  ctx.restore();
}

const capH = (px) => Math.round(px * 0.7);   // Barlow's cap height: text boxes are laid out on it

function measurer(ctx) {
  return (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
}

/* Tracked caps, a character at a time (canvas letterSpacing isn't in iOS 16 Safari). Only for
   short labels and the date, which always fit. */
function fillTracked(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of Array.from(text)) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
}

/* mulberry32: the no-photo art varies per catch but redraws identically every time. */
function seededRandom(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* An ink scrim easing in from clear at y0 to `alpha` at y1, held to y2. One gradient with eased
   stops: a straight two-stop ramp shows a hard edge across a smooth sky. */
function fillScrim(ctx, rgb, w, y0, y1, y2, alpha) {
  const span = Math.max(1, y2 - y0), knee = Math.min(1, Math.max(0, (y1 - y0) / span));
  const g = ctx.createLinearGradient(0, y0, 0, y2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, e = t * t * (3 - 2 * t);
    g.addColorStop(t * knee, 'rgba(' + rgb + ',' + (alpha * e).toFixed(3) + ')');
  }
  g.addColorStop(1, 'rgba(' + rgb + ',' + alpha + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, w, span);
}

function drawPhotoCover(ctx, img, w, h) {
  const r = photoCoverRect(img.naturalWidth, img.naturalHeight, w, h, CARD_PHOTO_FOCUS);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
  return r;
}

/* Brightness of the drawn photo between card rows y0 and y1 (a 24×12 thumbnail of that band). */
function photoLumaUnder(img, r, cardH, y0, y1) {
  try {
    const cv = makeCanvas(24, 12);
    const x = cv.getContext('2d', { willReadFrequently: true });
    if (!x) return 0.5;
    const f0 = Math.max(0, y0 / cardH), f1 = Math.min(1, y1 / cardH);
    x.drawImage(img, r.sx, r.sy + r.sh * f0, r.sw, Math.max(1, r.sh * (f1 - f0)), 0, 0, 24, 12);
    return photoLuma(x.getImageData(0, 0, 24, 12).data);
  } catch (e) { return 0.5; }
}

/* No photo: an ink chart with depth contours shoaling toward the fish mark. Generic texture,
   not the catch's water — it must not hint at the spot. */
function drawChartArt(ctx, w, h, cx, cy, glyph, rnd) {
  ctx.fillStyle = CARD_COLOR.ink;
  ctx.fillRect(0, 0, w, h);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.1;
  const N = 15, step = reach / N;
  for (let i = N; i >= 1; i--) {
    const r = i * step, t = 1 - i / N;
    ctx.beginPath();
    for (let k = 0; k <= 144; k++) {
      const a = (k / 144) * Math.PI * 2;
      const wob = 1 + 0.10 * Math.sin(2 * a + ph[0] + i * 0.23) + 0.05 * Math.sin(3 * a + ph[1] - i * 0.17) + 0.025 * Math.sin(5 * a + ph[2] + i * 0.4);
      const px = cx + Math.cos(a) * r * wob * 1.18, py = cy + Math.sin(a) * r * wob * 0.86;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = mixHex(CARD_COLOR.ink, CARD_COLOR.shoal, t * t);
    ctx.fill();
    ctx.strokeStyle = 'rgba(196,214,232,' + (0.05 + 0.07 * t).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawGlyph(ctx, 'fish', cx - glyph / 2, cy - glyph / 2, glyph, CARD_COLOR.signal, 1.2);
}

/* [fish] Logged with <brand>          <short url> — the signal glyph, then the url right-aligned
   in whatever room is left (dropped rather than crammed). */
function drawFooter(ctx, measure, brand, x, y, width, px) {
  const glyph = Math.round(px * 1.35), gap = Math.round(px * 0.5);
  const leadF = uiFont(500, px), nameF = uiFont(700, px);
  const lead = brand.lead + ' ';
  const leadW = measure(lead, leadF);
  const name = ellipsize(measure, brand.name, nameF, Math.max(px * 3, width - glyph - gap - leadW));
  const leftW = glyph + gap + leadW + measure(name, nameF);
  const room = width - leftW - px * 1.5;
  const url = room > px * 5 ? ellipsize(measure, brand.url, leadF, room) : '';
  ctx.textAlign = 'left';
  drawGlyph(ctx, 'fish', x, y - capH(px) / 2 - glyph / 2, glyph, CARD_COLOR.signal, 1.9);
  ctx.font = leadF; ctx.fillStyle = CARD_COLOR.text2; ctx.fillText(lead, x + glyph + gap, y);
  ctx.font = nameF; ctx.fillStyle = CARD_COLOR.text1; ctx.fillText(name, x + glyph + gap + leadW, y);
  if (url) {
    ctx.font = leadF; ctx.fillStyle = CARD_COLOR.text2;
    ctx.textAlign = 'right'; ctx.fillText(url, x + width, y); ctx.textAlign = 'left';
  }
}

/* Lay out a top-to-bottom stack of blocks ({h, gap, draw(top)}) so it ends at `bottom`.
   Returns the stack's top. */
function stackTop(blocks, bottom) {
  const total = blocks.reduce((a, b, i) => a + b.h + (i < blocks.length - 1 ? b.gap : 0), 0);
  return bottom - total;
}
function drawStack(blocks, top) {
  let y = top;
  blocks.forEach((b) => { b.draw(y); y += b.h + b.gap; });
}

const TEXT_SHADOW = 'rgba(6,11,17,0.45)';
function withShadow(ctx, on, fn) {
  if (!on) { fn(); return; }
  ctx.save();
  ctx.shadowColor = TEXT_SHADOW; ctx.shadowBlur = 18; ctx.shadowOffsetY = 2;
  fn();
  ctx.restore();
}

/* Post, 1080×1080: the photo full bleed, the details stacked bottom-left on a scrim sized to
   them, the brand line under a hairline. */
function drawPostCard(ctx, m, img, rnd) {
  const { w: W, h: H } = CATCH_CARD_SIZES.post;
  const M = 72, CW = W - 2 * M;
  const measure = measurer(ctx);
  const C = CARD_COLOR;
  const onPhoto = !!img;

  // Sized so a typical catch's details stay in the bottom ~38%: the photo is the point.
  const sp = fitText(measure, m.species, { maxWidth: CW, maxSize: 104, minSize: 58, maxLines: 2, oneLineFloor: 0.68, font: (s) => uiFont(700, s) });
  const spPitch = Math.round(sp.size * 1.04);

  const STAT = 60, statF = instFont(600, STAT), unitF = uiFont(500, 32);
  const statRoom = (CW - 54 * (m.stats.length - 1)) / Math.max(1, m.stats.length);
  const stats = m.stats.map((s) => {
    const unitW = s.unit ? 10 + measure(s.unit, unitF) : 0;
    return { ...s, value: ellipsize(measure, s.value, statF, statRoom - unitW) };
  });

  const CH = { h: 56, pad: 20, icon: 26, gap: 12, px: 28 };
  const chipItems = m.conds.map((c) => ({ icon: c.icon, text: c.chip, font: uiFont(500, CH.px) }));
  if (m.position) chipItems.push({ icon: 'pin', text: m.position, font: instFont(600, CH.px) });
  const chipInner = CH.pad * 2 + CH.icon + 12;
  const chips = chipItems.map((ch) => {
    const text = ellipsize(measure, ch.text, ch.font, CW - chipInner);
    return { ...ch, text, w: chipInner + measure(text, ch.font) };
  });
  const rows = flowRows(chips.map((c) => c.w), CW, CH.gap);

  const blocks = [];
  if (m.when) {
    blocks.push({
      h: capH(26), gap: 22,
      draw: (t) => { ctx.font = uiFont(600, 26); ctx.fillStyle = C.signal; fillTracked(ctx, m.when.toUpperCase(), M, t + capH(26), 2.6); },
    });
  }
  blocks.push({
    h: capH(sp.size) + (sp.lines.length - 1) * spPitch, gap: stats.length ? 30 : 34,
    draw: (t) => withShadow(ctx, onPhoto, () => {
      ctx.font = sp.font; ctx.fillStyle = C.text1;
      sp.lines.forEach((line, i) => ctx.fillText(line, M, t + capH(sp.size) + i * spPitch));
    }),
  });
  if (stats.length) {
    blocks.push({
      h: capH(STAT), gap: 34,
      draw: (t) => withShadow(ctx, onPhoto, () => {
        const base = t + capH(STAT);
        let x = M;
        stats.forEach((s, i) => {
          if (i) { ctx.fillStyle = C.line; ctx.fillRect(x + 26, base - capH(STAT), 2, capH(STAT)); x += 54; }
          ctx.font = statF; ctx.fillStyle = C.text1; ctx.fillText(s.value, x, base); x += measure(s.value, statF);
          if (s.unit) { x += 10; ctx.font = unitF; ctx.fillStyle = C.text2; ctx.fillText(s.unit, x, base); x += measure(s.unit, unitF); }
        });
      }),
    });
  }
  if (rows.length) {
    blocks.push({
      h: rows.length * CH.h + (rows.length - 1) * CH.gap, gap: 0,
      draw: (t) => rows.forEach((row, ri) => {
        const y = t + ri * (CH.h + CH.gap);
        let x = M;
        row.forEach((i) => {
          const ch = chips[i];
          roundRectPath(ctx, x, y, ch.w, CH.h, CH.h / 2);
          ctx.fillStyle = onPhoto ? 'rgba(' + C.deepRgb + ',0.55)' : C.raised; ctx.fill();
          ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
          drawGlyph(ctx, ch.icon, x + CH.pad, y + (CH.h - CH.icon) / 2, CH.icon, C.text2, 2);
          ctx.font = ch.font; ctx.fillStyle = C.text1;
          ctx.fillText(ch.text, x + CH.pad + CH.icon + 12, y + CH.h / 2 + capH(CH.px) / 2);
          x += ch.w + CH.gap;
        });
      }),
    });
  }

  const footY = H - 56, rule = footY - capH(26) - 28, top = stackTop(blocks, rule - 36);
  if (img) {
    const r = drawPhotoCover(ctx, img, W, H);
    fillScrim(ctx, C.deepRgb, W, Math.max(0, top - 260), top - 24, H, scrimAlpha(photoLumaUnder(img, r, H, top - 40, H)));
  } else {
    const glyph = Math.max(120, Math.min(280, top - 200));
    drawChartArt(ctx, W, H, W * 0.5, Math.max(glyph / 2 + 60, (top - 40) / 2), glyph, rnd);
    fillScrim(ctx, C.inkRgb, W, Math.max(0, top - 160), top - 24, H, 0.88);
  }
  drawStack(blocks, top);
  ctx.fillStyle = C.line; ctx.fillRect(M, rule, CW, 2);
  drawFooter(ctx, measure, m.brand, M, footY, CW, 26);
}

/* Story, 1080×1920: the photo (or the chart art) takes the top and fades into ink; the details
   sit below it in labelled columns, and the brand line stays clear of the reply bar. */
function drawStoryCard(ctx, m, img, rnd) {
  const { w: W, h: H } = CATCH_CARD_SIZES.story;
  const M = 80, CW = W - 2 * M;
  const measure = measurer(ctx);
  const C = CARD_COLOR;
  const labelF = uiFont(600, 26), LT = 2.6;

  const sp = fitText(measure, m.species, { maxWidth: CW, maxSize: 132, minSize: 72, maxLines: 3, oneLineFloor: 0.8, font: (s) => uiFont(700, s) });
  const spPitch = Math.round(sp.size * 1.04);

  /* label (caps) over value, in equal columns */
  const column = (x, y, colW, label, icon, drawValue) => {
    let lx = x;
    if (icon) { drawGlyph(ctx, icon, x, y - 4, 30, C.text3, 2); lx += 42; }
    ctx.font = labelF; ctx.fillStyle = C.text3;
    fillTracked(ctx, ellipsize(measure, label.toUpperCase(), labelF, colW - (lx - x)), lx, y + capH(26) + 2, LT);
    drawValue(x, colW);
  };

  const statF = instFont(600, 112), unitF = uiFont(500, 40);
  const statColW = (CW - 48) / 2;
  const condColW = m.conds.length ? (CW - 40 * (m.conds.length - 1)) / m.conds.length : CW;

  const blocks = [];
  if (m.when) {
    blocks.push({
      h: capH(32), gap: 30,
      draw: (t) => { ctx.font = uiFont(600, 32); ctx.fillStyle = C.signal; fillTracked(ctx, m.when.toUpperCase(), M, t + capH(32), 3); },
    });
  }
  blocks.push({
    h: capH(sp.size) + (sp.lines.length - 1) * spPitch, gap: 64,
    draw: (t) => { ctx.font = sp.font; ctx.fillStyle = C.text1; sp.lines.forEach((l, i) => ctx.fillText(l, M, t + capH(sp.size) + i * spPitch)); },
  });
  if (m.stats.length) {
    const h = capH(26) + 30 + capH(112);
    blocks.push({
      h, gap: 64,
      draw: (t) => m.stats.forEach((s, i) => column(M + i * (statColW + 48), t, statColW, s.label, null, (x, colW) => {
        const base = t + h;
        const unitW = s.unit ? 12 + measure(s.unit, unitF) : 0;
        const v = ellipsize(measure, s.value, statF, colW - unitW);
        ctx.font = statF; ctx.fillStyle = C.text1; ctx.fillText(v, x, base);
        if (s.unit) { ctx.font = unitF; ctx.fillStyle = C.text2; ctx.fillText(s.unit, x + measure(v, statF) + 12, base); }
      })),
    });
  }
  if (m.conds.length) {
    const h = capH(26) + 32 + capH(46);
    blocks.push({
      h, gap: m.position ? 56 : 0,
      draw: (t) => m.conds.forEach((c, i) => column(M + i * (condColW + 40), t, condColW, c.label, c.icon, (x, colW) => {
        const v = fitText(measure, c.value, { maxWidth: colW, maxSize: 46, minSize: 32, font: (s) => uiFont(600, s) });
        ctx.font = v.font; ctx.fillStyle = C.text1; ctx.fillText(v.lines[0], x, t + h);
      })),
    });
  }
  if (m.position) {
    const h = capH(26) + 32 + capH(46);
    blocks.push({
      h, gap: 0,
      draw: (t) => column(M, t, CW, 'Position', 'pin', (x, colW) => {
        const v = fitText(measure, m.position, { maxWidth: colW, maxSize: 46, minSize: 30, font: (s) => instFont(600, s) });
        ctx.font = v.font; ctx.fillStyle = C.text1; ctx.fillText(v.lines[0], x, t + h);
      }),
    });
  }

  /* The photo gets every pixel the details don't need, and ends in a short fade just above the
     date: a long fade over a bright photo goes muddy grey, and type on it gets hard to read. */
  const footY = H - STORY_SAFE_BOTTOM, rule = footY - capH(30) - 40, top = stackTop(blocks, rule - 64);
  const artBottom = Math.max(640, top - 64);
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, artBottom); ctx.clip();
  if (img) drawPhotoCover(ctx, img, W, artBottom);
  else {
    const glyph = Math.max(180, Math.min(340, artBottom * 0.32));
    drawChartArt(ctx, W, artBottom, W * 0.5, artBottom * 0.52, glyph, rnd);
  }
  ctx.restore();
  fillScrim(ctx, C.inkRgb, W, artBottom - 170, artBottom, artBottom, 1);
  drawStack(blocks, top);
  ctx.fillStyle = C.line; ctx.fillRect(M, rule, CW, 2);
  drawFooter(ctx, measure, m.brand, M, footY, CW, 30);
}

function loadCardPhoto(src) {
  return new Promise((resolve) => {
    const img = new Image();
    let timer;
    /* naturalWidth/Height are already turned upright: browsers apply a photo's EXIF orientation
       to images (and to drawImage) by default, so a portrait shot stays portrait. */
    const done = (ok) => { clearTimeout(timer); resolve(ok && img.naturalWidth && img.naturalHeight ? img : null); };
    timer = setTimeout(() => done(false), CARD_PHOTO_WAIT_MS);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}

/* Wait (briefly) for every Barlow face the card uses; a canvas never waits for a web font. */
async function cardFontsReady() {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts || typeof fonts.load !== 'function') return;
  let timer;
  try {
    await Promise.race([
      Promise.all(CARD_FONT_FACES.map((f) => fonts.load(f))),
      new Promise((r) => { timer = setTimeout(r, CARD_FONT_WAIT_MS); }),
    ]);
  } catch (e) { /* drawn with what loaded */ } finally { clearTimeout(timer); }
}

/**
 * Draw the share card as a PNG. Resolves null when this device can't (no canvas, no blob).
 * @param {any} c   a CatchView
 * @param {CatchCardOptions} [opts]
 * @returns {Promise<Blob|null>}
 */
export async function renderCatchCard(c, opts) {
  try {
    const m = catchCardModel(c, opts);
    const size = CATCH_CARD_SIZES[m.format];
    const photo = c && isSafePhotoUrl(c.photo) ? c.photo : null;
    const [img] = await Promise.all([photo ? loadCardPhoto(photo) : null, cardFontsReady()]);
    const cv = makeCanvas(size.w, size.h);
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const seed = (Math.floor((Number(c && c.ts) || 0) / 1000) ^ Math.imul(Number(c && c.id) || 0, 2654435761)) >>> 0;
    (m.format === 'story' ? drawStoryCard : drawPostCard)(ctx, m, img, seededRandom(seed));
    return await new Promise((res) => cv.toBlob((b) => res(b || null), 'image/png'));
  } catch (e) {
    return null;
  }
}

/**
 * Make the share card and hand it on: the share sheet in the iOS app (and iPhone Safari), a
 * download elsewhere. Resolves to what happened ('failed' after its own toast).
 * @param {any} c   a CatchView
 * @param {CatchCardOptions} [opts]
 * @returns {Promise<'shared'|'downloaded'|'cancelled'|'failed'>}
 */
export async function makeCatchCard(c, opts) {
  const o = opts || {};
  try {
    const blob = o.rendered || await renderCatchCard(c, o);
    if (!blob) { toast('Could not make card'); return 'failed'; }
    const how = await saveOrShareFile({ name: cardFileName(c && c.species, o.format), mime: 'image/png', data: blob, title: 'My catch' });
    if (how === 'downloaded') toast('Catch card saved');
    return how;
  } catch (e) {
    toast('Could not make card');
    return 'failed';
  }
}
