import { createStore } from 'zustand/vanilla';
import { GPS, WakeLock } from './gps.js';
import { Tracks } from './tracks.js';
import { Nav } from './nav.js';
import { Goto } from './goto.js';
import { backgroundLocation, isNativeShell } from '../services/native';

/* ============================================================================
   Staying alive in the background.

   The problem this exists for: browsers freeze or heavily throttle a page that
   isn't in front. If that happens while an anchor watch is armed, the watch stops
   without a sound — the single worst failure this app can have, because you're
   asleep and trusting it.

   What can actually be done, honestly:

   - A page that is PLAYING AUDIO is not throttled or unloaded. So while something
     safety-critical is running we keep a near-silent loop going. This is what lets
     the drift check and the no-GPS watchdog keep ticking after you switch apps.

   - It does NOT bring back GPS on iOS. Apple stops delivering location to web
     content when the screen locks, full stop — no API, no workaround. So the goal
     here is not to pretend the watch still works. It's the opposite: keep enough of
     the app running to NOTICE that it has gone blind, and make a loud noise about
     it. A silent failure becomes an audible one.

   - Notifications let that alarm surface when the app isn't the front window.

   - Inside the native iPhone app (window.FishNative) CoreLocation CAN keep running
     with the screen locked, so background location is switched on — only while an
     anchor watch, a track recording or a Go-To actually needs it.

   - The near-silent audio loop is NEVER played inside the native iPhone app. There the
     shell's own background location and its native anchor monitor (alarm tone +
     notification, see nav.js anchorSyncNative) do the job, and a continuous silent track
     would both duck the user's music all night (the shell's audio session ducks others)
     and break App Review's background-audio rule (Guideline 2.5.4: "no silent or
     continuous audio is played").

   Cost: playing audio can interrupt whatever else the phone is playing, so this
   only runs while a watch or recording is actually armed, and it can be turned off.
   ============================================================================ */
'use strict';

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

export const Awake = {
  reasons: new Set(),        // what currently needs us alive ('anchor', 'track', …)
  audio: null,
  enabled: safeGet('fishapp.keepalive') !== 'off',
  _notifyAsked: false,
};

export const KEEPALIVE_ON_TEXT = 'On — the app keeps running in the background while a watch or recording is armed. May interrupt music.';
export const KEEPALIVE_OFF_TEXT = 'Off — the anchor watch and track recording stop when you switch apps.';
export const KEEPALIVE_NATIVE_TEXT = 'Not used in the iPhone app — it keeps GPS and the anchor alarm running itself while a watch, recording or Go-To is active.';

/* Whether the audio keep-alive should run at all: the setting is on, and we are not inside
   the native iPhone app (see the header — it never plays there). */
export function awakeKeepAliveWanted() { return !!Awake.enabled && !isNativeShell(); }

/** True when nothing is missing on the keep-alive side: either it isn't wanted right now, or
 *  the loop is really playing (not merely created — iOS can refuse or pause it). */
export function awakeKeepAliveOk() {
  if (!awakeKeepAliveWanted() || Awake.reasons.size === 0) return true;
  return !!(Awake.audio && !Awake.audio.paused);
}

/* ---- View store: the watch band under the HUD + the Device settings line ---- */
/**
 * @typedef {Object} AwakeView
 * @property {boolean} visible        a watch or recording is armed
 * @property {boolean} warn           it cannot fully do its job right now (no GPS, screen may sleep, keep-alive down)
 * @property {string} what            "Anchor watch · Recording"
 * @property {string} detail          problems, or "GPS 4s ago · keep the screen on"
 * @property {boolean} anchor
 * @property {boolean} track
 * @property {number|null} fixAgeS
 * @property {'on'|'off'|'running'|'warn'|'native'} keepAliveKind   'native' = not used (iPhone app)
 * @property {string} keepAliveText   the Device section's status line
 * @property {boolean} bgLocation     native background GPS currently requested
 */
/** @type {import('zustand/vanilla').StoreApi<AwakeView>} */
export const awakeStore = createStore(() => /** @type {AwakeView} */ ({
  visible: false, warn: false, what: '', detail: '', anchor: false, track: false, fixAgeS: null,
  keepAliveKind: isNativeShell() ? 'native' : Awake.enabled ? 'on' : 'off',
  keepAliveText: isNativeShell() ? KEEPALIVE_NATIVE_TEXT : Awake.enabled ? KEEPALIVE_ON_TEXT : KEEPALIVE_OFF_TEXT,
  bgLocation: false,
}));

/* A 1-second WAV of very quiet noise, built at runtime so there's no asset to ship
   or cache. Not pure digital silence on purpose: some platforms treat an all-zero
   stream as "nothing playing" and throttle the page anyway. It's far below hearing
   at any normal volume. */
export function awakeSilentWavUrl() {
  const rate = 8000, secs = 1, n = rate * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, (i % 2 ? 1 : -1), true);   // ±1/32768
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/* Ref-counted: the anchor watch and the track recorder can both want us awake, and
   one finishing must not switch it off under the other. */
export function awakeAcquire(reason) {
  Awake.reasons.add(reason);
  awakeApply();
}
export function awakeRelease(reason) {
  Awake.reasons.delete(reason);
  awakeApply();
}

/* Returns a promise that settles (never rejects) once the play attempt it started has
   succeeded or failed — the restored-watch primer in nav.js waits on it before saying
   "armed". Resolves at once when there was nothing to start. */
export function awakeApply() {
  awakeSyncBackgroundLocation();
  const want = awakeKeepAliveWanted() && Awake.reasons.size > 0;
  /** @type {Promise<void>} */
  let settled = Promise.resolve();
  /* Also restart a loop the OS paused (a phone call, another app taking the audio session):
     it still exists, but it isn't keeping anything alive any more. */
  if (want && (!Awake.audio || Awake.audio.paused)) {
    try {
      let a = Awake.audio;
      if (!a) {
        a = new Audio(awakeSilentWavUrl());
        a.loop = true;
        a.volume = 0.02;
        a.setAttribute('playsinline', '');
      }
      const el = a;
      /* Must be started from a user gesture — it always is, because every reason
         we take is armed by a button tap (drop anchor, start recording). A restored
         anchor watch is the exception: it retries from the next taps (nav.js). */
      const p = el.play();
      Awake.audio = el;
      if (p && typeof p.then === 'function') {
        settled = p.then(
          () => { awakePublishKeepAlive(); awakeUpdateUi(); },
          () => {
            if (Awake.audio === el) {
              Awake.audio = null;
              try { URL.revokeObjectURL(el.src); } catch (e) {}
            }
            awakePublishKeepAlive(); awakeUpdateUi();
          });
      }
    } catch (e) { Awake.audio = null; }
  } else if (!want && Awake.audio) {
    try { Awake.audio.pause(); URL.revokeObjectURL(Awake.audio.src); } catch (e) {}
    Awake.audio = null;
  }
  awakePublishKeepAlive();
  awakeUpdateUi();
  return settled;
}

export function awakeSetEnabled(on) {
  Awake.enabled = on;
  try { localStorage.setItem('fishapp.keepalive', on ? 'on' : 'off'); } catch (e) {}
  awakeApply();
  awakePublishKeepAlive();
}

/* The Device section's line. The text is the legacy pair; the kind says what is
   actually happening right now (so the settings never claim more than is true). */
export function awakePublishKeepAlive() {
  if (isNativeShell()) {
    // the iPhone app never plays the loop — say so instead of "On … may interrupt music"
    awakeStore.setState({ keepAliveKind: 'native', keepAliveText: KEEPALIVE_NATIVE_TEXT });
    return;
  }
  const kind = !Awake.enabled ? 'off'
    : (Awake.audio && !Awake.audio.paused) ? 'running'
    : Awake.reasons.size > 0 ? 'warn'
    : 'on';
  awakeStore.setState({ keepAliveKind: kind, keepAliveText: Awake.enabled ? KEEPALIVE_ON_TEXT : KEEPALIVE_OFF_TEXT });
}

/* ---- Native iOS shell: background GPS, only while it is needed ----
   App Review expects background location to be purposeful, so the shell runs CoreLocation
   with the screen locked only while an anchor watch, a track recording or an active Go-To
   wants it. Re-evaluated whenever one of those starts or stops (no-op on the web). */
let _bgLocOn = false;
export function awakeWantsBackgroundLocation() {
  return !!((Nav && Nav.anchor && Nav.anchor.watching) || (Tracks && Tracks.recording) || (Goto && Goto.active));
}
export function awakeSyncBackgroundLocation() {
  const want = awakeWantsBackgroundLocation();
  if (want === _bgLocOn) return;
  _bgLocOn = want;
  try { backgroundLocation(want); } catch (e) {}
  awakeStore.setState({ bgLocation: want });
}

/* ---- Notifications: let an alarm surface when the app isn't in front ----
   Asked for only when a watch is actually armed, so it isn't a cold prompt on
   first launch. On iOS this needs the app installed to the Home Screen. The native
   iPhone app has no web Notification API or service worker — the full-screen alarm,
   sound and haptics carry it there. */
export function awakeAskNotify() {
  if (Awake._notifyAsked) return;
  Awake._notifyAsked = true;
  if (isNativeShell()) return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
  } catch (e) {}
}

/* serviceWorker.ready never settles when no worker registers (dev builds, a failed
   install) — never let an alarm notification wait on it forever. */
export const NOTIFY_SW_WAIT_MS = 3000;
export function awakeNotify(title, body) {
  if (isNativeShell()) return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
      body: body,
      tag: 'fishapp-alarm',            // replace, don't stack
      renotify: true,
      requireInteraction: true,        // stays up until acknowledged
      vibrate: [500, 200, 500, 200, 500],
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    };
    const direct = () => { try { new Notification(title, opts); } catch (e) {} };
    /* Prefer the service worker: on mobile, page-created Notifications are often
       refused outright, and the SW can show one even when the page is hidden. */
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      let timer = null;
      Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('no service worker')), NOTIFY_SW_WAIT_MS); }),
      ])
        .then((reg) => reg.showNotification(title, opts))
        .catch(direct)
        .finally(() => clearTimeout(timer));
    } else {
      direct();
    }
  } catch (e) { /* notifications are a bonus, never a dependency */ }
}

/* ---- Honest status ----
   Whether the safety net is actually up, in plain words. The point is that the app
   should never look like it's watching when it isn't. */
export function awakeHealth() {
  const armed = Awake.reasons.size > 0;
  const fixAgeS = (typeof GPS !== 'undefined' && GPS.lastFixTs)
    ? Math.round((Date.now() - GPS.lastFixTs) / 1000) : null;
  return {
    armed: armed,
    // playing, not merely created: iOS can refuse play() or pause the loop later
    keepAlive: !!(Awake.audio && !Awake.audio.paused),
    // never wanted in the iPhone app (it doesn't play there), so the band must not warn about it
    keepAliveWanted: awakeKeepAliveWanted(),
    screenLock: !!(typeof WakeLock !== 'undefined' && WakeLock.lock),
    screenLockWanted: !!(typeof WakeLock !== 'undefined' && WakeLock.enabled && WakeLock.supported),
    notify: (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'unsupported',
    fixAgeS: fixAgeS,
    gpsOk: fixAgeS != null && fixAgeS < 60,
  };
}

/** Pure: the watch-band model from a health reading (legacy copy, emoji removed). */
export function awakeBannerModel(h, anchor, track) {
  if (!h.armed) return { visible: false, warn: false, what: '', detail: '' };
  const what = [];
  if (anchor) what.push('Anchor watch');
  if (track) what.push('Recording');
  const problems = [];
  if (!h.gpsOk) problems.push(h.fixAgeS == null ? 'no GPS fix yet' : 'no GPS for ' + h.fixAgeS + 's');
  if (!h.screenLock && h.screenLockWanted) problems.push('screen may sleep');
  if (!h.keepAlive && h.keepAliveWanted) problems.push('background keep-alive not running');
  return {
    visible: true,
    warn: problems.length > 0,
    what: what.join(' · ') || 'Watching',
    detail: problems.length
      ? problems.join(' · ')
      : (h.fixAgeS != null ? 'GPS ' + h.fixAgeS + 's ago · keep the screen on' : 'keep the screen on'),
  };
}

/* The persistent banner. Visible from anywhere in the app whenever a watch is
   armed — the panel's own status line is no good when the panel is closed, which
   is exactly when you're relying on it. */
export function awakeUpdateUi() {
  const h = awakeHealth();
  const anchor = !!(typeof Nav !== 'undefined' && Nav && Nav.anchor && Nav.anchor.watching);
  const track = !!(typeof Tracks !== 'undefined' && Tracks && Tracks.recording);
  const m = awakeBannerModel(h, anchor, track);
  awakeStore.setState({
    visible: m.visible, warn: m.warn, what: m.what, detail: m.detail,
    anchor: h.armed && anchor, track: h.armed && track, fixAgeS: h.fixAgeS,
  });
}

/* Tick the banner so the fix age is live rather than a number frozen at arm time —
   a stale "GPS 2s ago" reading is worse than none. */
setInterval(() => { if (Awake.reasons.size) awakeUpdateUi(); }, 5000);

/* Re-check the screen lock when we come back to the front: the OS drops it while
   hidden, and if it can't be re-taken the banner should say so rather than imply
   the screen will stay on. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(awakeUpdateUi, 400);
});
