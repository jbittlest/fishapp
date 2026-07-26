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
     leave the tap-to-talk mic in First Mate as the fallback. */
'use strict';

const Voice = {
  on: false,             // user has enabled hands-free
  awake: false,          // wake word heard; a command is expected
  rec: null,
  speaking: false,
  _awakeTimer: null,
  _restartTimer: null,
  _muteUntil: 0,         // ignore recognition results until this timestamp (echo guard)
  _fails: 0,             // consecutive start failures, for backoff
  _wantOn: false,        // desired state, so onend knows whether to restart
  supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
};

const VOICE_AWAKE_MS = 9000;    // how long we listen for a command after the wake word

/* "hey fish" survives a lot of mishearing — accept the common ones rather than making the
   user enunciate perfectly over engine noise. A bare "a fish" is deliberately NOT accepted:
   on a fishing boat "I caught a fish" would wake it constantly. */
const WAKE_RE = /\b(?:hey|hay|hi|high|ok|okay)\s*(?:fish|fisch|fist|phish|vish|fresh|finch)\b/;

function voiceNorm(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---- Command table. First match wins, so specific actions precede the panel keywords
   they share words with ("drop anchor" before "anchor" → Nav tools). ---- */
const VOICE_COMMANDS = [
  // --- actions ---
  { re: /\b(?:mark|save)(?: this)?(?: spot| pin| waypoint| location| place)?\b|\bdrop a (?:pin|waypoint|mark)\b/,
    run: () => voiceMarkSpot() },
  { re: /\bstart (?:the )?route\b|\bfollow (?:the )?route\b/,
    run: () => voiceCall('routeStart', 'Starting the route.') },
  { re: /\b(?:stop|cancel|end) (?:the )?(?:navigation|navigating|route|nav)\b/,
    run: () => voiceCall('gotoCancel', 'Navigation stopped.') },
  // Anchor/track report their real resulting state — hands-free means the user can't read
  // the toast these actions normally rely on.
  { re: /\bdrop (?:the )?anchor\b|\banchor watch on\b/, run: () => {
      if (typeof anchorDrop !== 'function') return "I can't do that right now.";
      anchorDrop();
      return (typeof Nav !== 'undefined' && Nav.anchor.watching)
        ? 'Anchor watch on, ' + Nav.anchor.radiusFt + ' feet.'
        : 'No GPS fix yet, so I could not set the anchor watch.';
    } },
  { re: /\braise (?:the )?anchor\b|\banchor watch off\b/,
    run: () => voiceCall('anchorRaise', 'Anchor up.') },
  { re: /\b(?:start|stop|record)(?: a| the)? track(?:ing)?\b/, run: () => {
      if (typeof trackToggle !== 'function') return "I can't do that right now.";
      trackToggle();
      return (typeof Tracks !== 'undefined' && Tracks.recording) ? 'Recording your track.' : 'Track saved.';
    } },
  // animate:false — a zoom that depends on an animation completing can silently do nothing
  // if the compositor is stalled, and by voice there's no visual cue to retry.
  { re: /\bzoom in\b|\bcloser\b/,
    run: () => { window._map.setZoom(window._map.getZoom() + 1, { animate: false }); return 'Zooming in.'; } },
  { re: /\bzoom out\b|\bwider\b/,
    run: () => { window._map.setZoom(window._map.getZoom() - 1, { animate: false }); return 'Zooming out.'; } },
  { re: /\b(?:follow me|center|centre|recenter|recentre|find me)\b/,
    run: () => { if (typeof setFollow === 'function') setFollow(true); return 'Following you.'; } },
  { re: /\b(?:close|dismiss|hide|never mind|go back|nothing)\b/,
    run: () => { if (typeof closePanels === 'function') closePanels(); return 'Closed.'; } },

  // --- spoken answers straight from live boat data (instant, no AI round-trip) ---
  { re: /\bwhere am i\b|\bmy position\b|\bcoordinates?\b/, run: () => voiceSayPosition() },
  { re: /\bhow fast\b|\bmy speed\b|\bspeed\b/, run: () => voiceSaySpeed() },

  // --- panels ---
  { re: /\b(?:weather|wind|forecast|waves?|swell)\b/, run: () => voicePanel('panel-weather', 'Weather.') },
  { re: /\b(?:tide|tides|bite time|solunar|moon)\b/, run: () => voicePanel('panel-tides', 'Tides and bite times.') },
  { re: /\b(?:spots?|waypoints?|tracks?|voyages?)\b/, run: () => voicePanel('panel-spots', 'Your spots.') },
  { re: /\b(?:nav tools?|tools?|catch log|trip)\b/, run: () => voicePanel('panel-tools', 'Nav tools.') },
  // Download must precede the layers rule — "offline charts" also contains "charts".
  { re: /\b(?:download|offline)\b/, run: () => voicePanel('panel-download', 'Offline charts.') },
  { re: /\b(?:layers?|chart|charts|map)\b/, run: () => voicePanel('panel-layers', 'Map layers.') },
  { re: /\b(?:guides?|knots?|fish id|regulations?|limits?)\b/, run: () => voicePanel('panel-knots', 'Guides.') },
  { re: /\b(?:emergency|mayday|sos|distress)\b/, run: () => voicePanel('panel-emergency', 'Emergency.') },
  { re: /\b(?:more|menu)\b/, run: () => voicePanel('panel-more', 'More.') },
];

function voicePanel(id, say) {
  if (typeof togglePanel === 'function') {
    const el = document.getElementById(id);
    if (el && el.classList.contains('hidden')) togglePanel(id);
  }
  return say;
}
/* Call a global action if it exists; returns what to say back. */
function voiceCall(fnName, say) {
  if (typeof window[fnName] !== 'function') return "I can't do that right now.";
  try { window[fnName](); } catch (e) { return 'That did not work.'; }
  return say;   // null → stay silent (the action toasts/speaks for itself)
}

async function voiceMarkSpot() {
  const ll = (typeof GPS !== 'undefined' && GPS.lastLatLng) || (window._map && window._map.getCenter());
  if (!ll) return 'No GPS fix yet, so I can’t mark a spot.';
  const name = 'Voice mark ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (typeof asstCreateSpot !== 'function') return "I can't save spots right now.";
  try {
    await asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: 'fish' });
    return 'Marked this spot.';
  } catch (e) { return 'I could not save that spot.'; }
}
function voiceSayPosition() {
  const ll = typeof GPS !== 'undefined' ? GPS.lastLatLng : null;
  if (!ll) return 'No GPS fix yet.';
  if (typeof formatCoord === 'function') {
    return 'You are at ' + formatCoord(ll.lat, 'lat') + ', ' + formatCoord(ll.lng, 'lon');
  }
  return 'You are at ' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4);
}
function voiceSaySpeed() {
  const c = (typeof GPS !== 'undefined' && GPS.last) ? GPS.last.coords : null;
  if (!c || c.speed == null || isNaN(c.speed)) return 'No speed reading yet.';
  return Math.round(c.speed * 1.94384) + ' knots.';
}

/* ---- Speaking (reuses First Mate's voice picker when present) ---- */
function voiceSay(text) {
  if (!text) return;
  Voice.speaking = true;
  // Mute recognition for the utterance plus a tail, so we don't hear ourselves.
  Voice._muteUntil = Date.now() + 1200 + text.length * 60;
  try {
    if (typeof asstSpeak === 'function') { asstSpeak(text); }
    else if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  } catch (e) { /* non-fatal */ }
  setTimeout(() => { Voice.speaking = false; }, 600);
}

/* ---- Wake / command handling ---- */
function voiceSetAwake(on) {
  Voice.awake = on;
  clearTimeout(Voice._awakeTimer);
  const btn = document.getElementById('btn-voice');
  if (btn) btn.classList.toggle('awake', on);
  if (on) Voice._awakeTimer = setTimeout(() => voiceSetAwake(false), VOICE_AWAKE_MS);
}

async function voiceHandleTranscript(raw) {
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

async function voiceRun(cmd) {
  if (!cmd) return;
  voiceSetAwake(false);
  for (const c of VOICE_COMMANDS) {
    if (c.re.test(cmd)) {
      let say;
      try { say = await c.run(); } catch (e) { say = 'That did not work.'; }
      if (say) voiceSay(say);
      return;
    }
  }
  // No local match → let First Mate field it (it answers offline from boat data too).
  if (typeof asstSend === 'function') {
    if (typeof ASST !== 'undefined') ASST.speak = true;   // hands-free: always read replies
    Voice._muteUntil = Date.now() + 2000;                 // don't hear our own answer
    try { await asstSend(cmd); } catch (e) { voiceSay("Sorry, I couldn't answer that."); }
  } else {
    voiceSay("I didn't catch a command.");
  }
}

/* ---- Recognition lifecycle ---- */
function voiceBuildRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = false;
  r.maxAlternatives = 1;

  r.onresult = (e) => {
    if (!Voice.on) return;
    if (Date.now() < Voice._muteUntil || Voice.speaking) return;   // ignore our own TTS
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res || !res.isFinal || !res[0]) continue;
      voiceHandleTranscript(res[0].transcript);
    }
  };
  r.onerror = (e) => {
    const err = e && e.error;
    // Permission problems are terminal — stop rather than spin restarting forever.
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      voiceStop();
      if (typeof toast === 'function') toast('🎤 Microphone blocked — enable mic access to use Hey Fish');
      return;
    }
    if (err === 'aborted') return;
    Voice._fails++;
  };
  r.onend = () => {
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

function voiceStart() {
  if (!Voice.supported || !Voice._wantOn || Voice.rec) return;
  try {
    Voice.rec = voiceBuildRec();
    Voice.rec.start();
    Voice.on = true;
    Voice._fails = 0;
  } catch (e) {
    Voice.rec = null;
    Voice._fails++;
    clearTimeout(Voice._restartTimer);
    Voice._restartTimer = setTimeout(voiceStart, Math.min(500 * Voice._fails, 8000));
  }
  voiceUpdateUi();
}

function voiceStop() {
  Voice._wantOn = false;
  Voice.on = false;
  clearTimeout(Voice._restartTimer);
  voiceSetAwake(false);
  if (Voice.rec) { try { Voice.rec.abort(); } catch (e) {} Voice.rec = null; }
  voiceUpdateUi();
}

function voiceUpdateUi() {
  const btn = document.getElementById('btn-voice');
  if (!btn) return;
  btn.classList.toggle('listening', !!Voice.on);
  const lbl = btn.querySelector('.tb-lbl');
  if (lbl) lbl.textContent = Voice.on ? 'Listening' : 'Hey Fish';
}

/* Toggled from the 🎤 tab. The first tap is the user gesture that unlocks mic + audio. */
function voiceToggle() {
  if (!Voice.supported) {
    if (typeof toast === 'function') {
      toast("🎤 This browser can't do always-on voice — use the mic in First Mate to talk");
    }
    if (typeof togglePanel === 'function') togglePanel('panel-assistant');
    return;
  }
  if (Voice.on || Voice._wantOn) {
    voiceStop();
    localStorage.setItem('fishapp.voice', 'off');
    if (typeof toast === 'function') toast('🎤 Hands-free off');
    return;
  }
  Voice._wantOn = true;
  Voice._fails = 0;
  localStorage.setItem('fishapp.voice', 'on');
  if (typeof unlockAudio === 'function') unlockAudio();      // let us speak back later (iOS)
  if (typeof requestWakeLock === 'function') requestWakeLock();
  voiceStart();
  if (typeof toast === 'function') toast('🎤 Listening — say “Hey Fish” then your command');
  voiceSay('Hands free on. Say hey fish when you need me.');
}

/* Pause while hidden (the engine dies in the background anyway) and resume on return —
   without this the restart loop burns battery for a mic that isn't recording. */
document.addEventListener('visibilitychange', () => {
  if (!Voice._wantOn) return;
  clearTimeout(Voice._restartTimer);
  if (document.visibilityState === 'visible') {
    // Force a clean session: any recogniser left over from before the app was hidden is
    // dead but still occupying Voice.rec, which would make voiceStart() a no-op.
    if (Voice.rec) { try { Voice.rec.abort(); } catch (e) {} Voice.rec = null; }
    Voice._fails = 0;
    voiceStart();
  } else if (Voice.rec) {
    try { Voice.rec.abort(); } catch (e) {} Voice.rec = null;
  }
});

function voiceInit() {
  voiceUpdateUi();
  const btn = document.getElementById('btn-voice');
  if (btn && !Voice.supported) btn.classList.add('unsupported');
  /* Can't auto-start: browsers demand a user gesture to open the mic. But if hands-free was
     on before this load (app relaunch, or a service-worker update reloading the page), don't
     make the user go find the button — resume on the FIRST tap anywhere. */
  if (Voice.supported && localStorage.getItem('fishapp.voice') === 'on') {
    const resume = (e) => {
      document.removeEventListener('pointerdown', resume, true);
      // If that first tap WAS the mic button, let voiceToggle own it — otherwise we'd turn
      // voice on here and its handler would immediately toggle it back off.
      if (e && e.target && e.target.closest && e.target.closest('#btn-voice')) return;
      if (Voice.on || Voice._wantOn) return;
      Voice._wantOn = true;
      Voice._fails = 0;
      if (typeof unlockAudio === 'function') unlockAudio();
      if (typeof requestWakeLock === 'function') requestWakeLock();
      voiceStart();
      if (typeof toast === 'function') toast('🎤 Hands-free resumed — say “Hey Fish”');
    };
    document.addEventListener('pointerdown', resume, true);
    if (typeof toast === 'function') toast('🎤 Tap anywhere to resume hands-free');
  }
}
