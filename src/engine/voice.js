import { createStore } from 'zustand/vanilla';
import { GPS, formatCoord, gpsIsStale, requestWakeLock, setFollow } from './gps.js';
import { Tracks, trackStart, trackStop } from './tracks.js';
import { Nav, anchorDrop, anchorRaise, routeStart, unlockAudio } from './nav.js';
import { Goto, gotoCancel } from './goto.js';
import { biteSpokenSummary, biteWindows } from './bite.js';
import { ASST, asstCreateSpot, asstSend, asstSpeak, asstUpdateSpeakBtn } from './assistant.js';
import { applyPendingUpdate, getMap } from './app.js';
import { closePanels, isPanelOpen, normalizePanelId, openPanel, togglePanel, toast, uiStore } from '../services/ui';
import { isNativeShell } from '../services/native';

/* Hands-free voice control — "Hey Fish".

   Continuously listens for the wake word, then runs a spoken command against the app
   (open panels, toggle layers, mark spots, anchor, zoom…). Anything it doesn't recognise
   is handed to First Mate, so "hey fish, what's the tide doing tonight" still works.

   Deliberate design notes:
   - Recognition stops itself constantly (silence timeouts, engine hiccups). We restart it
     from onend with a backoff instead of assuming a single session stays alive.
   - Our own text-to-speech is loud enough to be re-heard as a command, so results are
     ignored while speaking plus a short tail.
   - Everything degrades: no SpeechRecognition (notably iOS Safari) → we say so once and
     leave the tap-to-talk mic in First Mate as the fallback.

   React port: the engine owns the mic session, the restart loop, the echo guard and every
   timer. The tab button (features/voice/VoiceTabButton) only renders `voiceStore` and calls
   voiceToggle() synchronously inside its click handler — the iOS user-gesture unlock for the
   mic, speech and the anchor-alarm AudioContext depends on that. */
'use strict';

export const Voice = {
  on: false,             // user has enabled hands-free
  awake: false,          // wake word heard; a command is expected
  rec: null,
  speaking: false,
  _awakeTimer: null,
  _restartTimer: null,
  _muteUntil: 0,         // ignore recognition results until this timestamp (echo guard)
  _fails: 0,             // consecutive start failures, for backoff
  _wantOn: false,        // desired state, so onend knows whether to restart
  _gotResult: false,     // a session that produced speech is a healthy one
  /* Hands-free was on before this launch and is waiting for the first tap (voiceInit). */
  _resumePending: false,
  /* Inside the iOS app the microphone or speech recognition was refused — only iOS Settings
     can fix that. Hides Hey Fish for the session so the tab bar offers First Mate instead of
     a mic that can never work. Not persisted: iOS relaunches the app after a permission
     change in Settings, and detection runs again. */
  _unavailable: false,
  _heard: '',            // the command just heard, shown on the tab for VOICE_HEARD_MS
  _heardTimer: null,
  supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
};

export const VOICE_AWAKE_MS = 9000;    // how long we listen for a command after the wake word
export const VOICE_HEARD_MS = 2000;    // how long the tab shows the command it just heard
/* An action that asks first (an in-app confirm) can't be answered hands-free. If one is
   still open this long after the command, say so — otherwise the user hears nothing and
   assumes the boat-side action happened. */
export const VOICE_CONFIRM_HINT_MS = 350;

/* ---- View state for the tab button (plain data; React renders it) ---- */
/**
 * @typedef {Object} VoiceView
 * @property {boolean} supported  hands-free can run here. False when SpeechRecognition is missing
 *   (or the platform refused it) — the tab bar then shows First Mate in the centre slot instead.
 * @property {boolean} on         hands-free is switched on (the user's intent; survives backgrounding)
 * @property {boolean} listening  the mic session is believed live right now (Voice.on)
 * @property {boolean} awake      wake word heard; the 9 s command window is open
 * @property {boolean} resumePending  hands-free was on before this launch; the first tap anywhere resumes it
 * @property {string} label       the tab label: 'Hey Fish' | 'Listening' | 'Starting' | the command just heard
 * @property {string} transcript  the command just heard ('' once VOICE_HEARD_MS has passed)
 */
/** @type {import('zustand/vanilla').StoreApi<VoiceView>} */
export const voiceStore = createStore(() => /** @type {VoiceView} */ ({
  supported: !!Voice.supported,
  on: false,
  listening: false,
  awake: false,
  resumePending: false,
  label: 'Hey Fish',
  transcript: '',
}));

/* "hey fish" survives a lot of mishearing — accept the common ones rather than making the
   user enunciate perfectly over engine noise. A bare "a fish" is deliberately NOT accepted:
   on a fishing boat "I caught a fish" would wake it constantly. */
export const WAKE_RE = /\b(?:hey|hay|hi|high|ok|okay)\s*(?:fish|fisch|fist|phish|vish|fresh|finch)\b/;

export function voiceNorm(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* The track rule's verb decides what to do ("record" counts as start). */
export const VOICE_TRACK_RE = /\b(start|stop|record)(?: a| the)? track(?:ing)?\b/;

/* ---- Command table. First match wins, so specific actions precede the panel keywords
   they share words with ("drop anchor" before "anchor" → Nav tools).
   Every rule gets the normalised command; `id` names the rule for tests and logs. ---- */
export const VOICE_COMMANDS = [
  // --- actions ---
  /* Needs an object. The noun groups used to be optional, so a bare "save" or "mark"
     anywhere matched — and because this is the FIRST rule, "save my track" and
     "mark the route" both dropped a waypoint and replied "Marked this spot." */
  { id: 'mark', re: /\b(?:mark|save)\s+(?:this|my|the)?\s*(?:spot|pin|waypoint|location|place)\b|\bmark this\b|\bdrop a (?:pin|waypoint|mark)\b/,
    run: () => voiceMarkSpot() },
  { id: 'route-start', re: /\bstart (?:the )?route\b|\bfollow (?:the )?route\b/,
    run: () => voiceRouteStart() },
  { id: 'nav-stop', re: /\b(?:stop|cancel|end) (?:the )?(?:navigation|navigating|route|nav)\b/,
    run: () => voiceStopNav() },
  // Anchor/track report their real resulting state — hands-free means the user can't read
  // the toast these actions normally rely on.
  { id: 'anchor-drop', re: /\bdrop (?:the )?anchor\b|\banchor watch on\b/,
    run: () => voiceAnchorDrop() },
  { id: 'anchor-raise', re: /\braise (?:the )?anchor\b|\banchor watch off\b/,
    run: () => voiceAnchorRaise() },
  /* Not a blind toggle any more: "start tracking" while recording used to STOP the
     recording (and say "Track saved."), and "stop track" while idle started one. */
  { id: 'track', re: VOICE_TRACK_RE,
    run: (cmd) => voiceTrack(cmd) },
  // animate:false — a zoom that depends on an animation completing can silently do nothing
  // if the compositor is stalled, and by voice there's no visual cue to retry.
  { id: 'zoom-in', re: /\bzoom in\b|\bcloser\b/,
    run: () => voiceZoom(1, 'Zooming in.') },
  { id: 'zoom-out', re: /\bzoom out\b|\bwider\b/,
    run: () => voiceZoom(-1, 'Zooming out.') },
  { id: 'follow', re: /\b(?:follow me|center|centre|recenter|recentre|find me)\b/,
    run: () => { if (typeof setFollow === 'function') setFollow(true); return 'Following you.'; } },
  { id: 'close', re: /\b(?:close|dismiss|hide|never mind|go back|nothing)\b/,
    run: () => { if (typeof closePanels === 'function') closePanels(); return 'Closed.'; } },

  // --- personal bite prediction (must precede the "tide"/"weather" panel rules, which
  //     would otherwise swallow "when's the best tide to fish") ---
  /* voiceNorm turns the apostrophe into a space ("when's" → "when s"), so the old
     `when'?s the bite` could never match. Accept "when s", "whens" and "when is". */
  { id: 'bite', re: /\bwhen (should|do|can) i (go|fish|head out)\b|\bbest (time|window|day)( to)?( go)?( fish\w*)?\b|\bwhen to go\b|\bwhen(?: ?s| is) the bite\b|\bshould i go fish\w*\b/,
    run: async () => {
      if (typeof biteWindows !== 'function') return "I can't work that out yet.";
      try {
        const res = await biteWindows({ days: 7, limit: 3 });
        return biteSpokenSummary(res, {});
      } catch (e) { return "I couldn't work out a window."; }
    } },

  // --- spoken answers straight from live boat data (instant, no AI round-trip) ---
  { id: 'position', re: /\bwhere am i\b|\bmy position\b|\bcoordinates?\b/, run: () => voiceSayPosition() },
  /* Must be the BOAT's speed. A bare \bspeed\b matched "what's the wind speed"
     and confidently answered with SOG — the wrong number to a safety question,
     spoken aloud with nothing on screen to contradict it. */
  { id: 'speed', re: /\bhow fast\b|\bmy speed\b|\b(?:boat|our) speed\b|\bspeed over ground\b|\bsog\b/,
    run: () => voiceSaySpeed() },

  // --- panels (skipped for questions — see voiceIsQuestion) ---
  { id: 'weather', panel: 1, re: /\b(?:weather|wind|forecast|waves?|swell)\b/, run: () => voicePanel('weather', 'Weather.') },
  { id: 'tides', panel: 1, re: /\b(?:tide|tides|bite time|solunar|moon)\b/, run: () => voicePanel('tides', 'Tides and bite times.') },
  { id: 'spots', panel: 1, re: /\b(?:spots?|waypoints?|tracks?|voyages?)\b/, run: () => voicePanel('spots', 'Your spots.') },
  { id: 'tools', panel: 1, re: /\b(?:nav tools?|tools?|catch log|trip)\b/, run: () => voicePanel('tools', 'Nav tools.') },
  // Download must precede the layers rule — "offline charts" also contains "charts".
  { id: 'download', panel: 1, re: /\b(?:download|offline)\b/, run: () => voicePanel('download', 'Offline charts.') },
  { id: 'layers', panel: 1, re: /\b(?:layers?|chart|charts|map)\b/, run: () => voicePanel('layers', 'Map layers.') },
  /* Fish ID / limits / regulations go straight to the Fish & limits tab. They used to
     open Guides on whichever tab was used last — usually Knots. */
  { id: 'guides-fish', panel: 1, re: /\b(?:fish id|regulations?|limits?)\b/, run: () => voicePanel('guides', 'Fish and limits.', { tab: 'fish' }) },
  { id: 'guides-knots', panel: 1, re: /\bknots?\b/, run: () => voicePanel('guides', 'Guides.', { tab: 'knots' }) },
  { id: 'guides', panel: 1, re: /\bguides?\b/, run: () => voicePanel('guides', 'Guides.') },
  { id: 'emergency', panel: 1, re: /\b(?:emergency|mayday|sos|distress)\b/, run: () => voicePanel('emergency', 'Emergency.') },
  { id: 'more', panel: 1, re: /\b(?:more|menu)\b/, run: () => voicePanel('more', 'More.') },
];

/** First command rule that would run for `cmd` (null → First Mate fields it). Pure. */
export function voiceMatch(cmd) {
  if (!cmd) return null;
  const asking = voiceIsQuestion(cmd);
  for (const c of VOICE_COMMANDS) {
    if (c.panel && asking) continue;   // a question isn't a request to open a screen
    if (c.re.test(cmd)) return c;
  }
  return null;
}

/* Open a panel (never close it — "weather" said twice must not toggle it shut). With
   `data` the panel is (re)opened with it, e.g. Guides on the Fish & limits tab. */
export function voicePanel(id, say, data) {
  const pid = normalizePanelId(id);
  if (data) openPanel(pid, data);
  else if (!isPanelOpen(pid)) openPanel(pid);
  return say;
}

/* Call an action; returns what to say back.
   Was by NAME through window[fnName] — in ES modules routeStart/gotoCancel/anchorRaise
   aren't globals, so every one of those commands would have replied "I can't do that
   right now." It also reported success whenever the function didn't throw; the rules
   above now check the real outcome instead. */
export async function voiceCall(fn, say) {
  if (typeof fn !== 'function') return "I can't do that right now.";
  try { await voiceAwaitAction(fn); } catch (e) { return 'That did not work.'; }
  return say;   // null → stay silent (the action toasts/speaks for itself)
}

/* Run an action that may put up an in-app confirm (gotoCancel, routeStart → gotoStart) and
   wait for it. Nobody hands-free is looking at the screen, so if it opened a dialog that is
   still waiting shortly after, say so — then wait for the tap and let the caller report what
   really happened. Sync and async actions both work. */
export async function voiceAwaitAction(action, hint) {
  const dialogsBefore = voiceOpenDialogs();
  const p = Promise.resolve(action());
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const t = setTimeout(() => {
    if (!settled && voiceOpenDialogs() > dialogsBefore) voiceSay(hint || 'Check the screen to confirm.');
  }, VOICE_CONFIRM_HINT_MS);
  try { return await p; } finally { clearTimeout(t); }
}
function voiceOpenDialogs() {
  try { return uiStore.getState().dialogs.length; } catch (e) { return 0; }
}

/* ---- Actions that report what ACTUALLY happened ---- */
export async function voiceRouteStart() {
  if (typeof routeStart !== 'function') return "I can't do that right now.";
  const pts = (Nav && Nav.route && Nav.route.pts) || [];
  // routeStart refuses (with a toast nobody is reading) until the plan has two points.
  if (pts.length < 2) {
    /* A started route takes the planner down (routeStart → routeClear), so the plan is empty
       for the whole run. "Follow the route" said while following it is not "no route". */
    if (Goto.active && Goto.route) return 'You are already following the route.';
    return 'There is no route to follow yet. Plan at least two points first.';
  }
  const prevRoute = Goto.active ? Goto.route : null;
  const prevTs = Goto.startTs;
  await voiceAwaitAction(() => routeStart(), 'Check the screen. You have a voyage in progress.');
  const started = !!(Goto.active && Goto.route && (Goto.route !== prevRoute || Goto.startTs !== prevTs));
  return started ? 'Starting the route.' : 'The route did not start.';
}

export async function voiceStopNav() {
  if (typeof gotoCancel !== 'function') return "I can't do that right now.";
  if (!Goto.active) return 'You are not navigating right now.';
  await voiceAwaitAction(() => gotoCancel(), 'Check the screen to end navigation without saving this voyage.');
  // gotoCancel asks first when a voyage is under way; "Cancel" there keeps navigating.
  return Goto.active ? 'Navigation is still on.' : 'Navigation stopped.';
}

export async function voiceAnchorDrop() {
  if (typeof anchorDrop !== 'function') return "I can't do that right now.";
  const wasWatching = !!Nav.anchor.watching, prevLL = Nav.anchor.ll;
  await voiceAwaitAction(() => anchorDrop());
  // A drop while already watching re-centres the watch; a refused one leaves the old watch up.
  if (Nav.anchor.watching && (!wasWatching || Nav.anchor.ll !== prevLL)) {
    return 'Anchor watch on, ' + Nav.anchor.radiusFt + ' feet.';
  }
  // anchorDrop refuses without a fix, on a stale fix and on a coarse fix — say which.
  const why = !GPS.lastLatLng ? 'No GPS fix yet'
    : (typeof gpsIsStale === 'function' && gpsIsStale()) ? 'My last GPS fix is too old'
      : GPS.coarse ? 'GPS is not accurate enough yet' : '';
  if (Nav.anchor.watching) {
    return why ? why + ', so the anchor watch stays where it was.' : 'The anchor watch stays where it was.';
  }
  return why ? why + ', so I could not set the anchor watch.' : 'I could not set the anchor watch.';
}

export async function voiceAnchorRaise() {
  if (typeof anchorRaise !== 'function') return "I can't do that right now.";
  if (!Nav.anchor.watching) return 'There is no anchor watch on.';
  await voiceAwaitAction(() => anchorRaise());
  return Nav.anchor.watching ? 'The anchor watch is still on.' : 'Anchor up.';
}

export async function voiceTrack(cmd) {
  if (typeof trackStart !== 'function' || typeof trackStop !== 'function') return "I can't do that right now.";
  const m = VOICE_TRACK_RE.exec(cmd || '');
  const stop = !!m && m[1] === 'stop';
  if (!stop) {
    if (Tracks.recording) return 'Already recording your track.';
    await trackStart();
    return Tracks.recording ? 'Recording your track.' : 'I could not start recording.';
  }
  if (!Tracks.recording) return 'No track is recording.';
  // trackStop discards a recording of fewer than 2 points ("Track too short — not saved").
  const enough = Array.isArray(Tracks.points) && Tracks.points.length >= 2;
  /* A failed storage write (quota, private mode) does not throw: trackStop keeps the track in
     Tracks.unsaved and toasts "Track NOT saved" with a Retry. Saying "Track saved." over that
     told a hands-free user the track was safe when closing the app would lose it — so compare
     the unsaved list (by identity: a Retry of another track may remove one meanwhile). */
  const unsavedBefore = new Set(voiceUnsavedTracks());
  await trackStop();
  if (Tracks.recording) return 'The track is still recording.';
  if (!enough) return 'Track too short, so it was not saved.';
  if (voiceUnsavedTracks().some((t) => !unsavedBefore.has(t))) {
    return 'The track could not be saved. It is kept until the app closes. Retry or save it as a file from Spots and tracks.';
  }
  return 'Track saved.';
}
function voiceUnsavedTracks() {
  return (Tracks && Array.isArray(Tracks.unsaved)) ? Tracks.unsaved : [];
}

export function voiceZoom(delta, say) {
  const map = getMap();
  if (!map) return "The chart isn't ready yet.";
  map.setZoom(map.getZoom() + delta, { animate: false });
  return say;
}

export async function voiceMarkSpot() {
  /* No map-centre fallback. Hands-free means nobody is looking at the screen, so
     silently pinning wherever the map happened to be panned — and saying "Marked
     this spot" — put a mark on the wrong water with no way to notice.
     Every other position command already refuses without a fix. */
  const ll = (typeof GPS !== 'undefined' && GPS.lastLatLng) || null;
  if (!ll) return 'No GPS fix yet, so I can’t mark a spot.';
  if (typeof gpsIsStale === 'function' && gpsIsStale()) return 'My last GPS fix is too old to mark a spot.';
  const name = 'Voice mark ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (typeof asstCreateSpot !== 'function') return "I can't save spots right now.";
  try {
    await asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: 'fish' });
    return 'Marked this spot.';
  } catch (e) { return 'I could not save that spot.'; }
}
/* Position and speed are read aloud with nothing on screen to contradict them, so a fix
   older than GPS_STALE_MS is never spoken as current: position says how old it is (a last
   known position still matters to a rescuer), speed is refused (an old SOG is meaningless). */
export function voiceFixAgeMin() {
  const ts = GPS.lastFixTs || 0;
  return ts ? Math.max(1, Math.round((Date.now() - ts) / 60000)) : null;
}
export function voiceSayPosition() {
  const ll = typeof GPS !== 'undefined' ? GPS.lastLatLng : null;
  if (!ll) return 'No GPS fix yet.';
  const where = (typeof formatCoord === 'function')
    ? formatCoord(ll.lat, 'lat') + ', ' + formatCoord(ll.lng, 'lon')
    : ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4);
  if (typeof gpsIsStale === 'function' && gpsIsStale()) {
    const min = voiceFixAgeMin();
    return 'My last GPS fix is ' + (min ? min + (min === 1 ? ' minute' : ' minutes') + ' old' : 'old') +
      '. Last known position ' + where;
  }
  return 'You are at ' + where;
}
export function voiceSaySpeed() {
  const c = (typeof GPS !== 'undefined' && GPS.last) ? GPS.last.coords : null;
  if (!c || c.speed == null || isNaN(c.speed)) return 'No speed reading yet.';
  if (typeof gpsIsStale === 'function' && gpsIsStale()) return 'No current speed reading. My last GPS fix is too old.';
  return Math.round(c.speed * 1.94384) + ' knots.';
}

/* ---- Speaking (reuses First Mate's voice picker when present) ---- */
/**
 * Speak a reply (or an alert) out loud.
 * @param {string} text
 * @param {{ms?: number}} [opts]  ms: how long the on-screen copy stays up on a device with no
 *   speech engine (default: by length, see voiceCaptionMs). bite.js weather warnings pass 9000,
 *   the same as the toast they get when hands-free is off.
 */
export function voiceSay(text, opts) {
  if (!text) return;
  Voice.speaking = true;
  // Mute recognition for the utterance plus a tail, so we don't hear ourselves.
  Voice._muteUntil = Date.now() + 1200 + text.length * 60;
  try {
    if (typeof asstSpeak === 'function') {
      /* asstSpeak is silent while First Mate's own read-aloud is muted (its default), which
         made every hands-free reply AND the bite.js weather warnings (spoken instead of
         toasted while Voice.on) vanish without a sound. Hands-free replies are always
         spoken: force it for this one utterance, exactly like the First Mate fallthrough
         below, and put the user's setting straight back (asstSpeak reads it synchronously). */
      const hadSpeak = (typeof ASST !== 'undefined') ? ASST.speak : null;
      if (typeof ASST !== 'undefined') ASST.speak = true;
      try { asstSpeak(text); } finally { if (typeof ASST !== 'undefined') ASST.speak = hadSpeak; }
    } else if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  } catch (e) { /* non-fatal */ }
  /* No speech engine at all (some embedded web views): show it instead of saying nothing.
     Shown even when First Mate's cloud voice is on: that path can still fail (signal drops,
     autoplay blocked) and its fallback is this same missing device voice, so the copy on
     screen is the only guarantee. Spoken and shown at once is a caption, never a loss. */
  if (!('speechSynthesis' in window)) voiceCaption(text, (opts && opts.ms) || voiceCaptionMs(text));
  setTimeout(() => { Voice.speaking = false; }, 600);
}

/* How long a shown reply stays up: long enough to read at the helm. The shared toast default
   (~3 s) cut a two-sentence wind warning short; a short reply gets 4 s, a long one up to the
   9 s bite.js gives its own weather toast. */
export function voiceCaptionMs(text) {
  return Math.min(9000, Math.max(4000, 2500 + String(text || '').length * 80));
}

/* Show a reply as a toast — but never over a toast that carries an action ("Track NOT saved …
   Retry", a voyage that failed to save): that button is the only way to recover the data. The
   reply waits until that toast has gone, then shows (re-checking, so a newer action toast
   defers it again). */
export function voiceCaption(text, ms) {
  let cur;
  try { cur = uiStore.getState().toast; } catch (e) { cur = null; }
  if (cur && cur.action) {
    const heldId = cur.id;
    const unsub = uiStore.subscribe((s) => {
      if (s.toast && s.toast.id === heldId) return;
      unsub();
      voiceCaption(text, ms);
    });
    return;
  }
  try { toast(text, { ms: ms }); } catch (e) { /* non-fatal */ }
}

/* Echo-guard helpers for the speech code in assistant.js (replacing its direct writes to
   Voice._muteUntil, which still work). Extend never shortens; set is exact. */
export function voiceExtendMuteUntil(ts) { Voice._muteUntil = Math.max(Voice._muteUntil || 0, ts); }
export function voiceSetMuteUntil(ts) { Voice._muteUntil = ts; }

/* ---- Wake / command handling ---- */
export function voiceSetAwake(on) {
  Voice.awake = on;
  clearTimeout(Voice._awakeTimer);
  if (on) Voice._awakeTimer = setTimeout(() => voiceSetAwake(false), VOICE_AWAKE_MS);
  voiceUpdateUi();
}

/* Show the command on the tab for a moment — the only on-screen sign of what it heard. */
export function voiceShowHeard(text) {
  Voice._heard = String(text || '');
  clearTimeout(Voice._heardTimer);
  if (Voice._heard) Voice._heardTimer = setTimeout(() => { Voice._heard = ''; voiceUpdateUi(); }, VOICE_HEARD_MS);
  voiceUpdateUi();
}

export async function voiceHandleTranscript(raw) {
  const t = voiceNorm(raw);
  if (!t) return;

  // Not awake yet: only react to the wake word. If the same breath carried a command
  // ("hey fish show me the weather"), run it immediately rather than asking again.
  if (!Voice.awake) {
    const m = t.match(WAKE_RE);
    if (!m) return;
    const rest = t.slice(m.index + m[0].length).trim();
    if (rest) { voiceSetAwake(false); await voiceRun(rest); return; }
    voiceSetAwake(true);
    voiceSay('Aye?');
    return;
  }
  // Awake: treat this utterance as the command (strip a repeated wake word).
  await voiceRun(t.replace(WAKE_RE, '').trim());
}

/* Is this a QUESTION rather than a command to open something?
   "show me the weather" wants the panel. "what's the weather in Catalina" wants an ANSWER —
   and the panel can only ever show the boat's own position, so routing a question there is
   guaranteed to answer the wrong thing. Questions are handed to First Mate instead, which
   can geocode a named place and speak the result back. Only the panel rules are skipped;
   actions ("mark this spot at the point") and the direct readouts still match first. */
export const VOICE_QUESTION_RE = /^(?:what|whats|when|where|why|how|is|are|was|will|should|can|could|do|does|did|any)\b/;
export const VOICE_ELSEWHERE_RE = /\b(?:in|at|near|around|off|by|over)\s+[a-z]/;   // "…in catalina", not "…in 30 feet"
/* …but "near me" / "around here" is THIS boat's position — the one thing the panel
   does answer. Treating it as somewhere-else meant "tides near me" never opened
   the tides panel. */
export const VOICE_SELF_RE = /\b(?:in|at|near|around|off|by|over)\s+(?:me|here|us|my|our|the boat)\b/;
export function voiceIsQuestion(cmd) {
  if (VOICE_QUESTION_RE.test(cmd)) return true;
  return VOICE_ELSEWHERE_RE.test(cmd) && !VOICE_SELF_RE.test(cmd);
}

export async function voiceRun(cmd) {
  if (!cmd) return;
  voiceSetAwake(false);
  voiceShowHeard(cmd);
  const c = voiceMatch(cmd);
  if (c) {
    let say;
    try { say = await c.run(cmd); } catch (e) { say = 'That did not work.'; }
    if (say) voiceSay(say);
    return;
  }
  // No local match → let First Mate field it (it answers offline from boat data too).
  if (typeof asstSend === 'function') {
    /* asstSend silently drops a question while it is still answering the last one —
       hands-free that sounded exactly like being ignored. */
    if (typeof ASST !== 'undefined' && ASST.streaming) { voiceSay('Hang on, I am still answering the last question.'); return; }
    /* Force speech for THIS reply only, then put it back. Setting it permanently
       overrode a deliberate mute for the rest of the session, and left the button
       showing muted while every typed answer was read aloud — so tapping it appeared
       to do the opposite of what it said. */
    const hadSpeak = (typeof ASST !== 'undefined') ? ASST.speak : null;
    if (typeof ASST !== 'undefined') ASST.speak = true;
    // never SHORTEN an existing guard — the cloud path sets it from real audio length
    Voice._muteUntil = Math.max(Voice._muteUntil || 0, Date.now() + 2000);
    /* First Mate may need an on-screen OK before going online (cloud-AI consent) — if a
       dialog opens and waits, voiceAwaitAction says "check the screen" instead of silence. */
    try { await voiceAwaitAction(() => asstSend(cmd)); } catch (e) { voiceSay("Sorry, I couldn't answer that."); }
    finally {
      if (typeof ASST !== 'undefined' && hadSpeak !== null) {
        ASST.speak = hadSpeak;
        if (typeof asstUpdateSpeakBtn === 'function') { try { asstUpdateSpeakBtn(); } catch (e) {} }
      }
    }
  } else {
    voiceSay("I didn't catch a command.");
  }
}

/* ---- Recognition lifecycle ---- */
export function voiceBuildRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = false;
  r.maxAlternatives = 1;

  /* Every handler checks it is still THE current recogniser. abort() dispatches
     `end` asynchronously, so the foreground-resume path (abort → start a new one)
     used to let the old session's onend null out the live one — after which a
     second recogniser was started alongside it. Two live mics meant one "drop the
     anchor" ran twice, and voiceStop() could only abort the one it knew about. */
  r.onresult = (e) => {
    if (Voice.rec !== r || !Voice.on) return;
    if (Date.now() < Voice._muteUntil || Voice.speaking) return;   // ignore our own TTS
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res || !res.isFinal || !res[0]) continue;
      Voice._gotResult = true;      // a session that produced speech is a healthy one
      Voice._fails = 0;
      voiceHandleTranscript(res[0].transcript);
    }
  };
  r.onerror = (e) => {
    if (Voice.rec !== r) return;
    const err = e && e.error;
    // Permission problems are terminal — stop rather than spin restarting forever.
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      voiceStop();
      voicePersist('off');   // don't re-prompt every launch
      const native = voiceIsNative();
      /* In the iPhone app a refusal can't be retried from inside the app: the Microphone /
         Speech Recognition switches live in iOS Settings, and changing them relaunches the
         app (which re-detects). So hide Hey Fish for this session — the tab bar offers First
         Mate instead of a mic button that can only ever fail. */
      if (native) { Voice._unavailable = true; voiceUpdateUi(); }
      if (typeof toast === 'function') {
        toast(native
          ? 'Microphone or speech recognition is off for FishApp — allow both in iOS Settings to use Hey Fish'
          : 'Microphone blocked — enable mic access to use Hey Fish');
      }
      return;
    }
    if (err === 'aborted') return;
    Voice._fails++;
  };
  r.onend = () => {
    if (Voice.rec !== r) return;    // a newer session already took over
    Voice.rec = null;
    if (!Voice._wantOn) { voiceUpdateUi(); return; }
    // Don't respin while backgrounded: the mic is dead there anyway, and a session started
    // hidden would occupy Voice.rec and make the resume below a no-op — voice would stay
    // silently dead after every app switch. visibilitychange owns the resume instead.
    if (document.hidden) return;
    // The engine ends sessions constantly (silence, timeouts). Restart with a light backoff.
    const delay = Math.min(200 * Math.pow(2, Math.min(Voice._fails, 5)), 8000);
    clearTimeout(Voice._restartTimer);
    Voice._restartTimer = setTimeout(voiceStart, delay);
  };
  return r;
}

export function voiceStart() {
  if (!Voice.supported || Voice._unavailable || !Voice._wantOn || Voice.rec) return;
  try {
    Voice.rec = voiceBuildRec();
    Voice.rec.start();
    Voice.on = true;
    /* Do NOT clear _fails here. Starting successfully proves nothing — offshore with
       no data the engine starts fine and then errors every time, and zeroing the
       counter on each start pinned the backoff at 400 ms forever, respinning the mic
       ~2.5×/second for the whole trip. It's cleared in onresult instead: a session
       that actually heard something is the only proof things are working. */
  } catch (e) {
    Voice.rec = null;
    Voice._fails++;
    clearTimeout(Voice._restartTimer);
    Voice._restartTimer = setTimeout(voiceStart, Math.min(500 * Voice._fails, 8000));
  }
  voiceUpdateUi();
}

export function voiceStop() {
  Voice._wantOn = false;
  Voice.on = false;
  Voice._resumePending = false;
  clearTimeout(Voice._restartTimer);
  voiceSetAwake(false);
  if (Voice.rec) { try { Voice.rec.abort(); } catch (e) {} Voice.rec = null; }
  voiceUpdateUi();
  // Hands-free was the last thing holding back a pending app update — apply it now.
  if (typeof applyPendingUpdate === 'function') applyPendingUpdate();
}

/* Publish the tab button's state (it used to toggle classes on #btn-voice). */
export function voiceLabel() {
  if (Voice._heard) return Voice._heard;
  if (Voice.on) return 'Listening';
  if (Voice._wantOn) return 'Starting';     // wanted, but no live session yet (start failed, backing off)
  return 'Hey Fish';
}
export function voiceUpdateUi() {
  voiceStore.setState({
    supported: !!Voice.supported && !Voice._unavailable,
    on: !!(Voice.on || Voice._wantOn),
    listening: !!Voice.on,
    awake: !!Voice.awake,
    resumePending: !!Voice._resumePending,
    label: voiceLabel(),
    transcript: Voice._heard,
  });
}

/* localStorage can throw (private mode, quota, a locked-down web view). These used to be
   bare calls inside voiceToggle — a throw there left _wantOn stuck true with no session,
   which also held back every app update for the rest of the day. */
export function voicePersist(v) {
  try { localStorage.setItem('fishapp.voice', v); } catch (e) { /* preference only */ }
}
export function voiceStoredOn() {
  try { return localStorage.getItem('fishapp.voice') === 'on'; } catch (e) { return false; }
}
function voiceIsNative() {
  try { return isNativeShell(); } catch (e) { return false; }
}

/* Toggled from the voice tab. The first tap is the user gesture that unlocks mic + audio,
   so this must run synchronously inside the click handler — never from an effect. */
export function voiceToggle() {
  if (!Voice.supported || Voice._unavailable) {
    if (typeof toast === 'function') {
      toast(voiceIsNative()
        ? "Hands-free voice isn't available on this device — use First Mate to talk"
        : "This browser can't do always-on voice — use the mic in First Mate to talk");
    }
    if (typeof togglePanel === 'function') togglePanel('assistant');
    return;
  }
  Voice._resumePending = false;
  if (Voice.on || Voice._wantOn) {
    voiceStop();
    voicePersist('off');
    if (typeof toast === 'function') toast('Hands-free off');
    return;
  }
  Voice._wantOn = true;
  Voice._fails = 0;
  voicePersist('on');
  if (typeof unlockAudio === 'function') { try { unlockAudio(); } catch (e) {} }      // let us speak back later (iOS)
  if (typeof requestWakeLock === 'function') { try { requestWakeLock(); } catch (e) {} }
  voiceStart();
  if (typeof toast === 'function') toast('Listening — say “Hey Fish” then your command');
  voiceSay('Hands free on. Say hey fish when you need me.');
}

/* Pause while hidden (the engine dies in the background anyway) and resume on return —
   without this the restart loop burns battery for a mic that isn't recording.
   Registered once at module load (a module-level singleton — never from React, where
   StrictMode or a remount would register it twice). */
export function voiceOnVisibility() {
  if (!Voice._wantOn) return;
  clearTimeout(Voice._restartTimer);
  if (document.visibilityState === 'visible') {
    // Force a clean session: any recogniser left over from before the app was hidden is
    // dead but still occupying Voice.rec, which would make voiceStart() a no-op.
    if (Voice.rec) { try { Voice.rec.abort(); } catch (e) {} Voice.rec = null; }
    Voice._fails = 0;
    voiceStart();
  } else {
    if (Voice.rec) { try { Voice.rec.abort(); } catch (e) {} Voice.rec = null; }
    /* Say so. Voice.on stayed true while backgrounded, so the toolbar kept reading
       "listening" over a dead mic — and bite.js routes its weather alerts to SPEECH
       whenever Voice.on, so a warning could be spoken to a mic that wasn't running
       instead of shown as a toast. _wantOn still holds the intent to resume. */
    Voice.on = false;
    voiceUpdateUi();
  }
}
document.addEventListener('visibilitychange', voiceOnVisibility);

/* The voice tab carries this attribute (and id="btn-voice"), so the relaunch resume can
   leave a tap on it to voiceToggle. */
export const VOICE_TOGGLE_SELECTOR = '#btn-voice, [data-voice-toggle]';

export function voiceInit() {
  voiceUpdateUi();
  /* Can't auto-start: browsers demand a user gesture to open the mic. But if hands-free was
     on before this load (app relaunch, or a service-worker update reloading the page), don't
     make the user go find the button — resume on the FIRST tap anywhere. */
  if (Voice.supported && voiceStoredOn() && !Voice._resumePending && !Voice.on && !Voice._wantOn) {
    const resume = (e) => {
      document.removeEventListener('pointerdown', resume, true);
      // Only a resume that is still pending acts: if the user already switched hands-free on
      // or off another way (keyboard, a permission error), this first tap must not override it.
      const pending = Voice._resumePending;
      Voice._resumePending = false;
      if (!pending) { voiceUpdateUi(); return; }
      // If that first tap WAS the mic button, let voiceToggle own it — otherwise we'd turn
      // voice on here and its handler would immediately toggle it back off.
      if (e && e.target && e.target.closest && e.target.closest(VOICE_TOGGLE_SELECTOR)) { voiceUpdateUi(); return; }
      if (Voice.on || Voice._wantOn) { voiceUpdateUi(); return; }
      Voice._wantOn = true;
      Voice._fails = 0;
      if (typeof unlockAudio === 'function') { try { unlockAudio(); } catch (e2) {} }
      if (typeof requestWakeLock === 'function') { try { requestWakeLock(); } catch (e2) {} }
      voiceStart();
      if (typeof toast === 'function') toast('Hands-free resumed — say “Hey Fish”');
    };
    Voice._resumePending = true;
    document.addEventListener('pointerdown', resume, true);
    voiceUpdateUi();
    if (typeof toast === 'function') toast('Tap anywhere to resume hands-free');
  }
}
