import L from 'leaflet';
import { createStore } from 'zustand/vanilla';
import { idb } from './db.js';
import { GPS, bearingBetween, formatCoord, gpsIsStale, mapProgrammatic, nmBetween, setFollow } from './gps.js';
import { Spots, addSpotMarker, deleteSpot, spotsChanged } from './spots.js';
import { compass } from './weather.js';
import { Reefs } from './reefs.js';
import { SST } from './sst.js';
import { Astro } from './astro.js';
import { nearestTideStation } from './tides.js';
import { coopsHiLoUrl } from './datasources.js';
import { Catch } from './catch.js';
import { Nav, getRouteGph, getRouteSpeedKn, tripReset, tripToggle } from './nav.js';
import { KNOTS } from './knots.js';
import { FISH_ID } from './fish-id.js';
import { AREA_TIPS, FISH_TIPS, MPA_TIP_NOTE, TECHNIQUE_TIPS, areaTipText, areaTipsFor, fishTipsFor, techniqueTipsFor } from './fish-tips.js';
import { areaDailyForecast, areaDepthAt, areaFcstIndex, areaPackFor, areaPackSummary, areaSstStats, areaTidesNext } from './areadata.js';
import { biteFmtWindow, biteReason, biteWindows } from './bite.js';
import { Voice } from './voice.js';
import { layersStore, setDataOverlay } from './layers.js';
import { getMap } from './app.js';
import { confirmDialog, isPanelOpen, toast, uiStore } from '../services/ui';

/* First Mate — in-app fishing & boating assistant.
   Hybrid: OFFLINE it answers deterministically from the app's own live data
   (position, solunar/sun/moon via astro.js, cached weather, catches, spots,
   reefs, regs, knots). ONLINE with an API key it becomes a full conversational
   AI (Claude) that is handed the same live snapshot as grounding.

   React port: the engine never touches the DOM. The transcript, status line, voice picker
   and settings live in `asstStore` (below) so they survive the panel closing — voice.js
   sends questions with the panel closed and expects the answer spoken. The panel
   (features/assistant/AssistantPanel.tsx) renders the store and calls these functions. */
'use strict';

/* ---------------- models ---------------- */
/* The picker. The legacy list (Opus 4.8 / Sonnet 5 / Haiku 4.5) went stale; these are the
   current ids. A saved legacy id is migrated to the closest current one (asstMigrateModel),
   so a user who picked "Haiku" keeps a Haiku. */
export const ASST_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', short: 'Opus 5.5', detail: 'smartest' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', short: 'Sonnet 5.5', detail: 'faster' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', short: 'Haiku 5.5', detail: 'fastest / cheapest' },
];
export const ASST_DEFAULT_MODEL = 'claude-opus-5-5';
export function asstMigrateModel(id) {
  const m = String(id || '').trim().toLowerCase();
  if (!m) return ASST_DEFAULT_MODEL;
  if (ASST_MODELS.some((x) => x.id === m)) return m;
  if (/sonnet/.test(m)) return 'claude-sonnet-5-5';
  if (/haiku/.test(m)) return 'claude-haiku-5-5';
  return ASST_DEFAULT_MODEL;     // opus / fable / anything unknown → the default (Opus)
}

export const ASST = {
  history: [],          // {role:'user'|'assistant', content:'…'}
  lastLoc: null,        // {lat,lng,label} of the last place the user asked about (for follow-ups)
  streaming: false,
  speak: false,         // read answers aloud (persisted fishapp.asst.speak; voice.js overrides per reply)
  key() { return (localStorage.getItem('fishapp.asst.key') || '').trim(); },
  model() { return asstMigrateModel(localStorage.getItem('fishapp.asst.model')); },
};

/* ---------------- view store (what the First Mate sheet renders) ---------------- */
/**
 * @typedef {Object} AsstMsg
 * @property {number} id
 * @property {'user'|'bot'} role
 * @property {string} text          plain text — render with white-space:pre-wrap and **bold** only, never as HTML
 * @property {boolean} [thinking]   a reply is in flight
 * @property {string} [progress]    what the in-flight reply is doing, e.g. 'checking conditions'
 * @property {boolean} [error]      the AI couldn't answer; the text carries the offline answer
 * @property {boolean} [greeting]
 */
/**
 * @typedef {Object} AsstVoiceOpt
 * @property {string} name
 * @property {boolean} natural
 */
/**
 * @typedef {Object} AsstView
 * @property {AsstMsg[]} messages
 * @property {boolean} busy                 a reply is in flight (sends are dropped meanwhile)
 * @property {boolean} speak                Speak toggle (the user's persistent choice)
 * @property {'claude'|'proxy'|'offline'|'data'} brain
 * @property {string} statusText
 * @property {boolean} showChips
 * @property {boolean} micSupported         one-shot SpeechRecognition exists
 * @property {boolean} micListening
 * @property {boolean} ttsSupported         device speechSynthesis exists
 * @property {AsstVoiceOpt[]} voices        English device voices, best first
 * @property {string} voiceName             the device voice in use ('' = none)
 * @property {'none'|'natural'|'pick-natural'|'ios'|'no-natural'} voiceHint
 * @property {boolean} online
 * @property {boolean} hasKey
 * @property {string} model
 * @property {string} modelLabel
 * @property {'yes'|'no'|null} consent      cloud-AI consent (App Store 5.1.2(i)); null = not asked yet
 * @property {boolean} cloudVoice           natural cloud voice setting
 * @property {string} proxyUrl              effective free-AI endpoint
 * @property {boolean} proxyIsDefault       true when no per-device override is set
 */
/** @type {import('zustand/vanilla').StoreApi<AsstView>} */
export const asstStore = createStore(() => /** @type {AsstView} */ ({
  messages: [],
  busy: false,
  speak: false,
  brain: 'offline',
  statusText: '',
  showChips: false,
  micSupported: false,
  micListening: false,
  ttsSupported: false,
  voices: [],
  voiceName: '',
  voiceHint: 'none',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  hasKey: false,
  model: ASST_DEFAULT_MODEL,
  modelLabel: 'Opus 5.5',
  consent: null,
  cloudVoice: false,
  proxyUrl: '',
  proxyIsDefault: true,
}));

/* ---------------- small helpers ---------------- */
/* `live` = the position came from a GPS fix (not the map center). `stale` = that fix is older
   than GPS_STALE_MS (gps.js), so it is the LAST KNOWN position, not where the boat is now —
   answers must say so (DESIGN.md: never show a stale value as live), like voice.js does. */
export function asstPos() {
  if (typeof GPS !== 'undefined' && GPS.lastLatLng) return { ll: GPS.lastLatLng, live: true, stale: asstFixStale() };
  const map = getMap();
  if (map) return { ll: map.getCenter(), live: false, stale: false };
  return { ll: null, live: false, stale: false };
}
export function asstFixStale() {
  try { return typeof gpsIsStale === 'function' && !!gpsIsStale(); } catch (e) { return false; }
}
/** Minutes since the last accepted GPS fix (at least 1), or null if there never was one. */
export function asstFixAgeMin() {
  const ts = (typeof GPS !== 'undefined' && GPS.lastFixTs) || 0;
  return ts ? Math.max(1, Math.round((Date.now() - ts) / 60000)) : null;
}
/** "12 min old" / "age unknown" — for labelling a stale fix. */
export function asstFixAgeText() {
  const m = asstFixAgeMin();
  return m == null ? 'age unknown' : m + ' min old';
}
export function asstSpeedKn() {
  if (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.speed != null)
    return GPS.last.coords.speed * 1.94384;
  return null;
}
export function asstHeading() {
  if (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.heading != null && !isNaN(GPS.last.coords.heading))
    return GPS.last.coords.heading;
  return null;
}
export function asstTime(d) { return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'; }
export function asstCompass(deg) {
  if (deg == null) return '';
  if (typeof compass === 'function') return compass(deg);
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg / 22.5) % 16];
}
/* The cached weather (written by weather.js) is only usable if it was saved for essentially
   THIS place and recently. It used to be read raw, so offline weather, the go/no-go read and
   the AI snapshot could quote another harbour's wind under "Wind now". Same rule as
   weather.js wxCacheFor: within 0.25° (~25 km), and no older than 12 h. */
export const ASST_WX_MAX_DEG = 0.25;
export const ASST_WX_MAX_AGE_MS = 12 * 3600000;
export function asstWxUsable(c, ll, now) {
  if (!c || !ll || c.lat == null || c.lng == null) return false;
  if (Math.abs(c.lat - ll.lat) > ASST_WX_MAX_DEG || Math.abs(c.lng - ll.lng) > ASST_WX_MAX_DEG) return false;
  if (!c.ts || ((now == null ? Date.now() : now) - c.ts) > ASST_WX_MAX_AGE_MS) return false;
  return true;
}
export function asstCachedWx(ll) {
  let c;
  try { c = JSON.parse(localStorage.getItem('fishapp.lastwx') || 'null'); } catch (e) { return null; }
  const here = ll === undefined ? asstPos().ll : ll;
  return asstWxUsable(c, here) ? c : null;
}
export function asstAgo(ts) {
  const m = (Date.now() - ts) / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + ' min ago';
  const h = m / 60;
  if (h < 24) return Math.round(h) + ' h ago';
  return Math.round(h / 24) + ' d ago';
}
/* Rough natural-time parser: "tomorrow afternoon", "tonight", "this morning". */
export function asstParseWhen(t) {
  const d = new Date(); let label = 'Now';
  const at = (h) => d.setHours(h, 0, 0, 0);
  if (/tomorrow/.test(t)) {
    d.setDate(d.getDate() + 1); at(12); label = 'Tomorrow';
    if (/morning/.test(t)) { at(8); label = 'Tomorrow morning'; }
    else if (/afternoon/.test(t)) { at(14); label = 'Tomorrow afternoon'; }
    else if (/evening|night/.test(t)) { at(19); label = 'Tomorrow evening'; }
  } else if (/tonight/.test(t)) { at(20); label = 'Tonight'; }
  else if (/this afternoon/.test(t)) { at(14); label = 'This afternoon'; }
  else if (/this morning/.test(t)) { at(8); label = 'This morning'; }
  else if (/this evening/.test(t)) { at(19); label = 'This evening'; }
  if (label === 'Now') {
    const wds = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < 7; i++) {
      if (t.indexOf(wds[i]) < 0) continue;
      let add = (i - d.getDay() + 7) % 7; if (add === 0) add = 7;   // next occurrence, not today
      d.setDate(d.getDate() + add); at(12);
      label = wds[i].charAt(0).toUpperCase() + wds[i].slice(1);
      if (/morning/.test(t)) { at(8); label += ' morning'; }
      else if (/afternoon/.test(t)) { at(14); label += ' afternoon'; }
      else if (/evening|night/.test(t)) { at(19); label += ' evening'; }
      break;
    }
  }
  return { ms: d.getTime(), label };
}
export function asstAreaPack() {
  const ll = asstPos().ll;
  return (ll && typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
}
export function asstNearestReefs(ll, n) {
  if (typeof Reefs === 'undefined' || !Reefs.reefs || !Reefs.reefs.length || typeof L === 'undefined') return [];
  const here = L.latLng(ll.lat, ll.lng);
  return Reefs.reefs
    .map((r) => ({ r, nm: nmBetween(here, L.latLng(r.la, r.lo)), brg: bearingBetween(here, L.latLng(r.la, r.lo)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, n);
}
export function asstNearestSpots(ll, n) {
  if (typeof Spots === 'undefined' || !Spots.all || !Spots.all.length || typeof L === 'undefined') return [];
  const here = L.latLng(ll.lat, ll.lng);
  return Spots.all
    .map((s) => ({ s, nm: nmBetween(here, L.latLng(s.lat, s.lng)), brg: bearingBetween(here, L.latLng(s.lat, s.lng)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, n);
}
export function asstAstro(ll) {
  if (typeof Astro === 'undefined' || !ll) return null;
  const now = new Date();
  try {
    const ill = Astro.moonIllumination(now);
    return {
      now,
      sun: Astro.sunTimes(now, ll.lat, ll.lng),
      moonT: Astro.moonTimes(now, ll.lat, ll.lng),
      phaseName: Astro.moonPhaseName(ill.phase),
      lit: Math.round(ill.fraction * 100),
      solunar: Astro.solunar(now, ll.lat, ll.lng) || [],
    };
  } catch (e) { return null; }
}
/* Planner speed / fuel from the Nav tools (nav.js owns them now; they used to be read straight
   out of the #route-speed / #route-gph inputs). NaN when unavailable. */
export function asstRouteSpeedKn() {
  try { return typeof getRouteSpeedKn === 'function' ? parseFloat(getRouteSpeedKn()) : NaN; } catch (e) { return NaN; }
}
export function asstRouteGph() {
  try { return typeof getRouteGph === 'function' ? parseFloat(getRouteGph()) : NaN; } catch (e) { return NaN; }
}

/* ---------------- live-data snapshot (feeds both brains) ---------------- */
export function asstSnapshot() {
  const { ll, live, stale } = asstPos();
  const L1 = [];
  L1.push('=== LIVE BOAT DATA (' + new Date().toLocaleString() + ') ===');
  L1.push('Online: ' + (navigator.onLine ? 'yes' : 'NO — offshore/no signal'));
  if (ll) {
    /* A stale fix used to go out as "(live GPS)", so both AIs quoted an old position — and an
       old speed — as current. */
    L1.push('Position: ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) +
      (!live ? ' (map center — no GPS fix yet)'
        : stale ? ' (LAST KNOWN GPS fix, ' + asstFixAgeText() + ' — the GPS has not updated since; say so if you use it)'
          : ' (live GPS)'));
    if (stale) {
      L1.push('Speed / heading: no current reading (the last GPS fix is too old).');
    } else {
      const sp = asstSpeedKn(), hd = asstHeading();
      if (sp != null) L1.push('Speed over ground: ' + sp.toFixed(1) + ' kn');
      if (hd != null) L1.push('Heading: ' + Math.round(hd) + '° (' + asstCompass(hd) + ')');
    }
  } else {
    L1.push('Position: unknown (no GPS, no map).');
  }

  const a = asstAstro(ll);
  if (a) {
    L1.push('Sun: rise ' + asstTime(a.sun.sunrise) + ', set ' + asstTime(a.sun.sunset));
    L1.push('Moon: ' + a.phaseName + ' (' + a.lit + '% lit)' +
      (a.moonT.rise ? ', rise ' + asstTime(a.moonT.rise) : '') +
      (a.moonT.set ? ', set ' + asstTime(a.moonT.set) : ''));
    if (a.solunar.length) {
      L1.push('Solunar bite periods today: ' + a.solunar
        .map((p) => (p.type === 'major' ? 'MAJOR ' : 'minor ') + asstTime(p.start) + '–' + asstTime(p.end)).join('; '));
    }
  }

  const wx = asstCachedWx(ll);
  if (wx && wx.wx && wx.wx.current) {
    const c = wx.wx.current, age = Math.round((Date.now() - wx.ts) / 60000);
    L1.push('Weather (cached ' + age + ' min ago): wind ' + Math.round(c.wind_speed_10m) + ' kn ' +
      asstCompass(c.wind_direction_10m) + ', gust ' + Math.round(c.wind_gusts_10m) + ' kn, air ' +
      Math.round(c.temperature_2m) + '°F');
    if (wx.marine && wx.marine.current) {
      const m = wx.marine.current;
      L1.push('Seas (cached): ' + (m.wave_height * 3.28084).toFixed(1) + ' ft @ ' +
        Math.round(m.wave_period) + 's from ' + asstCompass(m.wave_direction) +
        (m.swell_wave_height != null ? '; swell ' + (m.swell_wave_height * 3.28084).toFixed(1) + ' ft @ ' +
          Math.round(m.swell_wave_period) + 's from ' + asstCompass(m.swell_wave_direction) : ''));
    }
  } else {
    L1.push('Weather: none cached for this location in the last 12 h (open the Weather panel while online to cache it).');
  }

  const pk = (ll && typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
  if (pk && pk.data) {
    const d = pk.data;
    const parts = [];
    if (d.forecast) parts.push('7-day wind/wave forecast');
    if (d.tides) parts.push('a week of tides');
    if (d.sstGrid) parts.push('water-temp grid');
    if (d.depthGrid) parts.push('depth grid');
    if (d.fish) parts.push(d.fish.total + ' fish records');
    if (d.mpas) parts.push(d.mpas.length + ' closures');
    L1.push('Downloaded area pack "' + pk.name + '" covers this location (captured ' + asstAgo(d.capturedTs) +
      '): ' + parts.join(', ') + '. Call get_area_intel to read it — especially useful offline.');
  }

  if (ll) {
    const reefs = asstNearestReefs(ll, 3);
    if (reefs.length) L1.push('Nearest reefs: ' + reefs
      .map((x) => x.r.n + ' (' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) + (x.r.d ? ', ~' + x.r.d + ' ft' : '') + ')').join('; '));
    const spots = asstNearestSpots(ll, 3);
    if (spots.length) L1.push('Your nearest saved spots: ' + spots
      .map((x) => x.s.name + ' [' + x.s.type + '] (' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) + ')').join('; '));
  }

  if (typeof Catch !== 'undefined' && Catch.all && Catch.all.length) {
    const n = Catch.all.length;
    const bySp = {};
    Catch.all.forEach((c) => { const s = (c.species || 'unknown').trim(); bySp[s] = (bySp[s] || 0) + 1; });
    const top = Object.entries(bySp).sort((a2, b2) => b2[1] - a2[1]).slice(0, 5)
      .map(([s, c]) => s + '×' + c).join(', ');
    const recent = Catch.all.slice().sort((x, y) => y.ts - x.ts).slice(0, 3)
      .map((c) => c.species + (c.length ? ' ' + c.length + '"' : '') + ' on ' + new Date(c.ts).toLocaleDateString() +
        (c.bait ? ' (' + c.bait + ')' : '')).join('; ');
    L1.push('Catch log: ' + n + ' logged. Species: ' + top + '. Recent: ' + recent);
  }

  if (typeof Nav !== 'undefined') {
    if (Nav.trip && Nav.trip.active) {
      const avg = Nav.trip.nKn ? (Nav.trip.sumKn / Nav.trip.nKn) : 0;
      L1.push('Trip running: ' + Nav.trip.dist.toFixed(1) + ' nm, avg ' + avg.toFixed(1) + ' kn, max ' + Nav.trip.maxKn.toFixed(1) + ' kn');
    }
    if (Nav.anchor && Nav.anchor.watching) L1.push('Anchor watch ON, radius ' + Nav.anchor.radiusFt + ' ft');
  }
  return L1.join('\n');
}

/* Compact CA regulations table for the online brain. */
export function asstRegsTable() {
  if (typeof FISH_ID === 'undefined' || !FISH_ID.length) return '';
  return 'CA SALTWATER REGS (general reference — verify with CDFW):\n' +
    FISH_ID.map((f) => '- ' + f.name + ': min size ' + f.size + '; bag ' + f.bag + (f.note ? '; ' + f.note : '')).join('\n');
}
/* Condensed fishing cheat-sheet handed to the AI so it gives specific lure/bait/
   technique advice from the same knowledge the offline engine uses. */
export function asstTipsTable() {
  if (typeof FISH_TIPS === 'undefined') return '';
  const fish = FISH_TIPS.map((f) => '- ' + f.name + ': ' + f.sum).join('\n');
  const areas = (typeof AREA_TIPS !== 'undefined') ? AREA_TIPS.map((a) => '- ' + a.name + ': ' + areaTipText(a)).join('\n') : '';
  const tech = (typeof TECHNIQUE_TIPS !== 'undefined') ? TECHNIQUE_TIPS.map((tp) => '- ' + tp.name + ': ' + tp.text).join('\n') : '';
  return 'FIRST MATE FISHING KNOWLEDGE (Southern & Central California — general reference). Use this to give specific lure/jig/bait/technique advice. Areas marked "Check MPA boundaries" border marine protected areas — always pass that on.\nTARGETS (species → go-to):\n' + fish +
    '\nAREA GAME PLANS:\n' + areas + '\nTECHNIQUES:\n' + tech;
}

/* ================= OFFLINE deterministic engine ================= */
/* A question ABOUT a name ("what's this spot called?", "is there a spot named Rock Pile?")
   is not an instruction to create one. */
export function asstIsQuestion(t) {
  if (/^\s*(?:please\b|(?:can|could|would|will) you\b)/.test(t)) return false;   // a polite request, not a question
  return /^\s*(?:what|what's|whats|which|who|where|when|why|how|is|are|was|were|do|does|did|have|has)\b/.test(t) ||
    /\?\s*$/.test(t);
}
/* An unmistakable distress call. The emergency intent used to sit near the END of the router,
   behind every other intent and with only a few keywords, so "my buddy fell overboard", "we're
   taking on water", "engine fire" or "someone is bleeding badly" got the help menu, and
   "mayday, we're sinking — nearest ramp?" got "You have no saved ramps". Checked FIRST now, and
   narrow on purpose: fishing talk shares these words ("sinking lure", "the bite is on fire",
   "bleed the fish", "flood tide"), so only the distress phrasings match here. The broader
   'help me' / 'emergency' / 'coast guard' words stay at the old place in the router, where the
   specific intents ("help me tie a knot") are tried first. */
export const ASST_DISTRESS_RE = new RegExp([
  '\\bmayday\\b', '\\bpan[- ]?pan\\b', '\\bsos\\b', '\\bdistress\\b',
  '\\b(?:man|person|someone|somebody|crew|kid|child|fell|fallen|falls|falling|went|gone|washed)\\s+(?:\\w+\\s+)?overboard\\b',
  '\\btaking (?:on )?water\\b', '\\bswamp(?:ed|ing)\\b', '\\bcapsiz', '\\b(?:we|boat|it)(?:\'re| are| is|\'s)? (?:rolled|flipped) over\\b',
  '\\b(?:we|i|boat|it|she)(?:\'re| are| am|\'m| is|\'s) sinking\\b', '\\bsinking fast\\b', '\\b(?:boat|we) (?:is|are) going down\\b',
  '\\b(?:ran|run|are|we\'re|went|hit|hard|stuck) aground\\b',
  '\\bengine fire\\b', '\\bfire (?:aboard|on board|onboard|in the (?:engine|cabin|bilge|boat))\\b',
  '\\b(?:boat|engine|motor|cabin|we)(?:\'re| are| is)? on fire\\b',
  '\\bdrowning\\b', '\\bnot breathing\\b', '\\bunconscious\\b', '\\bunresponsive\\b', '\\bheart attack\\b', '\\bchest pain\\b',
  '\\bbleeding (?:badly|heavily|a lot|bad|out)\\b', '\\b(?:won\'?t|can\'?t|cannot) stop (?:the )?bleeding\\b',
  '\\b(?:badly|seriously|really) (?:hurt|injured)\\b', '\\b(?:hurt|injured) (?:badly|bad|seriously)\\b',
].join('|'));
export function asstIsDistress(text) {
  return ASST_DISTRESS_RE.test(String(text || '').toLowerCase().replace(/[’‘]/g, "'"));
}

/* async because the bite-window intent reads cached tide predictions (and may refresh them);
   both call sites in asstSend already await it. */
export async function asstOffline(q) {
  const t = String(q == null ? '' : q).toLowerCase();
  const { ll, live, stale } = asstPos();
  const has = (...w) => w.some((x) => t.includes(x));
  const word = (...w) => w.some((x) => new RegExp('\\b' + x + '\\b').test(t));

  // Distress first — before anything else could answer it (see ASST_DISTRESS_RE).
  if (asstIsDistress(t)) return asstAnsEmergency(ll, live, stale);

  /* Place a waypoint — a LOCAL action, so it works offline too.
     Requires a CREATE phrase. A bare 'waypoint' used to match here first, so
     "how far to my waypoint Rock Pile?" silently wrote a junk pin named
     "Waypoint 7" to the database instead of answering the distance.
     The naming clause ('named'/'called' + 'spot'/'here'/…) also fired on questions —
     "what's this spot called?" dropped a junk "Waypoint N" pin — so it never fires on a
     question now. The passive forms ('named'/'called') also fired on any mention of a named
     spot ("tell me about the spot called Rock Pile"), so they need a create word ('mark',
     'drop', 'new'…) or the pin to be HERE ("spot here called Rock Pile", "waypoint here named
     X") — the imperative phrasings the legacy router accepted still create.
     The explicit create phrases still win either way ("can you drop a pin here and call
     it Rock Pile?"). */
  const passiveName = has('named', 'called') &&
    (word('mark', 'drop', 'save', 'add', 'pin', 'put', 'new') ||
      /\b(?:spot|pin|waypoint|mark|marker)\s+here\b|\bhere\s+(?:called|named)\b/.test(t));
  if (has('drop a pin', 'pin it', 'mark this', 'mark here', 'mark spot', 'marker here',
    'save this spot', 'save this location', 'save my spot', 'drop a mark',
    'drop a waypoint', 'save a waypoint', 'mark a waypoint', 'add a waypoint', 'new waypoint',
    'drop waypoint', 'save waypoint', 'mark waypoint') ||
    ((has('name it', 'call it') || passiveName) &&
      has('here', 'spot', 'pin', 'waypoint', 'mark') && !asstIsQuestion(t)))
    return asstOfflinePlaceWaypoint(q);

  // Position
  if (has('where am i', 'my position', 'coordinate', 'my location', 'lat/long', 'lat long', 'gps'))
    return asstAnsPosition(ll, live, stale);
  /* Speed / heading. "heading" as a verb is far more common here than as a bearing
     ("heading to Catalina — how far?"), and a bare match sent those to the speed
     readout instead of the distance answer. */
  if (has('how fast', 'my speed', 'speed over', ' sog', 'which way', 'my course', 'course over') ||
    /\b(?:my|what|current|our) heading\b|\bheading (?:is|now)\b/.test(t))
    return asstAnsSpeed();
  /* "When should I go" — try the PERSONAL bite engine first: patterns learned from this
     user's own catch log beat generic solunar tables whenever there's enough history.
     asstAnsBite returns null when there isn't, and we fall through to the generic planner
     below, so a new user still gets a useful answer from day one. */
  const wantsWhen = has('best day', 'which day', 'when should i go', 'plan my trip', 'plan a trip',
    'should i go fishing', 'best day to fish', 'best morning', 'coming days to fish', 'when to go fishing',
    'best time to fish', 'best time to go', 'when to go', 'when is the bite', "when's the bite", 'when do i go') ||
    /* Second clause must stay in the FISHING sense. A bare 'when' + a day word made
       "when is high tide tomorrow?" answer with a bite-window planner and never
       reach the tide intent below. */
    ((has('best time') || /\bwhen (?:should|to|do|can)\b/.test(t)) &&
      has('fish', 'go out', 'head out', 'bite') &&
      has('week', 'tomorrow', 'days', 'weekend'));
  if (wantsWhen) {
    const personal = await asstAnsBite(t);
    if (personal) return personal;
  }
  // Multi-day "best day to fish" planner (bite + weather) — generic fallback
  if (wantsWhen) return asstAnsPlan();
  // Bite / solunar (today)
  if (has('bite', 'solunar', 'best time', 'when to fish', 'feeding', 'best window'))
    return asstAnsSolunar(ll);
  // Multi-day weather outlook
  if (has('this week', 'next few days', 'coming days', 'outlook', 'week ahead', 'multi-day',
    'next 3 days', 'next three days', 'weekend forecast', '7 day', '7-day', 'forecast for the week'))
    return asstAnsOutlook();
  // Go / no-go conditions read
  if (has('rough', 'safe to go', 'go out', 'sea state', 'small craft', 'too windy', 'calm enough',
    'how bad', 'fishable', 'should i go out', 'okay to go', 'ok to go', 'nasty out'))
    return asstAnsGoNoGo();
  // Nearest saved spot by type (ramp / anchorage / hazard / wreck)
  if (has('nearest ramp', 'closest ramp', 'nearest launch', 'boat ramp', 'launch ramp', 'nearest dock',
    'nearest anchorage', 'closest anchorage', 'nearest hazard', 'nearest wreck', 'place to anchor')) {
    const near = asstAnsNearest(t); if (near) return near;
  }
  // Lures / jigs / bait / technique / how-to-catch — answered from the fishing
  // knowledge base (fish-tips.js), area-aware, plus the user's catch log.
  if (has('what bait', 'best bait', 'what should i use', 'what lure', 'which lure', 'what to throw',
    'what should i throw', 'should i throw', 'throw for', 'what do they hit', 'how do i catch', 'how to catch',
    'how do i target', 'how to target', 'how do i fish', 'how to fish', 'fish for', 'target ', 'catch a ',
    'catch some', 'what works for', 'tips for', 'technique', 'dropper loop', 'fly line', 'fly-line', 'flyline',
    'yo-yo', 'yoyo', 'surface iron', 'sabiki', 'flat fall', 'flat-fall', 'good lure', 'right lure', 'best lure',
    'best jig', 'what jig', 'lure for', 'jig for', 'bait for', 'iron for', 'setup for', 'rig for')) {
    const bait = asstAnsBait(t); if (bait) return bait;
  }
  // Sun / daylight
  if (has('sunrise', 'sunset', 'daylight', 'dawn', 'dusk', 'first light', 'last light'))
    return asstAnsSun(ll);
  // Moon
  if (has('moon', 'lunar', 'phase'))
    return asstAnsMoon(ll);
  // Tides (now answerable offline from a downloaded area pack)
  if (has('tide', 'high tide', 'low tide', 'slack', 'ebb', 'flood'))
    return asstAnsTides(t);
  // Fish history in this area (from the downloaded pack)
  if (has('what fish', 'been caught', 'caught here', 'biting', 'what bites', 'species here',
    'what lives here', 'what can i catch', 'fish been', 'whats around', "what's around"))
    return asstAnsFishHistory(t);
  // Closures / protected areas  (note: avoid bare 'mpa' — it's a substring of "compare")
  if (has('closure', 'closed to fish', 'protected area', 'marine protected', ' mpa', 'mpas',
    'can i fish here', 'legal to fish here', 'no-take', 'no take', 'reserve')) {
    /* A SPECIES closure ("rockfish depth closures", "is lingcod closed") is a regulation, not
       a protected area — it used to get "No closure data captured offline here", as if there
       were none. The species card carries its closure note and the CDFW warning. */
    const spc = has('protected', ' mpa', 'mpas', 'reserve', 'no-take', 'no take') || word('here') ? null : asstFindSpecies(t);
    if (spc) return asstFormatSpecies(spc);
    return asstAnsClosures();
  }
  /* Waves / seas. 'seas' is a substring of 'season', so a bare match meant
     "what's the season for lingcod?" returned a swell report and the regulations
     intent below was unreachable. Word-boundary it, like the ' mpa' note above. */
  if (has('wave', 'swell', 'surf', 'chop') || word('seas'))
    return asstAnsWaves();
  // Weather / wind
  if (has('weather', 'wind', 'windy', 'gust', 'forecast', 'breeze', 'conditions', 'rain', 'raining',
    'cloudy', 'sunny', 'hot out', 'cold out'))
    return asstAnsWeather(t);
  // Water temp
  if (has('water temp', 'sea temp', 'sst', 'surface temp', 'temperature of the water', 'how warm', 'how cold'))
    return asstAnsWaterTemp();
  // Depth (from the downloaded depth grid)
  if (has('how deep', 'depth here', 'depth at', 'bottom depth', 'water depth', 'fathom', 'how much water', 'deep is it'))
    return asstAnsDepth(t);
  // Compare two saved spots
  if (has('compare', ' vs ', 'versus', 'which is closer', 'which spot', 'better spot')) {
    const cmp = asstAnsCompareSpots(t); if (cmp) return cmp;
  }
  // Distance / bearing / trip time / fuel to a named spot (before knots — "25 knots" ≠ a knot!)
  if (has('distance to', 'how far', 'bearing to', 'how do i get to', 'fuel to', 'how much fuel',
    'how long to', 'time to get to', 'eta to', 'get to', 'and back', 'round trip')) {
    const d = asstAnsDistanceTo(t, ll);
    if (d) return d;
  }
  // Reefs / structure
  if (has('reef', 'structure', 'artificial'))
    return asstAnsReefs(ll);
  // Regulations — species lookup
  if (has('legal', 'limit', 'size', 'bag', 'keep', 'regulation', 'slot', 'season', 'how many can i')) {
    const reg = asstAnsReg(t);
    if (reg) return reg;
  }
  // Knots
  if (has('knot', 'tie', 'rig ', 'loop', 'hitch', 'bend'))
    return asstAnsKnot(t);
  // Catch log
  if (has('catch', 'caught', 'my log', 'have i', 'what have i', 'my fish'))
    return asstAnsCatches();
  // Spots
  if (has('spot', 'marked', 'my spots', 'waypoint', 'nearest spot'))
    return asstAnsSpots(ll);
  // Emergency
  if (has('emergency', 'mayday', 'sos', 'sinking', 'help me', 'man overboard', 'overboard', 'distress', 'pan-pan', 'pan pan',
    'coast guard', 'channel 16', 'call for help'))
    return asstAnsEmergency(ll, live, stale);
  // Bare saved-spot name → distance/bearing
  if (typeof Spots !== 'undefined' && ll && Spots.all.length) {
    const spot = Spots.all.find((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
    if (spot) {
      const here = L.latLng(ll.lat, ll.lng), there = L.latLng(spot.lat, spot.lng);
      const nm = nmBetween(here, there), brg = bearingBetween(here, there);
      return spot.name + ': ' + nm.toFixed(1) + ' nm, bearing ' + Math.round(brg) + '° ' + asstCompass(brg);
    }
  }
  /* A species AND a place with no other words ("calico bass at Catalina" — the example the
     bait answer itself suggests) wants the game plan, not the limits card. */
  if (typeof fishTipsFor === 'function' && typeof areaTipsFor === 'function' && fishTipsFor(t) && areaTipsFor(t)) {
    const plan = asstAnsBait(t); if (plan) return plan;
  }
  // Species reference fallback (e.g. "yellowtail")
  const sp = asstFindSpecies(t);
  if (sp) return asstFormatSpecies(sp);
  const kn = asstFindKnot(t);
  if (kn) return asstFormatKnot(kn);

  return asstAnsHelp();
}

/* Live fix, stale fix and map center read differently. A stale fix used to print as "Your
   position", and the map center was offered as the line to read to the Coast Guard; typed
   here and spoken to Hey Fish (voice.js voiceSayPosition) now agree. */
export function asstAnsPosition(ll, live, stale) {
  if (!ll) return "No position yet — I need a GPS fix. Tap the locate button and give it a moment under open sky.";
  const dec = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
  const dm = (typeof formatCoord === 'function') ? (formatCoord(ll.lat, 'lat') + '  ' + formatCoord(ll.lng, 'lon')) : dec;
  if (!live) {
    return 'Map center (no live GPS fix yet):\n' + dm + '\n' + dec +
      '\n\nThis is where the map is pointed, not a GPS position — don\'t read it to the Coast Guard as yours. Tap SOS once you have a fix.';
  }
  if (stale) {
    return 'Last known GPS fix (' + asstFixAgeText() + '):\n' + dm + '\n' + dec +
      '\n\nThe GPS has not updated since then — tell the Coast Guard this is your last known position. ' +
      'For the Coast Guard, read the top line. Tap SOS to copy or text it.';
  }
  return 'Your position:\n' + dm + '\n' + dec + '\n\nFor the Coast Guard, read the top line. Tap SOS to copy or text it.';
}
export function asstAnsSpeed() {
  const sp = asstSpeedKn(), hd = asstHeading();
  if (sp == null && hd == null) return "No speed/heading yet — those come from a moving GPS fix.";
  /* An old SOG read as current is worse than none (voice.js voiceSaySpeed refuses too). */
  if (asstFixStale()) return 'No current speed reading. My last GPS fix is too old.';
  let s = '';
  if (sp != null) s += 'Speed over ground: ' + sp.toFixed(1) + ' kn (' + (sp * 1.15078).toFixed(1) + ' mph)\n';
  if (hd != null) s += 'Heading: ' + Math.round(hd) + '° ' + asstCompass(hd);
  return s.trim();
}
export function asstAnsSolunar(ll) {
  const a = asstAstro(ll);
  if (!a) return "I can't compute solunar times without a position.";
  if (!a.solunar.length) return "No strong solunar periods computed for today at this location.";
  const now = new Date();
  const lines = a.solunar.map((p) => {
    const active = now >= p.start && now <= p.end;
    return (p.type === 'major' ? '• MAJOR' : '• minor') + '  ' + asstTime(p.start) + '–' + asstTime(p.end) + (active ? '  ← NOW' : '');
  });
  return "Best bite windows today (solunar):\n" + lines.join('\n') +
    "\n\nMajors are the strongest. Dawn and dusk overlapping a major are prime. " + a.phaseName + ', ' + a.lit + '% lit.';
}
export function asstAnsSun(ll) {
  const a = asstAstro(ll);
  if (!a) return "I need a position to compute sun times.";
  const hrs = (a.sun.sunset - a.sun.sunrise) / 3600000;
  return "Today:\nSunrise " + asstTime(a.sun.sunrise) + "\nSunset  " + asstTime(a.sun.sunset) +
    "\nSolar noon " + asstTime(a.sun.solarNoon) + "\nDaylight: " + hrs.toFixed(1) + " hrs";
}
export function asstAnsMoon(ll) {
  const a = asstAstro(ll);
  if (!a) return "I need a position to compute moon times.";
  return a.phaseName + " — " + a.lit + "% illuminated" +
    (a.moonT.rise ? "\nMoonrise " + asstTime(a.moonT.rise) : '') +
    (a.moonT.set ? "\nMoonset  " + asstTime(a.moonT.set) : '') +
    "\n\nNew and full moons drive the biggest tides and strongest solunar bite.";
}
export function asstAnsWeather(q) {
  // Prefer a downloaded area pack (multi-day forecast, works offline & supports "tomorrow")
  const a = asstAreaPack();
  if (a && a.data && a.data.forecast) {
    const when = asstParseWhen((q || '').toLowerCase());
    const d = a.data, i = areaFcstIndex(d.forecast, when.ms);
    if (i >= 0) {
      const f = d.forecast;
      let s = when.label + ' — ' + a.name + ' (downloaded ' + asstAgo(d.capturedTs) + '):\n' +
        'Wind ' + Math.round(f.wind[i]) + ' kn ' + asstCompass(f.dir[i]) + ', gust ' + Math.round(f.gust[i]) + ' kn\n' +
        'Air ' + Math.round(f.temp[i]) + '°F' + (f.precip[i] != null ? ', ' + f.precip[i] + '% rain' : '');
      if (d.marine) {
        const mi = areaFcstIndex(d.marine, when.ms);
        if (mi >= 0 && d.marine.wave_m[mi] != null) s += '\nSeas ' + (d.marine.wave_m[mi] * 3.28084).toFixed(1) + ' ft @ ' + Math.round(d.marine.period[mi]) + 's';
        if (mi >= 0 && d.marine.sst[mi] != null) s += '\nWater ' + Math.round(d.marine.sst[mi]) + '°F';
      }
      const g = Math.round(f.gust[i]);
      if (g >= 25) s += '\n\n**' + g + ' kn gusts — rough.**';
      else if (g >= 18) s += '\n\nBreezy — expect a chop.';
      return s;
    }
  }
  /* Asked about a later time with no downloaded forecast: say so before giving the current
     reading — "weather tomorrow afternoon" used to get today's wind with no word that it
     wasn't the forecast that was asked for. */
  const later = asstParseWhen((q || '').toLowerCase()).label;
  const noFcst = later !== 'Now' && !/^this /i.test(later) ? "I don't have a forecast for " + later.toLowerCase() +
    ' offline — download this area while online to capture a 7-day forecast.' : '';
  const wx = asstCachedWx();
  if (!wx || !wx.wx || !wx.wx.current) return noFcst ? noFcst + ' ' + asstNoWx() : asstNoWx();
  const ahead = noFcst ? noFcst + ' What I have is the latest reading:\n\n' : '';
  const c = wx.wx.current, age = Math.round((Date.now() - wx.ts) / 60000);
  let s = ahead + "Wind now (cached " + age + " min ago):\n" + Math.round(c.wind_speed_10m) + ' kn from ' +
    asstCompass(c.wind_direction_10m) + ', gusting ' + Math.round(c.wind_gusts_10m) + ' kn\nAir ' + Math.round(c.temperature_2m) + '°F';
  if (wx.marine && wx.marine.current) {
    const m = wx.marine.current;
    s += '\nSeas ' + (m.wave_height * 3.28084).toFixed(1) + ' ft @ ' + Math.round(m.wave_period) + 's';
  }
  const g = Math.round(c.wind_gusts_10m);
  if (g >= 25) s += '\n\n**' + g + ' kn gusts — rough. Check the NWS marine forecast (VHF WX) before heading out.**';
  else if (g >= 18) s += '\n\nBreezy — expect a chop.';
  return s;
}
export function asstAnsWaves() {
  const wx = asstCachedWx();
  if (!wx || !wx.marine || !wx.marine.current) {
    if (wx && wx.wx) return "No wave data cached. Open the Weather panel while online to cache seas — I only have wind then.";
    return asstNoWx();
  }
  const m = wx.marine.current, age = Math.round((Date.now() - wx.ts) / 60000);
  const ft = (m.wave_height * 3.28084);
  let s = "Seas (cached " + age + " min ago):\n" + ft.toFixed(1) + ' ft @ ' + Math.round(m.wave_period) + 's from ' + asstCompass(m.wave_direction);
  if (m.swell_wave_height != null)
    s += '\nSwell: ' + (m.swell_wave_height * 3.28084).toFixed(1) + ' ft @ ' + Math.round(m.swell_wave_period) + 's from ' + asstCompass(m.swell_wave_direction);
  if (ft >= 5) s += '\n\n**Big — small boats beware.**';
  else if (ft >= 3) s += '\n\nModerate chop — bumpy ride.';
  else s += '\n\nCalm-ish on this reading.';
  return s;
}
export function asstAnsTides(q) {
  const a = asstAreaPack();
  if (a && a.data && a.data.tides && a.data.tides.preds && a.data.tides.preds.length) {
    const t = (q || '').toLowerCase();
    const when = asstParseWhen(t);
    const day = asstYmd(new Date(when.ms));   // local date — tide preds are station-local, not UTC
    let show;
    if (/tomorrow|tonight|today|this /.test(t)) {
      show = a.data.tides.preds.filter((p) => p.t.slice(0, 10) === day)
        .map((p) => ({ time: p.t.slice(11, 16), type: p.type === 'H' ? 'High' : 'Low', ft: p.v }));
    } else {
      show = areaTidesNext(a.data, Date.now(), 4);
    }
    if (!show.length) show = areaTidesNext(a.data, when.ms, 4);
    const lines = show.map((p) => (p.type === 'High' ? 'High' : 'Low ') + '  ' + p.time + '   ' + p.ft + ' ft');
    return 'Tides — ' + a.data.tides.station + ' (' + when.label + ', downloaded ' + asstAgo(a.data.capturedTs) + '):\n' + lines.join('\n');
  }
  /* No downloaded area here — but the Tides panel caches the nearest station's NOAA high/low
     predictions on the phone. They're astronomical, so a saved copy stays right for days:
     answer from it before telling the user to go and fetch tides. */
  const cachedAnswer = asstTidesFromPanelCache(q);
  if (cachedAnswer) return cachedAnswer;
  return "I don't have tide predictions offline for here. Download this area while online — it now captures a week of tides — or open the Tides panel with signal.";
}
export function asstTidesFromPanelCache(q) {
  const pos = asstPos();
  const st = pos && pos.ll && typeof nearestTideStation === 'function' ? nearestTideStation(pos.ll) : null;
  if (!st || !st.id) return null;
  let cached;
  try { cached = JSON.parse(localStorage.getItem('fishapp.tides.' + st.id) || 'null'); } catch (e) { cached = null; }
  const hl = cached && Array.isArray(cached.hl) ? cached.hl : [];
  if (!hl.length) return null;
  const ms = (p) => new Date(String(p.t).replace(' ', 'T')).getTime();   // station-local, parsed as device-local (same assumption as tides.js)
  const t = (q || '').toLowerCase();
  const when = asstParseWhen(t);
  const day = asstYmd(new Date(when.ms));
  let rows = /tomorrow|tonight|today|this /.test(t) ? hl.filter((p) => String(p.t).slice(0, 10) === day) : [];
  if (!rows.length) rows = hl.filter((p) => ms(p) >= when.ms).slice(0, 4);
  if (!rows.length) return null;
  const lines = rows.map((p) => (p.type === 'H' ? 'High' : 'Low ') + '  ' + String(p.t).slice(11, 16) + '   ' + p.v + ' ft');
  return 'Tides — ' + (st.n || 'nearest station') + ' (' + when.label + ', saved ' + asstAgo(cached.ts) + '):\n' + lines.join('\n');
}
export function asstAnsFishHistory(t) {
  const a = asstAreaPack();
  if (a && a.data && a.data.fish && a.data.fish.total) {
    const top = Object.entries(a.data.fish.tally).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => k + ' ×' + v).join(', ');
    const recent = (a.data.fish.recent || []).slice(0, 6).map((r) => '• ' + r.species + ' (' + r.date + ')').join('\n');
    return 'Reported in this area (iNaturalist, downloaded ' + asstAgo(a.data.capturedTs) + ' · ' + a.data.fish.total + ' records):\nTop: ' + top +
      (recent ? '\n\nRecent:\n' + recent : '') + '\n\n(Community sightings — divers & anglers, not all rod-and-reel.)';
  }
  // No downloaded sightings — fall back to the area game-plan / general targets so we still help.
  const area = (typeof areaTipsFor === 'function') ? areaTipsFor(t || '') : null;
  if (area) return 'What to target — ' + area.name + '\n' + areaTipText(area) +
    '\n\n(That\'s the general game plan. Download this area with signal to also see recent community sightings.)';
  return "What to target here depends on the spot — tell me where (e.g. \"at Catalina\", \"the flats\") or what you're after, and I'll give you species, lures and how to fish them. " +
    "Popular SoCal targets: calico bass, sand bass, halibut, yellowtail, white seabass, barracuda, bonito, rockfish, lingcod, sheephead.";
}
export function asstAnsClosures() {
  const a = asstAreaPack();
  if (a && a.data && a.data.mpas) {
    if (!a.data.mpas.length) return "No marine protected areas were captured inside this downloaded area — but always confirm with CDFW before fishing near a closure.";
    const lines = a.data.mpas.slice(0, 12).map((m) => '• ' + m.n + (m.t ? ' [' + m.t + ']' : '')).join('\n');
    return 'Protected areas in this download:\n' + lines + '\n\n**Boundaries are approximate — confirm exact lines & take rules with CDFW before fishing.**';
  }
  return "No closure data captured offline here. The MPA layer is bundled — turn it on in Layers, or download this area so I can summarize closures offline.";
}
export function asstYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* Synthesized offline planner: rank the next few days by bite (solunar overlapping
   daylight) + weather (from the downloaded area pack, if any). */
export function asstAnsPlan() {
  const { ll } = asstPos();
  if (!ll || typeof Astro === 'undefined') return "I need a position to plan bite times.";
  const a = asstAreaPack();
  const daily = (a && a.data) ? areaDailyForecast(a.data) : null;
  const nDays = daily ? Math.min(daily.length, 5) : 3;
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const date = new Date(); date.setDate(date.getDate() + i); date.setHours(12, 0, 0, 0);
    const sun = Astro.sunTimes(date, ll.lat, ll.lng);
    const sol = Astro.solunar(date, ll.lat, ll.lng) || [];
    let best = null;
    sol.forEach((p) => {
      if (p.type !== 'major') return;
      const inDay = p.end >= sun.sunrise && p.start <= sun.sunset;
      const near = Math.min(Math.abs(p.center - sun.sunrise), Math.abs(p.center - sun.sunset)) < 90 * 60000;
      const score = (inDay ? 2 : 0) + (near ? 1 : 0);
      if (!best || score > best.score) best = { p, score, inDay, near };
    });
    const wx = daily ? daily.find((d) => d.date === asstYmd(date)) : null;
    let s = 0;
    if (best) s += best.inDay ? 3 : 1;
    if (best && best.near) s += 1;
    /* Only score a day we actually have wind for. A day with no readings used to
       score BEST — its -Infinity max wind passed the "<= 12 kn" test outright. */
    if (wx && wx.wind_kn) {
      if (wx.wind_kn[1] <= 12) s += 2; else if (wx.wind_kn[1] <= 18) s += 1; else s -= 1;
      if (wx.wave_ft != null) { if (wx.wave_ft <= 2) s += 1; else if (wx.wave_ft >= 5) s -= 1; }
      if (wx.precip_pct <= 20) s += 0.5;
    }
    days.push({ date, best, wx, s });
  }
  days.sort((x, y) => y.s - x.s);
  const lines = days.slice(0, 3).map((d, idx) => {
    const wd = d.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    let line = (idx + 1) + '. ' + wd;
    if (d.best) line += ' — bite ' + asstTime(d.best.p.start) + '–' + asstTime(d.best.p.end) +
      (d.best.inDay ? (d.best.near ? ' (near sunrise/sunset — prime)' : '') : ' (after dark)');
    if (d.wx && d.wx.wind_kn) line += '\n   wind ' + d.wx.wind_kn[0] + '–' + d.wx.wind_kn[1] + 'kn' +
      (d.wx.wave_ft != null ? ', seas ' + d.wx.wave_ft + 'ft' : '') + ', ' + d.wx.precip_pct + '% rain';
    return line;
  });
  return 'Best days to fish' + (daily ? ' (bite + weather, downloaded ' + asstAgo(a.data.capturedTs) + ')' : ' (bite windows only)') + ':\n' +
    lines.join('\n') + (daily ? '' : '\n\nDownload this area while online and I can factor in wind & seas too.');
}

/* Multi-day weather outlook from the downloaded pack. */
export function asstAnsOutlook() {
  const a = asstAreaPack();
  if (!a || !a.data || !a.data.forecast) return "I don't have a multi-day forecast offline here. Download this area while online to capture a 7-day outlook.";
  const daily = areaDailyForecast(a.data);
  // Every field is nullable now — say "no data" rather than print Infinity as fact.
  const lines = daily.slice(0, 7).map((d) => {
    const dt = new Date(d.date + 'T12:00');
    const wd = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (!d.wind_kn) return wd + ': no data captured for this day';
    return wd + ': wind ' + d.wind_kn[0] + '–' + d.wind_kn[1] + 'kn' +
      (d.gust_kn != null ? ' (g' + d.gust_kn + ')' : '') +
      (d.wave_ft != null ? ', seas ' + d.wave_ft + 'ft' : '') +
      (d.air_f ? ', ' + d.air_f[0] + '–' + d.air_f[1] + '°F' : '') + ', ' + d.precip_pct + '% rain';
  });
  if (!lines.length) return "That area pack's forecast has expired — re-download the area while online for a fresh outlook.";
  return a.name + ' — ' + lines.length + '-day outlook (downloaded ' + asstAgo(a.data.capturedTs) + '):\n' + lines.join('\n');
}

/* Plain go/no-go read on current wind + seas (with a safety caveat). */
export function asstAnsGoNoGo() {
  let wind, gust, wave, src;
  const a = asstAreaPack();
  if (a && a.data && a.data.forecast) {
    const i = areaFcstIndex(a.data.forecast, Date.now());
    if (i >= 0) {
      wind = a.data.forecast.wind[i]; gust = a.data.forecast.gust[i];
      if (a.data.marine) { const mi = areaFcstIndex(a.data.marine, Date.now()); if (mi >= 0 && a.data.marine.wave_m[mi] != null) wave = a.data.marine.wave_m[mi] * 3.28084; }
      src = 'downloaded ' + asstAgo(a.data.capturedTs);
    }
  }
  if (wind == null) {
    const wx = asstCachedWx();
    if (wx && wx.wx && wx.wx.current) {
      wind = wx.wx.current.wind_speed_10m; gust = wx.wx.current.wind_gusts_10m;
      if (wx.marine && wx.marine.current) wave = wx.marine.current.wave_height * 3.28084;
      src = 'cached ' + asstAgo(wx.ts);
    }
  }
  if (wind == null) return "I don't have wind/sea data offline right now. Download this area or open Weather with signal.";
  const g = Math.round(gust), w = wave != null ? wave : null;
  /* The verdict used to lead with a coloured emoji; it now leads in bold words, which also
     survive night mode and a screen reader. */
  let verdict;
  if (g >= 25 || (w != null && w >= 6)) { verdict = 'Rough — think hard before going. Small boats should probably stay in.'; }
  else if (g >= 18 || (w != null && w >= 4)) { verdict = 'Marginal — doable in the right boat, but expect a bumpy, wet ride.'; }
  else if (g >= 12 || (w != null && w >= 2.5)) { verdict = 'A little chop, but generally fishable.'; }
  else { verdict = 'Looks calm and fishable.'; }
  return '**' + verdict + '**\nWind ~' + Math.round(wind) + ' kn (gust ' + g + ')' + (w != null ? ', seas ~' + w.toFixed(1) + ' ft' : '') + ' (' + src + ').' +
    '\n\n**Rough read only — the call is the skipper\'s. Get the NWS marine forecast (VHF WX / NOAA) before you head out.**';
}

/* Nearest saved spot of a given type (ramp, anchorage, hazard, wreck). */
export function asstAnsNearest(t) {
  let type = null, label = '';
  // 'dock' is a trigger phrase upstream and maps to 'ramp' when placing a waypoint,
  // so it has to resolve here too — otherwise "nearest dock" fell through to help.
  if (/ramp|launch|boat ?ramp|put.?in|dock/.test(t)) { type = 'ramp'; label = 'ramp/dock'; }
  else if (/anchorage|anchor spot|place to anchor/.test(t)) { type = 'anchor'; label = 'anchorage'; }
  else if (/hazard|danger/.test(t)) { type = 'hazard'; label = 'hazard'; }
  else if (/wreck/.test(t)) { type = 'wreck'; label = 'wreck'; }
  if (!type) return null;
  const list = (typeof Spots !== 'undefined' ? Spots.all : []).filter((s) => s.type === type);
  if (!list.length) return 'You have no saved ' + label + 's yet. Drop one by saying "mark this as a ' + type + ' named …".';
  const { ll } = asstPos();
  if (!ll) return 'You have ' + list.length + ' saved ' + label + '(s), but I need a GPS fix to sort by distance.';
  const sorted = list.map((s) => ({ s, nm: nmBetween(ll, L.latLng(s.lat, s.lng)), brg: bearingBetween(ll, L.latLng(s.lat, s.lng)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, 3);
  return 'Nearest ' + label + ':\n' + sorted.map((x, i) => (i + 1) + '. ' + x.s.name + ' — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg)).join('\n');
}

/* What bait/lure has worked for a species, from your own catch log. */
export function asstAnsBait(t) {
  const sp = (typeof fishTipsFor === 'function') ? fishTipsFor(t) : null;
  const area = (typeof areaTipsFor === 'function') ? areaTipsFor(t) : null;
  const tech = (typeof techniqueTipsFor === 'function') ? techniqueTipsFor(t) : null;

  // Pure technique question ("how do I fish a dropper loop?") with no species named.
  if (tech && !sp) return tech.name + '\n' + tech.text;

  if (sp) {
    let s = sp.name + '\n' +
      '• Lures/jigs: ' + sp.lures + '\n' +
      '• Bait: ' + sp.baits + '\n' +
      '• How: ' + sp.method + '\n' +
      '• Where/when: ' + sp.where + ' ' + sp.when;
    // Area-specific note if the question names one this species has tips for.
    if (sp.areas) {
      const ak = Object.keys(sp.areas).find((k) => t.includes(k));
      if (ak) {
        s += '\n• ' + ak.replace(/\b\w/g, (c) => c.toUpperCase()) + ': ' + sp.areas[ak];
        // The species' spot notes name grounds beside MPAs too (Catalina front side, PV, the islands).
        const ap = areaTipsFor(ak) || areaTipsFor(t);
        if (ap && ap.mpa) s += '\n' + MPA_TIP_NOTE;
      }
    }
    // Fold in the user's own catch log if it has data for this species.
    if (typeof Catch !== 'undefined' && Catch.all && Catch.all.length) {
      const nameWords = sp.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const matches = Catch.all.filter((c) => c.species && c.bait && nameWords.some((w) => c.species.toLowerCase().includes(w)));
      if (matches.length) {
        const tally = {};
        matches.forEach((c) => { const b = c.bait.trim(); tally[b] = (tally[b] || 0) + 1; });
        const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b, n]) => b + ' ×' + n);
        s += '\n\nFrom your log, these have hit: ' + top.join(', ') + '.';
      }
    }
    return s + '\n\n**Confirm size/bag limits with CDFW before keeping fish.**';
  }

  if (area) return area.name + '\n' + areaTipText(area) +
    '\n\n(Ask about a species — e.g. "what should I throw for yellowtail here" — for lure/bait specifics.)';

  // Nothing matched — nudge with useful options rather than punting.
  return "Tell me what you're after (and roughly where) and I'll give you lures, bait and how to fish it — e.g. \"calico bass at Catalina\", \"halibut on the flats\", \"yellowtail on the iron\".\n" +
    "Popular SoCal targets: calico bass, sand bass, halibut, yellowtail, white seabass, barracuda, bonito, rockfish, lingcod, sheephead.";
}

export function asstAnsWaterTemp() {
  const a = asstAreaPack();
  if (a && a.data && typeof areaSstStats === 'function') {
    const st = areaSstStats(a.data);
    if (st) return "Water temp in " + a.name + " (downloaded " + asstAgo(a.data.capturedTs) + "):\n" +
      "About " + st.avg + "°F, ranging " + st.min + "–" + st.max + "°F across the area" +
      (st.span >= 2 ? ".\nWarmest water (a break to try) is near " + st.warmest.lat.toFixed(3) + ", " + st.warmest.lng.toFixed(3) + " (" + st.max + "°F)." : ".");
  }
  const wx = asstCachedWx();
  if (wx && wx.marine && wx.marine.current && wx.marine.current.sea_surface_temperature != null)
    return "Sea-surface temp (cached): " + Math.round(wx.marine.current.sea_surface_temperature) + "°F";
  if (typeof SST !== 'undefined' && SST.range)
    return "I don't have an exact water temp cached here. The SST layer's current color scale runs about " +
      Math.round(SST.range[0] * 9 / 5 + 32) + "–" + Math.round(SST.range[1] * 9 / 5 + 32) +
      "°F across the view. Turn on the Sea-surface-temp layer (needs internet) and tap the water for an exact reading.";
  return "I don't have a cached water temp. Online, turn on the SST layer and tap the water for an exact °F.";
}
export function asstAnsReefs(ll) {
  if (!ll) return "I need a position to find nearby reefs.";
  const reefs = asstNearestReefs(ll, 5);
  if (!reefs.length) return "No reef data loaded (the bundled reef list is California-focused).";
  return "Nearest artificial reefs:\n" + reefs.map((x, i) =>
    (i + 1) + '. ' + x.r.n + ' — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) +
    (x.r.d ? ', ~' + x.r.d + ' ft' : '') + (x.r.c ? '\n   ' + x.r.c : '')).join('\n');
}
export function asstAnsSpots(ll) {
  if (typeof Spots === 'undefined' || !Spots.all || !Spots.all.length)
    return "You have no saved spots yet. Tap the pin button or long-press the map to mark one.";
  if (!ll) return "You have " + Spots.all.length + " saved spots, but I need a GPS fix to sort by distance.";
  const spots = asstNearestSpots(ll, 6);
  return "Your nearest spots:\n" + spots.map((x, i) =>
    (i + 1) + '. ' + x.s.name + ' [' + x.s.type + '] — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) +
    (x.s.notes ? '\n   ' + x.s.notes : '')).join('\n');
}
export function asstAnsDistanceTo(t, ll) {
  if (!ll || typeof Spots === 'undefined' || !Spots.all) return null;
  const spot = Spots.all.find((s) => s.name && t.includes(s.name.toLowerCase()));
  if (!spot) return null;
  const here = L.latLng(ll.lat, ll.lng), there = L.latLng(spot.lat, spot.lng);
  const nm = nmBetween(here, there), brg = bearingBetween(here, there);
  // Speed: "at 25 kn/mph" in the query → Nav route-speed setting → live GPS → 20 kn default
  let sp = null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kn|knots?|kt|mph)/);
  if (m) { sp = parseFloat(m[1]); if (/mph/.test(m[2])) sp = sp / 1.15078; }
  if (sp == null) { const rs = asstRouteSpeedKn(); if (rs > 0) sp = rs; }
  if (sp == null && !asstFixStale()) { const g = asstSpeedKn(); if (g && g > 1) sp = g; }   // never an old SOG
  if (sp == null) sp = 20;
  const gph = asstRouteGph() || 8;
  const roundTrip = /back|round|return/.test(t);
  const legMin = nm / sp * 60, fuel = nm / sp * gph;
  let s = spot.name + ': ' + nm.toFixed(1) + ' nm, bearing ' + Math.round(brg) + '° ' + asstCompass(brg) +
    '\nAt ' + Math.round(sp) + ' kn: ~' + Math.round(legMin) + ' min one way, ~' + fuel.toFixed(1) + ' gal';
  if (roundTrip) s += '\nRound trip: ' + (nm * 2).toFixed(1) + ' nm, ~' + Math.round(legMin * 2) + ' min, ~' + (fuel * 2).toFixed(1) + ' gal';
  s += '\n(Assumes ' + gph + ' gal/hr — set speed & GPH in Nav tools.)';
  return s;
}
export function asstAnsDepth(t) {
  const a = asstAreaPack();
  if (!a || !a.data || !a.data.depthGrid || !a.data.depthGrid.length)
    return "I don't have depth data offline here. Tap the water with signal (depth shows on the card), or download this area — it now captures a depth grid.";
  let ll = asstPos().ll, where = 'here';
  const spot = (typeof Spots !== 'undefined' ? Spots.all : []).find((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
  if (spot) { ll = L.latLng(spot.lat, spot.lng); where = spot.name; }
  if (!ll) return "I need a position (or a saved spot name) to read depth.";
  const p = areaDepthAt(a.data, ll);
  if (!p) return "No depth was captured near " + where + ".";
  if (p.land) return "That point (" + where + ") reads as land on the survey grid.";
  return "Depth " + where + ": about " + p.ft + " ft (" + Math.round(p.ft / 6) + " fathoms) — nearest point in a coarse grid, downloaded " + asstAgo(a.data.capturedTs) + ".\nTap the chart with signal for an exact sounding.";
}
export function asstAnsCompareSpots(t) {
  if (typeof Spots === 'undefined' || Spots.all.length < 2) return null;
  const found = Spots.all.filter((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
  if (found.length < 2) return null;
  const { ll } = asstPos();
  const sp = (asstFixStale() ? null : asstSpeedKn()) || asstRouteSpeedKn() || 20;   // never an old SOG
  const rows = found.slice(0, 3).map((s) => {
    let line = '• ' + s.name + ' [' + s.type + ']';
    if (ll) {
      const there = L.latLng(s.lat, s.lng), here = L.latLng(ll.lat, ll.lng);
      const nm = nmBetween(here, there);
      line += ' — ' + nm.toFixed(1) + ' nm ' + asstCompass(bearingBetween(here, there)) +
        (sp > 0 ? ', ~' + Math.round(nm / sp * 60) + ' min' : '');
    }
    if (s.notes) line += '\n   ' + s.notes;
    return line;
  });
  let head = 'Comparing ' + found.slice(0, 3).map((s) => s.name).join(' vs ') + ':';
  if (ll) {
    const here = L.latLng(ll.lat, ll.lng);
    const closest = found.slice().sort((a, b) => nmBetween(here, L.latLng(a.lat, a.lng)) - nmBetween(here, L.latLng(b.lat, b.lng)))[0];
    head += '\nClosest to you: ' + closest.name + '.';
  }
  return head + '\n\n' + rows.join('\n');
}
export function asstAnsCatches() {
  if (typeof Catch === 'undefined' || !Catch.all || !Catch.all.length)
    return "Your catch log is empty. Open Nav tools & catch log and tap Log catch to start building it.";
  const all = Catch.all.slice().sort((a, b) => b.ts - a.ts);
  const bySp = {};
  all.forEach((c) => { const s = (c.species || 'unknown').trim(); bySp[s] = (bySp[s] || 0) + 1; });
  const top = Object.entries(bySp).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => s + ' ×' + c).join(', ');
  const recent = all.slice(0, 5).map((c) => '• ' + c.species + (c.length ? ' ' + c.length + '"' : '') +
    (c.bait ? ' on ' + c.bait : '') + ' — ' + new Date(c.ts).toLocaleDateString()).join('\n');
  return all.length + " catches logged.\nBy species: " + top + "\n\nMost recent:\n" + recent;
}
export function asstAnsReg(t) {
  const sp = asstFindSpecies(t);
  if (!sp) return null;
  return asstFormatSpecies(sp);
}
export function asstFindSpecies(t) {
  if (typeof FISH_ID === 'undefined') return null;
  // direct name / word overlap
  let best = FISH_ID.find((f) => t.includes(f.name.toLowerCase()));
  if (best) return best;
  /* Generic words never name a species: "fish" is inside "Rockfish" and "Ocean Whitefish", so
     "how many fish can I keep?" or "is it legal to keep this fish" answered with the ROCKFISH
     limits as if that were the user's fish. */
  const stop = ['fish', 'fishes', 'fishing', 'what', 'this', 'that', 'here', 'there', 'keep', 'legal', 'many', 'much',
    'with', 'from', 'about', 'have', 'season', 'catch', 'caught', 'when', 'where', 'limit', 'limits', 'size', 'open',
    'rules', 'regs', 'closure', 'closures', 'depth', 'inch', 'inches', 'long', 'tell', 'know', 'they', 'them'];
  const words = t.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && stop.indexOf(w) < 0);
  best = FISH_ID.find((f) => words.some((w) => f.name.toLowerCase().includes(w)));
  return best || null;
}
export function asstFormatSpecies(f) {
  return f.name + '\nMin size: ' + f.size + '\nBag limit: ' + f.bag +
    (f.note ? '\n' + f.note : '') + '\nID: ' + f.id +
    '\n\n**General reference — always confirm current CA regs with CDFW before keeping fish.**';
}
export function asstFindKnot(t) {
  if (typeof KNOTS === 'undefined') return null;
  // drop generic terms — every knot NAME contains "Knot", so the bare token "knot" would
  // match the first entry (Palomar) for any knot query. Keep only distinctive words.
  const stop = ['knot', 'knots', 'tie', 'line', 'hook', 'lure', 'rig', 'best', 'good', 'the', 'for', 'how', 'what'];
  const words = t.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && stop.indexOf(w) < 0);
  return KNOTS.find((k) => t.includes(k.name.toLowerCase())) ||
    KNOTS.find((k) => words.some((w) => k.name.toLowerCase().includes(w))) || null;
}
/* "Which knot for X?" — by what the knot is FOR when no knot is named. "best knot for braid to
   fluoro" and "what knot for a swivel" used to get only the list of names. Ordered: the most
   specific job first. Returns the knot (by name, so a trimmed list just finds nothing). */
export const ASST_KNOT_USES = [
  { re: /\bbraid\b.*\b(?:fluoro\w*|leader|mono\w*)\b|\b(?:fluoro\w*|leader|mono\w*)\b.*\bbraid\b/, name: 'FG Knot', also: 'Albright Knot or Double Uni Knot if you want an easier one' },
  { re: /\b(?:spool|reel|arbor)\b/, name: 'Arbor Knot' },
  { re: /\bleader\b|\bjoin\w*\b|\btwo lines\b|\bline to line\b|\bsplice\b/, name: 'Double Uni Knot' },
  { re: /\bdropper\b|\bmulti.?hook\b|\bteaser\b/, name: 'Dropper Loop' },
  { re: /\bbait hook\b|\bcircle hook\b|\bsnell\w*\b/, name: 'Snell Knot' },
  { re: /\bjig\w*\b|\biron\b/, name: 'San Diego Jam Knot' },
  { re: /\bswimbait\b|\bplug\b|\bfree action\b/, name: 'Non-Slip Loop Knot' },
  { re: /\bswivel\b|\bhook\b|\blure\b|\bsnap\b|\bterminal\b/, name: 'Palomar Knot' },
];
export function asstKnotForUse(t) {
  if (typeof KNOTS === 'undefined') return null;
  for (const u of ASST_KNOT_USES) {
    if (!u.re.test(t)) continue;
    const k = KNOTS.find((x) => x.name === u.name);
    if (k) return { k, also: u.also || '' };
  }
  return null;
}
export function asstAnsKnot(t) {
  const k = asstFindKnot(t);
  if (k) return asstFormatKnot(k);
  const byUse = asstKnotForUse(t);
  if (byUse) return asstFormatKnot(byUse.k) + (byUse.also ? '\n(Alternatives: ' + byUse.also + '.)' : '');
  if (typeof KNOTS === 'undefined' || !KNOTS.length) return "No knot guide loaded.";
  return "Which knot? I know: " + KNOTS.map((k2) => k2.name).join(', ') +
    ".\nOpen Guides → Knots for illustrated steps.";
}
export function asstFormatKnot(k) {
  return k.name + ' — ' + k.use + ' (' + k.level + ')\n' +
    k.steps.map((s, i) => (i + 1) + '. ' + s).join('\n') +
    (k.tip ? '\nTip: ' + k.tip : '') + '\n\nOpen Guides → Knots for a diagram.';
}
/* The script tells the user to read "position above" in a MAYDAY, so the line above must say
   what it is. With no fix asstPos() hands back the map center, and a stale fix is only where
   the boat WAS — both used to print as "Your position". Labelled the way voice.js
   voiceSayPosition and asstPositionSource label them; the rest of the script is unchanged. */
export function asstAnsEmergency(ll, live, stale) {
  let s = "EMERGENCY\n• VHF Channel 16 — hail & distress\n• Call 911 / Coast Guard (needs signal)\n";
  if (ll) {
    const at = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
    if (live === false) s += "• Map center (NO GPS fix): " + at + " — not your position; give your position from a chartplotter or landmarks\n";
    else if (stale) s += "• Last known GPS fix (" + asstFixAgeText() + "): " + at + " — say it is your last known position\n";
    else s += "• Your position: " + at + "\n";
  }
  s += "\nMAYDAY (life-threatening), say 3×: your boat name, position above, nature of emergency, # people aboard.\n" +
    "No signal + iPhone 14+? Emergency SOS via satellite — point at open sky.\n\nTap the SOS button for the full script, one-tap texting, and satellite steps.";
  return s;
}
export function asstNoWx() {
  return "I have no recent weather cached for this spot. Open the Weather panel once while you have signal — it caches so I can read it offline. " +
    asstLiveHint();
}
/* What to suggest for a live answer, by the REASON the phone is answering. "Turn on Allow
   cloud AI" was also given when it was already on and the relay was blocked (403) or no relay
   is set — advice that does nothing. */
export function asstLiveHint() {
  if (!navigator.onLine) return '';
  if (asstCloudConsent() !== 'yes') return "You're online now, so turn on Allow cloud AI in First Mate settings for a live answer.";
  if (!ASST.key() && (ASST._proxyBlocked || !asstProxyUrl())) return "The AI relay isn't available right now, so I can't fetch a live answer.";
  return 'Try again in a moment for a live answer.';
}
export function asstAnsHelp() {
  return "I'm First Mate. Even with NO signal or key, I can tell you:\n" +
    "• Best day/time to fish (bite + weather) & the week's outlook\n" +
    "• Is it too rough to go out? (go/no-go read)\n" +
    "• Tides, sunrise/sunset, moon phase, solunar bite windows\n" +
    "• Weather for now or 'tomorrow afternoon', wind, seas, water temp & breaks\n" +
    "• Your position, speed, heading; nearest reef / ramp / anchorage / spot\n" +
    "• What to throw — lures, jigs, bait & technique for a species or area (calico, yellowtail, halibut, WSB…)\n" +
    "• What's biting at a spot & what bait worked (from your log)\n" +
    "• Fish size/bag limits, closures, knots, Mayday info\n" +
    "• Drop & name a waypoint\n\n" +
    "(Tides, multi-day weather & fish history need the area downloaded first.) With signal and cloud AI allowed in settings I'll also chat freely; add your own API key and I can take actions too.";
}

/* Personal bite windows from the user's own catch log (bite.js).
   Returns null — deliberately, not an error string — when there isn't enough history or no
   saved forecast, so the caller falls back to the generic solunar planner. */
export async function asstAnsBite(t) {
  if (typeof biteWindows !== 'function') return null;
  try {
    /* Match only species actually in the log, longest first so "calico bass" beats a bare
       "bass". Unrecognised names just fall through to all catches. */
    let species = null;
    if (typeof Catch !== 'undefined' && Catch.all) {
      const names = Array.from(new Set(Catch.all.map((c) => (c.species || '').trim())))
        .filter((s) => s.length > 2).sort((a, b) => b.length - a.length);
      species = names.find((n) => t.includes(n.toLowerCase())) || null;
    }
    const res = await biteWindows({ days: 7, limit: 3, species: species || undefined });
    if (!res || res.error || !res.windows || !res.windows.length) return null;   // -> generic planner
    let out = 'Best windows' + (species ? ' for ' + species : '') +
      ', scored against your ' + res.n + ' logged catches (' + res.confidence.label + '):\n';
    res.windows.forEach((w, i) => {
      out += '\n' + (i + 1) + '. ' + biteFmtWindow(w) + ' — ' + Math.round(w.score * 100) + '%\n   ' +
        w.best.hits.slice(0, 3).map(biteReason).join(' · ');
    });
    return out;
  } catch (e) { return null; }
}

/* ---- Local waypoint action (used offline AND by the online place_waypoint tool) ---- */
export async function asstCreateSpot(o) {
  const spot = { lat: o.lat, lng: o.lng, name: o.name, type: o.type || 'fish', notes: o.notes || '', ts: Date.now() };
  const id = await idb.put('spots', spot);
  spot.id = spot.id || id;
  Spots.all.push(spot);
  /* The write is committed from here on. A failure redrawing the marker or the Spots list
     must not surface as a failed save — the offline path would then tell the user "Nothing
     was written" about a spot that IS saved and reappears on the next launch. */
  try { addSpotMarker(spot); } catch (e) { console.error('[first mate] spot marker', e); }
  try { if (typeof spotsChanged === 'function') spotsChanged(); } catch (e) { console.error('[first mate] spots list', e); }
  return spot;
}
export function asstParseWaypointName(q) {
  let m = q.match(/["“']([^"”']{1,40})["”']/);
  if (m) return m[1].trim();
  m = q.match(/(?:name(?:d| it)?|call(?:ed)?(?: it)?|label(?:ed)?(?: it)?)\s+([\w '&.-]{1,40})/i);
  if (m) return m[1].trim().replace(/[.,!?]+$/, '');
  return null;
}
export async function asstOfflinePlaceWaypoint(q) {
  const { ll } = asstPos();
  if (!ll) return "I can't drop a waypoint without a position — I need a GPS fix (or pan the map there first).";
  const source = asstPositionSource(null) || 'map center — no GPS fix yet';
  const given = asstParseWaypointName(q);
  const name = given || ('Waypoint ' + ((typeof Spots !== 'undefined' ? Spots.all.length : 0) + 1));
  /* The type comes from the request, not from the name: "drop a pin here called Rock Pile"
     used to save a HAZARD (the name contains "rock"), and "… named Anchor Bay" an anchorage. */
  let t = q.toLowerCase();
  if (given) t = t.split(given.toLowerCase()).join(' ');
  let type = 'fish';
  if (t.includes('anchor')) type = 'anchor';
  else if (t.includes('hazard') || t.includes('danger') || t.includes('rock')) type = 'hazard';
  else if (t.includes('wreck') || t.includes('structure')) type = 'wreck';
  else if (t.includes('ramp') || t.includes('dock')) type = 'ramp';
  /* Await it. This used to return "Saved and on the map" synchronously while the
     write was still pending and swallow any rejection — so on a full or private-mode
     store the user was told it saved, no toast fired, and nothing was in the list.
     The online tool path already awaits; the two paths disagreed. */
  try {
    await asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: type });
  } catch (e) {
    return 'Couldn\'t save "' + name + '" — storage may be full or blocked. Nothing was written.';
  }
  /* Same wording as the online place_waypoint tool: a pin not placed from a live fix says
     where it came from (the map center, or a stale last-known fix). */
  const guessed = source !== 'live GPS';
  if (typeof toast === 'function') toast(name + ' saved' + (guessed ? ' (' + source + ')' : ''));
  return 'Dropped "' + name + '" (' + type + ') at ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) +
    (guessed ? ' (' + source + ')' : '') + '.\nSaved and on the map. Open Spots to rename or remove it.';
}

/* ================= ONLINE brain (Claude) ================= */
/* What both cloud brains are told about formatting: the transcript renders plain text with
   **bold** only (never HTML), on a phone, and the app carries no emoji. */
export const ASST_FORMAT_RULE = "Format for a small screen: plain text, short lines, '-' bullets when listing, **bold** only for the key number or a warning. No headings, tables, links or emoji.";
/* Where First Mate must NOT be the last word (legal review, docs/launch/legal-review.md). Both
   cloud prompts carry it, after the "be the local" fishing instruction it limits; the offline
   answers follow the same rules (CDFW lines on regs/closures, the skipper-decides line on the
   go/no-go read, the emergency script with no treatment advice). */
export const ASST_LIMITS_RULE = "Limits — these ALWAYS override the above: " +
  "(1) Regulations and MPA boundaries: give the general reference, then tell them to confirm current size/bag limits, seasons, depth closures and MPA lines with CDFW; never say a spot is open or legal to fish. " +
  "(2) Go/no-go, weather and sea state: give the numbers and a plain read, but the decision is the skipper's — point them to the NWS marine forecast / VHF WX before heading out; never say it is safe. " +
  "(3) Medical or any emergency: VHF Ch 16 / call 911 or the Coast Guard and the app's SOS button first; no treatment advice beyond basic first aid.";
export function asstSystemPrompt() {
  return [
    "You are First Mate, a calm, concise assistant built into an offline marine navigation app for a recreational boater and angler.",
    "You have the user's LIVE boat data below — use it. Prefer it over guessing. Units: distances in nautical miles, speed in knots, temps in °F, depths/heights in feet.",
    "Be practical and brief — this is read on a phone on a boat. Lead with the answer. Use short lines. Only elaborate when asked.",
    ASST_FORMAT_RULE,
    "Safety first: for anything life-threatening, tell them to use VHF Ch 16 / call the Coast Guard and point to the app's SOS button. Never give false confidence about weather or conditions.",
    "Fishing regulations you cite are general reference — always tell them to confirm current limits with the state wildlife agency (CDFW in California) before keeping fish.",
    "You can take real actions in the app via tools: place / list / delete waypoints, toggle map layers, start or stop trip tracking, center the map, and pull LIVE weather & tides for a point. For current weather, seas, water temp or tides, CALL get_conditions / get_tides — don't answer those from the cached snapshot alone. Default every location to the boat's current position unless the user gives coordinates or names a saved spot. After acting, confirm briefly and naturally what you did. If a tool result says it used the map center because there was no GPS fix, say so.",
    "If the user is offline (get_conditions / get_tides can't reach the network) or asks about a downloaded area, call get_area_intel — it reads the offline data pack captured when the area was downloaded (multi-day forecast, a week of tides, water-temp grid, fish-sighting history, closures). Always mention when the data was captured so they know its age.",
    "Catch logging and knots aren't automated yet — for those, point them to Nav tools & catch log and to Guides → Knots in the app.",
    "You are a knowledgeable local deckhand: you have a built-in fishing brain (below) covering species, lures/jigs/baits, techniques, and area game-plans for Southern & Central California. When asked what to throw, what bait, how to catch something, or what's biting at a spot, give a SPECIFIC recommendation from it — don't tell the user to ask a local, hire a guide, google it or buy a book for FISHING ADVICE.",
    ASST_LIMITS_RULE,
    "",
    asstSnapshot(),
    "",
    asstRegsTable(),
    "",
    asstTipsTable(),
  ].join('\n');
}

/* ================= FREE proxy brain (Cloudflare Workers AI, no key) ================= */
/* Owner: set this to your deployed Worker URL to give ALL users free no-key chat.
   (Users can also set it per-device in settings → "Free-AI endpoint".) */
export const ASST_PROXY = 'https://first-mate.jbittlest.workers.dev';
export function asstProxyOverride() { return (localStorage.getItem('fishapp.asst.proxy') || '').trim(); }
export function asstProxyUrl() { return (asstProxyOverride() || ASST_PROXY || '').trim(); }
/* The settings field shows the EFFECTIVE endpoint (it used to show blank while the default
   was quietly in use, so it looked switched off when it wasn't). Saving it empty or unchanged
   means "use the FishApp relay"; turning cloud AI off is the Allow cloud AI switch, not an
   empty field. Returns { value } to store ('' = default) or { error }. */
export function asstNormalizeProxy(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.replace(/\/+$/, '') === ASST_PROXY) return { value: '' };
  if (/^https:\/\/[^\s/]+/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return { value: s };
  return { error: 'The endpoint must be an https:// address.' };
}

/* The Worker cuts `system` at 8000 characters (proxy/first-mate-worker.js). The prompt used to
   run ~10k with the LIVE CONDITIONS / TIDES block appended LAST — so the free brain never saw
   the live numbers it was told to read out, and punted. Now the live block sits right after
   the instructions, and only the reference tables are trimmed (whole lines) to fit. */
export const ASST_PROXY_SYSTEM_CAP = 8000;
/** Join sections in order under a character cap. Sections without `trim` are always kept;
 *  `trim` sections fill what's left, cut at whole lines (a header plus at least one row). */
export function asstFitSections(sections, cap) {
  const list = sections.filter((s) => s && s.text);
  const SEP = '\n\n';
  const reqAfter = (i) => list.slice(i + 1).filter((s) => !s.trim).reduce((n, s) => n + s.text.length + SEP.length, 0);
  const parts = [];
  let used = 0;
  list.forEach((s, i) => {
    const join = parts.length ? SEP.length : 0;
    if (!s.trim) { parts.push(s.text); used += join + s.text.length; return; }
    const room = cap - used - join - reqAfter(i);
    if (room <= 0) return;
    if (s.text.length <= room) { parts.push(s.text); used += join + s.text.length; return; }
    const MORE = '…';
    const kept = [];
    let n = 0;
    for (const ln of s.text.split('\n')) {
      if (n + ln.length + 1 + MORE.length > room) break;
      kept.push(ln); n += ln.length + 1;
    }
    if (kept.length > 1) { const txt = kept.join('\n') + '\n' + MORE; parts.push(txt); used += join + txt.length; }
  });
  const out = parts.join(SEP);
  return out.length > cap ? out.slice(0, cap) : out;
}
/* The few reference rows that matter for THIS question, so a trimmed prompt still carries
   them (the species' full tip, the named area, the technique and the species' regs). */
export function asstFocusNotes(text) {
  const t = (text || '').toLowerCase();
  const out = [];
  const sp = (typeof fishTipsFor === 'function') ? fishTipsFor(t) : null;
  if (sp) out.push('- ' + sp.name + ' — lures/jigs: ' + sp.lures + ' Bait: ' + sp.baits + ' How: ' + sp.method + ' Where/when: ' + sp.where + ' ' + sp.when);
  const area = (typeof areaTipsFor === 'function') ? areaTipsFor(t) : null;
  if (area) out.push('- ' + area.name + ': ' + areaTipText(area));
  const tech = (typeof techniqueTipsFor === 'function') ? techniqueTipsFor(t) : null;
  if (tech) out.push('- ' + tech.name + ': ' + tech.text);
  const reg = asstFindSpecies(t);
  if (reg) out.push('- Regs (general reference — verify with CDFW) ' + reg.name + ': min size ' + reg.size + '; bag ' + reg.bag + (reg.note ? '; ' + reg.note : ''));
  return out.length ? 'MOST RELEVANT TO THIS QUESTION:\n' + out.join('\n') : '';
}
export function asstProxySystem(userText, live) {
  const head = [
    "You are First Mate, a concise, friendly assistant inside an offline marine navigation app for a recreational boater and angler.",
    "Use the LIVE boat data below — prefer it over guessing. Units: nautical miles, knots, °F, feet. Be brief; this is read on a phone on a boat. Lead with the answer.",
    ASST_FORMAT_RULE,
    "A LIVE CONDITIONS / LIVE TIDES block below is real data just fetched for the location it names (the boat, or a place the user asked about). Answer weather, wind, seas, WAVE HEIGHT, SWELL, water-temp and tide questions DIRECTLY from those numbers — report the exact figures (wave_ft, swell_ft, water_temp_f, etc.). This app is hands-free: for the NUMBERS, don't tell the user to open the Weather/Tides panel, check a buoy, or look it up themselves (a go/no-go decision still points to the NWS marine forecast — see Limits). If a wave/swell figure is missing because the point is inland, briefly say so and ask them to name a coastal spot — do not deflect to a panel. Only when NO live block is present at all (fully offline) may you mention the Weather / Tides panels.",
    "You can't place waypoints, start trips, or navigate the map yourself — for those actions, point them to the on-screen buttons.",
    "Fishing regulations are general reference — tell them to confirm current limits with the state agency (CDFW in California) before keeping fish. For emergencies: VHF Channel 16 / Coast Guard and the app's SOS button.",
    "You are a knowledgeable local deckhand with a built-in fishing brain (below): species, lures/jigs/baits, techniques, and area game-plans for Southern & Central California. When asked what to throw, what bait, how to catch something, or what's biting at a spot, answer with SPECIFIC picks from it — don't send them to a local, a guide or google for FISHING ADVICE.",
    ASST_LIMITS_RULE,
  ].join('\n');
  return asstFitSections([
    { text: head },
    { text: live || '' },
    { text: asstSnapshot() },
    { text: asstFocusNotes(userText), trim: true },
    { text: asstTipsTable(), trim: true },
    { text: asstRegsTable(), trim: true },
  ], ASST_PROXY_SYSTEM_CAP);
}

/* Geocode a place name to coordinates via Open-Meteo's free geocoding API.
   Returns { lat, lng, label } or null. */
export async function asstGeocode(name) {
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
      encodeURIComponent(name));
    const j = await r.json();
    if (j && j.results && j.results.length) {
      const g = j.results[0];
      return { lat: g.latitude, lng: g.longitude,
        label: [g.name, g.admin1, g.country_code].filter(Boolean).join(', ') };
    }
  } catch (e) { /* offline / no match */ }
  return null;
}
/* Geocoding matches on name prefix, so a long phrase ("avalon catalina island")
   often misses — retry with progressively shorter prefixes. */
export async function asstGeocodeBest(name) {
  const words = name.split(/\s+/);
  const tries = [name];
  if (words.length > 2) tries.push(words.slice(0, 2).join(' '));
  if (words.length > 1) tries.push(words[0]);
  for (const q of tries) { const g = await asstGeocode(q); if (g) return g; }
  return null;
}
/* If a tool input carries a `place` name (and no explicit coords), geocode it to
   lat/lng so the rest of the tool treats it like any other point. */
export async function asstGeocodeInput(input) {
  input = input || {};
  if (input.place && input.lat == null && input.lng == null) {
    const g = await asstGeocodeBest(String(input.place));
    if (g) return { lat: g.lat, lng: g.lng, place_label: g.label };
    return { error: 'could not find a place called "' + input.place + '"' };
  }
  return input;
}
/* Pull candidate place names out of a location question. Each preposition
   ("in/at/for/near/around/off/by") starts a phrase that runs until a conjunction,
   another preposition, or punctuation — so "near Catalina or around Catalina
   Island" yields ["catalina island", "catalina"] (most-specific first), not one
   messy blob. Returns [] if no place is named. */
export function asstExtractPlaces(t) {
  // words that end a place phrase (conjunctions, prepositions, filler verbs)
  const stop = 'or|and|near|around|at|in|on|off|by|to|from|but|is|are|right|now|today|tonight|tomorrow|please|vs|versus|then';
  const re = new RegExp('\\b(?:in|at|for|near|around|off|by)\\s+([a-z][a-z .\'\\-]*?)(?=\\s+(?:' + stop + ')\\b|[,?.!]|$)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const place = m[1].trim().replace(/\s+/g, ' ');
    if (place.length < 3 || place.length > 40) continue;
    if (/^(the|a|an|my|this|that|here|there|now|today|tonight|tomorrow|anchor|sea|shore|home|noon|dawn|dusk|night|morning|afternoon|evening|dark|light)\b/.test(place)) continue;
    if (/\b(week|day|days|morning|afternoon|evening|night|hour|minute)s?\b/.test(place)) continue;
    out.push(place);
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);   // most-specific (longest) first
}

/* The free proxy brain has no tools, so it can't fetch live data on its own.
   When the user's question needs conditions or tides, fetch them client-side
   (reusing the same tool functions the keyed AI uses) and hand the numbers to
   the proxy so it can answer hands-free instead of punting to the app's panels.
   If the user names a place ("weather in Avalon"), geocode it and fetch there. */
export async function asstProxyLiveContext(userText, botId) {
  const t = (userText || '').toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  const wantWx = has('weather', 'wind', 'windy', 'gust', 'breeze', 'conditions', 'forecast',
    'wave', 'swell', 'seas', 'surf', 'chop', 'rough', 'sea state', 'small craft',
    'temp', 'temperature', 'how warm', 'how cold', 'hot out', 'cold out', 'degrees', 'humid',
    'sst', 'fishable', 'go out', 'too rough', 'how rough', 'safe to go');
  const wantTide = has('tide', 'high tide', 'low tide', 'slack', 'ebb', 'flood');
  if (!wantWx && !wantTide) return '';

  // Resolve the target location, in priority order:
  //  1) a place named in THIS message (geocoded, most-specific candidate first)
  //  2) if the user explicitly means "here" → the boat, and forget the last place
  //  3) otherwise reuse the last place asked about this session, so a follow-up
  //     like "what's the swell?" after "...near Catalina" still means Catalina
  //  4) fall back to the boat's own position
  const wantHere = has('where i am', 'where am i', ' here', 'my location', 'current position',
    'my position', 'my spot', 'where we are', 'my area', 'right here');
  let loc = {}, forWhere = "the boat's position", named = false;
  for (const name of asstExtractPlaces(t)) {
    // A fish species after "for" ("weather for yellowtail…") is not a place — skip
    // it so we don't geocode "yellowtail" to Yellowtail, Montana.
    if (typeof fishTipsFor === 'function' && fishTipsFor(name)) continue;
    asstProgress(botId, 'locating ' + name);
    const g = await asstGeocodeBest(name);
    if (g) {
      loc = { lat: g.lat, lng: g.lng }; forWhere = g.label; named = true;
      ASST.lastLoc = { lat: g.lat, lng: g.lng, label: g.label };
      break;
    }
  }
  if (wantHere) { ASST.lastLoc = null; }
  else if (!named && ASST.lastLoc) { loc = { lat: ASST.lastLoc.lat, lng: ASST.lastLoc.lng }; forWhere = ASST.lastLoc.label; }

  const wantMarine = has('wave', 'swell', 'seas', 'surf', 'chop', 'sea state');
  const blocks = [];
  try {
    if (wantWx) {
      asstProgress(botId, 'checking conditions');
      const c = await asstToolConditions(loc);
      if (c && !c.error) {
        let b = 'LIVE CONDITIONS — just fetched for ' + forWhere + ' ' + (c.position || '') +
          ' (wave_ft = total seas, swell_ft = groundswell only):\n' + JSON.stringify(c);
        // Inland points have no ocean wave/swell — tell the model to ask for a
        // coastal spot rather than punt the user to a panel.
        if (wantMarine && c.wave_ft == null)
          b += "\n(No ocean wave/swell here — this point is inland or outside the marine grid. " +
            "Say so briefly and ASK the user which coastal spot they mean, e.g. \"near Catalina\". Do NOT tell them to open a panel.)";
        blocks.push(b);
      }
    }
    if (wantTide) {
      asstProgress(botId, 'checking tides');
      const td = await asstToolTides(loc);
      if (td && !td.error) blocks.push('LIVE TIDES — just fetched for ' + forWhere + ':\n' + JSON.stringify(td));
    }
  } catch (e) { /* offline / unreachable — proxy falls back to advising */ }
  return blocks.length ? blocks.join('\n\n') : '';
}

/* What the Worker forwards to the model (proxy/first-mate-worker.js — keep the numbers in step;
   a unit test runs this body through the Worker and checks it keeps every character): the system
   prompt within 8000 characters and 3000 estimated tokens, then the newest messages — at most 12,
   4000 characters each — while the whole input stays within 4000 estimated tokens. Sending more
   only costs upload on one bar of signal. The Worker also refuses bodies over 64 KB, and that is
   counted in bytes: CJK text is 3 bytes a character and every quote and newline is escaped, so a
   few long pasted passages used to push the history over it — a 413 on every later question,
   however short, until the chat was cleared. So the body is measured too, and the oldest history
   dropped until it fits. With history gone the rest always fits: our own system prompt escapes to
   ~16 KB at most, and a 4000-character question to 24 KB even if every character is escaped. */
export const ASST_PROXY_MAX_MESSAGES = 12;
export const ASST_PROXY_MSG_CAP = 4000;
export const ASST_PROXY_SYSTEM_TOKENS = 3000;
export const ASST_PROXY_INPUT_TOKENS = 4000;
export const ASST_PROXY_MAX_BODY = 60 * 1024;     // bytes; the Worker's cap is 64 KB
/** Estimated tokens, on the high side (the Worker's own estimate): ~4 ASCII characters a token,
 *  every other UTF-16 unit (accents, CJK, emoji halves) a token of its own. */
export function asstEstTokens(s) {
  let ascii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 4) + (s.length - ascii);
}
// The longest start of `s` within `max` estimated tokens, never splitting a surrogate pair.
function asstCutToTokens(s, max) {
  if (asstEstTokens(s) <= max) return s;
  let ascii = 0, other = 0, i = 0;
  for (; i < s.length; i++) {
    if (s.charCodeAt(i) < 128) ascii++; else other++;
    if (Math.ceil(ascii / 4) + other > max) break;
  }
  if (i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800) i--;
  return s.slice(0, i);
}
/** The relay request body: the system prompt and the newest `messages` (oldest first, the
 *  question last) that the Worker keeps, within its byte cap. The question always goes. */
export function asstProxyBody(system, messages) {
  const sys = asstCutToTokens(String(system || '').slice(0, ASST_PROXY_SYSTEM_CAP), ASST_PROXY_SYSTEM_TOKENS);
  let room = ASST_PROXY_INPUT_TOKENS - asstEstTokens(sys);
  const sent = [];
  for (let i = messages.length - 1; i >= 0 && sent.length < ASST_PROXY_MAX_MESSAGES; i--) {
    let content = String(messages[i].content).slice(0, ASST_PROXY_MSG_CAP);
    if (asstEstTokens(content) > room) {
      if (sent.length) break;                            // older history that doesn't fit stays home
      content = asstCutToTokens(content, room);
    }
    room -= asstEstTokens(content);
    sent.unshift({ role: messages[i].role, content });
  }
  const encode = (msgs) => JSON.stringify({ system: sys, messages: msgs });
  let body = encode(sent);
  while (sent.length > 1 && new TextEncoder().encode(body).length > ASST_PROXY_MAX_BODY) {
    sent.shift();
    body = encode(sent);
  }
  return body;
}

/* ---- Relay back-off ----
   The relay answers 429 when this connection asks faster than its per-client limit, and 503
   when Workers AI can't answer (out of capacity, or the account's free daily allowance is
   spent), both carrying { retryAfter } in seconds. Asking again at once fails the same way and,
   across every boat on the water, keeps a struggling relay pinned — so that route is skipped
   until then and First Mate answers on the phone straight away. A reply that never came
   (timeout) holds briefly too, so the next question doesn't hang another 90 s. A plain
   connection failure doesn't hold: it never reached the relay, and it fails fast. Chat and
   /tts are limited separately by the Worker, so each route holds on its own. */
export const ASST_RELAY_WAIT_MIN_S = 5;
export const ASST_RELAY_WAIT_MAX_S = 30 * 60;   // a spent allowance says "until 00:00 UTC"; look again sooner
export const ASST_RELAY_SLOW_WAIT_S = 60;
/** Seconds to wait after a 429/503: the JSON retryAfter, else the Retry-After header, else `dflt` — clamped. */
export function asstRetryAfterS(resp, j, dflt) {
  let s = Number(j && j.retryAfter);
  if (!(s > 0)) s = Number(resp && resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('Retry-After') : NaN);
  if (!(s > 0)) s = dflt;
  return Math.min(ASST_RELAY_WAIT_MAX_S, Math.max(ASST_RELAY_WAIT_MIN_S, Math.ceil(s)));
}
/** Hold a relay route ('chat' | 'tts') for `seconds`; why = 'busy' (429) | 'down' (503) | 'slow' (timeout). */
export function asstRelayHold(route, seconds, why) {
  ASST._relayHold = ASST._relayHold || {};
  ASST._relayHold[route] = { until: Date.now() + seconds * 1000, why };
  return { why, waitS: seconds };
}
/** The hold still in force on a route, as { why, waitS }, or null. */
export function asstRelayHeld(route) {
  const h = ASST._relayHold && ASST._relayHold[route];
  if (!h) return null;
  const waitS = Math.ceil((h.until - Date.now()) / 1000);
  return waitS > 0 ? { why: h.why, waitS } : null;
}
// The fetch deadline in app.js reports 'timed out after Ns'; a raw abort means the same.
function asstTimedOut(e) {
  return !!e && (e.name === 'AbortError' || e.name === 'TimeoutError' || /timed out/i.test(String(e.message)));
}
/* A non-OK relay reply as an error to throw. The relay's own `error` text is deliberately not
   carried: the bubble says what happened in our words (asstRelayFailHead). */
async function asstRelayFailure(resp, route) {
  let j = null;
  try { j = await resp.json(); } catch (e) { /* not JSON */ }
  const err = new Error('relay ' + resp.status);
  err.status = resp.status;
  /* 403 = the relay refused this origin (e.g. an older Worker that only knows the website). The
     Worker echoes even a refused origin for CORS so this is readable, not a failed preflight that
     looks like no signal. Retrying every question would show the same error each time, so stop
     offering the relay for this session — chat and the cloud voice alike: the status drops to
     Data mode and answers come from the phone. Saving the endpoint setting re-enables it. */
  if (resp.status === 403) ASST._proxyBlocked = true;
  else if (resp.status === 429) err.relay = asstRelayHold(route, asstRetryAfterS(resp, j, 60), 'busy');
  else if (resp.status === 503) err.relay = asstRelayHold(route, asstRetryAfterS(resp, j, 60), 'down');
  return err;
}
export function asstWaitText(s) {
  if (s < 60) return 'in under a minute';
  if (s < 90) return 'in about a minute';
  return 'in about ' + Math.round(s / 60) + ' min';
}
/* First line of the red bubble when the relay didn't answer. Never the relay's or the
   browser's own text ("Failed to fetch", a model trace) — what happened, and when to retry. */
export function asstRelayFailHead(e) {
  const r = e && e.relay;
  if (r) {
    const when = 'try again ' + asstWaitText(r.waitS);
    if (r.why === 'busy') return 'The free AI is busy (' + when + '). Offline answer:';
    if (r.why === 'slow') return "The free AI didn't answer in time (" + when + '). Offline answer:';
    return 'The free AI is unavailable right now (' + when + '). Offline answer:';
  }
  if (e && e.empty) return 'The free AI sent back an empty answer. Offline answer:';
  const s = e && e.status;
  // 413 can't come from the FishApp relay any more (asstProxyBody fits its cap); a relay with a smaller one can.
  const why = s === 403 ? 'the free AI relay refused this app'
    : s === 413 ? 'the conversation is too long — Clear chat and ask again'
      : s ? 'relay error ' + s
        : 'no connection';
  return "Couldn't reach the AI (" + why + '). Offline answer:';
}

export async function asstAskProxy(userText, botId) {
  // Inside a back-off the relay asked for: don't ask it, or fetch live data for it.
  const held = asstRelayHeld('chat');
  if (held) { const err = new Error('relay held'); err.relay = held; throw err; }
  const live = await asstProxyLiveContext(userText, botId);
  asstProgress(botId, '');
  const messages = ASST.history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });
  const system = asstProxySystem(userText, live);
  let resp;
  try {
    resp = await fetch(asstProxyUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: asstProxyBody(system, messages),
      timeoutMs: 90000,        // a model reply is slower than a data API, but not unbounded
    });
  } catch (e) {
    const err = new Error('relay unreachable');
    if (asstTimedOut(e)) err.relay = asstRelayHold('chat', ASST_RELAY_SLOW_WAIT_S, 'slow');
    throw err;
  }
  if (!resp.ok) throw await asstRelayFailure(resp, 'chat');   // 403 also stops offering the relay
  /* An empty (or unreadable) reply used to land in the chat as a bare "(no reply)" — and go
     into the history sent with every later question. It is a failed answer: asstSend shows the
     offline one under a line saying what happened. */
  const j = await resp.json();     // not JSON (a captive portal's page) → "no connection"
  const reply = String((j && j.reply) || '').trim();
  if (!reply) { const err = new Error('empty reply'); err.empty = true; throw err; }
  return reply;
}

/* Adaptive thinking is on every model in the picker (Opus 5.5, Sonnet 5.5, Haiku 5.5) and on
   the 4.6+ family. Haiku 4.5 — in the old picker — rejected it with a 400, so this stays gated
   for any older id still saved somewhere. Fixed `budget_tokens` is removed on the current
   models and we deliberately don't reintroduce it. */
export function asstSupportsThinking(model) {
  return /^claude-(opus-4-(6|7|8)|opus-5|sonnet-5|sonnet-4-6|haiku-5|fable-5|mythos-5)/.test(model || '');
}
/* Server-side refusal fallback ('default' routing). Offered on Opus 5.5 and Sonnet 5.5;
   Haiku 5.5 has none (sending it would just stay declined). */
export function asstSupportsFallback(model) {
  return model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
}
export const ASST_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export async function asstApiCall(messages, system) {
  const model = ASST.model();
  const body = {
    model: model,
    /* Was 1024, which truncated longer answers mid-sentence. Thinking tokens also count
       against this, so it needs real headroom. Kept below the streaming threshold since
       these are plain non-streaming requests. */
    max_tokens: 16000,
    /* Built ONCE per question by the caller, not per tool round: the snapshot carries a
       timestamp and the spot list, and changing `system` mid-loop while thinking blocks are
       replayed breaks the API's preserved-thinking check. */
    system: system || asstSystemPrompt(),
    tools: asstTools(),
    messages,
  };
  /* Let Claude decide how much to reason per question — a tide lookup stays cheap while
     "is it too rough to cross tomorrow" gets real thought. Effort is pinned to `high` (the
     legacy default) because Opus 5.5 and Haiku 5.5 now default to `medium`. The reasoning
     itself isn't displayed, so no `display` opt-in is needed. */
  if (asstSupportsThinking(model)) {
    body.thinking = { type: 'adaptive' };
    body.output_config = { effort: 'high' };
  }
  const headers = {
    'content-type': 'application/json',
    'x-api-key': ASST.key(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  /* A safety classifier can decline a benign boating question (HTTP 200, stop_reason
     'refusal'); 'default' fallbacks re-run it on Anthropic's recommended model instead. */
  if (asstSupportsFallback(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = ASST_FALLBACK_BETA;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeoutMs: 120000,       // thinking + tool rounds are slow; still bounded
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
    const err = new Error(msg); err.status = resp.status; throw err;
  }
  return resp.json();
}

/* Agentic loop: let Claude answer, or call tools (which act on the app / fetch
   live data), feed results back, and repeat until it produces a final answer. */
export async function asstAskOnline(userText, botId) {
  const messages = ASST.history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });
  const system = asstSystemPrompt();

  let finalText = '';
  const didTools = [];      // what actually ran, so a truncated loop can still report
  for (let step = 0; step < 6; step++) {
    const data = await asstApiCall(messages, system);
    /* A decline (even after the server-side fallback) is not an answer — check it before
       reading content. asstSend falls back to the offline engine and says the AI declined. */
    if (data.stop_reason === 'refusal') {
      const err = new Error('declined'); err.refusal = true; err.didTools = didTools.slice(); throw err;
    }
    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });   // unchanged, thinking blocks included
      const results = [];
      for (const b of data.content) {
        if (b.type !== 'tool_use') continue;
        asstProgress(botId, asstToolLabel(b.name));
        const out = await asstExecTool(b.name, b.input || {});
        if (!(out && out.error)) didTools.push(asstToolLabel(b.name));
        results.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
          is_error: !!(out && out.error),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    finalText = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    break;
  }
  if (finalText) return finalText;
  /* Running out of steps mid-task used to return a bare "(no reply)" — after the
     waypoint was created, the layer toggled and the trip started. Real, persistent
     changes with no indication they'd happened. Say what was done. */
  if (didTools.length) {
    const uniq = didTools.filter((v, i) => didTools.indexOf(v) === i);
    return "I ran out of steps before finishing that one. Here's what I did do: " +
      uniq.join(', ') + '.\n\nAsk me again — more simply, or one part at a time.';
  }
  // Nothing said and nothing done: a failed answer, not "(no reply)" (see asstAskProxy).
  const err = new Error('empty reply'); err.empty = true; throw err;
}

export function asstToolLabel(n) {
  return {
    get_conditions: 'checking conditions', get_tides: 'checking tides',
    place_waypoint: 'placing waypoint', list_waypoints: 'reading waypoints',
    delete_waypoint: 'removing waypoint', toggle_layer: 'toggling layer',
    set_trip: 'updating trip', go_to: 'centering the map',
    get_area_intel: 'reading offline area data',
  }[n] || 'working';
}

export function asstToolAreaIntel(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position' };
  const a = (typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
  if (!a || !a.data) return { error: 'no downloaded area pack covers this location — the user can download this area (Offline charts) while online to capture its data.' };
  return areaPackSummary(a);
}

/* ---- Tool schemas handed to Claude ---- */
export function asstTools() {
  return [
    { name: 'get_conditions', description: 'Live marine weather at a point: wind, gusts, air temp, total wave height/period/direction, swell height/period/direction (the groundswell component), and sea-surface water temp. Defaults to the boat\'s current position. For any OTHER location the user names (e.g. "weather in Avalon"), pass its name as `place` — it will be geocoded — instead of guessing coordinates.',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, place: { type: 'string', description: 'A place name to look up instead of the boat position' } } } },
    { name: 'get_tides', description: 'Today\'s high/low tide predictions for the nearest tide station. Defaults to the boat\'s position; pass `place` (a place name, geocoded) or lat/lng for somewhere else.',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, place: { type: 'string', description: 'A place name to look up instead of the boat position' } } } },
    { name: 'place_waypoint', description: 'Drop and save a named waypoint/spot on the map. Defaults to the boat\'s current position unless lat/lng are given. Without a GPS fix it falls back to the map center — the result says so (position_source), and you must tell the user.',
      input_schema: { type: 'object', properties: {
        name: { type: 'string', description: 'Waypoint name' },
        type: { type: 'string', enum: ['fish', 'anchor', 'hazard', 'ramp', 'wreck', 'other'], description: 'Marker type (default fish)' },
        notes: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['name'] } },
    { name: 'list_waypoints', description: 'List the user\'s saved waypoints with distance & bearing from the boat.',
      input_schema: { type: 'object', properties: {} } },
    { name: 'delete_waypoint', description: 'Delete a saved waypoint by (partial) name.',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'toggle_layer', description: 'Turn a map overlay on or off.',
      input_schema: { type: 'object', properties: {
        layer: { type: 'string', enum: ['sst', 'rain', 'wind', 'reefs', 'mpa', 'fish'], description: 'sst=water temp, rain=radar, wind=wind arrows, reefs=artificial reefs, mpa=protected areas, fish=recent catches' },
        on: { type: 'boolean' } }, required: ['layer', 'on'] } },
    { name: 'set_trip', description: 'Start or stop trip tracking (distance, average & max speed).',
      input_schema: { type: 'object', properties: { active: { type: 'boolean' }, reset: { type: 'boolean' } }, required: ['active'] } },
    { name: 'go_to', description: 'Center the map on the boat, a named saved spot, or coordinates.',
      input_schema: { type: 'object', properties: { spot: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } },
    { name: 'get_area_intel', description: 'Read the OFFLINE data pack for a downloaded area covering a point (default current position): multi-day wind/wave/tide/water-temp forecast, a sea-temp grid (warmest/coolest water), recent fish-sighting history, and protected-area closures — all captured when the area was downloaded. Use this for area questions when offline, for a multi-day outlook, or for historical fish patterns and closures.',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  ];
}

export function asstPointFrom(input) {
  if (input && input.lat != null && input.lng != null && typeof L !== 'undefined') return L.latLng(input.lat, input.lng);
  return asstPos().ll;
}

export async function asstExecTool(name, input) {
  try {
    switch (name) {
      case 'get_conditions': return await asstToolConditions(input);
      case 'get_tides': return await asstToolTides(input);
      case 'place_waypoint': return await asstToolPlaceWaypoint(input);
      case 'list_waypoints': return asstToolListWaypoints();
      case 'delete_waypoint': return await asstToolDeleteWaypoint(input);
      case 'toggle_layer': return asstToolToggleLayer(input);
      case 'set_trip': return asstToolSetTrip(input);
      case 'go_to': return asstToolGoTo(input);
      case 'get_area_intel': return asstToolAreaIntel(input);
      default: return { error: 'unknown tool ' + name };
    }
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

export async function asstToolConditions(input) {
  input = await asstGeocodeInput(input);
  if (input && input.error) return input;
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position — provide lat and lng' };
  const lat = ll.lat, lng = ll.lng;
  const out = { position: lat.toFixed(4) + ', ' + lng.toFixed(4) };
  if (input && input.place_label) out.place = input.place_label;
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=kn&temperature_unit=fahrenheit');
    const c = (await r.json()).current || {};
    /* An error body ({error:true,reason:…}) yields {} here without throwing, and
       Math.round(undefined) is NaN — which was handed to the model as a real
       reading. Missing must stay missing. */
    if (c.wind_speed_10m == null) throw new Error('no current data');
    out.wind_kn = Math.round(c.wind_speed_10m);
    if (c.wind_gusts_10m != null) out.gust_kn = Math.round(c.wind_gusts_10m);
    if (c.wind_direction_10m != null) out.wind_from = asstCompass(c.wind_direction_10m) + ' (' + Math.round(c.wind_direction_10m) + '°)';
    if (c.temperature_2m != null) out.air_temp_f = Math.round(c.temperature_2m);
  } catch (e) { out.wind = 'unavailable (offline?)'; }
  try {
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lng +
      '&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&temperature_unit=fahrenheit');
    const c = (await r.json()).current || {};
    if (c.wave_height != null) {
      out.wave_ft = +(c.wave_height * 3.28084).toFixed(1);   // total significant wave height (wind sea + swell)
      out.wave_period_s = Math.round(c.wave_period);
      out.wave_from = asstCompass(c.wave_direction);
    }
    if (c.swell_wave_height != null) {
      out.swell_ft = +(c.swell_wave_height * 3.28084).toFixed(1);   // swell component only (longer-period groundswell)
      out.swell_period_s = Math.round(c.swell_wave_period);
      out.swell_from = asstCompass(c.swell_wave_direction);
    }
    if (c.sea_surface_temperature != null) out.water_temp_f = Math.round(c.sea_surface_temperature);
  } catch (e) { /* marine may be unavailable inland */ }
  return out;
}

export async function asstToolTides(input) {
  input = await asstGeocodeInput(input);
  if (input && input.error) return input;
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position' };
  if (typeof nearestTideStation !== 'function') return { error: 'tides unavailable' };
  const st = nearestTideStation(ll);
  if (!st) return { error: 'no tide station found' };
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  try {
    const r = await fetch(coopsHiLoUrl(st.id, ymd, ymd));
    const preds = ((await r.json()).predictions || []).map((p) => ({
      time: p.t.split(' ')[1], type: p.type === 'H' ? 'High' : 'Low', height_ft: +parseFloat(p.v).toFixed(1),
    }));
    const nm = nmBetween(ll, L.latLng(st.la, st.lo));
    return { station: st.n, distance_nm: +nm.toFixed(0), today: preds };
  } catch (e) { return { station: st.n, error: 'could not fetch tide predictions' }; }
}

/* Where a waypoint lands, in words. Without a fix the tool used to fall back to the map
   center silently — the user was told "saved" about a pin on whatever water the map showed.
   voice.js refuses outright (nobody is looking at the screen); here someone is reading the
   reply, so it saves and SAYS so. */
export function asstPositionSource(input) {
  if (input && input.lat != null && input.lng != null) return 'given coordinates';
  const p = asstPos();
  if (!p.ll) return null;
  if (!p.live) return 'map center — no GPS fix yet';
  if (p.stale) return 'last known GPS fix, ' + asstFixAgeText() + ' — the boat may have moved';
  return 'live GPS';
}
export async function asstToolPlaceWaypoint(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position available — provide lat and lng' };
  const name = (input.name || '').trim();
  if (!name) return { error: 'name is required' };
  const source = asstPositionSource(input) || 'map center — no GPS fix yet';
  const spot = await asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: input.type || 'fish', notes: input.notes || '' });
  const guessed = source !== 'live GPS' && source !== 'given coordinates';
  if (typeof toast === 'function') toast(name + ' saved' + (guessed ? ' (' + source + ')' : ''));
  const out = { ok: true, name: name, type: spot.type, lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5), position_source: source };
  if (guessed) out.note = 'Not placed from a live GPS fix (' + source + ') — tell the user, and suggest moving it in Spots if it is in the wrong place.';
  return out;
}

export function asstToolListWaypoints() {
  if (typeof Spots === 'undefined' || !Spots.all.length) return { waypoints: [] };
  const p = asstPos().ll;
  return { waypoints: Spots.all.map((s) => {
    const o = { name: s.name, type: s.type, lat: +s.lat.toFixed(5), lng: +s.lng.toFixed(5) };
    if (s.notes) o.notes = s.notes;
    if (p) { o.nm = +nmBetween(p, L.latLng(s.lat, s.lng)).toFixed(2); o.bearing = Math.round(bearingBetween(p, L.latLng(s.lat, s.lng))); }
    return o;
  }) };
}

/* Deletes the first (partial) name match with NO confirmation of its own, unlike the Spots UI —
   preserved knowingly (the user asked the AI to do it). If deleteSpot now confirms on its own
   and the user keeps the spot, report that instead of claiming it's gone. */
export async function asstToolDeleteWaypoint(input) {
  const q = (input.name || '').toLowerCase().trim();
  if (!q) return { error: 'name required' };
  if (typeof Spots === 'undefined') return { error: 'spots unavailable' };
  const matches = Spots.all.filter((s) => s.name && s.name.toLowerCase().includes(q));
  if (!matches.length) return { error: 'no waypoint matching "' + input.name + '"' };
  const s = matches[0];
  await deleteSpot(s.id);
  if (Spots.all.some((x) => x.id === s.id)) return { error: 'the user kept "' + s.name + '" (deletion cancelled)' };
  if (typeof toast === 'function') toast(s.name + ' deleted');
  return { deleted: s.name, other_matches: matches.length - 1 };
}

export const ASST_LAYERS = ['sst', 'rain', 'wind', 'reefs', 'mpa', 'fish'];
export function asstToolToggleLayer(input) {
  if (ASST_LAYERS.indexOf(input.layer) < 0) return { error: 'unknown layer "' + input.layer + '"' };
  const want = !!input.on;
  /* Same entry point as the Layers sheet (it replaced ticking the #ovl-* checkbox and firing a
     synthetic change event), so a module that refuses — SST or rain with no signal — still
     refuses here and leaves the toggle OFF. Report what actually happened. */
  if (!!layersStore.getState()[input.layer] !== want) setDataOverlay(input.layer, want);
  const now = !!layersStore.getState()[input.layer];
  const out = { layer: input.layer, on: now };
  if (now !== want) out.note = 'the app could not turn this layer ' + (want ? 'on' : 'off') + ' (it may need an internet connection)';
  return out;
}

export function asstToolSetTrip(input) {
  if (typeof Nav === 'undefined' || !Nav.trip || typeof tripToggle !== 'function') return { error: 'trip tracking unavailable' };
  const want = !!input.active;
  if (want && !Nav.trip.active) tripToggle();
  else if (!want && Nav.trip.active) tripToggle();
  if (input.reset && typeof tripReset === 'function') tripReset();
  const avg = Nav.trip.nKn ? (Nav.trip.sumKn / Nav.trip.nKn) : 0;
  return { trip_active: Nav.trip.active, distance_nm: +Nav.trip.dist.toFixed(2), avg_kn: +avg.toFixed(1), max_kn: +Nav.trip.maxKn.toFixed(1) };
}

export function asstToolGoTo(input) {
  const map = getMap();
  if (!map) return { error: 'map unavailable' };
  let ll = null, label = '';
  if (input.lat != null && input.lng != null) { ll = L.latLng(input.lat, input.lng); label = 'coordinates'; }
  else if (input.spot && typeof Spots !== 'undefined') {
    const s = Spots.all.find((x) => x.name && x.name.toLowerCase().includes(String(input.spot).toLowerCase()));
    if (!s) return { error: 'no saved spot matching "' + input.spot + '"' };
    ll = L.latLng(s.lat, s.lng); label = s.name;
  } else { const p = asstPos(); if (p.ll) { ll = p.ll; label = 'your position'; } }
  if (!ll) return { error: 'no target to center on' };
  if (typeof setFollow === 'function') setFollow(false);
  mapProgrammatic(() => map.setView(ll, Math.max(map.getZoom(), 14)));
  return { centered_on: label };
}

/* ================= transcript plumbing (store, not DOM) ================= */
let _msgSeq = 1;
/* Bot text never carries emoji (DESIGN.md): the offline answers are written clean, and this
   backstop catches AI replies, species/knot data and anything else. An emoji plus the space
   after it goes, so "X marks" stays readable; line breaks and indentation are kept. */
export const ASST_EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}](?:\u{FE0F}|\u{200D}|\u{20E3})*)+[ \t]?|\u{FE0F}|\u{20E3}/gu;
export function asstCleanText(text) {
  return String(text == null ? '' : text).replace(ASST_EMOJI_RE, '');
}
/** Split a reply into plain and **bold** runs — the only markup the transcript renders. */
export function asstSplitBold(text) {
  const out = [];
  const re = /\*\*([^*\n][^*]*?)\*\*/g;
  let last = 0, m;
  const s = String(text == null ? '' : text);
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out;
}
/** Append a message; returns its id (legacy returned the bubble element). */
export function asstAddMsg(role, text, extra) {
  const m = Object.assign({ id: _msgSeq++, role: role, text: role === 'bot' ? asstCleanText(text) : String(text) }, extra || {});
  asstStore.setState((s) => ({ messages: s.messages.concat([m]) }));
  return m.id;
}
export function asstUpdateMsg(id, patch) {
  const p = Object.assign({}, patch);
  if (p.text != null) p.text = asstCleanText(p.text);
  asstStore.setState((s) => {
    if (!s.messages.some((m) => m.id === id)) return s;   // cleared meanwhile — nothing to write into
    return { messages: s.messages.map((m) => (m.id === id ? Object.assign({}, m, p) : m)) };
  });
}
/* What an in-flight reply is doing ("checking conditions"); '' = just thinking. */
export function asstProgress(botId, label) {
  if (botId == null) return;
  asstUpdateMsg(botId, { progress: label || '' });
}

/* ---- Voice: speak answers (TTS, works offline incl. iPhone) + voice input (STT) ---- */
export function asstStripForSpeech(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]|\u{FE0F}|\u{20E3}/gu, ' ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/* Cloud voice is usable only with a proxy configured AND signal — offshore it silently
   reverts to the device voice, which is the whole reason the device path stays. It also
   needs cloud AI ALLOWED (consent 'yes'), not merely "not refused": the spoken text — which
   includes hands-free readouts such as "You are at <lat, lng>" from voice.js — goes to the
   relay, so a user who was never asked (or a legacy build's saved cloudvoice='1') keeps the
   device voice until they allow cloud AI. */
export function asstCloudVoiceOn() {
  return localStorage.getItem('fishapp.asst.cloudvoice') === '1' && asstCloudVoiceUsable();
}
export function asstCloudVoiceUsable() {
  return !!asstProxyUrl() && !ASST._proxyBlocked && navigator.onLine && asstCloudConsent() === 'yes';
}
export function asstStopSpeech() {
  /* Clearing this is what actually cancels an in-flight cloud utterance: the /tts
     fetch may still be running, and checking ASST.speak on arrival isn't enough
     because hands-free legitimately speaks one reply while the toggle reads off. */
  ASST._speakWanted = false;
  ASST._speakGen = (ASST._speakGen || 0) + 1;
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  if (ASST._audio) { try { ASST._audio.pause(); } catch (e) {} ASST._audio = null; }
}
export function asstSpeak(text) {
  if (!ASST.speak) return;
  asstSpeakNow(text);
}
/* The ungated path — asstSpeak minus the Speak-toggle check. The settings "This is how I
   sound" test uses it with the voice being chosen (not yet saved), so the sample plays even
   with Speak off (legacy only sampled on Save, and silently did nothing with Speak off). */
export function asstSpeakNow(text, opts) {
  const clean = asstStripForSpeech(text).slice(0, 700);
  if (!clean) return;
  asstStopSpeech();          // clears _speakWanted…
  ASST._speakWanted = true;  // …so re-arm for the utterance we're about to start
  const o = opts || {};
  const cloud = o.cloud != null ? (!!o.cloud && asstCloudVoiceUsable()) : asstCloudVoiceOn();
  if (cloud) asstSpeakCloud(clean, o.voice);
  else asstSpeakDevice(clean, o.voice);
}
export function asstSpeakDevice(clean, voice) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US'; u.rate = 1; u.pitch = 1;
    const v = voice || ASST._voice;
    if (v) u.voice = v;
    /* Hold the mic shut for however long this takes. Only the cloud path used to do
       this, so on the device voice — offline, or with no TTS key — the recogniser
       went live partway through the reply and could hear "OK, fish are…" as the
       "hey fish" wake word and answer its own answer, in a loop. */
    if (typeof Voice !== 'undefined') {
      const est = 1200 + (clean.length / 14) * 1000;   // ~14 chars/sec of speech
      Voice._muteUntil = Math.max(Voice._muteUntil || 0, Date.now() + est);
      u.onend = u.onerror = () => { Voice._muteUntil = Date.now() + 700; };
    }
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
/* Natural speech via the Worker's /tts route. Every failure path — no key on the Worker
   (501), no signal, blocked autoplay — falls back to the device voice rather than leaving
   the user in silence, which underway is worse than a robotic voice. */
export async function asstSpeakCloud(clean, deviceVoice) {
  const gen = ASST._speakGen = (ASST._speakGen || 0) + 1;
  // The relay asked for a pause (asstRelayHold): speak on the device now instead of asking again.
  if (asstRelayHeld('tts')) { asstSpeakDevice(clean, deviceVoice); return; }
  try {
    let r;
    try {
      r = await fetch(asstProxyUrl().replace(/\/+$/, '') + '/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: clean, voice: localStorage.getItem('fishapp.asst.ttsvoice') || undefined }),
      });
    } catch (e) {
      // Only the request's own deadline holds — play() below can also reject with an AbortError.
      if (asstTimedOut(e)) asstRelayHold('tts', ASST_RELAY_SLOW_WAIT_S, 'slow');
      throw e;
    }
    if (!r.ok) throw await asstRelayFailure(r, 'tts');
    const blob = await r.blob();
    if (gen !== ASST._speakGen) return;              // a newer utterance superseded this one
    if (!ASST._speakWanted) return;                  // muted while this was in flight
    const audio = new Audio(URL.createObjectURL(blob));
    ASST._audio = audio;
    /* Hold the mic muted for the REAL audio length rather than a guess from character
       count — otherwise Hey Fish hears the tail of its own reply and answers itself. */
    audio.addEventListener('loadedmetadata', () => {
      if (typeof Voice !== 'undefined' && isFinite(audio.duration)) {
        Voice._muteUntil = Date.now() + audio.duration * 1000 + 700;
      }
    });
    audio.addEventListener('ended', () => {
      if (ASST._audio === audio) ASST._audio = null;
      try { URL.revokeObjectURL(audio.src); } catch (e) {}
    });
    await audio.play();
  } catch (e) {
    if (gen === ASST._speakGen) asstSpeakDevice(clean, deviceVoice);   // never fail silent
  }
}
/* Rank installed voices by how human they sound.

   The single biggest factor is out of our hands: iOS ships only "compact" quality voices by
   default, and those are the robotic ones. The natural variants (Enhanced / Premium) have to
   be downloaded by the user in Settings → Accessibility → Spoken Content → Voices. We can
   only choose among what's actually installed, so rank and take the best available — and let
   the user override the choice, since which voices exist differs per device. */
export function asstVoiceScore(v) {
  const n = v.name || '';
  let s = 0;
  if (/enhanced|premium|neural/i.test(n)) s += 100;   // the natural-sounding downloads
  if (/siri/i.test(n)) s += 60;
  if (/\b(ava|allison|samantha|joelle|nicky|zoe|evan|noelle|tom)\b/i.test(n)) s += 30;
  if (/compact/i.test(n)) s -= 50;                    // explicitly the robotic ones
  if (/en[-_]US/i.test(v.lang)) s += 20;
  else if (/^en/i.test(v.lang)) s += 10;
  if (v.localService) s += 5;                         // local = no network hitch mid-sentence
  return s;
}
export const ASST_NATURAL_RE = /enhanced|premium|neural/i;
export function asstVoiceList() {
  if (!('speechSynthesis' in window)) return [];
  return (window.speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang));
}
export function asstPickVoice() {
  if (!('speechSynthesis' in window)) return;
  const pick = () => {
    const vs = asstVoiceList();
    if (!vs.length) return;                            // iOS populates this asynchronously
    const saved = localStorage.getItem('fishapp.asst.voice');
    ASST._voice = (saved && vs.find((v) => v.name === saved)) ||
      vs.slice().sort((a, b) => asstVoiceScore(b) - asstVoiceScore(a))[0] || null;
    asstFillVoicePicker();
  };
  pick();
  /* Fires once the list is ready. A listener rather than assigning onvoiceschanged, so it
     never clobbers (or gets clobbered by) another module's handler. */
  if (!ASST._voicesHooked) {
    ASST._voicesHooked = true;
    const ss = window.speechSynthesis;
    if (typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', pick);
    else ss.onvoiceschanged = pick;
  }
}
/** Which honest hint the voice picker shows (the copy lives in the panel). */
export function asstVoiceHintKind(names, current, iOS) {
  if (!names.length) return 'none';
  if (names.some((n) => ASST_NATURAL_RE.test(n))) return ASST_NATURAL_RE.test(current) ? 'natural' : 'pick-natural';
  return iOS ? 'ios' : 'no-natural';
}
/* Publish whatever this device actually has, best first, and which voice is live. The app
   already auto-selects the best installed voice, so the only thing the user ever needs to DO
   is install a better one — the hint says so explicitly rather than leaving them hunting
   through a dropdown that can't help. Be honest about the platform ceiling: Safari does NOT
   expose iOS's downloadable Enhanced/Premium voices to the Web Speech API — getVoices()
   returns only a limited built-in subset — so telling an iPhone user to download a better
   voice sends them on a chase that cannot work. Only say that where it's actually true. */
export function asstFillVoicePicker() {
  const seen = new Set();
  const vs = asstVoiceList().slice().sort((a, b) => asstVoiceScore(b) - asstVoiceScore(a))
    .filter((v) => (seen.has(v.name) ? false : (seen.add(v.name), true)));
  if (!vs.length) { asstStore.setState({ voices: [], voiceName: '', voiceHint: 'none' }); return; }
  const current = (ASST._voice && ASST._voice.name) || vs[0].name;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  asstStore.setState({
    voices: vs.map((v) => ({ name: v.name, natural: ASST_NATURAL_RE.test(v.name) })),
    voiceName: current,
    voiceHint: asstVoiceHintKind(vs.map((v) => v.name), current, iOS),
  });
}
/* Kept for voice.js, which restores ASST.speak after its one-reply override and calls this. */
export function asstUpdateSpeakBtn() {
  asstStore.setState({ speak: !!ASST.speak });
}
export function asstToggleSpeak() {
  ASST.speak = !ASST.speak;
  localStorage.setItem('fishapp.asst.speak', ASST.speak ? '1' : '0');
  asstUpdateSpeakBtn();
  /* asstStopSpeech kills BOTH engines. Cancelling only speechSynthesis left a
     45-second cloud reply playing out of the <audio> element after the user
     deliberately silenced the boat. */
  if (!ASST.speak) asstStopSpeech();
  else asstSpeak("Voice on. I'll read my answers aloud.");
}
/* Settings "This is how I sound": the voice being picked, played even with Speak off. */
export function asstTestVoice(voiceName, cloud) {
  const v = voiceName ? asstVoiceList().find((x) => x.name === voiceName) : null;
  asstSpeakNow('This is how I sound.', { voice: v || null, cloud: !!cloud });
}
export function asstStartMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { if (typeof toast === 'function') toast("Voice input isn't supported here — tap the mic on your keyboard to talk"); return; }
  if (ASST._rec) { try { ASST._rec.stop(); } catch (e) {} return; }   // second tap = done talking
  try {
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    ASST._rec = r;
    asstStore.setState({ micListening: true });
    r.onresult = (e) => { const txt = e.results[0][0].transcript; if (txt) asstSend(txt); };
    r.onerror = (e) => {
      const why = (e && e.error) || 'error';
      if (why === 'aborted') return;
      if (why === 'not-allowed' || why === 'service-not-allowed') {
        /* Permission refused (or, in the iPhone app, Settings has it off). Say how to fix it and
           stop offering a mic button that can't work this session. */
        if (typeof toast === 'function') toast('Microphone or speech recognition is off for FishApp — allow both in Settings, or use the dictation key on your keyboard');
        asstStore.setState({ micSupported: false });
        return;
      }
      if (why === 'no-speech') { if (typeof toast === 'function') toast("Didn't catch that — tap the mic and try again"); return; }
      if (typeof toast === 'function') toast('Voice: ' + why);
    };
    r.onend = () => { ASST._rec = null; asstStore.setState({ micListening: false }); };
    r.start();
  } catch (e) {
    ASST._rec = null;
    asstStore.setState({ micListening: false });
    if (typeof toast === 'function') toast('Voice input failed');
  }
}

/* ---------------- cloud-AI consent (App Store guideline 5.1.2(i)) ---------------- */
/* Before the FIRST cloud call — the free relay or Claude with the user's key — say what is
   sent and to whom, and remember the answer. Declined (or not asked yet with no answer) means
   First Mate answers on the phone. The settings switch changes it later. */
export const ASST_CONSENT_KEY = 'fishapp.asst.cloudConsent';
export function asstCloudConsent() {
  let v = null;
  try { v = localStorage.getItem(ASST_CONSENT_KEY); } catch (e) { /* storage blocked */ }
  return v === 'yes' || v === 'no' ? v : null;
}
export function asstSetCloudConsent(on) {
  try { localStorage.setItem(ASST_CONSENT_KEY, on ? 'yes' : 'no'); } catch (e) { /* storage blocked */ }
  if (!on && ASST._audio) asstStopSpeech();
  asstSetStatus();
}
/* What a cloud brain actually receives — keep this in step with asstSnapshot(), the proxy's
   live block and the Claude tools (list_waypoints hands over every saved spot with its notes),
   so the consent text and the settings hint (which both use it) never understate it
   (guideline 5.1.2(i), and the App Privacy answers). */
export const ASST_CLOUD_DATA = 'your question and the recent conversation, plus the boat data needed to answer it: ' +
  'your position, speed and heading, local conditions, nearby reefs, your saved spots (names, positions and notes), ' +
  'your catch log (species, sizes, baits and dates), and trip and anchor-watch status';
export function asstConsentMessage(brain) {
  const who = brain === 'claude'
    ? 'Anthropic (Claude), using your own API key under your account and Anthropic’s terms'
    : 'Cloudflare Workers AI through the FishApp relay. FishApp doesn’t store it. With your own API key it goes to Anthropic instead';
  return 'To answer with cloud AI, First Mate sends ' + ASST_CLOUD_DATA + ' to ' + who + '.\n\n' +
    'If you’d rather not, First Mate answers on this phone from your boat data. You can change this any time in First Mate settings. AI answers can be wrong; never rely on them for safety.';
}
/* The question never waits forever. A send waits on it with First Mate busy, and when it is
   asked while nobody is looking (a hands-free question with the sheet open, the phone out of
   reach) every later "Hey Fish" only heard "still answering". After this long it is taken
   down, nothing is saved, and the question is answered on the phone. */
export const ASST_CONSENT_TIMEOUT_MS = 60000;
let _consentAsk = null;
/** Ask once (concurrent callers share the open question). Resolves 'yes' | 'no' as saved, or
 *  null when no decision was made (timed out) — nothing is saved then. */
export function asstAskCloudConsent(brain) {
  if (_consentAsk) return _consentAsk;
  const answer = confirmDialog({
    title: 'Use cloud AI?',
    message: asstConsentMessage(brain),
    confirmLabel: 'Allow',
    cancelLabel: 'Don’t allow',
    dismissible: false,       // a stray backdrop tap must not store a permanent "Don't allow"
  });
  /* pushDialog adds the dialog synchronously, so the newest one is this question. */
  let dialogId = null;
  try { const ds = uiStore.getState().dialogs; dialogId = ds.length ? ds[ds.length - 1].id : null; } catch (e) { /* no dialog host */ }
  const asked = new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      asstCloseDialog(dialogId);
      resolve(null);
    }, ASST_CONSENT_TIMEOUT_MS);
    Promise.resolve(answer).then((ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /* Only an explicit choice is remembered. confirmDialog resolves a backdrop tap as false
         too (see docs/requests/assistant.md); anything other than true/false is "no decision". */
      if (ok === true || ok === false) { asstSetCloudConsent(ok); resolve(ok ? 'yes' : 'no'); }
      else resolve(null);
    }, () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } });
  });
  _consentAsk = asked.finally(() => { _consentAsk = null; });
  return _consentAsk;
}
/** Take an in-app dialog down without an answer (it resolves false, which the asker ignores). */
export function asstCloseDialog(id) {
  if (id == null) return;
  try {
    const d = uiStore.getState().dialogs.find((x) => x.id === id);
    if (d) d.resolve(false);
  } catch (e) { /* dialog host gone */ }
}
/** Is the First Mate sheet on screen? Sends with it closed come from hands-free voice. */
export function asstPanelOpen() {
  try { return !!isPanelOpen('assistant'); } catch (e) { return true; }
}
export const ASST_DECLINED_NOTE = '(Answered on this phone from your boat data. To use cloud AI, turn on Allow cloud AI in First Mate settings.)';
export const ASST_CONSENT_LATER_NOTE = '(Answered on this phone from your boat data. Cloud AI needs your OK on screen first — First Mate will ask the next time you open it.)';
export const ASST_CONSENT_TIMEOUT_NOTE = '(Answered on this phone from your boat data. The cloud AI question went unanswered — ask again and choose Allow, or turn on Allow cloud AI in First Mate settings.)';

/* ---------------- status / brain ---------------- */
/** Which brain answers. Cloud only with signal and cloud AI not switched off; consent null
 *  still picks a cloud brain — asstSend asks first. */
export function asstPickBrain(o) {
  const cloudOk = o.consent !== 'no';
  if (o.online && o.hasKey && cloudOk) return 'claude';
  if (o.online && o.proxy && cloudOk) return 'proxy';
  if (!o.online) return 'offline';
  return 'data';
}
export function asstBrainInputs() {
  return { online: navigator.onLine, hasKey: !!ASST.key(), proxy: !!asstProxyUrl() && !ASST._proxyBlocked, consent: asstCloudConsent() };
}
export function asstSetStatus() {
  const inp = asstBrainInputs();
  const brain = asstPickBrain(inp);
  let txt;
  /* 'Claude' is claimed only with signal AND a key (and cloud AI allowed) — never promise a
     brain that can't answer. */
  if (brain === 'claude') txt = 'Claude ' + asstModelLabel() + ' · your key';
  else if (brain === 'proxy') txt = 'Free AI chat — no key needed';
  else if (brain === 'offline') txt = 'Offline — answering from your boat data';
  /* Data mode by choice (cloud AI off) vs because the relay can't be used (refused this app,
     or no endpoint) — the second used to read the same, as if the user had chosen it. */
  else if (inp.consent === 'no') txt = 'Data mode — answering from your boat data';
  else txt = 'Data mode — AI relay unavailable, answering from your boat data';
  asstStore.setState({
    brain, statusText: txt, online: inp.online, hasKey: inp.hasKey, consent: inp.consent,
    model: ASST.model(), modelLabel: asstModelLabel(),
    cloudVoice: localStorage.getItem('fishapp.asst.cloudvoice') === '1',
    proxyUrl: asstProxyUrl(), proxyIsDefault: !asstProxyOverride(),
  });
}
export function asstModelLabel() {
  const m = ASST.model();
  const hit = ASST_MODELS.find((x) => x.id === m);
  return hit ? hit.short : m;
}

/* ---------------- send ---------------- */
export async function asstSend(text) {
  text = (text || '').trim();
  if (!text || ASST.streaming) return;
  asstAddMsg('user', text);

  ASST.streaming = true;
  asstSetSending(true);

  /* Everything below runs inside try/finally. Without it a single hung fetch — one
     bar of signal, or a captive portal where navigator.onLine is still true — left
     ASST.streaming stuck on forever, and the guard above then silently swallowed
     every later message, the Enter key and every suggestion chip until a reload. */
  const gen = ASST._gen || 0;
  try {
    /* A distress call is answered on the phone, at once: the emergency script (Ch 16, position,
       MAYDAY words, SOS button) is the vetted answer, and a cloud round-trip on one bar of
       signal could keep a sinking boat on "Thinking…" for up to 90 s — or behind the cloud-AI
       consent question. */
    let brain = asstIsDistress(text) ? 'data' : asstPickBrain(asstBrainInputs());
    let note = '';                               // why this was answered on the phone (shown, not spoken)
    if ((brain === 'claude' || brain === 'proxy') && asstCloudConsent() == null) {
      if (!asstPanelOpen()) {
        /* Hands-free with the sheet closed (voice.js): nobody may be looking, and a question
           waiting on screen kept First Mate busy for every later "Hey Fish". Answer on the
           phone now, decide nothing, and ask when First Mate is next opened (asstOnOpen). */
        ASST._consentPending = true;
        note = ASST_CONSENT_LATER_NOTE;
      } else {
        const choice = await asstAskCloudConsent(brain);
        if (gen !== (ASST._gen || 0)) return;      // chat was cleared while the question was up
        if (choice === 'no') note = ASST_DECLINED_NOTE;
        else if (choice == null) note = ASST_CONSENT_TIMEOUT_NOTE;
        brain = asstPickBrain(asstBrainInputs());  // re-check: signal, key and setting can change meanwhile
      }
    }
    const allowed = asstCloudConsent() === 'yes';
    const useClaude = brain === 'claude' && allowed;   // personal key → full Claude + tools
    const useProxy = brain === 'proxy' && allowed;     // no key → free hosted proxy chat

    if (useClaude || useProxy) {
      const botId = asstAddMsg('bot', '', { thinking: true, progress: '' });
      try {
        const reply = useClaude ? await asstAskOnline(text, botId) : await asstAskProxy(text, botId);
        if (gen !== (ASST._gen || 0)) return;      // chat was cleared while we waited
        asstUpdateMsg(botId, { text: reply, thinking: false, progress: '' });
        asstSpeak(asstCleanText(reply));
        ASST.history.push({ role: 'user', content: text });
        ASST.history.push({ role: 'assistant', content: reply });
        if (ASST.history.length > 24) ASST.history = ASST.history.slice(-24);
      } catch (e) {
        // graceful fallback to the offline engine
        let off;
        try { off = await asstOffline(text); } catch (e2) { off = 'No offline answer for that one.'; }
        if (gen !== (ASST._gen || 0)) return;
        let head;
        if (e && e.refusal) {
          const done = (e.didTools || []).filter((v, i, a) => a.indexOf(v) === i);
          head = "The AI wouldn't answer that one" + (done.length ? ' (before stopping it did: ' + done.join(', ') + ')' : '') + '. Offline answer:';
        } else if (useClaude && e && e.empty) {
          head = 'The AI sent back an empty answer. Offline answer:';
        } else if (useClaude) {
          const why = e.status === 401 ? 'bad API key' : (e.message || 'network');
          head = "Couldn't reach the AI (" + why + "). Offline answer:";
        } else {
          head = asstRelayFailHead(e);
        }
        asstUpdateMsg(botId, { thinking: false, progress: '', error: true, text: head + '\n\n' + off });
        asstSpeak(off);
      }
    } else {
      const botId = asstAddMsg('bot', '', { thinking: true, progress: '' });
      let ans;
      try { ans = await asstOffline(text); } catch (e) { ans = 'Something went wrong working that out offline.'; }
      if (gen !== (ASST._gen || 0)) return;
      asstUpdateMsg(botId, { text: note ? ans + '\n\n' + note : ans, thinking: false });
      asstSpeak(ans);
    }
  } finally {
    ASST.streaming = false;
    asstSetSending(false);
    asstSetStatus();
  }
}

export function asstSetSending(on) {
  asstStore.setState({ busy: !!on });
}

export const ASST_CHIPS = [
  'Best day to fish this week?', 'Is it too rough today?', "What's the weather where I am?",
  'Tides today', "What should I throw for calico bass?", 'Best lure for yellowtail at Catalina?',
  "What's biting at Catalina?", 'How do I fish a dropper loop?', 'Drop a waypoint here',
];
export const ASST_GREETING = "Ahoy! I'm First Mate.\nNo signal needed for most of what you'll ask — best days to fish, is it too rough, tides, weather outlook, water temp, reefs, fish limits, knots, or dropping a waypoint. With signal I'll also chat freely, and with your own API key I can take actions. Tap a suggestion to start.";

/* Called by the panel when it opens (mount). Refreshes status and voices; greets if the
   transcript is empty. */
export function asstOnOpen() {
  asstSetStatus();
  /* iOS fills getVoices() asynchronously and fires voiceschanged once — often long before
     this panel is first opened, leaving the picker empty when the user finally looks at it.
     Refill on every open. */
  if (typeof asstFillVoicePicker === 'function') asstFillVoicePicker();
  const st = asstStore.getState();
  if (!st.messages.length) {
    asstAddMsg('bot', ASST_GREETING, { greeting: true });
    asstStore.setState({ showChips: true });
  } else if (!st.showChips) {
    /* The first question came hands-free with the panel closed: the transcript isn't empty,
       but the suggestions were never offered. Offer them now (they stay once shown). */
    asstStore.setState({ showChips: true });
  }
  /* A hands-free question was answered on the phone because cloud AI hadn't been asked about
     yet (asstSend) — ask now that someone is looking. Not while a reply is in flight; a
     question nobody answers (timeout) stays pending for the next open. */
  if (ASST._consentPending && asstCloudConsent() == null && !ASST.streaming) {
    const b = asstPickBrain(asstBrainInputs());
    if (b === 'claude' || b === 'proxy') {
      ASST._consentPending = false;
      void asstAskCloudConsent(b).then((choice) => { if (choice == null) ASST._consentPending = true; });
    }
  }
}

/* Clear chat. */
export function asstClearChat() {
  /* Bump the generation so a request still in flight can't write its reply into
     a detached bubble and push the "cleared" exchange back onto the history —
     which then got shipped to Claude on the next message. */
  ASST._gen = (ASST._gen || 0) + 1;
  ASST.history = [];
  ASST.lastLoc = null;          // "what's the swell?" must not still mean the old place
  asstStopSpeech();
  asstStore.setState({ messages: [], showChips: false });
  asstOnOpen();
}

/* Save the settings form. Returns false (and says why) if the endpoint is invalid. */
export function asstSaveSettings(s) {
  s = s || {};
  if (s.proxy != null) {
    const p = asstNormalizeProxy(s.proxy);
    if (p.error) { if (typeof toast === 'function') toast(p.error); return false; }
    if (p.value) localStorage.setItem('fishapp.asst.proxy', p.value);
    else localStorage.removeItem('fishapp.asst.proxy');
    ASST._proxyBlocked = false;     // a (re)saved endpoint gets a fresh chance
    ASST._relayHold = {};
  }
  if (s.key != null) localStorage.setItem('fishapp.asst.key', String(s.key).trim());
  if (s.model) localStorage.setItem('fishapp.asst.model', asstMigrateModel(s.model));
  if (s.cloudVoice != null) localStorage.setItem('fishapp.asst.cloudvoice', s.cloudVoice ? '1' : '0');
  if (s.voiceName) {
    localStorage.setItem('fishapp.asst.voice', s.voiceName);
    const v = asstVoiceList().find((x) => x.name === s.voiceName);
    if (v) ASST._voice = v;
    asstFillVoicePicker();
  }
  // Speak a sample so the choice is immediately auditable — routed through asstSpeak so
  // it exercises whichever path (cloud or device) was just selected.
  asstSpeak('This is how I sound.');
  asstSetStatus();
  if (typeof toast === 'function') toast('Assistant settings saved');
  return true;
}
/* What the settings form starts from. The key is read here (not kept in the store). */
export function asstReadSettings() {
  return {
    key: ASST.key(),
    model: ASST.model(),
    proxy: asstProxyUrl(),
    cloudVoice: localStorage.getItem('fishapp.asst.cloudvoice') === '1',
    voiceName: (ASST._voice && ASST._voice.name) || localStorage.getItem('fishapp.asst.voice') || '',
  };
}

export function asstInit() {
  // A saved model id from the old picker becomes the closest current one.
  const saved = localStorage.getItem('fishapp.asst.model');
  if (saved && saved !== asstMigrateModel(saved)) localStorage.setItem('fishapp.asst.model', asstMigrateModel(saved));

  // voice: speak answers (TTS) + voice input (STT)
  ASST.speak = localStorage.getItem('fishapp.asst.speak') === '1';
  asstPickVoice();
  asstUpdateSpeakBtn();
  asstStore.setState({
    // e.g. iOS Safari / the iOS app's web view have no web speech recognition — keyboard dictation instead
    micSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    ttsSupported: 'speechSynthesis' in window,
  });
  if (!ASST._netHooked) {
    ASST._netHooked = true;
    window.addEventListener('online', asstSetStatus);
    window.addEventListener('offline', asstSetStatus);
  }
  asstSetStatus();
}
