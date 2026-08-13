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
  lastActionTs: 0,          // last deliberate user touch — the deadman feeds on this
  _deadmanTimer: null,
  _logLines: [],
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
  const list = [
    0x1800, 0x1801, 0x180a, 0x180f, 0x1819,
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART — extremely common in vendor gear
    '0000fe59-0000-1000-8000-00805f9b34fb',   // Nordic DFU
  ];
  if (p.service) list.unshift(p.service.toLowerCase());
  return list;
}

/* ---- Platform capability -------------------------------------------------- */

/* Returns {ok, why} — `why` is shown to the user verbatim, so it has to be actionable. */
function motorSupport() {
  if (navigator.bluetooth) return { ok: true, why: '' };
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
  el.innerHTML = Motor._logLines
    .map((r) => '<span class="mlog ' + r.cls + '">' + r.t + '  ' + r.line + '</span>')
    .join('\n');
  el.scrollTop = el.scrollHeight;
}

/* ---- Connection ----------------------------------------------------------- */

async function motorConnect() {
  const sup = motorSupport();
  if (!sup.ok) { toast('Bluetooth not available in this browser'); return; }

  try {
    motorLog('requesting device…');
    /* namePrefix rather than a service filter: we may not know the service UUID yet, and the
       control head advertises as "Minn Kota Controller 4.0" per the One-Boat Network manual. */
    Motor.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Minn Kota' }, { namePrefix: 'MinnKota' }],
      optionalServices: motorCandidateServices(),
    });
  } catch (e) {
    // Chooser dismissed is the common case and isn't an error worth shouting about.
    if (e && e.name === 'NotFoundError') { motorLog('no device picked', 'warn'); return; }
    motorLog('requestDevice failed: ' + (e && e.message), 'err');
    return;
  }

  Motor.device.addEventListener('gattserverdisconnected', motorOnDisconnected);

  try {
    motorLog('connecting to ' + (Motor.device.name || '(unnamed)') + '…');
    Motor.server = await Motor.device.gatt.connect();
    Motor.connected = true;
    motorLog('connected', 'ok');
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
      if (p.write || p.writeWithoutResponse) Motor.chars.set(ch.uuid, ch);

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
          Motor.chars.set(ch.uuid, ch);
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
  motorLog('◀ ' + uuid.slice(4, 8) + '  ' + rec.hex + '   "' + motorAscii(dv) + '"', 'rx');
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
  Motor.lastActionTs = Date.now();
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

function motorDeadmanTick() {
  if (!Motor.armed) return;
  const idle = Date.now() - Motor.lastActionTs;
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

  const ch = Motor.chars.get(target.toLowerCase());
  if (!ch) { motorLog('write characteristic ' + target + ' not found on the device', 'err'); return; }

  const bytes = motorParseHex(hex);
  if (!bytes) { toast('That is not valid hex'); return; }

  if (opts.danger && !opts.force) {
    if (!Motor.armed) { toast('Arm the link first'); return; }
    if (!confirm('Send "' + (opts.label || 'command') + '"?\n\nThis can move the boat.')) return;
  }

  Motor.lastActionTs = Date.now();     // any deliberate send feeds the deadman
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

/* Opening the panel shouldn't silently re-arm anything; it just refreshes what's true now. */
function motorOnOpen() { motorInit(); }
