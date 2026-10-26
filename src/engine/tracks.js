import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { idb } from './db.js';
import { mapProgrammatic, setFollow } from './gps.js';
import { awakeAcquire, awakeRelease } from './awake.js';
import { Goto, gotoApplyUpdateIfSafe, navUnderWay } from './goto.js';
import { getMap } from './app.js';
import { closeCard, closePanels, confirmDialog, openCard, toast, uiStore, updateCard } from '../services/ui';
import { saveOrShareFile } from '../services/native';

/* Track recording: breadcrumb trail of where you've driven the boat.

   Port note: the More-sheet tile's .recording class and the #tracks-list markup are
   published through `tracksStore` (recording state + the saved list) instead. */
'use strict';

export const Tracks = {
  recording: false,
  points: [],          // [lat, lng] pairs of the active recording
  startedAt: null,
  line: null,          // live polyline
  shown: {},           // id -> polyline of saved tracks currently on the map
  saved: {},           // id -> saved track record (last load)
  unsaved: [],         // tracks whose IndexedDB write failed — kept in memory, retryable
  _lastPt: null,
  _lastTs: 0,
  _loadSeq: 0,
  _unsavedSeq: 0,
};

/**
 * @typedef {Object} TrackItem
 * @property {number|string} id
 * @property {string} name
 * @property {number} nm
 * @property {number} start
 * @property {number} end
 * @property {number} points
 * @property {boolean} unsaved     the write failed; only in memory until it is retried or saved as a file
 * @property {string} error
 * @typedef {Object} TracksView
 * @property {boolean} recording
 * @property {number} startedAt    0 when not recording
 * @property {number} points       points recorded so far
 * @property {TrackItem[]} saved   newest first (unsaved ones on top)
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {string} error
 * @property {Record<string, boolean>} shown
 */
/** @type {import('zustand/vanilla').StoreApi<TracksView>} */
export const tracksStore = createStore(() => /** @type {TracksView} */ ({
  recording: false, startedAt: 0, points: 0, saved: [], status: 'idle', error: '', shown: {},
}));

/* Boot hook: load the saved tracks into tracksStore. */
export function tracksInit() { return renderTracksList(); }

export function trackToggle() {
  if (Tracks.recording) trackStop(); else trackStart();
}

export function trackStart() {
  Tracks.recording = true;
  Tracks.points = [];
  Tracks.startedAt = Date.now();
  Tracks._lastPt = null;
  const map = getMap();
  Tracks.line = map ? L.polyline([], { className: 'nav-track-line nav-track-line--live', weight: 2.5, lineCap: 'round', dashArray: '1 6', interactive: false }).addTo(map) : null;
  tracksStore.setState({ recording: true, startedAt: Tracks.startedAt, points: 0 });
  // this tap is a gesture — start the keep-alive so a backgrounded app keeps recording
  if (typeof awakeAcquire === 'function') awakeAcquire('track');
  toast('Recording track — tap the record button again to stop');
}

export async function trackStop() {
  Tracks.recording = false;
  tracksStore.setState({ recording: false, startedAt: 0 });
  if (typeof awakeRelease === 'function') awakeRelease('track');
  const map = getMap();
  if (Tracks.line) { if (map) map.removeLayer(Tracks.line); Tracks.line = null; }

  if (Tracks.points.length < 2) {
    toast('Track too short — not saved');
    tracksStore.setState({ points: 0 });
    // (never while a track OR a voyage that failed to save exists only in memory — goto.js)
    gotoApplyUpdateIfSafe();
    return;
  }
  const track = {
    name: 'Track ' + new Date(Tracks.startedAt).toLocaleString(),
    points: Tracks.points,
    start: Tracks.startedAt,
    end: Date.now(),
    nm: trackDistanceNm(Tracks.points),
  };
  try {
    await idb.put('tracks', track);
    renderTracksList();
    toast('Track saved (' + track.nm.toFixed(2) + ' nm)');
  } catch (e) {
    /* The write used to fail silently (quota, private mode, storage gone) with the
       recording state already cleared — the track was just gone. Say so, and keep it in
       memory where it can be retried or saved as a file. */
    trackKeepUnsaved(track, e);
  }
  // recording is over — a deferred app update can safely apply now (but never while a
  // track — or a voyage — that failed to save exists only in memory: the reload would lose it)
  gotoApplyUpdateIfSafe();
}

/* Called from gps.js on every fix */
export const TRACK_MIN_MOVE_M = 10;
export function trackOnFix(ll, ts, kn) {
  if (!Tracks.recording) return;
  /* gps.js calls this BEFORE the anchor evaluation, outside any try. A throw in here
     (a bad timestamp, a layer that went away) must never cost the anchor its drift
     check on this fix — so nothing escapes. */
  try {
    // record a point at most every 5s or if moved >10 m
    if (Tracks._lastPt) {
      const moved = ll.distanceTo(Tracks._lastPt);
      /* The 5 s keepalive used to override the distance filter outright, so a boat
         sitting still logged a point every 5 s of pure GPS noise — an 8-hour anchored
         "track" accumulated a dozen nautical miles it never travelled. Keep the
         keepalive, but only for a boat that's actually under way. */
      const stationary = (kn != null && isFinite(kn)) ? kn < 0.5 : moved < 3;
      if (moved < TRACK_MIN_MOVE_M && (stationary || ts - Tracks._lastTs < 5000)) return;
    }
    Tracks.points.push([ll.lat, ll.lng]);
    Tracks._lastPt = ll;
    Tracks._lastTs = ts;
    tracksStore.setState({ points: Tracks.points.length });
    if (Tracks.line) Tracks.line.addLatLng(ll);
  } catch (e) {
    try { console.error('[tracks] trackOnFix', e); } catch (e2) {}
  }
}

export function trackDistanceNm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = L.latLng(points[i - 1]).distanceTo(L.latLng(points[i]));
    /* Segments below the recorder's own movement threshold are jitter, not travel.
       Summing them turned noise into distance on every saved track and voyage. */
    if (seg >= TRACK_MIN_MOVE_M) m += seg;
  }
  return m / 1852;
}

function errMsg(e) { return (e && e.message) || String(e || 'unknown error'); }

function trackKeepUnsaved(track, e) {
  const id = 'unsaved-' + (++Tracks._unsavedSeq);
  Tracks.unsaved.unshift({ ...track, id: id, _error: errMsg(e) });
  publishTracks();
  toast('Track NOT saved — storage error (' + errMsg(e) + '). It is kept until the app closes: retry or save it as a file from Spots & tracks.',
    { action: { label: 'Retry', run: () => { trackRetrySave(id); } }, ms: 9000 });
}

/** True while a track exists only in memory (its storage write failed). */
export function tracksHaveUnsaved() { return Tracks.unsaved.length > 0; }

/** Retry the storage write of a track that failed to save. Resolves true when saved. */
export async function trackRetrySave(id) {
  const rec = Tracks.unsaved.find((t) => t.id === id);
  if (!rec) return false;
  const copy = { ...rec };
  delete copy.id; delete copy._error;
  let key;
  try {
    key = await idb.put('tracks', copy);
  } catch (e) {
    rec._error = errMsg(e);
    publishTracks();
    toast('Still could not save the track — ' + errMsg(e));
    return false;
  }
  /* The saved copy has a new IndexedDB key. Anything still pointing at 'unsaved-N' — the line
     on the chart, the open history card — is moved over to it once the list has reloaded;
     the card used to say "This track is no longer saved" right after a successful save. */
  const wasShown = !!Tracks.shown[id];
  hideTrackLayer(id);
  Tracks.unsaved = Tracks.unsaved.filter((t) => t.id !== id);
  // the record is in storage now under `key`; list it there straight away (the reload below confirms it)
  const saved = (key != null) ? { ...copy, id: key } : null;
  if (saved) Tracks.saved[key] = saved;
  if (saved && wasShown) drawTrackLayer(saved);
  const c = uiStore.getState().card;
  if (c && c.kind === 'history' && c.data && c.data.type === 'track' && c.data.id === id) {
    if (saved) updateCard(c.id, { id: saved.id }); else closeCard('history');
  }
  publishTracks();
  toast('Track saved (' + (Number(rec.nm) || 0).toFixed(2) + ' nm)');
  await renderTracksList();
  if (!Tracks.recording) gotoApplyUpdateIfSafe();
  return true;
}

/** Hand an unsaved track to the share sheet / a download as a FishApp backup file
 *  (Spots & tracks → Import brings it back). */
export async function trackSaveAsFile(id) {
  const rec = Tracks.unsaved.find((t) => t.id === id);
  if (!rec) return;
  const copy = { ...rec };
  delete copy.id; delete copy._error;
  const data = { app: 'FishApp', version: 2, exported: new Date().toISOString(), spots: [], tracks: [copy], catches: [], trips: [] };
  try {
    await saveOrShareFile({ name: 'fishapp-track-' + new Date(rec.start).toISOString().slice(0, 10) + '.json', mime: 'application/json', data: JSON.stringify(data, null, 1), title: rec.name });
  } catch (e) { toast('Could not save the file — ' + errMsg(e)); }
}

function trackSummary(t, unsaved) {
  return {
    id: t.id, name: t.name || 'Track', nm: Number(t.nm) || 0,
    start: t.start || 0, end: t.end || t.start || 0,
    points: Array.isArray(t.points) ? t.points.length : 0,
    unsaved: !!unsaved, error: unsaved ? (t._error || '') : '',
  };
}
function publishTracks(patch) {
  const saved = Object.keys(Tracks.saved).map((k) => Tracks.saved[k]).sort((a, b) => b.start - a.start);
  /** @type {Record<string, boolean>} */
  const shown = {};
  Object.keys(Tracks.shown).forEach((k) => { shown[k] = true; });
  tracksStore.setState({
    saved: [...Tracks.unsaved.map((t) => trackSummary(t, true)), ...saved.map((t) => trackSummary(t, false))],
    shown: shown,
    ...(patch || {}),
  });
}
export function trackFind(id) {
  return Tracks.saved[id] || Tracks.unsaved.find((t) => t.id === id) || null;
}

/* Load the saved tracks into tracksStore (was: render #tracks-list). Kept under its old
   name — the backup import calls it after adding records. */
export async function renderTracksList() {
  const seq = ++Tracks._loadSeq;
  if (tracksStore.getState().status !== 'ready') tracksStore.setState({ status: 'loading', error: '' });
  try {
    const all = await idb.getAll('tracks');
    if (seq !== Tracks._loadSeq) return;
    Tracks.saved = {};
    (all || []).forEach((t) => { Tracks.saved[t.id] = t; });
    publishTracks({ status: 'ready', error: '' });
  } catch (e) {
    if (seq !== Tracks._loadSeq) return;
    publishTracks({ status: 'error', error: errMsg(e) });
  }
}
export const loadTracks = renderTracksList;

function hideTrackLayer(id) {
  const map = getMap();
  if (Tracks.shown[id]) { if (map) map.removeLayer(Tracks.shown[id]); delete Tracks.shown[id]; }
}

/* Draw a saved track's line (no map moves). Returns it. */
function drawTrackLayer(rec) {
  const map = getMap();
  if (!map || !rec || !rec.points || !rec.points.length) return null;
  Tracks.shown[rec.id] = L.polyline(rec.points, { className: 'nav-track-line', weight: 2.5, lineCap: 'round', dashArray: '1 6', interactive: false }).addTo(map);
  return Tracks.shown[rec.id];
}

/* Show / hide a saved track on the chart (accepts the record or its id). Showing it
   closes the sheet, fits the map to it and opens its history card. Follow is turned
   off: with it on, the next fix snapped the chart straight back to the boat.
   Under way (a Go-To or a recording — goto.js navUnderWay) Follow stays on, and during a
   Go-To no card opens over the Go-To card. */
export function toggleTrackShown(t) {
  const rec = (t && typeof t === 'object') ? (trackFind(t.id) || t) : trackFind(t);
  if (!rec) return;
  const map = getMap();
  if (Tracks.shown[rec.id]) {
    hideTrackLayer(rec.id);
    const c = uiStore.getState().card;
    if (c && c.kind === 'history' && c.data && c.data.type === 'track' && c.data.id === rec.id) closeCard('history');
  } else if (map && rec.points && rec.points.length) {
    const line = drawTrackLayer(rec);
    closePanels();
    if (!navUnderWay()) setFollow(false);
    try { if (line) mapProgrammatic(() => map.fitBounds(line.getBounds(), { padding: [40, 40] })); } catch (e) {}
    if (Goto.active) toast('Track shown on the chart — Follow stays on while you navigate');
    else openCard('history', { type: 'track', id: rec.id });
  }
  publishTracks();
}

/** Delete a saved (or unsaved) track after an in-app confirm. Resolves true if deleted. */
export async function deleteTrack(id) {
  const ok = await confirmDialog({ title: 'Delete this track?', confirmLabel: 'Delete', destructive: true });
  if (!ok) return false;
  if (!trackFind(id)) return false;                 // already gone while the question was up
  hideTrackLayer(id);
  const c = uiStore.getState().card;
  if (c && c.kind === 'history' && c.data && c.data.type === 'track' && c.data.id === id) closeCard('history');
  if (Tracks.unsaved.some((t) => t.id === id)) {
    Tracks.unsaved = Tracks.unsaved.filter((t) => t.id !== id);
    publishTracks();
    return true;
  }
  try {
    await idb.del('tracks', id);
  } catch (e) {
    toast('Could not delete the track — ' + errMsg(e));
    return false;
  }
  await renderTracksList();
  return true;
}
