/* motor.js — pure helpers: UUID canonicalisation, hex parsing/printing, error explanations, the
 * requestDevice option ladder, platform capability, STOP matching, deadman maths.
 * Expected values are derived from the legacy implementation (legacy/js/motor.js). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ui = vi.hoisted(() => ({ toast: vi.fn(), confirmDialog: vi.fn(), promptDialog: vi.fn() }));
const native = vi.hoisted(() => ({
  copyText: vi.fn(async () => true), haptic: vi.fn(), isNativeShell: vi.fn(() => false),
  saveOrShareFile: vi.fn(async () => 'downloaded'),
}));

vi.mock('../../../src/engine/app.js', () => ({
  APP_BUILD: 'test-build',
  readJSON: (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));
vi.mock('../../../src/services/ui', () => ui);
vi.mock('../../../src/services/native', () => native);

import * as M from '../../../src/engine/motor.js';

const SIG = '-0000-1000-8000-00805f9b34fb';
const dv = (bytes) => new DataView(new Uint8Array(bytes).buffer);

function setNavigator(props) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(navigator, k, { configurable: true, value: v });
}

beforeEach(() => {
  localStorage.clear();
  M.Motor._logLines = [];
  M.Motor._plan = { mode: '', i: 0 };
  M.Motor.recording = false;
  vi.clearAllMocks();
  native.isNativeShell.mockReturnValue(false);
});

describe('motorCharKey', () => {
  it('canonicalises CoreBluetooth short/uppercase forms to lowercase 128-bit', () => {
    expect(M.motorCharKey('180F')).toBe('0000180f' + SIG);
    expect(M.motorCharKey('0x2A29')).toBe('00002a29' + SIG);
    expect(M.motorCharKey('FFE1')).toBe('0000ffe1' + SIG);
    expect(M.motorCharKey('f')).toBe('0000000f' + SIG);
    expect(M.motorCharKey('1234ABCD')).toBe('1234abcd' + SIG);
    expect(M.motorCharKey(' 6E400001-B5A3-F393-E0A9-E50E24DCCA9E ')).toBe('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    expect(M.motorCharKey(null)).toBe('');
    expect(M.motorCharKey(undefined)).toBe('');
    expect(M.motorCharKey('not-a-uuid')).toBe('not-a-uuid');
  });
});

describe('motorParseHex', () => {
  it('accepts spaced, packed, 0x and punctuated forms', () => {
    expect(Array.from(M.motorParseHex('a5 01 ff'))).toEqual([0xa5, 0x01, 0xff]);
    expect(Array.from(M.motorParseHex('A501FF'))).toEqual([0xa5, 0x01, 0xff]);
    expect(Array.from(M.motorParseHex('0xa5,0x01'))).toEqual([0xa5, 0x01]);
    expect(Array.from(M.motorParseHex('a5-01:02'))).toEqual([0xa5, 0x01, 0x02]);
  });
  it('returns null on anything malformed (never a half frame)', () => {
    expect(M.motorParseHex('abc')).toBe(null);       // odd length
    expect(M.motorParseHex('')).toBe(null);
    expect(M.motorParseHex(null)).toBe(null);
    expect(M.motorParseHex('zz')).toBe(null);        // nothing left after cleaning
    expect(M.motorParseHex('g1')).toBe(null);        // "1" alone = odd
  });
});

describe('motorHex / motorAscii', () => {
  it('print bytes and printable ASCII', () => {
    expect(M.motorHex(dv([0xa5, 0x01, 0xff]))).toBe('a5 01 ff');
    expect(M.motorHex(dv([]))).toBe('');
    expect(M.motorAscii(dv([0x48, 0x69, 0x00, 0x7f, 0x20]))).toBe('Hi.. ');
  });
});

describe('motorExplainError', () => {
  it('maps DOMException names to actionable guidance', () => {
    const nf = M.motorExplainError({ name: 'NotFoundError', message: 'User cancelled the requestDevice() chooser.' });
    expect(nf.name).toBe('NotFoundError');
    expect(nf.retap).toBe(false);
    expect(nf.guide).toMatch(/^No matching device, or the chooser was dismissed\. The motor only advertises WHILE YOU HOLD/);
    expect(M.motorExplainError({ name: 'TypeError', message: 'x' }).guide).toBe('Bad request options for this browser — likely a service UUID it cannot parse.');
    expect(M.motorExplainError({ name: 'NetworkError', message: 'x' }).guide).toMatch(/force-quit the One-Boat Network app\.$/);
  });
  it('reads a bridged plain Error by its message', () => {
    expect(M.motorExplainError(new Error('User cancelled the chooser')).name).toBe('NotFoundError');
    expect(M.motorExplainError(new Error('No device selected.')).name).toBe('NotFoundError');
    // narrow on purpose: a GATT "not found" is NOT a dismissed chooser
    const real = M.motorExplainError(new Error('service not found'));
    expect(real.name).toBe('Error');
    expect(real.guide).toBe('Unrecognised failure — the raw error is above.');
  });
  it('a lost tap asks for a re-tap rather than blaming the device', () => {
    const x = M.motorExplainError({ name: 'SecurityError', message: 'Must be handling a user gesture to show a permission request.' });
    expect(x).toMatchObject({ name: 'NotAllowedError', retap: true });
    expect(x.guide).toMatch(/each attempt needs its own tap/);
  });
  it('survives junk', () => {
    expect(M.motorExplainError(undefined)).toMatchObject({ name: 'Error', msg: 'undefined', retap: false });
  });
});

describe('motorCandidateServices / motorRequestPlans', () => {
  it('lists the standard guesses as canonical 128-bit strings', () => {
    const s = M.motorCandidateServices();
    expect(s).toEqual([
      '00001800' + SIG, '00001801' + SIG, '0000180a' + SIG, '0000180f' + SIG, '00001819' + SIG,
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e', '0000fe59' + SIG,
    ]);
  });
  it('puts the profile service first, canonicalised and de-duplicated', () => {
    localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: 'FFF0', write: '', notify: '', frames: [] }));
    expect(M.motorCandidateServices()[0]).toBe('0000fff0' + SIG);
    localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: '180F', write: '', notify: '', frames: [] }));
    const s = M.motorCandidateServices();
    expect(s.length).toBe(7);
    expect(s[0]).toBe('0000180f' + SIG);
  });
  it('drops a typo instead of failing the whole requestDevice call, and says so', () => {
    localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: 'oops-typo', write: '', notify: '', frames: [] }));
    const s = M.motorCandidateServices();
    expect(s.length).toBe(7);
    expect(M.Motor._logLines.at(-1)).toMatchObject({ line: 'ignoring unusable service UUID in profile: oops-typo', cls: 'warn' });
  });
  it('builds the option ladder', () => {
    const all = M.motorRequestPlans({ all: true });
    expect(all.map((p) => p.why)).toEqual(['every LE device + service list', 'every LE device, no service list']);
    expect(all[0].options.acceptAllDevices).toBe(true);
    expect(all[1].options).toEqual({ acceptAllDevices: true });

    localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: 'FFF0', write: '', notify: '', frames: [] }));
    const f = M.motorRequestPlans({});
    expect(f.map((p) => p.why)).toEqual([
      'name filter + full service list', 'name filter + saved/UART services only',
      'name filter, NO optionalServices key', 'single filter "Minn Kota" only',
    ]);
    expect(f[0].options.filters).toEqual([{ namePrefix: 'Minn Kota' }, { namePrefix: 'MinnKota' }]);
    expect(f[1].options.optionalServices).toEqual(['0000fff0' + SIG, '6e400001-b5a3-f393-e0a9-e50e24dcca9e']);
    expect('optionalServices' in f[2].options).toBe(false);
    expect(f[3].options).toEqual({ filters: [{ namePrefix: 'Minn Kota' }] });
  });
});

describe('motorRequestDevice ladder', () => {
  const err = (name, message = name) => Object.assign(new Error(message), { name });
  afterEach(() => { delete navigator.bluetooth; });

  it('walks down the rungs until the browser accepts the options', async () => {
    const dev = { name: 'Minn Kota X' };
    const requestDevice = vi.fn()
      .mockRejectedValueOnce(err('NotSupportedError'))
      .mockRejectedValueOnce(err('TypeError'))
      .mockResolvedValueOnce(dev);
    setNavigator({ bluetooth: { requestDevice } });
    await expect(M.motorRequestDevice({})).resolves.toBe(dev);
    expect(requestDevice).toHaveBeenCalledTimes(3);
    const lines = M.Motor._logLines.map((l) => l.line);
    expect(lines).toContain('this browser refused option set(s) 1–2 — worth reporting.');
    expect(lines).toContain('options accepted on try 3');
    expect(M.Motor._plan).toEqual({ mode: 'filter', i: 0 });
  });

  it('stops at once when the chooser was dismissed (no four choosers)', async () => {
    const requestDevice = vi.fn().mockRejectedValue(err('NotFoundError'));
    setNavigator({ bluetooth: { requestDevice } });
    await expect(M.motorRequestDevice({})).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(M.Motor._plan).toEqual({ mode: 'filter', i: 0 });
  });

  it('a lost tap resumes on the same rung at the next tap', async () => {
    const requestDevice = vi.fn()
      .mockRejectedValueOnce(err('NotSupportedError'))
      .mockRejectedValueOnce(err('SecurityError', 'Must be handling a user gesture to show a permission request.'));
    setNavigator({ bluetooth: { requestDevice } });
    await expect(M.motorRequestDevice({})).rejects.toBeTruthy();
    expect(M.Motor._plan).toEqual({ mode: 'filter', i: 1 });
    const dev = { name: 'Minn Kota X' };
    requestDevice.mockResolvedValueOnce(dev);
    await expect(M.motorRequestDevice({})).resolves.toBe(dev);
    // resumed at rung 2, not rung 1
    expect(requestDevice.mock.calls[2][0]).toEqual(M.motorRequestPlans({})[1].options);
  });

  it('switching to "show all" restarts the ladder', async () => {
    M.Motor._plan = { mode: 'filter', i: 2 };
    const requestDevice = vi.fn().mockResolvedValue({ name: 'x' });
    setNavigator({ bluetooth: { requestDevice } });
    await M.motorRequestDevice({ all: true });
    expect(requestDevice.mock.calls[0][0].acceptAllDevices).toBe(true);
    expect(requestDevice.mock.calls[0][0].optionalServices).toBeTruthy();
  });
});

describe('motorSupport / motorSupported', () => {
  afterEach(() => {
    delete navigator.bluetooth;
    delete navigator.userAgent; delete navigator.platform; delete navigator.maxTouchPoints;
    delete window.isSecureContext;
  });

  it('the iOS app shell is checked first and never offered Bluefy or https advice', () => {
    native.isNativeShell.mockReturnValue(true);
    setNavigator({ bluetooth: { requestDevice: vi.fn() } });
    const s = M.motorSupport();
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('native');
    expect(s.why).not.toMatch(/Bluefy|https|Android/);
    expect(M.motorSupported()).toBe(false);
  });
  it('ok when Web Bluetooth is present', () => {
    setNavigator({ bluetooth: { requestDevice: vi.fn() } });
    expect(M.motorSupport()).toEqual({ ok: true, why: '', reason: '' });
    expect(M.motorSupported()).toBe(true);
  });
  it('blames the insecure context before the browser', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    const s = M.motorSupport();
    expect(s.reason).toBe('insecure');
    expect(s.why).toBe('This page isn\'t a secure context, so no browser will expose Bluetooth. Open the <b>https://</b> address (not a local file or an http:// copy) and try again.');
  });
  it('iPhone (and iPad posing as a Mac) get the Bluefy explanation', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect(M.motorSupport().reason).toBe('ios');
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 });
    const s = M.motorSupport();
    expect(s.reason).toBe('ios');
    expect(s.why).toMatch(/Open FishApp in <b>Bluefy<\/b> \(free on the App Store\) and this panel works\.$/);
  });
  it('anything else', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    setNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko Firefox/120.0', platform: 'Win32', maxTouchPoints: 0 });
    expect(M.motorSupport()).toEqual({ ok: false, reason: 'other', why: 'This browser has no Web Bluetooth. Chrome or Edge on Android/desktop, or Bluefy on iPhone.' });
  });
});

describe('motorRichText', () => {
  it('splits our own <b> runs into text parts and strips any other tag', () => {
    expect(M.motorRichText('Open the <b>https://</b> address')).toEqual([
      { text: 'Open the ', bold: false }, { text: 'https://', bold: true }, { text: ' address', bold: false },
    ]);
    expect(M.motorRichText('<i>x</i>y')).toEqual([{ text: 'xy', bold: false }]);
    expect(M.motorRichText('')).toEqual([]);
  });
});

describe('motorFindStopFrame (exact STOP)', () => {
  it('matches only the command named STOP', () => {
    const stop = { label: ' Stop ', hex: 'a5 00' };
    expect(M.motorFindStopFrame([{ label: 'Spot-Lock stop', hex: 'a5 09' }, stop])).toBe(stop);
    expect(M.motorFindStopFrame([{ label: 'Spot-Lock stop', hex: 'a5 09' }])).toBe(null);
    expect(M.motorFindStopFrame([{ label: 'STOPPED', hex: '01' }, { label: 'stop motor', hex: '02' }])).toBe(null);
    expect(M.motorFindStopFrame([{ label: 'STOP', hex: '01' }, { label: 'stop', hex: '02' }]).hex).toBe('01');
    expect(M.motorFindStopFrame(undefined)).toBe(null);
    expect(M.motorFindStopFrame([null, { label: null }])).toBe(null);
  });
});

describe('motorLegacyStopFrame (old "contains stop" rule, for the migration warning)', () => {
  it('returns what the old rule fired, only when nothing is named exactly STOP', () => {
    const a = { label: 'Spot-Lock stop', hex: 'a5 09' };
    const b = { label: 'Stop motor', hex: 'a5 00' };
    expect(M.motorLegacyStopFrame([{ label: 'Spot-Lock on', hex: '01' }, a, b])).toBe(a);   // first match, like legacy
    expect(M.motorLegacyStopFrame([b, { label: ' STOP ', hex: '02' }])).toBe(null);          // an exact STOP exists
    expect(M.motorLegacyStopFrame([{ label: 'Spot-Lock on', hex: '01' }])).toBe(null);
    expect(M.motorLegacyStopFrame(undefined)).toBe(null);
    expect(M.motorLegacyStopFrame([null, { label: null }])).toBe(null);
  });
});

describe('motorWithin', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('resolves with the promise when it settles first, and never rejects', async () => {
    const onTimeout = vi.fn();
    await expect(M.motorWithin(Promise.resolve(7), 1000, onTimeout)).resolves.toBe(7);
    await expect(M.motorWithin(Promise.reject(new Error('x')), 1000, onTimeout)).resolves.toBe(undefined);
    expect(onTimeout).not.toHaveBeenCalled();
  });
  it('gives up after the wait and says so', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const p = M.motorWithin(new Promise(() => {}), 3000, onTimeout);
    await vi.advanceTimersByTimeAsync(2999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(undefined);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe('motorRequestDevice superseded by a newer tap', () => {
  afterEach(() => { delete navigator.bluetooth; M.Motor._connectSeq = 0; });
  it('stops walking rungs and leaves the resume point to the newer attempt', async () => {
    const err = Object.assign(new Error('nope'), { name: 'NotSupportedError' });
    let rejectFirst;
    const requestDevice = vi.fn().mockReturnValueOnce(new Promise((_, rej) => { rejectFirst = rej; }));
    setNavigator({ bluetooth: { requestDevice } });
    M.Motor._connectSeq = 5;
    const p = M.motorRequestDevice({}, 5);
    M.Motor._connectSeq = 6;                  // a newer tap
    M.Motor._plan = { mode: 'filter', i: 2 }; // the newer attempt's resume point
    rejectFirst(err);
    await expect(p).rejects.toBe(err);
    expect(requestDevice).toHaveBeenCalledTimes(1);   // no second rung
    expect(M.Motor._plan).toEqual({ mode: 'filter', i: 2 });
  });
});

describe('deadman maths', () => {
  it('counts down from 20 s on the human clock, never below zero', () => {
    expect(M.MOTOR_DEADMAN_MS).toBe(20000);
    expect(M.motorDeadmanLeftS(0, 0)).toBe(20);
    expect(M.motorDeadmanLeftS(0, 1)).toBe(20);
    expect(M.motorDeadmanLeftS(0, 1000)).toBe(19);
    expect(M.motorDeadmanLeftS(0, 19001)).toBe(1);
    expect(M.motorDeadmanLeftS(0, 20000)).toBe(0);
    expect(M.motorDeadmanLeftS(0, 25000)).toBe(0);
  });
});

describe('misc', () => {
  it('session file name', () => {
    expect(M.motorSessionFileName(new Date('2026-10-25T14:03:09.123Z'))).toBe('motor-session-2026-10-25-14-03-09.json');
  });
  it('escapeHtmlMotor is kept for marker callers', () => {
    expect(M.escapeHtmlMotor('<b a="1">&')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;');
  });
  it('log is capped at 400 lines and carries device text verbatim, as plain text', () => {
    for (let i = 0; i < 405; i++) M.motorLog('line ' + i);
    const log = M.motorStore.getState().log;
    expect(log.length).toBe(M.MOTOR_LOG_MAX);
    expect(log[0].line).toBe('line 5');
    const evil = 'picked: "<img src=x onerror=alert(1)>"';
    M.motorLog(evil, 'hdr');
    expect(M.motorStore.getState().log.at(-1)).toMatchObject({ line: evil, cls: 'hdr' });
  });
  it('log lines are timestamped only while recording', () => {
    M.motorLog('idle');
    expect(M.Motor._logLines.at(-1).t).toBe('       ');
  });
});
