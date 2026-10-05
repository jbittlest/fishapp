/* Helm — the control layer: parameterised command frames, checksum inference, and a fake motor
   ---------------------------------------------------------------------------------------------
   motor.js is the transport and the safety cage. This is what turns captured bytes into a
   CONTROLLER: named actions with parameters, so "speed 3" is one template with a field in it
   rather than ten separately-captured opaque blobs.

   The hard part of any binary protocol is the trailing bytes. Almost every piece of vendor gear
   puts a checksum or CRC at the end of a frame, and if you get it wrong the motor silently
   ignores everything you send — which looks exactly like "the app is broken". So rather than
   guess, capture the same command two or three times with different parameter values and let
   helmSolveChecksum() work out which algorithm, over which byte range, reproduces what you saw.

   Everything here is testable with no motor present: HelmSim is a fake control head that accepts
   frames and keeps state, so the command model and (later) the autopilot can be exercised on a
   desk. That matters because the alternative is debugging a control loop next to a live propeller. */
'use strict';

const Helm = {
  sim: null,            // HelmSim instance when simulating instead of talking to real hardware
  simulate: false,      // when true, rendered frames go to the simulator, never to the radio
  commanded: {},        // what we ASKED for
  reported: {},         // what telemetry actually said — empty until notify frames are decoded
  limits: { maxSpeed: 4, maxHoldMs: 2500 },
};

/* ---- Transmit discipline --------------------------------------------------
   BLE writes serialise on the connection interval. Fire a setpoint every 200 ms into a queue
   that drains at 3 Hz and you build a backlog that lands a steer command ten seconds after the
   thumb left the screen. Setpoints are therefore LAST-VALUE-WINS, never queued: a newer heading
   replaces an undelivered older one, because nobody wants the stale one honoured. */
const HelmTx = { busy: false, pending: null };

async function helmTxSend(hex, opts, coalesceKey) {
  opts = opts || {};
  /* Aborts jump the queue entirely. STOP is never coalesced, never rate-limited, never dropped,
     and never waits behind a heading setpoint. The asymmetry is deliberate. */
  if (opts.force) return motorSendHex(hex, opts);
  if (!helmBudgetTake()) return false;
  if (HelmTx.busy) {
    if (coalesceKey) { HelmTx.pending = { hex: hex, opts: opts, key: coalesceKey }; return false; }
    return false;                       // one-shots are dropped, not stacked
  }
  HelmTx.busy = true;
  try { return await motorSendHex(hex, opts); }
  finally {
    HelmTx.busy = false;
    const p = HelmTx.pending; HelmTx.pending = null;
    if (p) helmTxSend(p.hex, p.opts, p.key);
  }
}

/* Token bucket over everything. A stuck pointer, a wedged autopilot tick and a runaway voice
   command are indistinguishable from down here, and one ceiling stops all three. */
const HELM_BUCKET = { cap: 8, refillPerSec: 5, tokens: 8, ts: 0 };
function helmBudgetTake() {
  const now = Date.now();
  if (!HELM_BUCKET.ts) HELM_BUCKET.ts = now;
  HELM_BUCKET.tokens = Math.min(HELM_BUCKET.cap,
    HELM_BUCKET.tokens + (now - HELM_BUCKET.ts) / 1000 * HELM_BUCKET.refillPerSec);
  HELM_BUCKET.ts = now;
  if (HELM_BUCKET.tokens < 1) return false;
  HELM_BUCKET.tokens -= 1;
  return true;
}

/* ---- Checksum algorithms --------------------------------------------------
   Named exactly as they'll appear in a template: "{sum8}", "{crc16modbus}", etc.
   Each takes a byte array and returns a number; `width` is how many bytes it occupies. */
const HELM_CHECKSUMS = {
  sum8:    { width: 1, fn: (b) => b.reduce((a, x) => (a + x) & 0xff, 0) },
  /* Two's-complement sum — the frame's bytes plus this equal zero mod 256. Common enough that
     leaving it out sends you hunting a CRC that was never there. */
  sum8neg: { width: 1, fn: (b) => (0x100 - b.reduce((a, x) => (a + x) & 0xff, 0)) & 0xff },
  xor8:    { width: 1, fn: (b) => b.reduce((a, x) => a ^ x, 0) },
  crc8:    { width: 1, fn: (b) => { let c = 0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; } },
  crc8maxim: { width: 1, fn: (b) => { let c = 0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c & 1) ? ((c >> 1) ^ 0x8c) & 0xff : (c >> 1) & 0xff; } return c; } },
  crc16modbus: { width: 2, fn: (b) => { let c = 0xffff; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c & 1) ? ((c >> 1) ^ 0xa001) & 0xffff : (c >> 1) & 0xffff; } return c; } },
  crc16ccitt:  { width: 2, fn: (b) => { let c = 0xffff; for (const x of b) { c ^= (x << 8) & 0xffff; for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; } },
};
/* Byte order for the 2-byte results. Both are tried during inference — vendors pick either. */
const HELM_ENDIAN = { le: (v, w) => (w === 1 ? [v & 0xff] : [v & 0xff, (v >> 8) & 0xff]),
                      be: (v, w) => (w === 1 ? [v & 0xff] : [(v >> 8) & 0xff, v & 0xff]) };

/* ---- Parameter field types ------------------------------------------------ */
const HELM_FIELDS = {
  u8:    { width: 1, enc: (v) => [v & 0xff] },
  s8:    { width: 1, enc: (v) => [v < 0 ? (256 + v) & 0xff : v & 0xff] },
  u16le: { width: 2, enc: (v) => [v & 0xff, (v >> 8) & 0xff] },
  u16be: { width: 2, enc: (v) => [(v >> 8) & 0xff, v & 0xff] },
  /* Heading as tenths of a degree is common on marine gear; plain degrees also appear. Both
     wrap first, so 361 becomes 1 rather than silently truncating to garbage. */
  deg:   { width: 2, enc: (v) => { const d = ((Math.round(v) % 360) + 360) % 360; return [d & 0xff, (d >> 8) & 0xff]; } },
  deg10: { width: 2, enc: (v) => { const d = (((Math.round(v * 10) % 3600) + 3600) % 3600); return [d & 0xff, (d >> 8) & 0xff]; } },
};

/* ---- Template parsing / rendering -----------------------------------------
   Syntax: literal hex bytes, plus {name:type} for parameters and {algo} or {algo:from..to}
   for checksums. Ranges are byte indices into the rendered frame, `to` exclusive; omitted
   means "everything before this checksum".
     "a5 01 {speed:u8} 00 {sum8}"
     "a5 07 {heading:deg} {crc16modbus:1..6}"                                           */
function helmParseTemplate(tpl) {
  const out = [];
  const toks = String(tpl || '').trim().split(/\s+/).filter(Boolean);
  for (const t of toks) {
    const m = /^\{([a-z0-9_]+)(?::([^}]+))?\}$/i.exec(t);
    if (!m) {
      if (!/^[0-9a-f]{2}$/i.test(t)) throw new Error('not a hex byte or field: "' + t + '"');
      out.push({ kind: 'lit', byte: parseInt(t, 16) });
      continue;
    }
    const name = m[1], arg = m[2];
    if (HELM_CHECKSUMS[name]) {
      let from = null, to = null;
      if (arg) {
        const r = /^(\d+)\.\.(\d+)$/.exec(arg);
        if (!r) throw new Error('bad checksum range: "' + t + '"');
        from = +r[1]; to = +r[2];
      }
      out.push({ kind: 'sum', algo: name, from: from, to: to, endian: 'le' });
      continue;
    }
    if (!arg) throw new Error('parameter needs a type, e.g. {speed:u8} — got "' + t + '"');
    if (!HELM_FIELDS[arg]) throw new Error('unknown field type "' + arg + '" in "' + t + '"');
    out.push({ kind: 'field', name: name, type: arg });
  }
  return out;
}

/* Render a template to bytes. Missing parameters throw rather than defaulting to zero: a frame
   that silently means "speed 0" when you meant "speed 3" is the kind of bug that is invisible
   in a log and obvious on the water. */
function helmRender(tpl, params) {
  const toks = typeof tpl === 'string' ? helmParseTemplate(tpl) : tpl;
  params = params || {};
  const bytes = [];
  const pending = [];
  for (const t of toks) {
    if (t.kind === 'lit') { bytes.push(t.byte); continue; }
    if (t.kind === 'field') {
      const v = params[t.name];
      if (v === undefined || v === null || !isFinite(v)) throw new Error('missing parameter "' + t.name + '"');
      HELM_FIELDS[t.type].enc(Number(v)).forEach((b) => bytes.push(b));
      continue;
    }
    /* Checksums are resolved after the literal/field bytes are laid down, because a range can
       legitimately cover bytes that come later in the template than the checksum token does. */
    const spec = HELM_CHECKSUMS[t.algo];
    pending.push({ at: bytes.length, t: t, width: spec.width });
    for (let i = 0; i < spec.width; i++) bytes.push(0);
  }
  for (const p of pending) {
    const spec = HELM_CHECKSUMS[p.t.algo];
    const from = p.t.from == null ? 0 : p.t.from;
    const to = p.t.to == null ? p.at : p.t.to;
    const v = spec.fn(bytes.slice(from, to));
    HELM_ENDIAN[p.t.endian || 'le'](v, spec.width).forEach((b, i) => { bytes[p.at + i] = b; });
  }
  return new Uint8Array(bytes);
}

function helmToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/* ---- Field inference ------------------------------------------------------
   Given several captures of the SAME command with different parameter values, report which byte
   positions moved. Constant positions are framing and opcode; the movers are your parameter and
   your checksum. This is the first thing to run on a fresh capture — it turns a wall of hex into
   "byte 2 is the thing I was changing". */
function helmInferFields(frames) {
  const rows = frames.map((f) => (typeof f === 'string' ? Array.from(motorParseHex(f) || []) : Array.from(f)));
  if (rows.length < 2) throw new Error('need at least 2 frames to compare');
  const len = rows[0].length;
  if (!rows.every((r) => r.length === len)) {
    return { sameLength: false, note: 'frames differ in length — compare only same-length captures of the same command' };
  }
  const varying = [], constant = [];
  for (let i = 0; i < len; i++) {
    const vals = rows.map((r) => r[i]);
    (vals.every((v) => v === vals[0]) ? constant : varying).push(i);
  }
  return { sameLength: true, length: len, constant: constant, varying: varying,
           values: varying.map((i) => ({ index: i, values: rows.map((r) => r[i]) })) };
}

/* ---- Checksum inference ---------------------------------------------------
   Brute-force the trailing bytes. For every algorithm, every plausible start offset, and both
   byte orders, check whether it reproduces the observed trailing byte(s) in EVERY captured
   frame. Requiring all frames to agree is what makes this trustworthy — a single frame will
   match several algorithms by luck, three frames essentially never will.

   Returns every match, best-supported first, rather than picking one: if two algorithms both
   explain your captures you genuinely do not know yet, and should say so rather than commit. */
function helmSolveChecksum(frames) {
  const rows = frames.map((f) => (typeof f === 'string' ? Array.from(motorParseHex(f) || []) : Array.from(f)));
  if (rows.length < 2) throw new Error('need at least 2 frames — one frame matches many algorithms by chance');
  const len = rows[0].length;
  if (!rows.every((r) => r.length === len)) throw new Error('frames must be the same length');

  const hits = [];
  for (const algo of Object.keys(HELM_CHECKSUMS)) {
    const spec = HELM_CHECKSUMS[algo];
    if (len <= spec.width) continue;
    const at = len - spec.width;                    // assume the checksum trails, as it nearly always does
    for (const endian of (spec.width === 1 ? ['le'] : ['le', 'be'])) {
      for (let from = 0; from < at; from++) {
        const ok = rows.every((r) => {
          const want = HELM_ENDIAN[endian](spec.fn(r.slice(from, at)), spec.width);
          return want.every((b, i) => b === r[at + i]);
        });
        if (ok) hits.push({ algo: algo, from: from, to: at, endian: endian, width: spec.width,
                            template: '{' + algo + ':' + from + '..' + at + '}' });
      }
    }
  }
  /* A match covering more of the frame is the more meaningful one — from:0 over the whole body
     beats a lucky 2-byte window near the end. */
  hits.sort((a, b) => (a.to - a.from) === (b.to - b.from) ? a.from - b.from : (b.to - b.from) - (a.to - a.from));
  return { frames: rows.length, length: len, matches: hits,
           confident: hits.length === 1 && rows.length >= 3,
           note: !hits.length ? 'No checksum found. The trailing bytes may be a sequence counter, a rolling value, or there may be no checksum at all.'
                 : hits.length > 1 ? 'More than one algorithm fits — capture another frame to disambiguate.'
                 : rows.length < 3 ? 'Single match, but only 2 frames. Capture a third to be sure.' : 'Single algorithm explains every frame.' };
}

/* ---- Simulated motor ------------------------------------------------------
   A fake control head. It exists so the command model and the autopilot can be built and tested
   at a desk instead of beside a live propeller, and so a regression suite can run in CI with no
   hardware at all. It is deliberately dumb: it decodes frames only via the templates you give it,
   which means it also validates that your templates round-trip. */
function HelmSim(bindings) {
  this.bindings = bindings || {};        // action name -> template string
  this.state = { prop: false, speed: 0, heading: null, spotlock: false };
  this.received = [];
}
HelmSim.prototype.write = function (bytes) {
  const hex = helmToHex(bytes);
  this.received.push(hex);
  /* Match against each bound template by rendering candidates and comparing — for parameterless
     actions that's exact, and for parameterised ones we search the plausible value range. */
  for (const action of Object.keys(this.bindings)) {
    const tpl = this.bindings[action];
    let toks;
    try { toks = helmParseTemplate(tpl); } catch (e) { continue; }
    const fields = toks.filter((t) => t.kind === 'field');
    if (!fields.length) {
      try { if (helmToHex(helmRender(toks, {})) === hex) { this.apply(action, null); return { action: action }; } }
      catch (e) { /* not this one */ }
      continue;
    }
    if (fields.length !== 1) continue;                    // multi-field decode isn't needed yet
    for (let v = 0; v <= 360; v++) {
      let cand;
      try { cand = helmToHex(helmRender(toks, { [fields[0].name]: v })); } catch (e) { break; }
      if (cand === hex) { this.apply(action, v); return { action: action, value: v }; }
    }
  }
  return { action: null, note: 'frame did not match any bound template' };
};
HelmSim.prototype.apply = function (action, v) {
  const s = this.state;
  if (action === 'prop_on') s.prop = true;
  else if (action === 'prop_off') { s.prop = false; s.speed = 0; }
  else if (action === 'stop') { s.prop = false; s.speed = 0; s.spotlock = false; }
  else if (action === 'speed_set') { s.speed = v; s.prop = v > 0; }
  else if (action === 'heading_set') s.heading = v;
  else if (action === 'spotlock_on') s.spotlock = true;
  else if (action === 'spotlock_off') s.spotlock = false;
};

/* ---- Autopilot: Integral Line-of-Sight -------------------------------------
   NOT a PID on cross-track error. Cross-track is a POSITION error driving a HEADING command, so
   the plant already contains an integrator; wrapping a second one around it gives a double
   integrator with delay, and you get hunting by construction — the boat scribing S-curves down
   the track, which is the classic amateur-autopilot failure.

   ILOS instead. The integrator term absorbs the steady push of wind and current, and note the
   (e² + Δ²) in the DENOMINATOR: accumulation shrinks as the error grows, so it winds LEAST
   exactly when saturation is most likely. That is anti-windup for free — no conditional
   integration, no clamping, no back-calculation, none of the usual bolt-ons. */
const AP = {
  on: false, route: [], i: 0, startLL: null, yInt: 0, lastTick: 0,
  humanDeadline: 0, commandedHdg: null, note: '',
};

const AP_TICK_MS      = 1000;   // paced by GPS. You cannot outrun your position source, and
                                // commanding at 10 Hz on 1 Hz data just injects noise into a prop.
const AP_DELTA_M      = 22;     // Δ lookahead. IS the max-correction knob: approach = atan(y/Δ).
const AP_SIGMA        = 0.08;   // σ integral gain. Bound: σ < speed margin over the current.
const AP_HDG_DEADBAND = 2;      // ° — don't chase wave-induced wander.
const AP_HDG_SLEW     = 12;     // ° per tick ceiling on the COMMANDED heading, so a bad output
                                // can't command a 170° swing; a reversal takes 15 s and every
                                // one of those ticks re-checks the gates.
const AP_FIX_HOLD_MS  = 3000;   // beyond this the fix isn't authoritative: freeze, hold heading.
const AP_FIX_SAFE_MS  = 12000;  // beyond this, safe harbour.

/* Signed cross-track error in metres. Positive = boat is to STARBOARD of the A→B track.
   Done with bearings rather than a projection so it reads like the rest of this codebase. */
function apCrossTrack(a, b, p) {
  const rel = ((bearingBetween(a, p) - bearingBetween(a, b) + 540) % 360) - 180;
  return a.distanceTo(p) * Math.sin(rel * Math.PI / 180);
}

/* Shortest signed angle from `from` to `to`, in degrees. */
function apAngleDiff(from, to) { return ((to - from + 540) % 360) - 180; }

/* One control step. Split out from the timer so it is unit-testable: give it a position and a
   fix age and it returns what it would command, with no radio and no clock involved. */
function apCompute(ll, fixAgeMs, coarse, dt) {
  const A = AP.i > 0 ? AP.route[AP.i - 1] : AP.startLL;
  const B = AP.route[AP.i];
  const trackBrg = bearingBetween(A, B);
  const y = apCrossTrack(A, B, ll);
  const authoritative = fixAgeMs <= AP_FIX_HOLD_MS && !coarse;

  if (authoritative) {
    const e = y + AP_SIGMA * AP.yInt;
    AP.yInt += (AP_DELTA_M * y / (e * e + AP_DELTA_M * AP_DELTA_M)) * dt;
    AP.note = '';
  } else {
    /* FREEZE the integrator — not clamp, not zero. Zeroing throws away a hard-won estimate of
       the current and causes a lurch the moment fixes return; clamping still lets it wind to
       the clamp while blind. The current did not change while we weren't looking. */
    AP.note = coarse ? 'GPS coarse — holding' : 'fix stale — holding';
  }

  /* The LOS law: steer toward a point Δ ahead on the track, offset by the integrated error. */
  const want = trackBrg - Math.atan2(y + AP_SIGMA * AP.yInt, AP_DELTA_M) * 180 / Math.PI;
  const prev = AP.commandedHdg == null ? want : AP.commandedHdg;
  const step = Math.max(-AP_HDG_SLEW, Math.min(AP_HDG_SLEW, apAngleDiff(prev, want)));
  const cmd = ((prev + step) % 360 + 360) % 360;

  return { trackBrg: trackBrg, xte: y, authoritative: authoritative,
           want: ((want % 360) + 360) % 360, commanded: cmd,
           deadbanded: Math.abs(apAngleDiff(prev, want)) < AP_HDG_DEADBAND };
}
