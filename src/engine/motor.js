import { createStore } from 'zustand/vanilla';
import { APP_BUILD, readJSON } from './app.js';
import { confirmDialog, promptDialog, toast } from '../services/ui';
import { copyText, haptic, isNativeShell, saveOrShareFile } from '../services/native';

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
   remote are the only true kill. The UI says this too; it must never stop saying it.

   PORT NOTES (React UI). This module never touches the page: everything the panel and the
   persistent MotorBand show is published through `motorStore` (plain data — device names and
   log lines are rendered by React as TEXT, never as markup). The deadman interval and the
   visibilitychange / pagehide STOP listeners live here, at module level, so they keep running
   when the panel is closed or unmounted and are immune to React StrictMode double-mounting.
   The native window.confirm()/prompt() dialogs became async in-app dialogs, so every function
   that waits on one re-checks connected / armed / deadman AFTER the await — the native dialog
   used to block the event loop (and the deadman with it), the in-app one does not. */
'use strict';

export const Motor = {
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
  _logSeq: 0,
  _plan: { mode: '', i: 0 },   // where the requestDevice ladder stopped, so a re-tap resumes there
  /* In-flight guards. A double tap on Connect used to start two requestDevice ladders in
     parallel; a double tap on Arm or on a danger command would now stack two in-app dialogs.
     '' | 'choose' (device chooser open) | 'link' (GATT connect + identify + explore running) */
  _connecting: '',
  _connectSeq: 0,            // bumps per connect attempt, so a stale attempt can't clobber a newer one
  _chooseAt: 0,              // when the current 'choose' began — a re-tap after MOTOR_CHOOSE_RETAP_MS supersedes it
  /* True while a manual disconnect waits for its STOP write. The link is still up in that window,
     so without this a second Disconnect, "Show all devices" or Arm could run under the pending
     STOP: dropping the link before STOP reached the motor, or arming a link about to vanish. */
  _disconnecting: false,
  /* Devices we deliberately let go of (listener removed). Only an event from one of these may be
     ignored by motorOnDisconnected — never an event just because its target is another object. */
  _retired: new WeakSet(),
  _armAsking: false,
  _sendAsking: false,
  _probeAt: 0,
  _voicePrimed: false,
};

/* How long the app may hold the motor armed with no human input before it commands stop and
   disarms itself. Short on purpose: this is the "phone went in a pocket mid-troll" case. */
export const MOTOR_DEADMAN_MS = 20000;
/* Cap the on-screen log. A notify characteristic can fire many times a second and an unbounded
   <pre> will eat the phone's memory during a long recon session. */
export const MOTOR_LOG_MAX = 400;
/* A second tap on Connect inside this window is a double tap and is ignored. A tap after it, with
   the chooser still "open" as far as we know, means the chooser was lost (a WKWebView shim such as
   Bluefy can drop it when iOS backgrounds the app and never settle the promise): start over. */
export const MOTOR_CHOOSE_RETAP_MS = 2000;
/* How long a manual disconnect waits for its STOP write before dropping the link anyway. A write
   with response that never acknowledges must not leave the panel stuck on "Disconnecting…". */
export const MOTOR_DISCONNECT_STOP_WAIT_MS = 3000;

export const MOTOR_PROFILE_KEY = 'fishapp.motor.profile';

/* ---- View store (what the panel and the MotorBand render) ------------------ */

/**
 * @typedef {''|'hdr'|'ok'|'warn'|'err'|'rx'|'tx'} MotorLogCls
 * @typedef {{ id: number, t: string, line: string, cls: MotorLogCls }} MotorLogLine
 * @typedef {{ label: string, hex: string, danger: boolean }} MotorFrame
 * @typedef {{ service: string, write: string, notify: string, frames: MotorFrame[] }} MotorProfileView
 * @typedef {{ text: string, bold: boolean }} MotorRichPart
 * @typedef {''|'native'|'insecure'|'ios'|'other'} MotorSupportReason
 * @typedef {{ ok: boolean, reason: MotorSupportReason, parts: MotorRichPart[] }} MotorSupportView
 */
/**
 * @typedef {Object} MotorView
 * @property {MotorSupportView} support   platform capability; `parts` is the verbatim explanation (bold runs marked)
 * @property {boolean} connected
 * @property {''|'choose'|'link'} connecting   '' when idle
 * @property {boolean} disconnecting      a manual disconnect is waiting for its STOP write
 * @property {string|null} deviceName     advertised name — attacker-controlled, render as text only
 * @property {boolean} armed
 * @property {number|null} deadmanRemainingS   seconds until auto-stop while armed, null when disarmed
 * @property {number} deadmanTotalS
 * @property {boolean} recording
 * @property {number} frameCount          Motor.frames.length (includes marks)
 * @property {MotorLogLine[]} log         ≤ MOTOR_LOG_MAX lines, oldest first
 * @property {MotorProfileView} profile
 * @property {boolean} hasStop            a command labelled exactly "STOP" exists
 * @property {number} stopIndex           index in profile.frames of that command, -1 when none
 * @property {string|null} legacyStopLabel   no STOP, but this command was sent as STOP by the old
 *                                         "label contains stop" rule — it no longer is (user text)
 */
/** @type {import('zustand/vanilla').StoreApi<MotorView>} */
export const motorStore = createStore(() => /** @type {MotorView} */ ({
  support: motorSupportView(),
  connected: false,
  connecting: '',
  disconnecting: false,
  deviceName: null,
  armed: false,
  deadmanRemainingS: null,
  deadmanTotalS: MOTOR_DEADMAN_MS / 1000,
  recording: false,
  frameCount: 0,
  log: [],
  profile: { service: '', write: '', notify: '', frames: [] },
  hasStop: false,
  stopIndex: -1,
  legacyStopLabel: null,
}));

/* The profile is everything we learned from the capture. Empty until you fill it in.
     service  — the motor's proprietary GATT service UUID
     write    — characteristic the official app writes commands to
     notify   — characteristic that pushes telemetry back
     frames   — named byte sequences you captured, e.g. {label:'Spot-Lock on', hex:'a5 01 ...'}
                `danger:true` marks anything that can move the boat: those need ARM + confirm. */
export function motorProfile() {
  return readJSON(MOTOR_PROFILE_KEY, { service: '', write: '', notify: '', frames: [] });
}
export function motorSaveProfile(p) {
  localStorage.setItem(MOTOR_PROFILE_KEY, JSON.stringify(p));
}

/* The dedicated STOP command — the frame STOP, the deadman, backgrounding and a manual disarm
   fire. Matched EXACTLY (label "STOP", any case, surrounding spaces ignored). The old rule was
   "first label containing stop", which would have fired e.g. "Spot-Lock stop" as the emergency
   stop just because it sorted first: an emergency stop has to be the one you named for it. */
export function motorFindStopFrame(frames) {
  return (frames || []).find((f) => f && String(f.label == null ? '' : f.label).trim().toUpperCase() === 'STOP') || null;
}

/* The command the OLD rule (first label containing "stop", any case) would have fired, when no
   command is named exactly STOP. Profiles saved before the exact rule may rely on it — a
   "Stop motor" was the STOP for the button, the deadman, backgrounding and pagehide — and
   commands cannot be renamed in-app. It is NOT sent as STOP (that is the bug the exact rule
   fixes); it is published so the panel and the MotorBand can say plainly that it no longer is,
   and offer a one-tap, confirmed copy named STOP (motorAdoptLegacyStop). */
export function motorLegacyStopFrame(frames) {
  if (motorFindStopFrame(frames)) return null;
  return (frames || []).find((f) => f && /stop/i.test(String(f.label == null ? '' : f.label))) || null;
}

/* Seconds left on the deadman for the countdown, from the human-presence clock only. */
export function motorDeadmanLeftS(lastHumanTs, now) {
  const idle = now - lastHumanTs;
  return Math.max(0, Math.ceil((MOTOR_DEADMAN_MS - idle) / 1000));
}

/* Services we ask for permission to touch. A 128-bit vendor UUID can't be guessed, so the
   saved profile's service is the one that matters — the rest are cheap standard-service
   guesses that cost nothing to request and occasionally pay off (0x1819 Location & Navigation
   is a genuinely plausible fit for a GPS-aware motor). */
export function motorCandidateServices() {
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

/* Returns {ok, why, reason} — `why` is shown to the user verbatim, so it has to be actionable.
   `why` keeps the legacy <b> markers; the panel renders them through motorRichText() as bold
   text runs (never as HTML), and the log strips them. */
export function motorSupport() {
  /* The FishApp iPhone app (native WKWebView shell) has no Web Bluetooth and no Bluetooth bridge
     of its own. Checked FIRST: depending on the custom scheme's isSecureContext the checks below
     would otherwise tell an App Store user about https or Bluefy, neither of which applies. The
     More sheet hides the tile there; this is what the panel says if it is opened anyway. */
  if (isNativeShell()) {
    return {
      ok: false, reason: 'native',
      why: 'The trolling motor link isn\'t part of the FishApp iPhone app — it needs Web Bluetooth, ' +
           'which Apple\'s web engine doesn\'t provide. Your motor\'s <b>foot pedal and remote</b> ' +
           'work exactly as before.',
    };
  }
  if (navigator.bluetooth) return { ok: true, why: '', reason: '' };
  /* Check this BEFORE blaming the browser. `navigator.bluetooth` is also undefined on any
     non-secure page, so a http:// or file:// copy used to fall through to the iOS branch and
     tell the user to "open FishApp in Bluefy" — while they were already sitting in Bluefy. */
  if (!window.isSecureContext) {
    return {
      ok: false, reason: 'insecure',
      why: 'This page isn\'t a secure context, so no browser will expose Bluetooth. Open the ' +
           '<b>https://</b> address (not a local file or an http:// copy) and try again.',
    };
  }
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    return {
      ok: false, reason: 'ios',
      why: 'Safari on iPhone has no Web Bluetooth — Apple has never shipped it, and every ' +
           'iOS browser is forced onto the same engine, so Chrome and Edge can\'t either. ' +
           'Open FishApp in <b>Bluefy</b> (free on the App Store) and this panel works.',
    };
  }
  return { ok: false, reason: 'other', why: 'This browser has no Web Bluetooth. Chrome or Edge on Android/desktop, or Bluefy on iPhone.' };
}

/* Split a `why` string into plain and bold runs. The only markup it ever carries is our own
   <b>…</b>; anything else is stripped, and the result is rendered as text nodes. */
export function motorRichText(html) {
  const s = String(html == null ? '' : html);
  /** @type {MotorRichPart[]} */
  const parts = [];
  const re = /<b>([\s\S]*?)<\/b>/gi;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ text: s.slice(last), bold: false });
  return parts
    .map((p) => ({ text: p.text.replace(/<[^>]+>/g, ''), bold: p.bold }))
    .filter((p) => p.text.length > 0);
}

/** @returns {MotorSupportView} */
function motorSupportView() {
  try {
    const sup = motorSupport();
    return { ok: sup.ok, reason: /** @type {MotorSupportReason} */ (sup.reason), parts: sup.ok ? [] : motorRichText(sup.why) };
  } catch (e) {
    return { ok: false, reason: 'other', parts: [] };
  }
}

/* Contract (More sheet / shell): Web Bluetooth present and not inside the iOS app. */
export function motorSupported() {
  try { return motorSupport().ok; } catch (e) { return false; }
}

/* ---- Logging / capture ---------------------------------------------------- */

/* CoreBluetooth (which is what Bluefy sits on) hands back CBUUID.uuidString — UPPERCASE, and in
   short form for 16-bit UUIDs, e.g. "180F" or "FFE1". The Web Bluetooth spec says lowercase
   canonical 128-bit. Keying the characteristic map on the raw string and looking it up with a
   lowercased profile UUID therefore missed on every write: "characteristic not found on the
   device", for a characteristic sitting right there. Normalise both ends through this. */
export function motorCharKey(u) {
  let s = String(u == null ? '' : u).trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s)) s = s.slice(2);
  if (/^[0-9a-f]{1,4}$/.test(s)) s = ('0000' + s).slice(-4);
  if (/^[0-9a-f]{4}$/.test(s)) return '0000' + s + '-0000-1000-8000-00805f9b34fb';
  if (/^[0-9a-f]{8}$/.test(s)) return s + '-0000-1000-8000-00805f9b34fb';
  return s;
}

export function motorHex(dv) {
  const out = [];
  for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i).toString(16).padStart(2, '0'));
  return out.join(' ');
}
export function motorAscii(dv) {
  let s = '';
  for (let i = 0; i < dv.byteLength; i++) {
    const b = dv.getUint8(i);
    s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  return s;
}
/* Parse "a5 01 ff" / "a501ff" / "0xa5,0x01" into bytes. Returns null on anything malformed —
   a half-parsed command frame is worse than no frame at all. */
export function motorParseHex(str) {
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

export function motorLog(line, cls) {
  const t = Motor.recording ? ((Date.now() - Motor.recStartTs) / 1000).toFixed(2).padStart(7) : '       ';
  Motor._logLines.push({ id: ++Motor._logSeq, t: t, line: String(line), cls: cls || '' });
  if (Motor._logLines.length > MOTOR_LOG_MAX) Motor._logLines.shift();
  /* TEXT ONLY. Log lines carry device-controlled text — advertised names and raw notification
     payloads — straight from whatever is broadcasting nearby. Interpolating that into innerHTML
     let any BLE device in radio range inject script into a page that can arm a trolling motor.
     Nothing logged here is ever meant to be markup; HTML in a device name is an attack, not a
     feature. The store carries plain strings and the panel renders them as React text nodes.
     (The one string carrying real tags, motorSupport().why, is stripped before it reaches this
     function.) */
  motorPublishLog();
}

/* Log-only publish: cheap enough for a notify characteristic firing many times a second. */
function motorPublishLog() {
  motorStore.setState({
    log: /** @type {MotorLogLine[]} */ (Motor._logLines.slice()),
    frameCount: Motor.frames.length,
  });
}

/* ---- Connection ----------------------------------------------------------- */

/* Plain English per DOMException name. Bluefy exposes no JavaScript console and no remote
   debugging, so an error the user cannot read is an error that cannot be fixed — every failure
   has to explain itself here, in the page, or the whole panel is undebuggable on the water. */
export function motorExplainError(e) {
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
export function motorRequestPlans(opts) {
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

/* `attempt` (optional) is motorConnect's _connectSeq for this ladder. Once a newer tap has
   superseded it, the ladder stops walking rungs and leaves the resume point alone. */
export async function motorRequestDevice(opts, attempt) {
  const mode = opts.all ? 'all' : 'filter';
  const plans = motorRequestPlans(opts);
  const stale = () => attempt != null && Motor._connectSeq !== attempt;
  if (Motor._plan.mode !== mode) Motor._plan = { mode: mode, i: 0 };
  let last = null;
  for (let i = Motor._plan.i; i < plans.length; i++) {
    if (stale()) throw last || new Error('connect superseded');
    motorLog('try ' + (i + 1) + '/' + plans.length + ': ' + plans[i].why, 'hdr');
    try {
      const d = await navigator.bluetooth.requestDevice(plans[i].options);
      if (stale()) return d;            // the caller ignores it; the newer attempt owns _plan
      if (i > 0) motorLog('this browser refused option set(s) 1–' + i + ' — worth reporting.', 'warn');
      motorLog('options accepted on try ' + (i + 1), 'ok');
      Motor._plan = { mode: mode, i: 0 };
      return d;
    } catch (e) {
      if (stale()) throw e;
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

/* MUST be reached synchronously from the tap: requestDevice needs transient user activation,
   so nothing before the first requestDevice call below may await. */
export async function motorConnect(opts) {
  opts = opts || {};
  const sup = motorSupport();
  if (!sup.ok) { toast('Bluetooth not available here'); motorLog(sup.why.replace(/<[^>]+>/g, ''), 'err'); return; }

  /* A manual disconnect is still waiting for its STOP write: dropping the link now would abort it. */
  if (Motor._disconnecting) { motorLog('still disconnecting — ignoring the tap', 'warn'); return; }

  /* In-flight guard: a double tap used to start two requestDevice ladders at once — two choosers,
     two GATT connects racing to set Motor.device. One attempt at a time.
     Except a chooser that never answers. If requestDevice never settles (a WKWebView shim can lose
     its chooser when iOS backgrounds the app), 'choose' would block every later tap for good and
     the panel would be dead until a reload. A tap that arrives MOTOR_CHOOSE_RETAP_MS or more after
     the chooser opened is not a double tap: it supersedes the lost attempt (whose result, if it
     ever comes, is ignored by the _connectSeq check below) and opens a fresh chooser. */
  if (Motor._connecting === 'link' ||
      (Motor._connecting === 'choose' && Date.now() - Motor._chooseAt < MOTOR_CHOOSE_RETAP_MS)) {
    motorLog('already connecting — ignoring the extra tap', 'warn');
    return;
  }
  if (Motor._connecting === 'choose') {
    motorLog('the device chooser never answered — opening it again', 'warn');
    Motor._connecting = '';
  }

  /* "Show all devices" while a link is up used to leave it up: armed state, characteristics and
     the old device's disconnect listener all carried over to whatever was picked next. Drop the
     link first. If ARMED, STOP has to reach the motor before the link goes — and the chooser
     cannot wait for that write without losing the tap — so do a full disconnect (STOP, disarm)
     and ask for one more tap. Disarmed, the link can be dropped synchronously right here. */
  if (Motor.connected) {
    if (Motor.armed) {
      await motorDisconnect();
      toast('Disconnected — tap Show all devices again');
      return;
    }
    motorDisarm('switching device');
    motorDropLink();
    motorLog('disconnected — switching device');
    motorUpdateUi();
  }
  /* Whatever device we held before is no longer ours to listen to: a late gattserverdisconnected
     from it must never tear down the link we are about to make. */
  motorForgetDeviceListener();

  const attempt = ++Motor._connectSeq;
  Motor._connecting = 'choose';
  Motor._chooseAt = Date.now();
  motorUpdateUi();
  try {
    motorLog(opts.all ? 'scanning for ALL nearby Bluetooth LE devices…'
                      : 'looking for a Minn Kota controller — HOLD the PAIR button now…', 'hdr');
    let picked;
    try {
      picked = await motorRequestDevice(opts, attempt);
    } catch (e) {
      /* Superseded by a newer tap: that attempt owns the panel now — no toast, no advice. */
      if (Motor._connectSeq !== attempt) return;
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
    /* A chooser we had given up on came back after all. Never adopt it: a newer attempt (or none)
       is what the user is looking at now. */
    if (Motor._connectSeq !== attempt) {
      motorLog('ignoring "' + ((picked && picked.name) || '(unnamed)') + '" from an earlier chooser — tap Connect again if you want it', 'warn');
      return;
    }
    Motor.device = picked;

    Motor._connecting = 'link';
    Motor.chars.clear();                // nothing from a previous device may answer for this one
    motorUpdateUi();
    motorLog('picked: "' + (Motor.device.name || '(no name broadcast)') + '"', 'hdr');
    /* Guarded: if this browser's BluetoothDevice isn't a full EventTarget, an uncaught throw here
       abandons motorConnect with the log frozen mid-connect and nothing explaining why. */
    try { Motor.device.addEventListener('gattserverdisconnected', motorOnDisconnected); }
    catch (e) { motorLog('note: no disconnect event in this browser — a dropped link may go unnoticed', 'warn'); }

    const dev = Motor.device;
    try {
      motorLog('connecting to ' + (Motor.device.name || '(unnamed)') + '…');
      const server = await dev.gatt.connect();
      /* Cancelled (Disconnect tapped) or superseded while the GATT connect was in flight: don't
         adopt a link nobody asked for any more — close it again. */
      if (Motor.device !== dev || Motor._connecting !== 'link' || Motor._connectSeq !== attempt) {
        try { dev.gatt.disconnect(); } catch (e2) {}
        throw new Error('connect cancelled');
      }
      Motor.server = server;
      Motor.connected = true;
      motorLog('connected', 'ok');
      await motorIdentify();
      await motorExplore();
    } catch (e) {
      motorLog('connect failed: ' + (e && e.message), 'err');
      if (Motor.device === dev) Motor.connected = false;
    }
  } finally {
    if (Motor._connectSeq === attempt) Motor._connecting = '';
    motorUpdateUi();
  }
}

/* The Connect / Disconnect button. Called synchronously from the click (requestDevice needs the
   tap). While a GATT connect is in flight the same button cancels it; while the chooser is (as far
   as we know) open, a re-tap goes to motorConnect, which re-opens a chooser that was lost. */
export function motorToggleConnect() {
  if (Motor.connected || Motor._connecting === 'link') return motorDisconnect();
  return motorConnect();
}

/* Tear the link down locally: stop listening to the device, drop GATT, forget characteristics.
   Synchronous on purpose so "Show all devices" can still reach requestDevice inside the tap. */
export function motorDropLink() {
  /* INVARIANT: the link is never dropped while armed. Every caller disarms first, but an armed
     flag left on a dead link is the worst state this module can be in (the MotorBand says "Motor
     armed", the deadman runs, and with the listener gone no link-lost path will ever clear it). */
  if (Motor.armed) motorDisarm('link dropped');
  motorForgetDeviceListener();
  /* While a GATT connect is still pending, disconnect() is what aborts it. */
  try {
    if (Motor.device && Motor.device.gatt &&
        (Motor.device.gatt.connected || Motor._connecting === 'link')) Motor.device.gatt.disconnect();
  } catch (e) {}
  Motor.connected = false;
  Motor.server = null;
  Motor.chars.clear();
}

function motorForgetDeviceListener() {
  if (!Motor.device) return;
  try { Motor._retired.add(Motor.device); } catch (e) {}
  try { Motor.device.removeEventListener('gattserverdisconnected', motorOnDisconnected); } catch (e) {}
}

/* True only for an event from a device we deliberately let go of (and whose listener a
   non-conforming implementation failed to remove). A target that is merely a DIFFERENT OBJECT —
   a wrapper or proxy dispatching on the device's behalf — is not proof of anything, and
   swallowing a real link loss while armed is far worse than one spurious teardown. */
export function motorIsRetiredEventTarget(t) {
  if (!t || !Motor.device || t === Motor.device) return false;
  let retired;
  try { retired = Motor._retired.has(t); } catch (e) { retired = false; }
  if (!retired) return false;
  /* Same per-origin device id = the same radio under another object: never ignore it. */
  const id = t.id, cur = Motor.device.id;
  if (id && cur && id === cur) return false;
  return true;
}

/* Losing the link while armed is the dangerous case: whatever we last commanded is still what
   the motor is doing, and we can no longer take it back. Disarm, and say so loudly. */
export function motorOnDisconnected(ev) {
  /* A listener left on a device we have since replaced must not tear down the current link. */
  if (ev && motorIsRetiredEventTarget(ev.target)) {
    motorLog('ignored a disconnect from a device no longer in use', 'warn');
    return;
  }
  const wasArmed = Motor.armed;
  Motor.connected = false;
  Motor.server = null;
  Motor.chars.clear();
  Motor.armed = false;
  clearInterval(Motor._deadmanTimer);
  motorLog('DISCONNECTED', 'err');
  motorUpdateUi();
  if (wasArmed) {
    toast('Motor link lost while armed — use the foot pedal');
    /* Spoken too. The legacy code called a global speak() that never existed, so this alert never
       made a sound. A safety alert is not gated by First Mate's speak toggle: it goes straight to
       the speech engine, with a haptic in the iOS shell. */
    motorAlertVoice('Motor link lost. Use the foot pedal.');
  }
}

/* Resolve when `promise` settles or after `ms`, whichever is first (onTimeout runs in the latter
   case). Never rejects. */
export function motorWithin(promise, ms, onTimeout) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let t;
  return Promise.race([
    Promise.resolve(promise).catch(() => {}).finally(() => clearTimeout(t)),
    new Promise((resolve) => { t = setTimeout(() => { try { if (onTimeout) onTimeout(); } catch (e) {} resolve(undefined); }, ms); }),
  ]);
}

export async function motorDisconnect() {
  /* Re-entrancy guard: one disconnect at a time. A second tap while the first waits for its STOP
     write would drop the link under that write (aborting it on a write-with-response
     characteristic, so the STOP never reaches the motor). */
  if (Motor._disconnecting) { motorLog('already disconnecting — ignoring the extra tap', 'warn'); return; }
  /* DEVIATION from legacy: a manual disconnect while ARMED now sends your STOP command first
     (and waits for the write to go out) before dropping the link. Legacy disarmed silently and
     left the motor doing whatever it was last told, with STOP no longer reachable.
     Legacy was synchronous, so nothing could run between the disarm and gatt.disconnect(); the
     wait for the STOP write opens that window, and _disconnecting closes it again: Connect, Show
     all devices and Arm are refused (and disabled in the panel) until the link is down. */
  const stop = Motor.armed && Motor.connected ? motorFindStopFrame(motorProfile().frames) : null;
  motorDisarm('manual disconnect');
  if (stop) {
    Motor._disconnecting = true;
    motorUpdateUi();
    try {
      await motorWithin(motorSendHex(stop.hex, { force: true, label: 'STOP' }), MOTOR_DISCONNECT_STOP_WAIT_MS,
        () => motorLog('STOP write not confirmed after ' + (MOTOR_DISCONNECT_STOP_WAIT_MS / 1000) + 's — dropping the link anyway', 'err'));
    } finally {
      Motor._disconnecting = false;
    }
  }
  /* Belt and braces: nothing may have re-armed in the wait (motorArm refuses while disconnecting),
     and motorDropLink disarms on its own too — the link is never dropped while armed. */
  if (Motor.armed) motorDisarm('manual disconnect');
  const wasConnecting = !Motor.connected && Motor._connecting === 'link';
  motorDropLink();
  /* Cancels an in-flight GATT connect too: motorConnect sees the state change after its await. */
  if (wasConnecting) Motor._connecting = '';
  motorLog(wasConnecting ? 'connect cancelled by user' : 'disconnected by user');
  motorUpdateUi();
}

/* Standard Device Information service — the manufacturer's own answer to "what am I".
   This exists precisely because an unfiltered chooser is a wall of anonymous devices: you pick a
   candidate, and instead of guessing, the device tells you. Nothing here is Minn Kota-specific;
   0x180a is a Bluetooth SIG standard every conforming device may implement. */
export const MOTOR_DEVINFO = [
  ['00002a29-0000-1000-8000-00805f9b34fb', 'manufacturer'],
  ['00002a24-0000-1000-8000-00805f9b34fb', 'model'],
  ['00002a25-0000-1000-8000-00805f9b34fb', 'serial'],
  ['00002a26-0000-1000-8000-00805f9b34fb', 'firmware'],
  ['00002a27-0000-1000-8000-00805f9b34fb', 'hardware'],
];

/* Ruled-out candidates, so working through a crowded marina list is systematic rather than a
   memory game. Keyed by the browser's per-origin device id, with the name for readability. */
export function motorRuledOut() { return readJSON('fishapp.motor.ruledout', {}); }

export async function motorIdentify() {
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
    motorLog('THIS LOOKS LIKE THE MOTOR — save its service UUID below and carry on.', 'ok');
  } else {
    const ruled = motorRuledOut();
    ruled[Motor.device.id || name || String(Object.keys(ruled).length)] = name || '(unnamed)';
    localStorage.setItem('fishapp.motor.ruledout', JSON.stringify(ruled));
    motorLog('NOT IT: nothing here identifies as Minn Kota. Noted as ruled out (' +
      Object.keys(ruled).length + ' so far). Disconnect and try the next candidate.', 'warn');
  }
  return info;
}

/* One shared notification handler. It used to be a fresh arrow function per subscribe, so every
   reconnect to the same device (whose characteristic objects the browser reuses) stacked another
   listener and every telemetry frame was logged and captured once per reconnect. EventTarget
   ignores a second registration of the SAME function, so a single module-level handler cannot
   stack. ev.target is the characteristic, so its uuid is the one the closure used to capture. */
export function motorOnCharValueChanged(ev) {
  const ch = ev && ev.target;
  if (!ch || !ch.value) return;
  motorOnNotify(ch.uuid, ch.value);
}

/* Walk every granted service, log the full GATT tree, and subscribe to anything that notifies.
   This is the recon tool: with the profile's service UUID filled in from the capture, this one
   call tells you the characteristic layout and starts streaming the motor's telemetry frames. */
export async function motorExplore() {
  let services;
  try { services = await Motor.server.getPrimaryServices(); }
  catch (e) { motorLog('getPrimaryServices failed: ' + (e && e.message), 'err'); return; }

  if (!services.length) {
    motorLog('no services granted — the profile has no service UUID yet, so there is nothing ' +
             'the browser will let us see. Fill it in from the capture (MOTOR.md).', 'warn');
    return;
  }

  for (const svc of services) {
    motorLog('service ' + svc.uuid, 'hdr');
    let chars;
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
          ch.addEventListener('characteristicvaluechanged', motorOnCharValueChanged);
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
export function motorOnNotify(uuid, dv) {
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
  motorLog('<- ' + short + '  ' + rec.hex + '   "' + motorAscii(dv) + '"', 'rx');
}

/* ---- Safety cage ---------------------------------------------------------- */

/* Arming is deliberately annoying. It is the one gate between a phone in a pocket and a
   spinning prop, and it exists because everything downstream of it is unverified code
   talking an undocumented protocol to a machine that moves a boat. */
export async function motorArm() {
  /* A link that is being disconnected is not one to arm: it is about to vanish. */
  if (!Motor.connected || Motor._disconnecting) { toast('Not connected'); return; }
  if (Motor.armed || Motor._armAsking) return;
  /* Still inside the tap: unlock speech now so the link-lost alert can actually be heard later
     (iOS only lets a page speak after it has spoken once from a gesture). */
  motorPrimeVoice();
  const dev = Motor.device;
  /* Said at the moment it matters: with no command named STOP, nothing in the app can stop the
     motor — STOP and auto-stop only disarm the link. */
  const noStop = !motorFindStopFrame(motorProfile().frames);
  Motor._armAsking = true;
  let ok;
  try {
    ok = await confirmDialog({
      title: 'ARM the motor link?',
      message:
        'FishApp will be able to send commands that move the boat.\n\n' +
        '• Prop clear of people, rope and the bottom\n' +
        '• Foot pedal within reach — it is the real kill switch\n' +
        '• Disarms itself after ' + (MOTOR_DEADMAN_MS / 1000) + 's with no input, or if the app is backgrounded\n\n' +
        (noStop ? 'No command is named STOP, so STOP and auto-stop can only disarm the link — they cannot stop the motor.\n\n' : '') +
        'Arm now?',
      confirmLabel: 'Arm',
      destructive: true,
    });
  } finally {
    Motor._armAsking = false;
  }
  if (!ok) return;
  /* RE-CHECK after the await. The native confirm() froze the page; the in-app dialog does not,
     so the link can drop (or be swapped for another device, or be mid-disconnect) while it is open. */
  if (!Motor.connected || Motor.device !== dev || Motor._disconnecting) { toast('Not connected'); return; }
  if (Motor.armed) return;
  Motor.armed = true;
  motorTouch();                       // arming is itself a deliberate human act
  clearInterval(Motor._deadmanTimer);
  Motor._deadmanTimer = setInterval(motorDeadmanTick, 1000);
  motorLog('ARMED', 'warn');
  motorUpdateUi();
  haptic();
}

export function motorDisarm(reason) {
  if (!Motor.armed) { motorUpdateUi(); return; }
  Motor.armed = false;
  clearInterval(Motor._deadmanTimer);
  motorLog('DISARMED (' + (reason || 'user') + ')', 'warn');
  motorUpdateUi();
}

/* The arm button. DEVIATION from legacy: a manual disarm now goes through motorStop, i.e. it
   sends your STOP command (if one is defined and the link is up) before disarming. Legacy
   disarm sent nothing and hid the STOP button, leaving the motor running with no way to take
   it back from the app. */
export function motorToggleArm() {
  if (Motor.armed) { motorStop('user'); return; }
  return motorArm();
}

/* Best-effort stop: fire the frame you labelled "STOP" in the profile, then disarm.
   If no such frame exists yet this only disarms — which is why the UI keeps telling you the
   foot pedal is the real one. Synchronous up to the write call on purpose: pagehide gives us
   no turn after this returns. */
export function motorStop(reason) {
  const p = motorProfile();
  const stop = motorFindStopFrame(p.frames);
  if (stop && Motor.connected) {
    motorSendHex(stop.hex, { force: true, label: 'STOP' }).catch(() => {});
  }
  motorDisarm(reason || 'stop');
}

/* Feed the human-presence clock. Called from a genuine gesture on a control and from nowhere
   else — not from motorSendHex, not from a timer, not from the autopilot. */
export function motorTouch() {
  const t = Date.now();
  Motor.lastHumanTs = t;
  Motor.lastActionTs = t;
  if (Motor.armed) motorStore.setState({ deadmanRemainingS: motorDeadmanLeftS(t, t) });
}

export function motorDeadmanTick() {
  if (!Motor.armed) return;
  const now = Date.now();
  const idle = now - Motor.lastHumanTs;   // human presence, NOT link traffic
  motorStore.setState({ deadmanRemainingS: motorDeadmanLeftS(Motor.lastHumanTs, now) });
  if (idle > MOTOR_DEADMAN_MS) {
    motorLog('deadman expired — stopping', 'err');
    motorStop('deadman');
    toast('Deadman expired — motor link disarmed');
  }
}

/* The phone going away is the scenario the deadman can't cover: once iOS suspends the page our
   timers stop firing, so we act on the way out rather than waiting to notice. This is still
   best-effort — a hard lock or a kill gives us no turn at all.
   Registered once, at module load (document-level, not on any app element), so it outlives the
   panel and never doubles under React StrictMode. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' && Motor.armed) {
    motorLog('app backgrounded while armed — stopping', 'err');
    motorStop('backgrounded');
  }
});
window.addEventListener('pagehide', () => { if (Motor.armed) motorStop('page closing'); });

/* ---- Spoken safety alert ---------------------------------------------------- */

/* Straight to the speech engine: First Mate's speak toggle governs chat replies, not alarms. */
export function motorAlertVoice(text) {
  try { haptic(); } catch (e) {}
  try {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return false;
    try { ss.cancel(); } catch (e) {}          // an alarm does not queue behind a chat reply
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1; u.volume = 1;
    ss.speak(u);
    return true;
  } catch (e) { return false; }
}

/* A silent utterance from inside a tap, so a later alert is allowed to make a sound. */
export function motorPrimeVoice() {
  if (Motor._voicePrimed) return;
  try {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    ss.speak(u);
    Motor._voicePrimed = true;
  } catch (e) {}
}

/* ---- Sending -------------------------------------------------------------- */

/* Write a hex frame to the profile's write characteristic.
   `danger` frames are refused unless armed — that check lives here, at the single choke point
   every command must pass through, rather than in the UI where a new button could forget it.
   The `force` path (STOP only) must stay free of any await before the write: motorStop runs from
   pagehide/visibilitychange, where the page gets no further turn. */
export async function motorSendHex(hex, opts) {
  opts = opts || {};
  if (!Motor.connected) { toast('Not connected'); return; }
  /* After Disconnect only STOP may still go out (it is what the disconnect is waiting for). */
  if (Motor._disconnecting && !opts.force) {
    motorLog('disconnecting — "' + (opts.label || 'command') + '" not sent', 'warn');
    return;
  }

  const p = motorProfile();
  const target = opts.charUuid || p.write;
  if (!target) { motorLog('no write characteristic in the profile yet', 'warn'); toast('No write characteristic set'); return; }

  let ch = Motor.chars.get(motorCharKey(target));
  if (!ch) { motorLog('write characteristic ' + target + ' not found on the device', 'err'); return; }

  const bytes = motorParseHex(hex);
  if (!bytes) { toast('That is not valid hex'); return; }

  if (opts.danger && !opts.force) {
    if (!Motor.armed) { toast('Arm the link first'); return; }
    if (Motor._sendAsking) return;            // one danger confirm at a time
    const dev = Motor.device;
    Motor._sendAsking = true;
    let ok;
    try {
      ok = await confirmDialog({
        title: 'Send "' + (opts.label || 'command') + '"?',
        message: 'This can move the boat.',
        confirmLabel: 'Send',
        destructive: true,
      });
    } finally {
      Motor._sendAsking = false;
    }
    if (!ok) return;
    /* RE-CHECK after the await. The legacy native confirm() froze the page, deadman included, so
       nothing could change under it. The in-app dialog does not: while it was open the link may
       have dropped, the deadman may have fired, the app may have been backgrounded (which
       disarms), or a different device may now be connected. Any of those = do not send. */
    if (!Motor.connected || Motor.device !== dev) { toast('Not connected'); return; }
    if (!Motor.armed) { toast('Disarmed while the confirm was open — not sent'); return; }
    if (Date.now() - Motor.lastHumanTs > MOTOR_DEADMAN_MS) { motorDeadmanTick(); return; }
    ch = Motor.chars.get(motorCharKey(target));
    if (!ch) { motorLog('write characteristic ' + target + ' not found on the device', 'err'); return; }
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
    motorLog('-> ' + (opts.label ? opts.label + '  ' : '') + motorHex(new DataView(bytes.buffer)), 'tx');
  } catch (e) {
    motorLog('write failed: ' + (e && e.message), 'err');
  }
}

/* ---- Recon session -------------------------------------------------------- */

export function motorRecordToggle() {
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
export async function motorMarkEvent() {
  const r = await promptDialog({
    title: 'Mark what I just did',
    message: 'What did you just do on the motor/remote?',
    fields: [{ name: 'what', label: 'What you did', placeholder: 'e.g. pressed Spot-Lock' }],
    confirmLabel: 'Mark',
  });
  const what = r ? String(r.what || '').trim() : '';
  if (!what) return;
  Motor.frames.push({ t: Motor.recording ? (Date.now() - Motor.recStartTs) / 1000 : null, ts: Date.now(), mark: what });
  motorLog('MARK  ' + what, 'hdr');
}

export function motorSessionFileName(d) {
  return 'motor-session-' + (d || new Date()).toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
}

/* Share sheet in the iOS shell / Web Share on phones / a download elsewhere — an <a download>
   of a Blob does nothing in Bluefy or a WKWebView. */
export async function motorExportSession() {
  const json = JSON.stringify({
    exported: new Date().toISOString(),
    device: Motor.device ? Motor.device.name : null,
    profile: motorProfile(),
    frames: Motor.frames,
  }, null, 2);
  try {
    await saveOrShareFile({ name: motorSessionFileName(), mime: 'application/json', data: json, title: 'Motor session' });
  } catch (e) {
    toast('Export failed');
  }
}

/* ---- UI ------------------------------------------------------------------- */

/* Publish everything the panel and the MotorBand show. Same name and call sites as the legacy
   DOM painter; now it only writes plain data into motorStore. */
export function motorUpdateUi() {
  const p = motorProfile();
  motorStore.setState({
    connected: Motor.connected,
    connecting: /** @type {''|'choose'|'link'} */ (Motor._connecting),
    disconnecting: Motor._disconnecting,
    deviceName: Motor.device && Motor.device.name ? String(Motor.device.name) : null,
    armed: Motor.armed,
    deadmanRemainingS: Motor.armed ? motorDeadmanLeftS(Motor.lastHumanTs, Date.now()) : null,
    recording: Motor.recording,
    frameCount: Motor.frames.length,
    log: /** @type {MotorLogLine[]} */ (Motor._logLines.slice()),
  });
  motorRenderFrames(p);
}

/* The captured-command buttons. Everything here came from your own packet capture — the app
   ships with none, and invents none. Publishes the profile; the panel renders the buttons (and
   the empty state) with labels as plain text. */
export function motorRenderFrames(profile) {
  const p = profile || motorProfile();
  /** @type {MotorFrame[]} */
  const frames = (Array.isArray(p.frames) ? p.frames : []).map((f) => ({
    label: String(f && f.label != null ? f.label : ''),
    hex: String(f && f.hex != null ? f.hex : ''),
    danger: !!(f && f.danger),
  }));
  const stop = motorFindStopFrame(frames);
  const legacy = motorLegacyStopFrame(frames);
  motorStore.setState({
    profile: { service: String(p.service || ''), write: String(p.write || ''), notify: String(p.notify || ''), frames: frames },
    hasStop: !!stop,
    stopIndex: stop ? frames.indexOf(stop) : -1,
    legacyStopLabel: legacy ? legacy.label : null,
  });
}
/* Kept for any marker/HTML caller; React escapes on its own and the panel never uses this. */
export function escapeHtmlMotor(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function motorSendFrame(i) {
  const frames = motorProfile().frames || [];
  const f = frames[i];
  if (!f) return;
  motorTouch();                       // a tap on a command button IS the human presence signal
  /* The command named STOP is the emergency stop. From the Commands grid it goes out exactly like
     the STOP button — force path, armed or not, no confirm — whatever its `danger` flag says.
     Under the fail-safe add dialog ("If you are not sure, answer Yes") STOP is easily saved as
     danger, and the arm gate then refused it while disarmed: after a link loss while armed and a
     reconnect, nothing in the app could send STOP without first going through the ARM confirm. */
  if (f === motorFindStopFrame(frames)) return motorSendHex(f.hex, { force: true, label: 'STOP' });
  return motorSendHex(f.hex, { danger: !!f.danger, label: f.label });
}

export async function motorAddFrame() {
  const r = await promptDialog({
    title: 'Add captured command',
    message: 'Name the stop command exactly STOP — that is the one the STOP button, the deadman and backgrounding send.',
    fields: [
      { name: 'label', label: 'Name this command', placeholder: 'e.g. Spot-Lock on' },
      { name: 'hex', label: 'Bytes as hex', placeholder: 'e.g. a5 01 00 ff' },
    ],
    confirmLabel: 'Next',
  });
  if (!r) return;
  const label = String(r.label || '').trim();
  const hex = String(r.hex || '').trim();
  if (!label && !hex) return;
  if (!label) { toast('Name the command first'); return; }
  if (!motorParseHex(hex)) { toast('That is not valid hex'); return; }

  /* The command named STOP is sent on the force path — armed or not, no confirm — by the STOP
     button, the deadman, backgrounding, a manual disarm and disconnect, and from the Commands grid.
     The move-the-boat question cannot change that, so it is not asked; instead the user confirms
     they know what the name does. Cancel / dismiss = nothing saved: nothing gets the force path
     without an explicit yes. Only the FIRST command named STOP is the STOP, and commands cannot
     be renamed or deleted in-app, so a second one is refused rather than saved as a decoy. */
  if (motorFindStopFrame([{ label: label }])) {
    if (motorFindStopFrame(motorProfile().frames)) { toast('A command named STOP already exists'); return; }
    const okStop = await confirmDialog({
      title: 'Save this as the STOP command?',
      message: 'STOP is sent at once, armed or not and with no confirm: by the STOP button, auto-stop, ' +
               'leaving the app, disarming and disconnecting while armed.\n\n' +
               'Save only the stop command from your capture under this name.',
      confirmLabel: 'Save as STOP',
    });
    if (!okStop) return;
    const ps = motorProfile();
    ps.frames = ps.frames || [];
    /* RE-CHECK after the await: another STOP may have been saved while the dialog was open. */
    if (motorFindStopFrame(ps.frames)) { toast('A command named STOP already exists'); return; }
    ps.frames.push({ label: label, hex: hex, danger: false });
    motorSaveProfile(ps);
    motorRenderFrames();
    toast('STOP command saved');
    return;
  }

  /* FAIL-SAFE, in two steps. Legacy asked "OK = yes / Cancel = no", so a stray Cancel (or a
     dismissed dialog) saved a prop-moving command as harmless — sendable without arming or a
     confirm. The emphasised button of the first question is now the safe answer, "Yes, it can".
     "No, it cannot", Cancel, Escape and a tap outside all lead to a second question whose risky
     answer is red and explicit ("Save as harmless"); only that tap gives danger:false, and
     dismissing it means "it can move the boat" too. No dismissal can ever save a command as
     harmless. (A three-outcome dialog would do it in one step: docs/requests/motor-helm.md.) */
  const canMove = await confirmDialog({
    title: 'Can this command MOVE THE BOAT?',
    message: 'Yes = it can only be sent while the link is armed, and asks for a confirm every time.\n\n' +
             'If you are not sure, answer Yes.',
    confirmLabel: 'Yes, it can',
    cancelLabel: 'No, it cannot',
  });
  let danger = true;
  if (canMove !== true) {
    const harmless = await confirmDialog({
      title: 'Save "' + label + '" as harmless?',
      message: 'It will send with one tap: no arming and no confirm. Only for a command that cannot ' +
               'move the boat, such as a battery or status query.',
      confirmLabel: 'Save as harmless',
      cancelLabel: 'It can move the boat',
      destructive: true,
    });
    danger = harmless !== true;
  }
  const p = motorProfile();
  p.frames = p.frames || [];
  p.frames.push({ label: label, hex: hex, danger: danger });
  motorSaveProfile(p);
  motorRenderFrames();
  toast('Command saved');
}

/* One-tap, confirmed migration for a profile saved under the old "label contains stop" rule:
   saves a copy of that command named STOP, so the STOP button, the deadman, backgrounding,
   disarming and disconnecting send it again. Nothing changes without the explicit yes. */
export async function motorAdoptLegacyStop() {
  const cand = motorLegacyStopFrame(motorProfile().frames);
  if (!cand) { motorRenderFrames(); return; }
  const label = String(cand.label == null ? '' : cand.label);
  const hex = String(cand.hex == null ? '' : cand.hex);
  const ok = await confirmDialog({
    title: 'Use "' + label + '" as STOP?',
    message: 'Its bytes (' + hex + ') are saved as a new command named STOP. STOP is sent at once, ' +
             'armed or not and with no confirm: by the STOP button, auto-stop, leaving the app, ' +
             'disarming and disconnecting while armed.\n\n' +
             'Only do this if "' + label + '" is the stop command from your capture.',
    confirmLabel: 'Use as STOP',
  });
  if (!ok) return;
  /* RE-CHECK after the await: the profile may have changed while the dialog was open. */
  const p = motorProfile();
  p.frames = p.frames || [];
  if (motorFindStopFrame(p.frames)) { motorRenderFrames(p); toast('A command named STOP already exists'); return; }
  const still = p.frames.some((f) => f && String(f.label == null ? '' : f.label) === label && String(f.hex == null ? '' : f.hex) === hex);
  if (!still) { motorRenderFrames(p); toast('That command is gone — nothing changed'); return; }
  if (!motorParseHex(hex)) { toast('That is not valid hex'); return; }
  p.frames.push({ label: 'STOP', hex: hex, danger: false });
  motorSaveProfile(p);
  motorRenderFrames(p);
  motorLog('STOP command saved from "' + label + '"', 'hdr');
  toast('STOP command saved');
}

export function motorSaveUuids(fields) {
  fields = fields || {};
  const p = motorProfile();
  p.service = String(fields.service || '').trim().toLowerCase();
  p.write = String(fields.write || '').trim().toLowerCase();
  p.notify = String(fields.notify || '').trim().toLowerCase();
  motorSaveProfile(p);
  toast('Profile saved — reconnect to pick it up');
  motorLog('profile saved: service=' + (p.service || '(none)'), 'hdr');
  motorRenderFrames(p);
}

/* Print what this browser can actually do. Without a console these five facts are otherwise
   indistinguishable from each other — "it failed" covers a non-secure page, a browser with no
   Bluetooth at all, a powered-off adapter and a denied permission, which need four different
   fixes. Runs on panel open so the answer is already on screen before anything is attempted. */
export async function motorProbe() {
  const ua = navigator.userAgent || '';
  const bluefy = /Bluefy/i.test(ua);
  motorLog('=== browser check ===', 'hdr');
  motorLog('secure context : ' + (window.isSecureContext ? 'yes' : 'NO — https required'),
    window.isSecureContext ? 'ok' : 'err');
  motorLog('web bluetooth  : ' + (navigator.bluetooth ? 'present' : 'ABSENT'),
    navigator.bluetooth ? 'ok' : 'err');
  motorLog('browser        : ' + (bluefy ? 'Bluefy' : (/iPhone|iPad/.test(ua) ? 'iOS, NOT Bluefy — Safari cannot do this' : 'other')),
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

/* The log as plain text — what Copy log puts on the clipboard. */
export function motorLogText() {
  return Motor._logLines.map((r) => r.t + '  ' + r.line).join('\n');
}

/* A <pre> full of hex is not something you can usefully screenshot and read back to me, and
   Bluefy gives no other way to get text out. */
export async function motorCopyLog() {
  const txt = motorLogText();
  if (!txt) { toast('Nothing logged yet'); return; }
  toast((await copyText(txt)) ? 'Log copied' : 'Copy failed');
}

/* Boot (engine/app.js) calls this. Publishes the platform answer and the current state. */
export function motorInit() {
  motorStore.setState({ support: motorSupportView() });
  motorUpdateUi();
}

/* Opening the panel shouldn't silently re-arm anything; it just refreshes what's true now —
   and runs the browser check, so the capability answer is on screen before the first attempt.
   Called from the panel's mount effect; a second call within a moment (React StrictMode's
   double mount, a quick close/reopen) refreshes but does not print the check twice. */
export function motorOnOpen() {
  motorInit();
  const now = Date.now();
  if (now - Motor._probeAt < 1500) return;
  Motor._probeAt = now;
  motorProbe();
}
