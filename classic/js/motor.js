/* Minn Kota trolling motor link — Bluetooth LE transport, protocol workbench, safety interlocks
   ---------------------------------------------------------------------------------------------
   Johnson Outdoors publishes no SDK, no protocol, and nothing usable by a third party. There is
   also (as of this writing) no public reverse-engineering work to build on. So this module ships
   deliberately EMPTY of protocol knowledge: it is the transport and the safety cage, and the
   command frames get filled in by you from a packet capture (see MOTOR.md).

   Two hard platform facts shape everything here:

   1. iOS Safari has never supported Web Bluetooth, in any version — and because Apple mandates
      WebKit, Chrome and Edge on iPhone inherit the same gap. A page in Safari CANNOT reach the
      motor. FishApp must be opened in Bluefy (free, App Store) for this panel to do anything.
      We detect that and say so plainly rather than failing with a bare "undefined".

   2. Web Bluetooth will only hand you services you named in advance — `getPrimaryServices()`
      returns what was granted, not what exists. A proprietary 128-bit service UUID cannot be
      guessed or discovered from the browser. That is precisely why the capture step exists:
      it is the only way to learn the UUIDs, after which they go in the profile below and
      everything else in this file starts working.

   SAFETY. This is a propeller that software can start. The interlocks here are real but they
   are software, running in a browser, on a phone that can lock or be killed at any moment —
   so they are best-effort by construction, not a guarantee. The motor's own foot pedal and
   remote are the only true kill. The UI says this too; it must never stop saying it. */
'use strict';

const Motor = {
  device: null,
  server: null,
  connected: false,
  armed: false,             // false = no frame flagged `danger` may be sent, ever
  chars: new Map(),         // uuid -> BluetoothRemoteGATTCharacteristic (writable + notifying)
  frames: [],               // rolling capture log (recon), newest last
  recording: false,
  recStartTs: 0,
  /* THREE SEPARATE CLOCKS, and conflating the first two is how a deadman dies.
       lastActionTs — "the link is alive": fed by any transmission, including automated ones.
       lastHumanTs  — "a human is present": fed ONLY by a real gesture on a control.
     These were one field. That was survivable while every frame came from a finger on the
     screen, but the moment anything repeats on a timer — hold-to-steer, an autopilot tick — the
     automated sends feed the deadman and it can never expire. A deadman that a machine can
     satisfy on a human's behalf is not a deadman, and every interlock built on it is theatre. */
  lastActionTs: 0,
  lastHumanTs: 0,
  _deadmanTimer: null,
  _logLines: [],
  _plan: { mode: '', i: 0 },   // where the requestDevice ladder stopped, so a re-tap resumes there
};

/* How long the app may hold the motor armed with no human input before it commands stop and
   disarms itself. Short on purpose: this is the "phone went in a pocket mid-troll" case. */
const MOTOR_DEADMAN_MS = 20000;
/* Cap the on-screen log. A notify characteristic can fire many times a second and an unbounded
   <pre> will eat the phone's memory during a long recon session. */
const MOTOR_LOG_MAX = 400;

const MOTOR_PROFILE_KEY = 'fishapp.motor.profile';

/* The profile is everything we learned from the capture. Empty until you fill it in.
     service  — the motor's proprietary GATT service UUID
     write    — characteristic the official app writes commands to
     notify   — characteristic that pushes telemetry back
     frames   — named byte sequences you captured, e.g. {label:'Spot-Lock on', hex:'a5 01 ...'}
                `danger:true` marks anything that can move the boat: those need ARM + confirm. */
function motorProfile() {
  return readJSON(MOTOR_PROFILE_KEY, { service: '', write: '', notify: '', frames: [] });
}
function motorSaveProfile(p) {
  localStorage.setItem(MOTOR_PROFILE_KEY, JSON.stringify(p));
}

/* Services we ask for permission to touch. A 128-bit vendor UUID can't be guessed, so the
   saved profile's service is the one that matters — the rest are cheap standard-service
   guesses that cost nothing to request and occasionally pay off (0x1819 Location & Navigation
   is a genuinely plausible fit for a GPS-aware motor). */
function motorCandidateServices() {
  const p = motorProfile();
  /* Canonical 128-bit strings, not the 0x180f-style numeric aliases the spec also allows. Chrome
     canonicalises numbers happily; partial implementations (Bluefy's included) have been known to
     throw a TypeError on them instead — and one bad entry rejects the WHOLE requestDevice call,
     which surfaces to the user as an unexplained "failed" with nothing to act on. */
  const list = [
    '00001800-0000-1000-8000-00805f9b34fb',   // Generic Access
    '00001801-0000-1000-8000-00805f9b34fb',   // Generic Attribute
    '0000180a-0000-1000-8000-00805f9b34fb',   // Device Information
    '0000180f-0000-1000-8000-00805f9b34fb',   // Battery
    '00001819-0000-1000-8000-00805f9b34fb',   // Location & Navigation — plausible on a GPS motor
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART — extremely common in vendor gear
    '0000fe59-0000-1000-8000-00805f9b34fb',   // Nordic DFU
  ];
  if (p.service) list.unshift(p.service);
  /* One malformed entry rejects the ENTIRE requestDevice call — and the profile's service UUID is
     typed by hand on a phone. Canonicalise everything, drop anything that still isn't a 128-bit
     UUID, and say which one was dropped rather than failing the whole connect over a typo. */
  const seen = {};
  return list.map(motorCharKey).filter((u) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)) {
      motorLog('ignoring unusable service UUID in profile: ' + u, 'warn');
      return false;
    }
    if (seen[u]) return false;
    seen[u] = 1;
    return true;
  });
}

/* ---- Platform capability -------------------------------------------------- */

/* Returns {ok, why} — `why` is shown to the user verbatim, so it has to be actionable. */
function motorSupport() {
  if (navigator.bluetooth) return { ok: true, why: '' };
  /* Check this BEFORE blaming the browser. `navigator.bluetooth` is also undefined on any
     non-secure page, so a http:// or file:// copy used to fall through to the iOS branch and
     tell the user to "open FishApp in Bluefy" — while they were already sitting in Bluefy. */
  if (!window.isSecureContext) {
    return {
      ok: false,
      why: 'This page isn\'t a secure context, so no browser will expose Bluetooth. Open the ' +
           '<b>https://</b> address (not a local file or an http:// copy) and try again.',
    };
  }
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    return {
      ok: false,
      why: 'Safari on iPhone has no Web Bluetooth — Apple has never shipped it, and every ' +
           'iOS browser is forced onto the same engine, so Chrome and Edge can\'t either. ' +
           'Open FishApp in <b>Bluefy</b> (free on the App Store) and this panel works.',
    };
  }
  return { ok: false, why: 'This browser has no Web Bluetooth. Chrome or Edge on Android/desktop, or Bluefy on iPhone.' };
}

/* ---- Logging / capture ---------------------------------------------------- */

/* CoreBluetooth (which is what Bluefy sits on) hands back CBUUID.uuidString — UPPERCASE, and in
   short form for 16-bit UUIDs, e.g. "180F" or "FFE1". The Web Bluetooth spec says lowercase
   canonical 128-bit. Keying the characteristic map on the raw string and looking it up with a
   lowercased profile UUID therefore missed on every write: "characteristic not found on the
   device", for a characteristic sitting right there. Normalise both ends through this. */
function motorCharKey(u) {
  let s = String(u == null ? '' : u).trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s)) s = s.slice(2);
  if (/^[0-9a-f]{1,4}$/.test(s)) s = ('0000' + s).slice(-4);
  if (/^[0-9a-f]{4}$/.test(s)) return '0000' + s + '-0000-1000-8000-00805f9b34fb';
  if (/^[0-9a-f]{8}$/.test(s)) return s + '-0000-1000-8000-00805f9b34fb';
  return s;
}

function motorHex(dv) {
  const out = [];
  for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i).toString(16).padStart(2, '0'));
  return out.join(' ');
}
function motorAscii(dv) {
  let s = '';
  for (let i = 0; i < dv.byteLength; i++) {
    const b = dv.getUint8(i);
    s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  return s;
}
/* Parse "a5 01 ff" / "a501ff" / "0xa5,0x01" into bytes. Returns null on anything malformed —
   a half-parsed command frame is worse than no frame at all. */
function motorParseHex(str) {
  const cleaned = String(str || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (!cleaned.length || cleaned.length % 2) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(cleaned.substr(i * 2, 2), 16);
    if (isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

function motorLog(line, cls) {
  const t = Motor.recording ? ((Date.now() - Motor.recStartTs) / 1000).toFixed(2).padStart(7) : '       ';
  Motor._logLines.push({ t: t, line: line, cls: cls || '' });
  if (Motor._logLines.length > MOTOR_LOG_MAX) Motor._logLines.shift();
  const el = document.getElementById('motor-log');
  if (!el) return;
  /* ESCAPED. Log lines carry device-controlled text — advertised names and raw notification
     payloads — straight from whatever is broadcasting nearby. Interpolating that into innerHTML
     let any BLE device in radio range inject script into a page that can arm a trolling motor.
     Nothing logged here is ever meant to be markup; HTML in a device name is an attack, not a
     feature. (The one string carrying real tags, motorSupport().why, is stripped before it
     reaches this function.) */
  el.innerHTML = Motor._logLines
    .map((r) => '<span class="mlog ' + r.cls + '">' + escapeHtmlMotor(r.t + '  ' + r.line) + '</span>')
    .join('\n');
  el.scrollTop = el.scrollHeight;
}

/* ---- Connection ----------------------------------------------------------- */

/* Plain English per DOMException name. Bluefy exposes no JavaScript console and no remote
   debugging, so an error the user cannot read is an error that cannot be fixed — every failure
   has to explain itself here, in the page, or the whole panel is undebuggable on the water. */
function motorExplainError(e) {
  let name = (e && e.name) || 'Error';
  const msg = (e && e.message) || String(e);
  /* Don't trust e.name alone. A JS-to-native bridge can surface a cancelled or empty chooser as a
     plain Error, which then reads as a hard failure and sends you hunting a bug that isn't there.
     The message text is the more reliable signal in that case. */
  /* Narrow on purpose. A looser "not found" match also swallowed genuine failures like
     "service not found", relabelling a real GATT problem as "chooser dismissed" and sending you
     off to hold the PAIR button forever over something that had nothing to do with pairing. */
  if (name === 'Error' && /cancel|user did not|no device (selected|chosen)/i.test(msg)) name = 'NotFoundError';
  /* Each requestDevice needs its own tap, and an awaited retry can outlive the activation.
     That is a browser bookkeeping problem, not a device problem, and must not read as one. */
  if (/user gesture|user activation|transient activation|must be handling/i.test(msg)) {
    return {
      name: 'NotAllowedError', msg: msg, retap: true,
      guide: 'The browser lost the tap that authorised this — each attempt needs its own tap. ' +
             'Tap "Connect to motor" once more; it resumes exactly where it stopped.',
    };
  }
  const guide = {
    NotFoundError:
      'No matching device, or the chooser was dismissed. The motor only advertises WHILE YOU HOLD ' +
      'the PAIR button on the control head — and it gives up after 30 seconds. Hold PAIR down, ' +
      'then tap Connect while still holding it.',
    SecurityError:
      'Blocked. The page must be https, and Bluefy needs Bluetooth permission in iOS Settings.',
    NotSupportedError:
      'This browser refused the request options. Usually an unsupported service UUID format.',
    InvalidStateError:
      'The Bluetooth adapter is not ready. Toggle Bluetooth off and on, then retry.',
    NetworkError:
      'The device was found but the connection dropped. Something else may already be holding it — ' +
      'force-quit the One-Boat Network app.',
    TypeError:
      'Bad request options for this browser — likely a service UUID it cannot parse.',
    AbortError: 'The request was cancelled.',
    NotAllowedError: 'Permission refused. iOS Settings → Privacy & Security → Bluetooth → Bluefy must be ON.',
  }[name];
  return { name: name, msg: msg, retap: false, guide: guide || 'Unrecognised failure — the raw error is above.' };
}

/* `all` = skip the name filter and show every BLE device in range.
   This is the single most diagnostic thing in the panel: if the motor appears under "show all"
   but never under the Minn Kota filter, it advertises under a different name. If it appears in
   iOS Settings but NEVER here even with the filter off, it is Bluetooth Classic — and no browser
   on any platform can speak Classic, which ends the web route entirely. */
/* Bluefy is a WKWebView shim over CoreBluetooth, not Chrome's implementation, and it rejects the
   WHOLE call if it dislikes ANY part of the options — one UUID it can't parse, a second filter
   entry, an optionalServices key at all. That surfaces as a single unexplained "request failed"
   with nothing to act on, which is exactly where this got stuck once already.

   So stop guessing: walk down progressively simpler option objects and print which rung the
   browser accepted. The rung that works IS the diagnosis, readable on the phone. */
function motorRequestPlans(opts) {
  const svcs = motorCandidateServices();
  const p = motorProfile();
  const both = [{ namePrefix: 'Minn Kota' }, { namePrefix: 'MinnKota' }];
  if (opts.all) {
    return [
      { why: 'every LE device + service list', options: { acceptAllDevices: true, optionalServices: svcs } },
      { why: 'every LE device, no service list', options: { acceptAllDevices: true } },
    ];
  }
  return [
    { why: 'name filter + full service list', options: { filters: both, optionalServices: svcs } },
    { why: 'name filter + saved/UART services only',
      options: { filters: both,
                 optionalServices: (p.service ? [motorCharKey(p.service)] : [])
                   .concat(['6e400001-b5a3-f393-e0a9-e50e24dcca9e']) } },
    { why: 'name filter, NO optionalServices key', options: { filters: both } },
    { why: 'single filter "Minn Kota" only', options: { filters: [{ namePrefix: 'Minn Kota' }] } },
  ];
}

async function motorRequestDevice(opts) {
  const mode = opts.all ? 'all' : 'filter';
  const plans = motorRequestPlans(opts);
  if (Motor._plan.mode !== mode) Motor._plan = { mode: mode, i: 0 };
  let last = null;
  for (let i = Motor._plan.i; i < plans.length; i++) {
    motorLog('try ' + (i + 1) + '/' + plans.length + ': ' + plans[i].why, 'hdr');
    try {
      const d = await navigator.bluetooth.requestDevice(plans[i].options);
      if (i > 0) motorLog('this browser refused option set(s) 1–' + i + ' — worth reporting.', 'warn');
      motorLog('options accepted on try ' + (i + 1), 'ok');
      Motor._plan = { mode: mode, i: 0 };
      return d;
    } catch (e) {
      const x = motorExplainError(e);
      motorLog('  try ' + (i + 1) + ' → ' + x.name + ': ' + x.msg, 'err');
      last = e;
      /* A lost tap says nothing about the options — resume on THIS rung at the next tap. */
      if (x.retap) { Motor._plan = { mode: mode, i: i }; throw e; }
      /* These four mean the options were ACCEPTED and the outcome was still no device: the
         chooser opened and found nothing, or was dismissed, or permission is denied. Simpler
         options cannot change that, and continuing would throw four choosers at the user. */
      if (x.name === 'NotFoundError' || x.name === 'AbortError' ||
          x.name === 'SecurityError' || x.name === 'NotAllowedError') {
        Motor._plan = { mode: mode, i: 0 };
        throw e;
      }
    }
  }
  Motor._plan = { mode: mode, i: 0 };
  throw last;
}

async function motorConnect(opts) {
  opts = opts || {};
  const sup = motorSupport();
  if (!sup.ok) { toast('Bluetooth not available here'); motorLog(sup.why.replace(/<[^>]+>/g, ''), 'err'); return; }

  motorLog(opts.all ? 'scanning for ALL nearby Bluetooth LE devices…'
                    : 'looking for a Minn Kota controller — HOLD the PAIR button now…', 'hdr');
  try {
    Motor.device = await motorRequestDevice(opts);
  } catch (e) {
    const x = motorExplainError(e);
    motorLog('requestDevice failed — ' + x.name + ': ' + x.msg, 'err');
    motorLog(x.guide, 'warn');
    if (x.retap) { toast('Tap Connect once more'); return; }
    if (!opts.all) {
      motorLog('Next: hold PAIR and retry, or tap "Show all devices" to see what is really advertising.', 'warn');
    } else if (x.name === 'NotFoundError') {
      /* The whole web route hinges on this line. An unfiltered chooser is a BLE-only scan, so
         Bluetooth Classic can only ever show up here as absence — never as an error. */
      motorLog('Nothing at all advertised over Bluetooth LE. If "Minn Kota Controller 4.0" is ' +
               'visible in iOS Settings → Bluetooth right now, the motor is Bluetooth CLASSIC — ' +
               'no browser on any platform can speak Classic, and the web route ends here.', 'warn');
    }
    toast(x.name === 'NotFoundError' ? 'No motor found — hold the PAIR button' : 'Bluetooth: ' + x.name);
    return;
  }

  motorLog('picked: "' + (Motor.device.name || '(no name broadcast)') + '"', 'hdr');
  /* Guarded: if this browser's BluetoothDevice isn't a full EventTarget, an uncaught throw here
     abandons motorConnect with the log frozen mid-connect and nothing explaining why. */
  try { Motor.device.addEventListener('gattserverdisconnected', motorOnDisconnected); }
  catch (e) { motorLog('note: no disconnect event in this browser — a dropped link may go unnoticed', 'warn'); }

  try {
    motorLog('connecting to ' + (Motor.device.name || '(unnamed)') + '…');
    Motor.server = await Motor.device.gatt.connect();
    Motor.connected = true;
    motorLog('connected', 'ok');
    await motorIdentify();
    await motorExplore();
  } catch (e) {
    motorLog('connect failed: ' + (e && e.message), 'err');
    Motor.connected = false;
  }
  motorUpdateUi();
}

/* Losing the link while armed is the dangerous case: whatever we last commanded is still what
   the motor is doing, and we can no longer take it back. Disarm, and say so loudly. */
function motorOnDisconnected() {
  const wasArmed = Motor.armed;
  Motor.connected = false;
  Motor.server = null;
  Motor.chars.clear();
  Motor.armed = false;
  clearInterval(Motor._deadmanTimer);
  motorLog('DISCONNECTED', 'err');
  motorUpdateUi();
  if (wasArmed) {
    toast('⚠️ Motor link lost while armed — use the foot pedal');
    if (typeof speak === 'function') { try { speak('Motor link lost. Use the foot pedal.'); } catch (e) {} }
  }
}

async function motorDisconnect() {
  motorDisarm('manual disconnect');
  try { if (Motor.device && Motor.device.gatt.connected) Motor.device.gatt.disconnect(); } catch (e) {}
  Motor.connected = false;
  Motor.chars.clear();
  motorLog('disconnected by user');
  motorUpdateUi();
}

/* Standard Device Information service — the manufacturer's own answer to "what am I".
   This exists precisely because an unfiltered chooser is a wall of anonymous devices: you pick a
   candidate, and instead of guessing, the device tells you. Nothing here is Minn Kota-specific;
   0x180a is a Bluetooth SIG standard every conforming device may implement. */
const MOTOR_DEVINFO = [
  ['00002a29-0000-1000-8000-00805f9b34fb', 'manufacturer'],
  ['00002a24-0000-1000-8000-00805f9b34fb', 'model'],
  ['00002a25-0000-1000-8000-00805f9b34fb', 'serial'],
  ['00002a26-0000-1000-8000-00805f9b34fb', 'firmware'],
  ['00002a27-0000-1000-8000-00805f9b34fb', 'hardware'],
];

/* Ruled-out candidates, so working through a crowded marina list is systematic rather than a
   memory game. Keyed by the browser's per-origin device id, with the name for readability. */
function motorRuledOut() { return readJSON('fishapp.motor.ruledout', {}); }

async function motorIdentify() {
  motorLog('=== what did I just connect to? ===', 'hdr');
  const name = Motor.device.name || '';
  motorLog('advertised name: ' + (name || '(none — device broadcasts no name)'), name ? 'ok' : 'warn');

  const info = {};
  try {
    const svc = await Motor.server.getPrimaryService('0000180a-0000-1000-8000-00805f9b34fb');
    for (const [uuid, label] of MOTOR_DEVINFO) {
      try {
        const v = await (await svc.getCharacteristic(uuid)).readValue();
        const s = motorAscii(v).replace(/\.+$/, '').trim();
        if (s) { info[label] = s; motorLog('  ' + label.padEnd(13) + ': ' + s, 'rx'); }
      } catch (e) { /* not every device implements every field */ }
    }
  } catch (e) {
    motorLog('  no Device Information service — this device won\'t say who made it', 'warn');
  }

  /* The verdict. "Johnson Outdoors" is the parent company; the motor may report either. */
  const hay = (name + ' ' + Object.values(info).join(' ')).toLowerCase();
  const looksRight = /minn\s*kota|johnson|terrova|ipilot|i-pilot/.test(hay);
  if (looksRight) {
    motorLog('✅ THIS LOOKS LIKE THE MOTOR — save its service UUID below and carry on.', 'ok');
  } else {
    const ruled = motorRuledOut();
    ruled[Motor.device.id || name || String(Object.keys(ruled).length)] = name || '(unnamed)';
    localStorage.setItem('fishapp.motor.ruledout', JSON.stringify(ruled));
    motorLog('❌ Nothing here identifies as Minn Kota. Noted as ruled out (' +
      Object.keys(ruled).length + ' so far). Disconnect and try the next candidate.', 'warn');
  }
  return info;
}

/* Walk every granted service, log the full GATT tree, and subscribe to anything that notifies.
   This is the recon tool: with the profile's service UUID filled in from the capture, this one
   call tells you the characteristic layout and starts streaming the motor's telemetry frames. */
async function motorExplore() {
  let services = [];
  try { services = await Motor.server.getPrimaryServices(); }
  catch (e) { motorLog('getPrimaryServices failed: ' + (e && e.message), 'err'); return; }

  if (!services.length) {
    motorLog('no services granted — the profile has no service UUID yet, so there is nothing ' +
             'the browser will let us see. Fill it in from the capture (MOTOR.md).', 'warn');
    return;
  }

  for (const svc of services) {
    motorLog('service ' + svc.uuid, 'hdr');
    let chars = [];
    try { chars = await svc.getCharacteristics(); }
    catch (e) { motorLog('  (characteristics unreadable: ' + (e && e.message) + ')', 'warn'); continue; }

    for (const ch of chars) {
      const p = ch.properties;
      const flags = [
        p.read && 'read', p.write && 'write', p.writeWithoutResponse && 'writeNR',
        p.notify && 'notify', p.indicate && 'indicate',
      ].filter(Boolean).join(',');
      motorLog('  char ' + ch.uuid + '  [' + flags + ']');
      if (p.write || p.writeWithoutResponse) Motor.chars.set(motorCharKey(ch.uuid), ch);

      /* Read once so a static value (firmware string, serial, battery) shows up immediately —
         these are often the easiest confirmation you're talking to the right device. */
      if (p.read) {
        try {
          const v = await ch.readValue();
          if (v.byteLength) motorLog('    = ' + motorHex(v) + '   "' + motorAscii(v) + '"', 'rx');
        } catch (e) { /* not readable in practice; not worth a line */ }
      }

      if (p.notify || p.indicate) {
        try {
          await ch.startNotifications();
          ch.addEventListener('characteristicvaluechanged', (ev) => motorOnNotify(ch.uuid, ev.target.value));
          Motor.chars.set(motorCharKey(ch.uuid), ch);
          motorLog('    subscribed', 'ok');
        } catch (e) { motorLog('    subscribe failed: ' + (e && e.message), 'warn'); }
      }
    }
  }
}

/* Every inbound frame. During recon this is your telemetry decoder: drive the boat with the
   real remote, watch which bytes move with heading / speed / battery, and the field layout
   falls out. Frames are kept so the whole session can be exported and studied off the water. */
function motorOnNotify(uuid, dv) {
  const rec = {
    t: Motor.recording ? (Date.now() - Motor.recStartTs) / 1000 : null,
    ts: Date.now(),
    uuid: uuid,
    hex: motorHex(dv),
    len: dv.byteLength,
  };
  Motor.frames.push(rec);
  if (Motor.frames.length > 5000) Motor.frames.shift();
  /* Don't blind-slice: a short-form or uppercase UUID from CoreBluetooth would leave the frame
     identifier column blank, which is the one thing telling frames from different characteristics
     apart during recon. */
  const short = motorCharKey(uuid).slice(4, 8) || String(uuid || '?');
  motorLog('◀ ' + short + '  ' + rec.hex + '   "' + motorAscii(dv) + '"', 'rx');
}

/* ---- Safety cage ---------------------------------------------------------- */

/* Arming is deliberately annoying. It is the one gate between a phone in a pocket and a
   spinning prop, and it exists because everything downstream of it is unverified code
   talking an undocumented protocol to a machine that moves a boat. */
function motorArm() {
  if (!Motor.connected) { toast('Not connected'); return; }
  const ok = confirm(
    'ARM the motor link?\n\n' +
    'FishApp will be able to send commands that move the boat.\n\n' +
    '• Prop clear of people, rope and the bottom\n' +
    '• Foot pedal within reach — it is the real kill switch\n' +
    '• Disarms itself after ' + (MOTOR_DEADMAN_MS / 1000) + 's with no input, or if the app is backgrounded\n\n' +
    'Arm now?'
  );
  if (!ok) return;
  Motor.armed = true;
  motorTouch();                       // arming is itself a deliberate human act
  clearInterval(Motor._deadmanTimer);
  Motor._deadmanTimer = setInterval(motorDeadmanTick, 1000);
  motorLog('ARMED', 'warn');
  motorUpdateUi();
}

function motorDisarm(reason) {
  if (!Motor.armed) { motorUpdateUi(); return; }
  Motor.armed = false;
  clearInterval(Motor._deadmanTimer);
  motorLog('DISARMED (' + (reason || 'user') + ')', 'warn');
  motorUpdateUi();
}

/* Best-effort stop: fire the frame you labelled "STOP" in the profile, then disarm.
   If no such frame exists yet this only disarms — which is why the UI keeps telling you the
   foot pedal is the real one. */
function motorStop(reason) {
  const p = motorProfile();
  const stop = (p.frames || []).find((f) => /stop/i.test(f.label));
  if (stop && Motor.connected) {
    motorSendHex(stop.hex, { force: true, label: 'STOP' }).catch(() => {});
  }
  motorDisarm(reason || 'stop');
}

/* Feed the human-presence clock. Called from a genuine gesture on a control and from nowhere
   else — not from motorSendHex, not from a timer, not from the autopilot. */
function motorTouch() {
  const t = Date.now();
  Motor.lastHumanTs = t;
  Motor.lastActionTs = t;
}

function motorDeadmanTick() {
  if (!Motor.armed) return;
  const idle = Date.now() - Motor.lastHumanTs;   // human presence, NOT link traffic
  const el = document.getElementById('motor-deadman');
  if (el) el.textContent = Math.max(0, Math.ceil((MOTOR_DEADMAN_MS - idle) / 1000)) + 's';
  if (idle > MOTOR_DEADMAN_MS) {
    motorLog('deadman expired — stopping', 'err');
    motorStop('deadman');
    toast('⏱ Deadman expired — motor link disarmed');
  }
}

/* The phone going away is the scenario the deadman can't cover: once iOS suspends the page our
   timers stop firing, so we act on the way out rather than waiting to notice. This is still
   best-effort — a hard lock or a kill gives us no turn at all. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' && Motor.armed) {
    motorLog('app backgrounded while armed — stopping', 'err');
    motorStop('backgrounded');
  }
});
window.addEventListener('pagehide', () => { if (Motor.armed) motorStop('page closing'); });

/* ---- Sending -------------------------------------------------------------- */

/* Write a hex frame to the profile's write characteristic.
   `danger` frames are refused unless armed — that check lives here, at the single choke point
   every command must pass through, rather than in the UI where a new button could forget it. */
async function motorSendHex(hex, opts) {
  opts = opts || {};
  if (!Motor.connected) { toast('Not connected'); return; }

  const p = motorProfile();
  const target = opts.charUuid || p.write;
  if (!target) { motorLog('no write characteristic in the profile yet', 'warn'); toast('No write characteristic set'); return; }

  const ch = Motor.chars.get(motorCharKey(target));
  if (!ch) { motorLog('write characteristic ' + target + ' not found on the device', 'err'); return; }

  const bytes = motorParseHex(hex);
  if (!bytes) { toast('That is not valid hex'); return; }

  if (opts.danger && !opts.force) {
    if (!Motor.armed) { toast('Arm the link first'); return; }
    if (!confirm('Send "' + (opts.label || 'command') + '"?\n\nThis can move the boat.')) return;
  }

  /* Link liveness only. This deliberately does NOT feed the human-presence clock: an autopilot
     tick calling in here must not be able to convince the deadman that someone is still holding
     the phone. Gestures call motorTouch() themselves. */
  Motor.lastActionTs = Date.now();
  try {
    /* writeValueWithoutResponse where offered: control traffic is periodic and a stalled
       ack round-trip is worse than a dropped frame. Fall back for older implementations —
       Bluefy in particular has lagged the newer method names. */
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(bytes);
    else if (ch.writeValueWithResponse) await ch.writeValueWithResponse(bytes);
    else await ch.writeValue(bytes);
    motorLog('▶ ' + (opts.label ? opts.label + '  ' : '') + motorHex(new DataView(bytes.buffer)), 'tx');
  } catch (e) {
    motorLog('write failed: ' + (e && e.message), 'err');
  }
}

/* ---- Recon session -------------------------------------------------------- */

function motorRecordToggle() {
  Motor.recording = !Motor.recording;
  if (Motor.recording) {
    Motor.recStartTs = Date.now();
    Motor.frames = [];
    motorLog('=== recording started ===', 'hdr');
  } else {
    motorLog('=== recording stopped (' + Motor.frames.length + ' frames) ===', 'hdr');
  }
  motorUpdateUi();
}

/* Stamp what you just did physically, so the frame log can be correlated with reality.
   Reversing a protocol is mostly this: "I pressed Spot-Lock at t=12.30" next to the bytes. */
function motorMarkEvent() {
  const what = prompt('What did you just do on the motor/remote?');
  if (!what) return;
  Motor.frames.push({ t: Motor.recording ? (Date.now() - Motor.recStartTs) / 1000 : null, ts: Date.now(), mark: what });
  motorLog('★ ' + what, 'hdr');
}

function motorExportSession() {
  const blob = new Blob([JSON.stringify({
    exported: new Date().toISOString(),
    device: Motor.device ? Motor.device.name : null,
    profile: motorProfile(),
    frames: Motor.frames,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'motor-session-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---- UI ------------------------------------------------------------------- */

function motorUpdateUi() {
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };

  set('motor-conn-status', (el) => {
    el.textContent = Motor.connected
      ? '✅ Connected to ' + (Motor.device && Motor.device.name ? Motor.device.name : 'motor')
      : 'Not connected';
  });
  set('btn-motor-connect', (el) => { el.textContent = Motor.connected ? 'Disconnect' : '🔗 Connect to motor'; });
  set('btn-motor-arm', (el) => {
    el.textContent = Motor.armed ? '🔓 ARMED — tap to disarm' : '🔒 Disarmed — tap to arm';
    el.classList.toggle('armed', Motor.armed);
    el.disabled = !Motor.connected;
  });
  set('motor-deadman-row', (el) => el.classList.toggle('hidden', !Motor.armed));
  set('btn-motor-record', (el) => { el.textContent = Motor.recording ? '⏹ Stop recording' : '⏺ Record frames'; });
  set('motor-frame-count', (el) => { el.textContent = Motor.frames.length ? Motor.frames.length + ' frames captured' : ''; });

  motorRenderFrames();
}

/* The captured-command buttons. Everything here came from your own packet capture — the app
   ships with none, and invents none. */
function motorRenderFrames() {
  const el = document.getElementById('motor-cmds');
  if (!el) return;
  const p = motorProfile();
  if (!p.frames || !p.frames.length) {
    el.innerHTML = '<p class="hint">No commands yet. Capture the One-Boat Network app talking to ' +
      'the motor (see MOTOR.md), then add the frames you decoded here.</p>';
    return;
  }
  el.innerHTML = p.frames.map((f, i) =>
    '<button class="tool-btn' + (f.danger ? ' danger' : '') + '" onclick="motorSendFrame(' + i + ')">' +
    (f.danger ? '⚠️ ' : '') + escapeHtmlMotor(f.label) + '</button>'
  ).join('');
}
function escapeHtmlMotor(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function motorSendFrame(i) {
  const f = motorProfile().frames[i];
  if (!f) return;
  motorTouch();                       // a tap on a command button IS the human presence signal
  motorSendHex(f.hex, { danger: !!f.danger, label: f.label });
}

function motorAddFrame() {
  const label = prompt('Name this command (e.g. "Spot-Lock on"):');
  if (!label) return;
  const hex = prompt('Bytes as hex (e.g. a5 01 00 ff):');
  if (!hex) return;
  if (!motorParseHex(hex)) { toast('That is not valid hex'); return; }
  const danger = confirm('Can this command MOVE THE BOAT?\n\nOK = yes (requires arming + confirm)\nCancel = no');
  const p = motorProfile();
  p.frames = p.frames || [];
  p.frames.push({ label: label, hex: hex, danger: danger });
  motorSaveProfile(p);
  motorRenderFrames();
  toast('Command saved');
}

function motorSaveUuids() {
  const p = motorProfile();
  p.service = (document.getElementById('motor-svc').value || '').trim().toLowerCase();
  p.write = (document.getElementById('motor-tx').value || '').trim().toLowerCase();
  p.notify = (document.getElementById('motor-rx').value || '').trim().toLowerCase();
  motorSaveProfile(p);
  toast('Profile saved — reconnect to pick it up');
  motorLog('profile saved: service=' + (p.service || '(none)'), 'hdr');
}

/* Print what this browser can actually do. Without a console these five facts are otherwise
   indistinguishable from each other — "it failed" covers a non-secure page, a browser with no
   Bluetooth at all, a powered-off adapter and a denied permission, which need four different
   fixes. Runs on panel open so the answer is already on screen before anything is attempted. */
async function motorProbe() {
  const ua = navigator.userAgent || '';
  const bluefy = /Bluefy/i.test(ua);
  motorLog('=== browser check ===', 'hdr');
  motorLog('secure context : ' + (window.isSecureContext ? 'yes' : 'NO — https required'),
    window.isSecureContext ? 'ok' : 'err');
  motorLog('web bluetooth  : ' + (navigator.bluetooth ? 'present' : 'ABSENT'),
    navigator.bluetooth ? 'ok' : 'err');
  motorLog('browser        : ' + (bluefy ? 'Bluefy ✓' : (/iPhone|iPad/.test(ua) ? 'iOS, NOT Bluefy — Safari cannot do this' : 'other')),
    bluefy ? 'ok' : 'warn');
  /* Which build is actually running. Half of a remote diagnosis is establishing that the phone
     is even on the code being discussed — the copied log should answer that without asking. */
  let build = '(unknown)';
  try { build = APP_BUILD; } catch (e) {}
  motorLog('app build      : ' + build + ' — if More says "update ready", close the browser from ' +
           'the app switcher and reopen before trusting anything below', 'warn');
  motorLog('page           : ' + location.protocol + '//' + location.host);
  motorLog('ua             : ' + ua.slice(0, 120));
  if (navigator.bluetooth && navigator.bluetooth.getAvailability) {
    try {
      const avail = await navigator.bluetooth.getAvailability();
      motorLog('adapter        : ' + (avail ? 'available' : 'NOT available — is Bluetooth on?'), avail ? 'ok' : 'err');
    } catch (e) { motorLog('adapter        : unknown (' + (e && e.name) + ')', 'warn'); }
  } else {
    motorLog('adapter        : cannot query in this browser', 'warn');
  }
  /* A device already granted to this origin can be reconnected without a chooser at all — worth
     knowing before hunting through an anonymous device list again. */
  if (navigator.bluetooth && navigator.bluetooth.getDevices) {
    try {
      const known = await navigator.bluetooth.getDevices();
      motorLog('already granted: ' + (known.length ? known.map((d) => d.name || '(unnamed)').join(', ') : 'none'),
        known.length ? 'ok' : '');
    } catch (e) { motorLog('already granted: cannot query (' + (e && e.name) + ')', 'warn'); }
  } else {
    motorLog('already granted: not queryable in this browser', 'warn');
  }
}

/* A <pre> full of hex is not something you can usefully screenshot and read back to me, and
   Bluefy gives no other way to get text out. */
function motorCopyLog() {
  const txt = Motor._logLines.map((r) => r.t + '  ' + r.line).join('\n');
  if (!txt) { toast('Nothing logged yet'); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Log copied')).catch(() => toast('Copy failed'));
  else toast('Copy not supported here');
}

function motorInit() {
  const sup = motorSupport();
  const warn = document.getElementById('motor-unsupported');
  if (warn) {
    warn.innerHTML = sup.ok ? '' : sup.why;
    warn.classList.toggle('hidden', sup.ok);
  }
  const p = motorProfile();
  const put = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  put('motor-svc', p.service);
  put('motor-tx', p.write);
  put('motor-rx', p.notify);
  motorUpdateUi();
}

/* Opening the panel shouldn't silently re-arm anything; it just refreshes what's true now —
   and runs the browser check, so the capability answer is on screen before the first attempt. */
function motorOnOpen() {
  motorInit();
  motorProbe();
}
