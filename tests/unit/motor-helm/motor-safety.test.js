/* motor.js — the safety cage as a state machine: arm gate, two clocks, deadman, backgrounding,
 * STOP, link loss, the async-dialog re-checks, and the fixes from the inventory (fail-safe
 * add-command dialog, exact STOP, Show-all disconnects first, Connect in-flight guard,
 * no stacked notify listeners, spoken link-lost alert, STOP on manual disarm/disconnect). */
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

const WRITE = '0000fff1-0000-1000-8000-00805f9b34fb';
const NOTIFY = '0000fff2-0000-1000-8000-00805f9b34fb';
const FRAMES = [
  { label: 'Spot-Lock stop', hex: 'a5 09', danger: false },
  { label: 'STOP', hex: 'a5 00', danger: false },
  { label: 'Spot-Lock on', hex: 'a5 01', danger: true },
];

let events;   // ordered side effects on the fake radio

function fakeChar(uuid, props) {
  const ch = new EventTarget();
  ch.uuid = uuid;
  ch.properties = props;
  ch.writes = [];
  ch.writeValueWithoutResponse = vi.fn(async (b) => { ch.writes.push(Array.from(b)); events.push('write ' + M.motorHex(new DataView(b.buffer))); });
  ch.startNotifications = vi.fn(async () => ch);
  ch.readValue = vi.fn(async () => new DataView(new ArrayBuffer(0)));
  return ch;
}
function fakeDevice(name, chars) {
  const d = new EventTarget();
  d.name = name;
  d.id = 'id-' + name;
  const server = {
    getPrimaryService: vi.fn(async () => { throw new Error('no 180a'); }),
    getPrimaryServices: vi.fn(async () => [{ uuid: 'svc', getCharacteristics: async () => chars }]),
  };
  d.gatt = {
    connected: false,
    connect: vi.fn(async () => { d.gatt.connected = true; return server; }),
    disconnect: vi.fn(() => { d.gatt.connected = false; events.push('disconnect ' + name); }),
  };
  d.server = server;
  return d;
}
function setProfile(frames = FRAMES) {
  localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: '', write: WRITE, notify: '', frames }));
}
/* A connected link, as motorConnect would leave it. */
function rig(frames) {
  setProfile(frames);
  const ch = fakeChar(WRITE, { write: true, writeWithoutResponse: true });
  const dev = fakeDevice('Minn Kota Test', [ch]);
  dev.gatt.connected = true;
  M.Motor.device = dev;
  M.Motor.server = dev.server;
  M.Motor.connected = true;
  M.Motor.chars.set(M.motorCharKey(WRITE), ch);
  dev.addEventListener('gattserverdisconnected', M.motorOnDisconnected);
  M.motorUpdateUi();
  return { ch, dev };
}
async function arm() {
  ui.confirmDialog.mockResolvedValueOnce(true);
  await M.motorArm();
  expect(M.Motor.armed).toBe(true);
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const logText = () => M.Motor._logLines.map((l) => l.line);
const st = () => M.motorStore.getState();

let requestDevice, speak, cancel;

beforeEach(() => {
  events = [];
  clearInterval(M.Motor._deadmanTimer);
  Object.assign(M.Motor, {
    device: null, server: null, connected: false, armed: false, frames: [], recording: false, recStartTs: 0,
    lastActionTs: 0, lastHumanTs: 0, _deadmanTimer: null, _logLines: [], _plan: { mode: '', i: 0 },
    _connecting: '', _armAsking: false, _sendAsking: false, _probeAt: 0, _voicePrimed: false,
    _chooseAt: 0, _disconnecting: false, _retired: new WeakSet(),
  });
  M.Motor.chars.clear();
  localStorage.clear();
  vi.clearAllMocks();
  ui.confirmDialog.mockReset(); ui.promptDialog.mockReset();
  native.isNativeShell.mockReturnValue(false);
  requestDevice = vi.fn();
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice } });
  speak = vi.fn(); cancel = vi.fn();
  window.speechSynthesis = { speak, cancel };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  M.motorUpdateUi();
});
afterEach(() => {
  vi.useRealTimers();
  clearInterval(M.Motor._deadmanTimer);
  delete navigator.bluetooth;
});

describe('arming', () => {
  it('refuses without a link and never asks', async () => {
    await M.motorArm();
    expect(ui.toast).toHaveBeenCalledWith('Not connected');
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(M.Motor.armed).toBe(false);
  });

  it('asks with the full safety checklist, then arms, touches the human clock and starts the deadman', async () => {
    rig();
    await arm();
    const opts = ui.confirmDialog.mock.calls[0][0];
    expect(opts.title).toBe('ARM the motor link?');
    expect(opts.message).toBe(
      'FishApp will be able to send commands that move the boat.\n\n' +
      '• Prop clear of people, rope and the bottom\n' +
      '• Foot pedal within reach — it is the real kill switch\n' +
      '• Disarms itself after 20s with no input, or if the app is backgrounded\n\n' +
      'Arm now?');
    expect(M.Motor._deadmanTimer).toBeTruthy();
    expect(M.Motor.lastHumanTs).toBeGreaterThan(0);
    expect(st()).toMatchObject({ armed: true, deadmanRemainingS: 20 });
    expect(logText()).toContain('ARMED');
    expect(native.haptic).toHaveBeenCalled();
  });

  it('Cancel leaves it disarmed', async () => {
    rig();
    ui.confirmDialog.mockResolvedValueOnce(false);
    await M.motorArm();
    expect(M.Motor.armed).toBe(false);
    expect(M.Motor._deadmanTimer).toBe(null);
  });

  it('re-checks the link after the dialog: a drop while it was open means no arm', async () => {
    rig();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorArm();
    M.motorOnDisconnected();
    d.resolve(true);
    await p;
    expect(M.Motor.armed).toBe(false);
    expect(ui.toast).toHaveBeenCalledWith('Not connected');
  });

  it('a second tap while the dialog is open does not stack another dialog', async () => {
    rig();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorArm();
    await M.motorArm();
    expect(ui.confirmDialog).toHaveBeenCalledTimes(1);
    d.resolve(true);
    await p;
    expect(M.Motor.armed).toBe(true);
  });

  it('primes speech from inside the arming tap', async () => {
    rig();
    await arm();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].volume).toBe(0);
  });
});

describe('deadman (human clock only)', () => {
  it('auto-stops 20-21 s after the last human input: STOP sent, disarmed, toast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { ch } = rig();
    await arm();
    vi.advanceTimersByTime(5000);
    expect(st().deadmanRemainingS).toBe(15);
    vi.advanceTimersByTime(15000);              // t = 20 s: idle is not yet > 20000
    expect(M.Motor.armed).toBe(true);
    vi.advanceTimersByTime(1000);               // t = 21 s
    expect(M.Motor.armed).toBe(false);
    expect(ch.writes).toEqual([[0xa5, 0x00]]);  // the exact STOP, not "Spot-Lock stop"
    expect(ui.toast).toHaveBeenCalledWith('Deadman expired — motor link disarmed');
    expect(logText()).toEqual(expect.arrayContaining(['deadman expired — stopping', 'DISARMED (deadman)']));
    expect(st()).toMatchObject({ armed: false, deadmanRemainingS: null });
  });

  it('a tap on a command feeds it; an automated send does not', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    rig();
    await arm();
    vi.advanceTimersByTime(15000);
    const human0 = M.Motor.lastHumanTs;
    await M.motorSendHex('a5 05', {});         // automated: link clock only
    expect(M.Motor.lastHumanTs).toBe(human0);
    expect(M.Motor.lastActionTs).toBe(Date.now());
    await M.motorSendFrame(0);                   // a gesture
    expect(M.Motor.lastHumanTs).toBe(Date.now());
    expect(st().deadmanRemainingS).toBe(20);
    vi.advanceTimersByTime(19000);
    expect(M.Motor.armed).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(M.Motor.armed).toBe(false);
  });
});

describe('leaving the app', () => {
  it('backgrounding while armed sends STOP and disarms', async () => {
    const { ch } = rig();
    await arm();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try { document.dispatchEvent(new Event('visibilitychange')); }
    finally { delete document.visibilityState; }
    expect(M.Motor.armed).toBe(false);
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(logText()).toEqual(expect.arrayContaining(['app backgrounded while armed — stopping', 'DISARMED (backgrounded)']));
  });

  it('pagehide while armed sends STOP synchronously and disarms', async () => {
    const { ch } = rig();
    await arm();
    window.dispatchEvent(new Event('pagehide'));
    expect(ch.writeValueWithoutResponse).toHaveBeenCalledTimes(1);   // no await before the write
    expect(M.Motor.armed).toBe(false);
    expect(logText()).toContain('DISARMED (page closing)');
  });

  it('does nothing while disarmed', () => {
    const { ch } = rig();
    window.dispatchEvent(new Event('pagehide'));
    expect(ch.writes).toEqual([]);
  });
});

describe('sending through the single choke point', () => {
  it('refuses a danger frame while disarmed, without asking', async () => {
    const { ch } = rig();
    await M.motorSendFrame(2);
    expect(ui.toast).toHaveBeenCalledWith('Arm the link first');
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(ch.writes).toEqual([]);
  });

  it('armed: asks per send, sends on yes, not on no', async () => {
    const { ch } = rig();
    await arm();
    ui.confirmDialog.mockResolvedValueOnce(false);
    await M.motorSendFrame(2);
    expect(ch.writes).toEqual([]);
    ui.confirmDialog.mockResolvedValueOnce(true);
    await M.motorSendFrame(2);
    expect(ui.confirmDialog.mock.calls.at(-1)[0]).toMatchObject({ title: 'Send "Spot-Lock on"?', message: 'This can move the boat.', destructive: true });
    expect(ch.writes).toEqual([[0xa5, 0x01]]);
    expect(st().log.at(-1)).toMatchObject({ line: '-> Spot-Lock on  a5 01', cls: 'tx' });
  });

  it('re-checks after the confirm: the deadman fired while it was open -> not sent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { ch } = rig();
    await arm();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorSendFrame(2);
    vi.advanceTimersByTime(21000);
    d.resolve(true);
    await p;
    expect(ch.writes).toEqual([[0xa5, 0x00]]);       // only the deadman's STOP
    expect(ui.toast).toHaveBeenCalledWith('Disarmed while the confirm was open — not sent');
  });

  it('re-checks after the confirm: link dropped while it was open -> not sent', async () => {
    const { ch, dev } = rig();
    await arm();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorSendFrame(2);
    dev.dispatchEvent(new Event('gattserverdisconnected'));
    d.resolve(true);
    await p;
    expect(ch.writes).toEqual([]);
    expect(ui.toast).toHaveBeenCalledWith('Not connected');
  });

  it('re-checks after the confirm: deadman due but not yet ticked -> not sent, stops now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { ch } = rig();
    await arm();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorSendFrame(2);
    clearInterval(M.Motor._deadmanTimer);            // simulate a tick that hasn't run yet
    vi.setSystemTime(1_000_000 + 20_500);
    d.resolve(true);
    await p;
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(M.Motor.armed).toBe(false);
  });

  it('one danger confirm at a time', async () => {
    rig();
    await arm();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorSendFrame(2);
    await M.motorSendFrame(2);
    expect(ui.confirmDialog).toHaveBeenCalledTimes(2);   // arm + one send
    d.resolve(false);
    await p;
  });

  it('validates link, profile and hex', async () => {
    await M.motorSendHex('a5', {});
    expect(ui.toast).toHaveBeenLastCalledWith('Not connected');
    rig();
    await M.motorSendHex('zz', {});
    expect(ui.toast).toHaveBeenLastCalledWith('That is not valid hex');
    localStorage.setItem(M.MOTOR_PROFILE_KEY, JSON.stringify({ service: '', write: '', notify: '', frames: [] }));
    await M.motorSendHex('a5', {});
    expect(ui.toast).toHaveBeenLastCalledWith('No write characteristic set');
    await M.motorSendHex('a5', { charUuid: 'abcd' });
    expect(logText().at(-1)).toBe('write characteristic abcd not found on the device');
  });
});

describe('STOP', () => {
  it('sends the command named exactly STOP with force, then disarms', async () => {
    const { ch } = rig();
    await arm();
    M.motorStop('stop button');
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(M.Motor.armed).toBe(false);
    expect(logText()).toContain('DISARMED (stop button)');
  });

  it('never fires a look-alike ("Spot-Lock stop") as the emergency stop', async () => {
    const { ch } = rig([{ label: 'Spot-Lock stop', hex: 'a5 09', danger: true }]);
    await arm();
    M.motorStop('stop button');
    expect(ch.writes).toEqual([]);
    expect(M.Motor.armed).toBe(false);
    expect(st().hasStop).toBe(false);
  });

  it('manual disarm now sends STOP (deviation)', async () => {
    const { ch } = rig();
    await arm();
    M.motorToggleArm();
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(M.Motor.armed).toBe(false);
    expect(logText()).toContain('DISARMED (user)');
  });

  it('manual disconnect while armed sends STOP before dropping the link (deviation)', async () => {
    const { ch, dev } = rig();
    await arm();
    await M.motorDisconnect();
    expect(events).toEqual(['write a5 00', 'disconnect Minn Kota Test']);
    expect(M.Motor.connected).toBe(false);
    expect(M.Motor.armed).toBe(false);
    expect(ch.writes.length).toBe(1);
    expect(dev.gatt.connected).toBe(false);
    expect(logText()).toContain('disconnected by user');
  });

  it('manual disconnect while disarmed sends nothing', async () => {
    const { ch } = rig();
    await M.motorDisconnect();
    expect(ch.writes).toEqual([]);
    expect(st().connected).toBe(false);
  });
});

describe('link loss', () => {
  it('while armed: disarm, clear, toast, spoken alert + haptic', async () => {
    const { dev } = rig();
    await arm();
    speak.mockClear(); native.haptic.mockClear();
    dev.dispatchEvent(new Event('gattserverdisconnected'));
    expect(M.Motor).toMatchObject({ connected: false, armed: false, server: null });
    expect(M.Motor.chars.size).toBe(0);
    expect(ui.toast).toHaveBeenCalledWith('Motor link lost while armed — use the foot pedal');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe('Motor link lost. Use the foot pedal.');
    expect(cancel).toHaveBeenCalled();
    expect(native.haptic).toHaveBeenCalled();
    expect(logText()).toContain('DISCONNECTED');
  });

  it('while disarmed: no alert', () => {
    const { dev } = rig();
    dev.dispatchEvent(new Event('gattserverdisconnected'));
    expect(speak).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it('a late event from a RETIRED device (listener removal failed) does not tear down the current link', async () => {
    const { dev: old } = rig();
    old.removeEventListener = () => {};          // a non-conforming implementation
    requestDevice.mockReturnValue(new Promise(() => {}));
    M.motorConnect({ all: true });               // drops (retires) the old device
    const next = fakeDevice('Minn Kota Next', []);
    M.Motor.device = next;
    M.Motor.connected = true;
    old.dispatchEvent(new Event('gattserverdisconnected'));
    expect(M.Motor.connected).toBe(true);
    expect(logText()).toContain('ignored a disconnect from a device no longer in use');
  });

  it('an event whose target is merely ANOTHER OBJECT (wrapper/proxy) is a real link loss while armed', async () => {
    rig();
    await arm();
    const wrapper = new EventTarget();
    wrapper.addEventListener('gattserverdisconnected', M.motorOnDisconnected);
    wrapper.dispatchEvent(new Event('gattserverdisconnected'));
    expect(M.Motor).toMatchObject({ connected: false, armed: false });
    expect(ui.toast).toHaveBeenCalledWith('Motor link lost while armed — use the foot pedal');
  });

  it('a retired device object with the SAME id as the current one is not ignored', async () => {
    const { dev } = rig();
    const alias = new EventTarget();
    alias.id = dev.id;
    M.Motor._retired.add(alias);
    await arm();
    M.motorOnDisconnected({ target: alias });
    expect(M.Motor.armed).toBe(false);
    expect(M.Motor.connected).toBe(false);
  });
});

describe('disconnect in flight (STOP write pending)', () => {
  /* A write-with-response characteristic whose ack we control. */
  function slowRig() {
    const r = rig();
    const gate = deferred();
    r.ch.properties = { write: true };
    r.ch.writeValueWithoutResponse = undefined;
    r.ch.writeValueWithResponse = vi.fn(async (b) => { events.push('write-start ' + M.motorHex(new DataView(b.buffer))); await gate.promise; events.push('write-acked'); });
    return { ...r, gate };
  }

  it('publishes disconnecting and ignores a second Disconnect until the STOP write is done', async () => {
    const { gate, dev } = slowRig();
    await arm();
    const p = M.motorDisconnect();
    expect(st()).toMatchObject({ disconnecting: true, connected: true, armed: false });
    await M.motorDisconnect();                          // second tap
    expect(dev.gatt.disconnect).not.toHaveBeenCalled();  // did not abort the pending STOP
    expect(logText()).toContain('already disconnecting — ignoring the extra tap');
    gate.resolve();
    await p;
    expect(events).toEqual(['write-start a5 00', 'write-acked', 'disconnect Minn Kota Test']);
    expect(st()).toMatchObject({ disconnecting: false, connected: false, armed: false });
  });

  it('"Show all devices" during the wait is refused (no requestDevice, no early drop)', async () => {
    const { gate, dev } = slowRig();
    await arm();
    const p = M.motorDisconnect();
    M.motorConnect({ all: true });
    expect(requestDevice).not.toHaveBeenCalled();
    expect(dev.gatt.disconnect).not.toHaveBeenCalled();
    expect(logText()).toContain('still disconnecting — ignoring the tap');
    gate.resolve();
    await p;
  });

  it('Arm during the wait is refused, and an arm dialog answered during it does not arm', async () => {
    const { gate } = slowRig();
    await arm();
    const p = M.motorDisconnect();
    ui.confirmDialog.mockClear();
    await M.motorArm();
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenLastCalledWith('Not connected');
    expect(M.Motor.armed).toBe(false);
    gate.resolve();
    await p;
    expect(M.Motor).toMatchObject({ armed: false, connected: false });
  });

  it('an arm dialog opened before the disconnect and confirmed during the wait does not arm', async () => {
    const { gate } = slowRig();
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const armP = M.motorArm();                 // dialog open (disarmed)
    M.Motor.armed = true;                       // simulate: armed state at disconnect time
    const p = M.motorDisconnect();
    d.resolve(true);
    await armP;
    expect(M.Motor.armed).toBe(false);
    gate.resolve();
    await p;
    expect(M.Motor).toMatchObject({ armed: false, connected: false });
  });

  it('other sends are held during the wait; STOP is not', async () => {
    const { gate } = slowRig();
    await arm();
    const p = M.motorDisconnect();
    await M.motorSendHex('a5 05', { label: 'status' });
    expect(logText()).toContain('disconnecting — "status" not sent');
    gate.resolve();
    await p;
  });

  it('a STOP write that never acknowledges does not hang the panel: the link drops after the wait', async () => {
    vi.useFakeTimers();
    const { dev } = slowRig();                  // gate never resolved
    await arm();
    const p = M.motorDisconnect();
    expect(st().disconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(M.MOTOR_DISCONNECT_STOP_WAIT_MS);
    await p;
    expect(dev.gatt.disconnect).toHaveBeenCalled();
    expect(st()).toMatchObject({ disconnecting: false, connected: false, armed: false });
    expect(logText()).toContain('STOP write not confirmed after 3s — dropping the link anyway');
  });

  it('the link is never dropped while armed (motorDropLink disarms)', async () => {
    rig();
    await arm();
    M.motorDropLink();
    expect(M.Motor).toMatchObject({ armed: false, connected: false });
    expect(logText()).toContain('DISARMED (link dropped)');
  });
});

describe('connect', () => {
  it('reaches requestDevice synchronously from the tap', () => {
    requestDevice.mockReturnValue(new Promise(() => {}));
    M.motorConnect();
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(st().connecting).toBe('choose');
  });

  it('in-flight guard: a double tap does not open a second chooser', () => {
    requestDevice.mockReturnValue(new Promise(() => {}));
    M.motorConnect();
    M.motorConnect();
    M.motorConnect({ all: true });
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(logText()).toContain('already connecting — ignoring the extra tap');
  });

  it('connects, identifies and explores', async () => {
    setProfile();
    const w = fakeChar(WRITE, { write: true, writeWithoutResponse: true });
    const n = fakeChar(NOTIFY, { notify: true });
    const dev = fakeDevice('Minn Kota Controller', [w, n]);
    requestDevice.mockResolvedValue(dev);
    await M.motorConnect();
    expect(M.Motor.connected).toBe(true);
    expect(M.Motor.chars.get(M.motorCharKey(WRITE))).toBe(w);
    expect(M.Motor.chars.get(M.motorCharKey(NOTIFY))).toBe(n);
    expect(n.startNotifications).toHaveBeenCalled();
    expect(st()).toMatchObject({ connected: true, connecting: '', deviceName: 'Minn Kota Controller' });
    expect(logText()).toEqual(expect.arrayContaining([
      'picked: "Minn Kota Controller"', 'connected',
      'THIS LOOKS LIKE THE MOTOR — save its service UUID below and carry on.',
    ]));
  });

  it('notes a non-Minn Kota device as ruled out', async () => {
    const dev = fakeDevice('JBL Flip', []);
    requestDevice.mockResolvedValue(dev);
    await M.motorConnect({ all: true });
    expect(JSON.parse(localStorage.getItem('fishapp.motor.ruledout'))).toEqual({ 'id-JBL Flip': 'JBL Flip' });
    expect(logText().some((l) => l.startsWith('NOT IT: nothing here identifies as Minn Kota. Noted as ruled out (1 so far).'))).toBe(true);
  });

  it('a dismissed chooser explains itself and resets the guard', async () => {
    requestDevice.mockRejectedValue(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }));
    await M.motorConnect();
    expect(ui.toast).toHaveBeenCalledWith('No motor found — hold the PAIR button');
    expect(st().connecting).toBe('');
    expect(logText()).toContain('Next: hold PAIR and retry, or tap "Show all devices" to see what is really advertising.');
  });

  it('refuses where Bluetooth is not available (and in the iOS app)', async () => {
    native.isNativeShell.mockReturnValue(true);
    await M.motorConnect();
    expect(requestDevice).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledWith('Bluetooth not available here');
    expect(M.motorSupported()).toBe(false);
  });

  it('"Show all devices" while connected (disarmed) drops the old link first, still inside the tap', () => {
    const { dev: old } = rig();
    requestDevice.mockReturnValue(new Promise(() => {}));
    M.motorConnect({ all: true });
    expect(old.gatt.disconnect).toHaveBeenCalled();
    expect(M.Motor.connected).toBe(false);
    expect(M.Motor.chars.size).toBe(0);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(requestDevice.mock.calls[0][0].acceptAllDevices).toBe(true);
    // the old device's listener is gone
    const before = M.Motor._logLines.length;
    old.dispatchEvent(new Event('gattserverdisconnected'));
    expect(M.Motor._logLines.length).toBe(before);
  });

  it('"Show all devices" while ARMED: STOP, disarm, disconnect, and ask for another tap', async () => {
    const { ch, dev } = rig();
    await arm();
    await M.motorConnect({ all: true });
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(M.Motor.armed).toBe(false);
    expect(dev.gatt.disconnect).toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledWith('Disconnected — tap Show all devices again');
  });

  it('Disconnect while the GATT connect is in flight cancels it', async () => {
    const dev = fakeDevice('Minn Kota Slow', []);
    const gate = deferred();
    dev.gatt.connect = vi.fn(() => gate.promise.then(() => { dev.gatt.connected = true; return dev.server; }));
    requestDevice.mockResolvedValue(dev);
    const p = M.motorConnect();
    await vi.waitFor(() => expect(st().connecting).toBe('link'));
    await M.motorToggleConnect();
    gate.resolve();
    await p;
    expect(M.Motor.connected).toBe(false);
    expect(st().connecting).toBe('');
    expect(logText()).toEqual(expect.arrayContaining(['connect cancelled by user', 'connect failed: connect cancelled']));
    expect(dev.gatt.connected).toBe(false);
  });
});

describe('a chooser that never answers', () => {
  it('a re-tap after the double-tap window opens a fresh chooser; a late answer from the lost one is ignored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const lost = deferred();
    requestDevice.mockReturnValueOnce(lost.promise).mockReturnValueOnce(new Promise(() => {}));
    M.motorConnect();
    vi.setSystemTime(1_000_000 + M.MOTOR_CHOOSE_RETAP_MS - 1);
    M.motorConnect();                                   // still a double tap
    expect(requestDevice).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + M.MOTOR_CHOOSE_RETAP_MS);
    M.motorToggleConnect();                             // the Connect button again
    expect(requestDevice).toHaveBeenCalledTimes(2);
    expect(logText()).toContain('the device chooser never answered — opening it again');
    expect(st().connecting).toBe('choose');

    lost.resolve(fakeDevice('Minn Kota Late', []));
    await flush();
    expect(M.Motor.device).toBe(null);                  // not adopted
    expect(st().connecting).toBe('choose');             // the newer attempt still owns the state
    expect(logText()).toContain('ignoring "Minn Kota Late" from an earlier chooser — tap Connect again if you want it');
  });

  it('a late failure from a superseded chooser does not toast or reset the newer attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const lost = deferred();
    requestDevice.mockReturnValueOnce(lost.promise.then(() => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); }))
      .mockReturnValueOnce(new Promise(() => {}));
    M.motorConnect();
    vi.setSystemTime(1_000_000 + M.MOTOR_CHOOSE_RETAP_MS + 10);
    M.motorConnect({ all: true });
    lost.resolve();
    await flush();
    expect(ui.toast).not.toHaveBeenCalled();
    expect(st().connecting).toBe('choose');
  });
});

describe('STOP stays reachable', () => {
  it('the STOP command in the Commands grid goes out while DISARMED even if it was saved as danger', async () => {
    const { ch } = rig([{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }, { label: 'STOP', hex: 'a5 00', danger: true }]);
    expect(st().stopIndex).toBe(1);
    await M.motorSendFrame(1);
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalledWith('Arm the link first');
    expect(ch.writes).toEqual([[0xa5, 0x00]]);
    expect(st().log.at(-1)).toMatchObject({ line: '-> STOP  a5 00', cls: 'tx' });
    // other danger commands are still gated
    await M.motorSendFrame(0);
    expect(ui.toast).toHaveBeenCalledWith('Arm the link first');
    expect(ch.writes.length).toBe(1);
  });

  it('the arm dialog says so when there is no STOP command', async () => {
    rig([{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }]);
    ui.confirmDialog.mockResolvedValueOnce(false);
    await M.motorArm();
    expect(ui.confirmDialog.mock.calls[0][0].message).toContain(
      'No command is named STOP, so STOP and auto-stop can only disarm the link — they cannot stop the motor.\n\nArm now?');
  });
});

describe('profiles saved under the old "contains stop" rule', () => {
  const OLD = [{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }, { label: 'Stop motor', hex: 'a5 00', danger: true }];

  it('publishes the command that is no longer sent as STOP', () => {
    setProfile(OLD);
    M.motorUpdateUi();
    expect(st()).toMatchObject({ hasStop: false, stopIndex: -1, legacyStopLabel: 'Stop motor' });
  });

  it('it is still NOT sent as STOP (the exact rule stands)', async () => {
    const { ch } = rig(OLD);
    await arm();
    M.motorStop('stop button');
    expect(ch.writes).toEqual([]);
    expect(M.Motor.armed).toBe(false);
  });

  it('"Use as STOP" saves a copy named STOP after an explicit confirm; Cancel changes nothing', async () => {
    setProfile(OLD);
    ui.confirmDialog.mockResolvedValueOnce(false);
    await M.motorAdoptLegacyStop();
    expect(M.motorProfile().frames).toEqual(OLD);

    ui.confirmDialog.mockResolvedValueOnce(true);
    await M.motorAdoptLegacyStop();
    expect(ui.confirmDialog.mock.calls[1][0]).toMatchObject({ title: 'Use "Stop motor" as STOP?', confirmLabel: 'Use as STOP' });
    expect(M.motorProfile().frames.at(-1)).toEqual({ label: 'STOP', hex: 'a5 00', danger: false });
    expect(st()).toMatchObject({ hasStop: true, stopIndex: 2, legacyStopLabel: null });
    expect(ui.toast).toHaveBeenLastCalledWith('STOP command saved');
  });

  it('re-checks after the confirm: a STOP saved meanwhile wins, nothing is duplicated', async () => {
    setProfile(OLD);
    const d = deferred();
    ui.confirmDialog.mockReturnValueOnce(d.promise);
    const p = M.motorAdoptLegacyStop();
    setProfile([...OLD, { label: 'STOP', hex: 'a5 ff', danger: false }]);
    d.resolve(true);
    await p;
    expect(M.motorProfile().frames.filter((f) => f.label === 'STOP')).toEqual([{ label: 'STOP', hex: 'a5 ff', danger: false }]);
    expect(ui.toast).toHaveBeenLastCalledWith('A command named STOP already exists');
  });
});

describe('telemetry', () => {
  it('re-exploring the same device does not stack notification listeners', async () => {
    const n = fakeChar(NOTIFY, { notify: true });
    M.Motor.server = { getPrimaryServices: async () => [{ uuid: 'svc', getCharacteristics: async () => [n] }] };
    await M.motorExplore();
    await M.motorExplore();
    n.value = new DataView(new Uint8Array([0x01, 0x41]).buffer);
    n.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(M.Motor.frames.length).toBe(1);
    expect(M.Motor.frames[0]).toMatchObject({ uuid: NOTIFY, hex: '01 41', len: 2 });
    expect(st().log.at(-1)).toMatchObject({ line: '<- fff2  01 41   ".A"', cls: 'rx' });
    expect(st().frameCount).toBe(1);
  });
});

describe('profile and commands', () => {
  it('add command: the emphasised answer is the safe one ("Yes, it can")', async () => {
    ui.promptDialog.mockResolvedValueOnce({ label: 'Spot-Lock on', hex: 'a5 01' });
    ui.confirmDialog.mockResolvedValueOnce(true);
    await M.motorAddFrame();
    expect(ui.confirmDialog).toHaveBeenCalledTimes(1);
    const q = ui.confirmDialog.mock.calls[0][0];
    expect(q.title).toBe('Can this command MOVE THE BOAT?');
    expect(q.confirmLabel).toBe('Yes, it can');
    expect(q.cancelLabel).toBe('No, it cannot');
    expect(q.message).toContain('If you are not sure, answer Yes.');
    expect(M.motorProfile().frames).toEqual([{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }]);
    expect(ui.toast).toHaveBeenCalledWith('Command saved');
    expect(st().profile.frames).toEqual([{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }]);
  });

  it('add command: "No, it cannot" (or any dismissal) only leads to a second, red question; dismissing that means it CAN move the boat', async () => {
    ui.promptDialog.mockResolvedValueOnce({ label: 'Spot-Lock on', hex: 'a5 01' });
    ui.confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await M.motorAddFrame();
    expect(ui.confirmDialog).toHaveBeenCalledTimes(2);
    const q2 = ui.confirmDialog.mock.calls[1][0];
    expect(q2).toMatchObject({ title: 'Save "Spot-Lock on" as harmless?', confirmLabel: 'Save as harmless', cancelLabel: 'It can move the boat', destructive: true });
    expect(M.motorProfile().frames).toEqual([{ label: 'Spot-Lock on', hex: 'a5 01', danger: true }]);
  });

  it('add command: only an explicit "Save as harmless" saves it as harmless', async () => {
    ui.promptDialog.mockResolvedValueOnce({ label: 'Battery query', hex: 'a5 10' });
    ui.confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await M.motorAddFrame();
    expect(M.motorProfile().frames.at(-1)).toEqual({ label: 'Battery query', hex: 'a5 10', danger: false });
  });

  it('add command named STOP: no move-the-boat question, an explicit confirm instead; Cancel saves nothing', async () => {
    ui.promptDialog.mockResolvedValueOnce({ label: ' stop ', hex: 'a5 00' });
    ui.confirmDialog.mockResolvedValueOnce(false);
    await M.motorAddFrame();
    expect(ui.confirmDialog.mock.calls[0][0]).toMatchObject({ title: 'Save this as the STOP command?', confirmLabel: 'Save as STOP' });
    expect(M.motorProfile().frames).toEqual([]);

    ui.promptDialog.mockResolvedValueOnce({ label: 'STOP', hex: 'a5 00' });
    ui.confirmDialog.mockResolvedValueOnce(true);
    await M.motorAddFrame();
    expect(ui.confirmDialog).toHaveBeenCalledTimes(2);
    expect(M.motorProfile().frames).toEqual([{ label: 'STOP', hex: 'a5 00', danger: false }]);
    expect(st()).toMatchObject({ hasStop: true, stopIndex: 0, legacyStopLabel: null });
    expect(ui.toast).toHaveBeenLastCalledWith('STOP command saved');

    // a second STOP would never be the STOP: refused, not saved as a decoy
    ui.promptDialog.mockResolvedValueOnce({ label: 'Stop', hex: 'a5 99' });
    await M.motorAddFrame();
    expect(ui.toast).toHaveBeenLastCalledWith('A command named STOP already exists');
    expect(M.motorProfile().frames.length).toBe(1);
  });

  it('add command: cancel / empty / bad hex saves nothing', async () => {
    ui.promptDialog.mockResolvedValueOnce(null);
    await M.motorAddFrame();
    ui.promptDialog.mockResolvedValueOnce({ label: 'X', hex: 'a5 1' });
    await M.motorAddFrame();
    expect(ui.toast).toHaveBeenLastCalledWith('That is not valid hex');
    ui.promptDialog.mockResolvedValueOnce({ label: '', hex: 'a5' });
    await M.motorAddFrame();
    expect(ui.toast).toHaveBeenLastCalledWith('Name the command first');
    expect(ui.confirmDialog).not.toHaveBeenCalled();
    expect(M.motorProfile().frames).toEqual([]);
  });

  it('saving the profile trims and lowercases the UUIDs', () => {
    M.motorSaveUuids({ service: ' 0000FFF0-0000-1000-8000-00805F9B34FB ', write: 'FFF1 ', notify: '' });
    expect(M.motorProfile()).toMatchObject({ service: '0000fff0-0000-1000-8000-00805f9b34fb', write: 'fff1', notify: '' });
    expect(st().profile.write).toBe('fff1');
    expect(ui.toast).toHaveBeenCalledWith('Profile saved — reconnect to pick it up');
    expect(logText().at(-1)).toBe('profile saved: service=0000fff0-0000-1000-8000-00805f9b34fb');
  });

  it('the store reports whether a STOP command exists', () => {
    setProfile();
    M.motorUpdateUi();
    expect(st().hasStop).toBe(true);
  });
});

describe('recon', () => {
  it('record / mark / export / copy', async () => {
    M.motorRecordToggle();
    expect(st().recording).toBe(true);
    expect(logText().at(-1)).toBe('=== recording started ===');
    M.motorOnNotify(NOTIFY, new DataView(new Uint8Array([7]).buffer));
    ui.promptDialog.mockResolvedValueOnce({ what: 'pressed Spot-Lock' });
    await M.motorMarkEvent();
    expect(M.Motor.frames.at(-1)).toMatchObject({ mark: 'pressed Spot-Lock' });
    expect(logText().at(-1)).toBe('MARK  pressed Spot-Lock');
    ui.promptDialog.mockResolvedValueOnce(null);
    await M.motorMarkEvent();
    expect(M.Motor.frames.length).toBe(2);
    M.motorRecordToggle();
    expect(logText().at(-1)).toBe('=== recording stopped (2 frames) ===');

    await M.motorExportSession();
    const arg = native.saveOrShareFile.mock.calls[0][0];
    expect(arg.name).toMatch(/^motor-session-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.json$/);
    expect(arg.mime).toBe('application/json');
    expect(JSON.parse(arg.data).frames.length).toBe(2);

    await M.motorCopyLog();
    expect(native.copyText).toHaveBeenCalledWith(M.motorLogText());
    expect(ui.toast).toHaveBeenLastCalledWith('Log copied');
  });

  it('copy with an empty log says so', async () => {
    await M.motorCopyLog();
    expect(ui.toast).toHaveBeenCalledWith('Nothing logged yet');
    expect(native.copyText).not.toHaveBeenCalled();
  });

  it('opening the panel twice in a row (StrictMode) prints the browser check once and never arms', () => {
    rig();
    M.motorOnOpen();
    M.motorOnOpen();
    expect(logText().filter((l) => l === '=== browser check ===').length).toBe(1);
    expect(M.Motor.armed).toBe(false);
  });
});
