/* Shared helpers for the navigation characterisation tests. The test files mock the heavy
 * neighbours (services/ui, services/native, app.js, spots.js, weather.js, db.js) with vi.mock
 * BEFORE this module's imports are evaluated (vi.mock is hoisted). */
import L from 'leaflet';
import { Nav, anchorRaise, tripReset, routeClear } from '../../../src/engine/nav.js';
import { GPS } from '../../../src/engine/gps.js';
import { Goto, gotoStore, tripsStore } from '../../../src/engine/goto.js';
import { Tracks, tracksStore } from '../../../src/engine/tracks.js';
import { Awake, awakeSyncBackgroundLocation } from '../../../src/engine/awake.js';

/* jsdom has no media playback. The keep-alive loop needs play() to resolve, and the engine
 * now checks `paused` (a loop iOS paused or refused is not keeping anything alive), so emulate
 * it: play() un-pauses, pause() pauses. `mediaPlayRejects(true)` makes play() fail like iOS
 * does outside a user gesture. */
let _playRejects = false;
export function mediaPlayRejects(on) { _playRejects = !!on; }
if (typeof window !== 'undefined' && window.HTMLMediaElement) {
  const proto = window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return !this.__fakePlaying; } });
  proto.play = function play() {
    if (_playRejects) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
    this.__fakePlaying = true;
    return Promise.resolve();
  };
  proto.pause = function pause() { this.__fakePlaying = false; };
}

/** Metres per degree of latitude on Leaflet's sphere (R = 6371 km). */
export const M_PER_DEG = 6371000 * Math.PI / 180;

/** A point `north` / `east` metres from `base`. */
export function llAt(base, north, east = 0) {
  return L.latLng(
    base.lat + north / M_PER_DEG,
    base.lng + east / (M_PER_DEG * Math.cos(base.lat * Math.PI / 180)),
  );
}

export const BASE = L.latLng(33.75, -118.4);

/** A fresh, tight GPS fix at `ll`. */
export function setFix(ll, accuracy = 5) {
  GPS.lastLatLng = ll;
  GPS.lastFixTs = Date.now();
  GPS.accuracy = accuracy;
  GPS.coarse = accuracy > 100;
  GPS.last = { coords: { latitude: ll.lat, longitude: ll.lng, heading: null, speed: null, accuracy } };
}

/** Put every engine module of the group back to a clean state between tests. */
export function resetAll() {
  try { localStorage.clear(); } catch (e) { /* ignore */ }
  Nav.mode = null;
  if (!Nav.route.layerGroup) Nav.route.layerGroup = L.layerGroup();
  if (!Nav.route.legLayer) Nav.route.legLayer = L.layerGroup();
  if (!Nav.measure.layer) Nav.measure.layer = L.layerGroup();
  routeClear();
  Nav.anchor.field = '150';
  Nav.anchor.radiusFt = 150;
  anchorRaise();
  tripReset();
  Object.assign(Goto, {
    active: false, dest: null, destName: '', startTs: 0, startLL: null, planNm: 0, track: [], maxKn: 0,
    route: null, legIdx: 0, saved: {}, unsaved: [], shown: {}, _lastPt: null, _lastTs: 0, _arrived: false, _arrivedNm: 0, _ending: false,
  });
  gotoStore.setState({ active: false, arriving: false, ending: false });
  tripsStore.setState({ status: 'idle', error: '', items: [], shown: {} });
  Object.assign(Tracks, { recording: false, points: [], startedAt: null, line: null, shown: {}, saved: {}, unsaved: [], _lastPt: null, _lastTs: 0 });
  tracksStore.setState({ recording: false, startedAt: 0, points: 0, saved: [], status: 'idle', error: '', shown: {} });
  Awake.reasons.clear();
  Awake.enabled = true;
  Awake.audio = null;
  _playRejects = false;
  Nav.anchor.audio = null;
  Object.assign(GPS, { last: null, lastLatLng: null, lastFixTs: 0, heading: null, accuracy: null, coarse: false });
  awakeSyncBackgroundLocation();
}
