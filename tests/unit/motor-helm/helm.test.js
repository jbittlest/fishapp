/* helm.js — pure frame-template / checksum / simulator / ILOS library (no callers, no UI).
 * Characterisation tests: expected values come from the legacy implementation (and match the
 * published CRC check values for "123456789"). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

const sendMock = vi.hoisted(() => ({ fn: null }));

vi.mock('../../../src/engine/app.js', () => ({ APP_BUILD: 'test', readJSON: (_k, f) => f }));
vi.mock('../../../src/services/ui', () => ({ toast: vi.fn(), confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock('../../../src/services/native', () => ({ copyText: vi.fn(), haptic: vi.fn(), isNativeShell: () => false, saveOrShareFile: vi.fn() }));
/* gps.js pulls in the whole map stack; bearingBetween is copied verbatim from it. */
vi.mock('../../../src/engine/gps.js', () => ({
  bearingBetween(a, b) {
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dl = (b.lng - a.lng) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },
}));
vi.mock('../../../src/engine/motor.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, motorSendHex: (...a) => sendMock.fn(...a) };
});

import * as H from '../../../src/engine/helm.js';

const ascii = (s) => Array.from(s).map((c) => c.charCodeAt(0));
const CHECK = ascii('123456789');

describe('HELM_CHECKSUMS', () => {
  it('match the standard check values for "123456789"', () => {
    expect(H.HELM_CHECKSUMS.sum8.fn(CHECK)).toBe(0xdd);
    expect(H.HELM_CHECKSUMS.sum8neg.fn(CHECK)).toBe(0x23);
    expect(H.HELM_CHECKSUMS.xor8.fn(CHECK)).toBe(0x31);
    expect(H.HELM_CHECKSUMS.crc8.fn(CHECK)).toBe(0xf4);
    expect(H.HELM_CHECKSUMS.crc8maxim.fn(CHECK)).toBe(0xa1);
    expect(H.HELM_CHECKSUMS.crc16modbus.fn(CHECK)).toBe(0x4b37);
    expect(H.HELM_CHECKSUMS.crc16ccitt.fn(CHECK)).toBe(0x29b1);
  });
  it('sum8neg makes the frame sum to zero mod 256', () => {
    const b = [0xa5, 0x01, 0x03];
    const total = b.reduce((a, x) => a + x, 0) + H.HELM_CHECKSUMS.sum8neg.fn(b);
    expect(total & 0xff).toBe(0);
  });
  it('widths', () => {
    expect(H.HELM_CHECKSUMS.sum8.width).toBe(1);
    expect(H.HELM_CHECKSUMS.crc16modbus.width).toBe(2);
    expect(H.HELM_CHECKSUMS.crc16ccitt.width).toBe(2);
  });
  it('endian helpers', () => {
    expect(H.HELM_ENDIAN.le(0xcdc5, 2)).toEqual([0xc5, 0xcd]);
    expect(H.HELM_ENDIAN.be(0xcdc5, 2)).toEqual([0xcd, 0xc5]);
    expect(H.HELM_ENDIAN.le(0x1ff, 1)).toEqual([0xff]);
  });
});

describe('HELM_FIELDS encoders', () => {
  it('encode the documented types', () => {
    expect(H.HELM_FIELDS.u8.enc(3)).toEqual([3]);
    expect(H.HELM_FIELDS.u8.enc(260)).toEqual([4]);          // no range check (known risk)
    expect(H.HELM_FIELDS.s8.enc(-1)).toEqual([0xff]);
    expect(H.HELM_FIELDS.s8.enc(5)).toEqual([5]);
    expect(H.HELM_FIELDS.u16le.enc(0x1234)).toEqual([0x34, 0x12]);
    expect(H.HELM_FIELDS.u16be.enc(0x1234)).toEqual([0x12, 0x34]);
  });
  it('headings wrap before encoding', () => {
    expect(H.HELM_FIELDS.deg.enc(361)).toEqual([1, 0]);
    expect(H.HELM_FIELDS.deg.enc(-1)).toEqual([0x67, 0x01]);  // 359
    expect(H.HELM_FIELDS.deg10.enc(12.3)).toEqual([123, 0]);
    expect(H.HELM_FIELDS.deg10.enc(360.5)).toEqual([5, 0]);
  });
});

describe('helmParseTemplate', () => {
  it('parses literals, fields and checksums', () => {
    expect(H.helmParseTemplate('a5 01 {speed:u8} 00 {sum8}')).toEqual([
      { kind: 'lit', byte: 0xa5 },
      { kind: 'lit', byte: 0x01 },
      { kind: 'field', name: 'speed', type: 'u8' },
      { kind: 'lit', byte: 0x00 },
      { kind: 'sum', algo: 'sum8', from: null, to: null, endian: 'le' },
    ]);
    expect(H.helmParseTemplate('{crc16modbus:1..6}')).toEqual([
      { kind: 'sum', algo: 'crc16modbus', from: 1, to: 6, endian: 'le' },
    ]);
    expect(H.helmParseTemplate('')).toEqual([]);
  });
  it('rejects anything malformed', () => {
    expect(() => H.helmParseTemplate('a5 zz')).toThrow('not a hex byte or field: "zz"');
    expect(() => H.helmParseTemplate('a5 {speed}')).toThrow('parameter needs a type');
    expect(() => H.helmParseTemplate('{speed:u9}')).toThrow('unknown field type "u9"');
    expect(() => H.helmParseTemplate('{sum8:1-3}')).toThrow('bad checksum range');
    expect(() => H.helmParseTemplate('a5 1')).toThrow('not a hex byte');
  });
});

describe('helmRender / helmToHex', () => {
  it('renders fields and a trailing sum8', () => {
    expect(H.helmToHex(H.helmRender('a5 01 {speed:u8} 00 {sum8}', { speed: 3 }))).toBe('a5 01 03 00 a9');
  });
  it('reproduces the classic Modbus frame 01 03 00 00 00 0a c5 cd', () => {
    expect(H.helmToHex(H.helmRender('01 03 00 00 00 0a {crc16modbus}', {}))).toBe('01 03 00 00 00 0a c5 cd');
  });
  it('honours an explicit checksum range', () => {
    // sum over bytes 1..3 only (01 + 03 = 04)
    expect(H.helmToHex(H.helmRender('a5 01 03 {sum8:1..3}', {}))).toBe('a5 01 03 04');
  });
  it('a missing parameter throws instead of defaulting to zero', () => {
    expect(() => H.helmRender('a5 {speed:u8}', {})).toThrow('missing parameter "speed"');
    expect(() => H.helmRender('a5 {speed:u8}', { speed: NaN })).toThrow('missing parameter "speed"');
    expect(() => H.helmRender('a5 {speed:u8}', { speed: null })).toThrow('missing parameter "speed"');
  });
  it('accepts pre-parsed tokens and returns a Uint8Array', () => {
    const out = H.helmRender(H.helmParseTemplate('a5 {speed:u8}'), { speed: 7 });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([0xa5, 7]);
    expect(H.helmToHex([1, 0xab])).toBe('01 ab');
  });
});

describe('helmInferFields', () => {
  it('finds the moving bytes', () => {
    const r = H.helmInferFields(['a5 01 01 00 a7', 'a5 01 02 00 a8', 'a5 01 03 00 a9']);
    expect(r).toEqual({
      sameLength: true, length: 5, constant: [0, 1, 3], varying: [2, 4],
      values: [{ index: 2, values: [1, 2, 3] }, { index: 4, values: [0xa7, 0xa8, 0xa9] }],
    });
  });
  it('refuses mixed lengths and single frames', () => {
    expect(H.helmInferFields(['a5 01', 'a5 01 02']).sameLength).toBe(false);
    expect(() => H.helmInferFields(['a5 01'])).toThrow('need at least 2 frames');
  });
});

describe('helmSolveChecksum', () => {
  it('identifies sum8 over the whole body from three captures', () => {
    const r = H.helmSolveChecksum(['a5 01 01 00 a7', 'a5 01 02 00 a8', 'a5 01 03 00 a9']);
    expect(r.matches).toEqual([{ algo: 'sum8', from: 0, to: 4, endian: 'le', width: 1, template: '{sum8:0..4}' }]);
    expect(r.confident).toBe(true);
    expect(r.note).toBe('Single algorithm explains every frame.');
  });
  it('identifies crc16modbus', () => {
    const r = H.helmSolveChecksum(['01 03 00 00 00 0a c5 cd', '01 03 00 01 00 0a 94 0d', '01 03 00 02 00 0a 64 0d']);
    expect(r.matches.map((m) => m.template)).toEqual(['{crc16modbus:0..6}']);
    expect(r.confident).toBe(true);
  });
  it('is not confident on two frames', () => {
    const r = H.helmSolveChecksum(['a5 01 01 00 a7', 'a5 01 02 00 a8']);
    expect(r.confident).toBe(false);
  });
  it('says so when nothing fits (identical bodies, different trailers = a counter, not a checksum)', () => {
    const r = H.helmSolveChecksum(['a5 01 01 00 10', 'a5 01 01 00 11', 'a5 01 01 00 12']);
    expect(r.matches).toEqual([]);
    expect(r.confident).toBe(false);
    expect(r.note).toBe('No checksum found. The trailing bytes may be a sequence counter, a rolling value, or there may be no checksum at all.');
  });
  it('says so when more than one algorithm fits', () => {
    const r = H.helmSolveChecksum(['a5 01 01 00 a7', 'a5 01 02 00 a8']);
    expect(r.note).toBe(r.matches.length > 1
      ? 'More than one algorithm fits — capture another frame to disambiguate.'
      : 'Single match, but only 2 frames. Capture a third to be sure.');
  });
  it('validates its input', () => {
    expect(() => H.helmSolveChecksum(['a5 01'])).toThrow('need at least 2 frames');
    expect(() => H.helmSolveChecksum(['a5 01', 'a5 01 02'])).toThrow('frames must be the same length');
  });
});

describe('HelmSim', () => {
  const bindings = {
    stop: 'a5 00 {sum8}',
    speed_set: 'a5 02 {speed:u8} {sum8}',
    heading_set: 'a5 07 {heading:deg} {crc16modbus}',
  };
  it('decodes parameterless and single-parameter frames and keeps state', () => {
    const sim = new H.HelmSim(bindings);
    expect(sim.write(H.helmRender(bindings.speed_set, { speed: 3 }))).toEqual({ action: 'speed_set', value: 3 });
    expect(sim.state).toMatchObject({ prop: true, speed: 3 });
    expect(sim.write(H.helmRender(bindings.heading_set, { heading: 271 }))).toEqual({ action: 'heading_set', value: 271 });
    expect(sim.state.heading).toBe(271);
    expect(sim.write(H.helmRender(bindings.stop, {}))).toEqual({ action: 'stop' });
    expect(sim.state).toMatchObject({ prop: false, speed: 0, spotlock: false });
    expect(sim.received.length).toBe(3);
  });
  it('reports frames that match nothing', () => {
    const sim = new H.HelmSim(bindings);
    expect(sim.write(new Uint8Array([1, 2, 3]))).toEqual({ action: null, note: 'frame did not match any bound template' });
  });
});

describe('transmit discipline', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    Object.assign(H.HELM_BUCKET, { cap: 8, refillPerSec: 5, tokens: 8, ts: 0 });
    Object.assign(H.HelmTx, { busy: false, pending: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('token bucket: 8 burst, then 5 per second', () => {
    for (let i = 0; i < 8; i++) expect(H.helmBudgetTake()).toBe(true);
    expect(H.helmBudgetTake()).toBe(false);
    now += 200;                                   // one token back
    expect(H.helmBudgetTake()).toBe(true);
    expect(H.helmBudgetTake()).toBe(false);
  });

  it('force (STOP) bypasses the budget and the queue', async () => {
    sendMock.fn = vi.fn(async () => 'sent');
    H.HELM_BUCKET.tokens = 0; H.HELM_BUCKET.ts = now;
    H.HelmTx.busy = true;
    expect(await H.helmTxSend('a5 00', { force: true })).toBe('sent');
    expect(sendMock.fn).toHaveBeenCalledWith('a5 00', { force: true });
  });

  it('setpoints are last-value-wins; one-shots are dropped while busy', async () => {
    let release;
    sendMock.fn = vi.fn(() => new Promise((r) => { release = r; }));
    const first = H.helmTxSend('01', {}, 'hdg');
    expect(H.HelmTx.busy).toBe(true);
    expect(await H.helmTxSend('02', {}, 'hdg')).toBe(false);
    expect(await H.helmTxSend('03', {}, 'hdg')).toBe(false);       // replaces 02
    expect(await H.helmTxSend('ff', {})).toBe(false);              // one-shot: dropped
    sendMock.fn.mockImplementation(async () => true);
    release(true);
    await first;
    await Promise.resolve();
    expect(sendMock.fn.mock.calls.map((c) => c[0])).toEqual(['01', '03']);
  });

  it('refuses when the budget is empty', async () => {
    sendMock.fn = vi.fn(async () => true);
    H.HELM_BUCKET.tokens = 0; H.HELM_BUCKET.ts = now;
    expect(await H.helmTxSend('01', {})).toBe(false);
    expect(sendMock.fn).not.toHaveBeenCalled();
  });
});

describe('ILOS autopilot step', () => {
  beforeEach(() => {
    Object.assign(H.AP, { on: false, route: [L.latLng(0, 0.01)], i: 0, startLL: L.latLng(0, 0), yInt: 0, lastTick: 0, humanDeadline: 0, commandedHdg: null, note: '' });
  });

  it('apAngleDiff is the shortest signed angle', () => {
    expect(H.apAngleDiff(350, 10)).toBe(20);
    expect(H.apAngleDiff(10, 350)).toBe(-20);
    expect(H.apAngleDiff(0, 180)).toBe(-180);
    expect(H.apAngleDiff(90, 90)).toBe(0);
  });

  it('cross-track is positive to starboard of the track', () => {
    const a = L.latLng(0, 0), b = L.latLng(0, 0.01);
    expect(H.apCrossTrack(a, b, L.latLng(-0.0001, 0.005))).toBeCloseTo(11.1195, 3);
    expect(H.apCrossTrack(a, b, L.latLng(0.0001, 0.005))).toBeCloseTo(-11.1195, 3);
  });

  it('first tick is unslewed and reports deadbanded (legacy quirk)', () => {
    const r = H.apCompute(L.latLng(0.0001, 0.005), 500, false, 1);
    expect(r.trackBrg).toBeCloseTo(90, 6);
    expect(r.xte).toBeCloseTo(-11.1195, 3);
    expect(r.authoritative).toBe(true);
    expect(r.want).toBeCloseTo(116.8802, 3);
    expect(r.commanded).toBeCloseTo(116.8802, 3);
    expect(r.deadbanded).toBe(true);
    expect(H.AP.yInt).toBeCloseTo(-0.40259, 4);
    expect(H.AP.commandedHdg).toBe(null);           // apCompute never writes it (known)
  });

  it('slews the commanded heading at most 12 degrees per tick', () => {
    H.apCompute(L.latLng(0.0001, 0.005), 500, false, 1);
    H.AP.commandedHdg = 0;
    const r = H.apCompute(L.latLng(0.0001, 0.005), 500, false, 1);
    expect(r.commanded).toBe(12);
    expect(r.deadbanded).toBe(false);
    expect(H.AP.yInt).toBeCloseTo(-0.80470, 4);
  });

  it('freezes (not zeroes) the integrator on a stale or coarse fix', () => {
    H.apCompute(L.latLng(0.0001, 0.005), 500, false, 1);
    const y0 = H.AP.yInt;
    const r = H.apCompute(L.latLng(0.0001, 0.005), 5000, false, 1);
    expect(r.authoritative).toBe(false);
    expect(H.AP.yInt).toBe(y0);
    expect(H.AP.note).toBe('fix stale — holding');
    H.apCompute(L.latLng(0.0001, 0.005), 500, true, 1);
    expect(H.AP.yInt).toBe(y0);
    expect(H.AP.note).toBe('GPS coarse — holding');
  });

  it('constants are unchanged', () => {
    expect([H.AP_TICK_MS, H.AP_DELTA_M, H.AP_SIGMA, H.AP_HDG_DEADBAND, H.AP_HDG_SLEW, H.AP_FIX_HOLD_MS, H.AP_FIX_SAFE_MS])
      .toEqual([1000, 22, 0.08, 2, 12, 3000, 12000]);
    expect(H.Helm.limits).toEqual({ maxSpeed: 4, maxHoldMs: 2500 });
  });
});
