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

   Cost: playing audio can interrupt whatever else the phone is playing, so this
   only runs while a watch or recording is actually armed, and it can be turned off.
   ============================================================================ */
'use strict';

const Awake = {
  reasons: new Set(),        // what currently needs us alive ('anchor', 'track', …)
  audio: null,
  enabled: localStorage.getItem('fishapp.keepalive') !== 'off',
  _notifyAsked: false,
};

/* A 1-second WAV of very quiet noise, built at runtime so there's no asset to ship
   or cache. Not pure digital silence on purpose: some platforms treat an all-zero
   stream as "nothing playing" and throttle the page anyway. It's far below hearing
   at any normal volume. */
function awakeSilentWavUrl() {
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
function awakeAcquire(reason) {
  Awake.reasons.add(reason);
  awakeApply();
}
function awakeRelease(reason) {
  Awake.reasons.delete(reason);
  awakeApply();
}

function awakeApply() {
  const want = Awake.enabled && Awake.reasons.size > 0;
  if (want && !Awake.audio) {
    try {
      const a = new Audio(awakeSilentWavUrl());
      a.loop = true;
      a.volume = 0.02;
      a.setAttribute('playsinline', '');
      /* Must be started from a user gesture — it always is, because every reason
         we take is armed by a button tap (drop anchor, start recording). */
      const p = a.play();
      if (p && p.catch) p.catch(() => { Awake.audio = null; });
      Awake.audio = a;
    } catch (e) { Awake.audio = null; }
  } else if (!want && Awake.audio) {
    try { Awake.audio.pause(); URL.revokeObjectURL(Awake.audio.src); } catch (e) {}
    Awake.audio = null;
  }
  awakeUpdateUi();
}

function awakeSetEnabled(on) {
  Awake.enabled = on;
  localStorage.setItem('fishapp.keepalive', on ? 'on' : 'off');
  awakeApply();
  const s = document.getElementById('keepalive-status');
  if (s) {
    s.textContent = on
      ? 'On — the app keeps running in the background while a watch or recording is armed. May interrupt music.'
      : 'Off — the anchor watch and track recording stop when you switch apps.';
  }
}

/* ---- Notifications: let an alarm surface when the app isn't in front ----
   Asked for only when a watch is actually armed, so it isn't a cold prompt on
   first launch. On iOS this needs the app installed to the Home Screen. */
function awakeAskNotify() {
  if (Awake._notifyAsked) return;
  Awake._notifyAsked = true;
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
  } catch (e) {}
}

function awakeNotify(title, body) {
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
    /* Prefer the service worker: on mobile, page-created Notifications are often
       refused outright, and the SW can show one even when the page is hidden. */
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, opts))
        .catch(() => { try { new Notification(title, opts); } catch (e) {} });
    } else {
      new Notification(title, opts);
    }
  } catch (e) { /* notifications are a bonus, never a dependency */ }
}

/* ---- Honest status ----
   Whether the safety net is actually up, in plain words. The point is that the app
   should never look like it's watching when it isn't. */
function awakeHealth() {
  const armed = Awake.reasons.size > 0;
  const fixAgeS = (typeof GPS !== 'undefined' && GPS.lastFixTs)
    ? Math.round((Date.now() - GPS.lastFixTs) / 1000) : null;
  return {
    armed: armed,
    keepAlive: !!Awake.audio,
    keepAliveWanted: Awake.enabled,
    screenLock: !!(typeof WakeLock !== 'undefined' && WakeLock.lock),
    screenLockWanted: !!(typeof WakeLock !== 'undefined' && WakeLock.enabled && WakeLock.supported),
    notify: ('Notification' in window) ? Notification.permission : 'unsupported',
    fixAgeS: fixAgeS,
    gpsOk: fixAgeS != null && fixAgeS < 60,
  };
}

/* The persistent banner. Visible from anywhere in the app whenever a watch is
   armed — the panel's own status line is no good when the panel is closed, which
   is exactly when you're relying on it. */
function awakeUpdateUi() {
  const el = document.getElementById('watch-banner');
  if (!el) return;
  const h = awakeHealth();
  if (!h.armed) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  const what = [];
  if (typeof Nav !== 'undefined' && Nav.anchor && Nav.anchor.watching) what.push('⚓ Anchor watch');
  if (typeof Tracks !== 'undefined' && Tracks.recording) what.push('⏺ Recording');
  const problems = [];
  if (!h.gpsOk) problems.push(h.fixAgeS == null ? 'no GPS fix yet' : 'no GPS for ' + h.fixAgeS + 's');
  if (!h.screenLock && h.screenLockWanted) problems.push('screen may sleep');
  if (!h.keepAlive && h.keepAliveWanted) problems.push('background keep-alive not running');

  el.className = problems.length ? 'warn' : '';
  document.getElementById('wb-what').textContent = what.join(' · ') || 'Watching';
  document.getElementById('wb-detail').textContent = problems.length
    ? '⚠️ ' + problems.join(' · ')
    : (h.fixAgeS != null ? 'GPS ' + h.fixAgeS + 's ago · keep the screen on' : 'keep the screen on');
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
