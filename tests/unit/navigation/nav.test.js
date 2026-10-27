// @vitest-environment jsdom
/* Characterisation tests for engine/nav.js: the anchor-watch state machine (with the three
 * fixed bugs), trip accumulation filters, planner maths and persisted cruise speed. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ui', () => ({
  toast: vi.fn(), closePanels: vi.fn(), openCard: vi.fn(), closeCard: vi.fn(), updateCard: vi.fn(), setDetent: vi.fn(),
  isPanelOpen: vi.fn(() => false), confirmDialog: vi.fn(async () => true),
  uiStore: { getState: () => ({ card: null }) },
}));
vi.mock('../../../src/services/native', () => ({
  backgroundLocation: vi.fn(), haptic: vi.fn(), isNativeShell: vi.fn(() => false),
  nativeAnchorWatch: vi.fn(), nativeAnchorSilence: vi.fn(),
  saveOrShareFile: vi.fn(async () => 'downloaded'),
}));
vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null, applyPendingUpdate: vi.fn() }));
vi.mock('../../../src/engine/spots.js', () => ({ escapeHtml: (s) => String(s), refreshSpotDistances: () => {} }));
vi.mock('../../../src/engine/weather.js', () => ({
  compass: (deg) => (deg == null || !isFinite(deg)) ? '—' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8],
}));
vi.mock('../../../src/engine/db.js', () => ({
  idb: { put: vi.fn(async () => 1), getAll: vi.fn(async () => []), del: vi.fn(async () => undefined) },
}));

import {
  Nav, navStore, fmtDur, anchorStatusText, anchorDrop, anchorRaise, anchorDismissAlarm, anchorRadiusChanged,
  anchorRestore, navAnchorEvaluate, navOnGpsStale, navOnFix, tripToggle, tripReset, tripDurationMs,
  routeSummarize, routeAddPoint, routeStart, routeUndo, getRouteSpeedKn, setRouteSpeedKn, getRouteGph, setRouteGph,
  navSetMode, navHandleClick, measureClick, FT_PER_M, ANCHOR_SNOOZE_MS, anchorPrimePending, anchorAudioReady,
  ANCHOR_SCREEN_COPY, anchorScreenCopy,
} from '../../../src/engine/nav.js';
import { GPS } from '../../../src/engine/gps.js';
import { Goto } from '../../../src/engine/goto.js';
import { Awake } from '../../../src/engine/awake.js';
import { toast, closePanels, confirmDialog } from '../../../src/services/ui';
import { backgroundLocation, haptic, isNativeShell, nativeAnchorSilence, nativeAnchorWatch } from '../../../src/services/native';
import { BASE, llAt, mediaPlayRejects, resetAll, setFix } from './helpers.js';

const distFt = (a, b) => Math.round(a.distanceTo(b) * FT_PER_M);

beforeEach(() => { resetAll(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('fmtDur', () => {
  it('formats minutes and hours like the legacy banner', () => {
    expect(fmtDur(0)).toBe('0m');
    expect(fmtDur(59)).toBe('0m');
    expect(fmtDur(60)).toBe('1m');
    expect(fmtDur(3599)).toBe('59m');
    expect(fmtDur(3600)).toBe('1h 0m');
    expect(fmtDur(3725)).toBe('1h 2m');
    expect(fmtDur(26 * 3600 + 5 * 60)).toBe('26h 5m');
  });
});

describe('anchorStatusText', () => {
  const now = 1_000_000;
  it('is empty when not watching', () => {
    expect(anchorStatusText({ watching: false, blind: false, radiusFt: 150, snoozeUntil: 0 }, now)).toBe('');
  });
  it('keeps the legacy copy (emoji removed)', () => {
    expect(anchorStatusText({ watching: true, blind: true, radiusFt: 150, snoozeUntil: 0 }, now)).toBe('NO GPS — the watch cannot see you drift');
    expect(anchorStatusText({ watching: true, blind: false, radiusFt: 150, snoozeUntil: 0 }, now)).toBe('Watching — alarms if you drift past 150 ft');
  });
  it('rounds the snooze up to whole minutes', () => {
    expect(anchorStatusText({ watching: true, blind: false, radiusFt: 90, snoozeUntil: now + 4.2 * 60000 }, now))
      .toBe('Watching — alarms if you drift past 90 ft · snoozed 5 min');
  });
});

describe('anchor drop refusals', () => {
  it('refuses with no fix', () => {
    anchorDrop();
    expect(Nav.anchor.watching).toBe(false);
    expect(toast).toHaveBeenCalledWith('No GPS fix yet — wait for a fix, then drop');
  });
  it('refuses a stale fix', () => {
    setFix(BASE);
    GPS.lastFixTs = Date.now() - 61000;
    anchorDrop();
    expect(Nav.anchor.watching).toBe(false);
    expect(toast).toHaveBeenCalledWith('GPS is stale — wait for a fresh fix before dropping the anchor watch');
  });
  it('refuses a coarse fix', () => {
    setFix(BASE, 150);
    anchorDrop();
    expect(Nav.anchor.watching).toBe(false);
    expect(toast).toHaveBeenCalledWith('GPS is only ±150m right now — wait for a tighter fix');
  });
});

describe('anchor watch', () => {
  function drop(radius = '150') {
    setFix(BASE);
    Nav.anchor.field = radius;
    anchorDrop();
  }

  it('drops at the GPS position, persists, takes the keep-alive and background GPS', () => {
    drop();
    expect(Nav.anchor.watching).toBe(true);
    expect(Nav.anchor.radiusFt).toBe(150);
    expect(Awake.reasons.has('anchor')).toBe(true);
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    const saved = JSON.parse(localStorage.getItem('fishapp.anchor'));
    expect(saved).toMatchObject({ lat: BASE.lat, lng: BASE.lng, radiusFt: 150 });
    expect(navStore.getState().anchorButton).toBe('Raise anchor / stop watch');
    expect(toast).toHaveBeenLastCalledWith('Anchor watch on (150 ft) — keep the app open, screen on');
  });

  it('reads the radius field and falls back to 150 for junk', () => {
    drop('abc');
    expect(Nav.anchor.radiusFt).toBe(150);
    drop('220');
    expect(Nav.anchor.radiusFt).toBe(220);
  });

  it('needs two consecutive out-of-circle fixes, then alarms (and haptics)', () => {
    drop();
    const out = llAt(BASE, 60);              // ~197 ft > 150 + 16 ft slop
    setFix(out);
    navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(false);
    navAnchorEvaluate(out);
    expect(Nav.anchor.dragging).toBe(true);
    expect(navStore.getState().alarmVisible).toBe(true);
    expect(navStore.getState().alarmText).toBe(distFt(out, BASE) + ' ft from anchor (limit 150 ft)');
    expect(navStore.getState().alarmDistFt).toBe(distFt(out, BASE));
    expect(haptic).toHaveBeenCalled();
    anchorRaise();
  });

  it('one bad fix followed by a good one never sounds', () => {
    drop();
    navAnchorEvaluate(llAt(BASE, 60));
    navAnchorEvaluate(llAt(BASE, 10));
    navAnchorEvaluate(llAt(BASE, 60));
    expect(navStore.getState().alarmVisible).toBe(false);
  });

  it('widens the limit by the fix accuracy, capped at the radius', () => {
    drop();
    GPS.accuracy = 30;                        // +98 ft → limit 248 ft
    const p = llAt(BASE, 60);                 // ~197 ft
    navAnchorEvaluate(p); navAnchorEvaluate(p); navAnchorEvaluate(p);
    expect(navStore.getState().alarmVisible).toBe(false);
    GPS.accuracy = 500;                       // slop capped at 150 → limit 300 ft
    const q = llAt(BASE, 95);                 // ~312 ft
    navAnchorEvaluate(q); navAnchorEvaluate(q);
    expect(navStore.getState().alarmVisible).toBe(true);
    anchorRaise();
  });

  it('stops by itself back inside the circle', () => {
    drop();
    const out = llAt(BASE, 60);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(true);
    navAnchorEvaluate(llAt(BASE, 5));
    expect(navStore.getState().alarmVisible).toBe(false);
    expect(Nav.anchor.dragging).toBe(false);
  });

  it('Silence is a 5-minute snooze, re-armed early when the drift grows 25%', () => {
    drop();
    const out = llAt(BASE, 60);
    setFix(out);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    anchorDismissAlarm();
    expect(navStore.getState().alarmVisible).toBe(false);
    expect(Nav.anchor.snoozeFt).toBe(distFt(out, BASE));
    expect(Nav.anchor.snoozeUntil).toBeGreaterThan(Date.now() + ANCHOR_SNOOZE_MS - 1000);
    navAnchorEvaluate(out); navAnchorEvaluate(out); navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(false);          // still snoozed
    const further = llAt(BASE, 60 * 1.3);
    navAnchorEvaluate(further);
    expect(navStore.getState().alarmVisible).toBe(true);           // outCount already ≥ 2, drift grew
    anchorRaise();
  });

  it('the snooze expires on time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    drop();
    const out = llAt(BASE, 60);
    setFix(out);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    anchorDismissAlarm();
    navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(false);
    vi.setSystemTime(Date.now() + ANCHOR_SNOOZE_MS + 1000);
    navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(true);
    anchorRaise();
  });

  it('goes blind on stale GPS with the NO GPS copy and an alarm', () => {
    drop();
    navOnGpsStale();
    expect(Nav.anchor.blind).toBe(true);
    expect(navStore.getState().alarmVisible).toBe(true);
    expect(navStore.getState().alarmText).toBe('NO GPS — the anchor watch cannot see you drift');
    expect(navStore.getState().anchorStatus).toBe('NO GPS — the watch cannot see you drift');
    expect(toast).toHaveBeenCalledWith('Anchor watch blind — no GPS fix for a minute');
    anchorRaise();
  });

  it('FIX: a drag alarm that went blind restarts when GPS returns still outside', () => {
    drop();
    const out = llAt(BASE, 60);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    expect(Nav.anchor.dragging).toBe(true);
    navOnGpsStale();                                  // blind while dragging
    expect(Nav.anchor.blind).toBe(true);
    navAnchorEvaluate(out);                           // a fix again — still outside the circle
    expect(Nav.anchor.blind).toBe(false);
    expect(Nav.anchor.dragging).toBe(true);
    expect(navStore.getState().alarmVisible).toBe(true);
    expect(navStore.getState().alarmText).toContain('ft from anchor');
    anchorRaise();
  });

  it('FIX: silencing a blind alarm is a snooze, not forever', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T03:00:00Z'));
    drop();
    navOnGpsStale();
    anchorDismissAlarm();
    expect(navStore.getState().alarmVisible).toBe(false);
    navOnGpsStale();                                  // watchdog tick inside the snooze
    expect(navStore.getState().alarmVisible).toBe(false);
    vi.setSystemTime(Date.now() + ANCHOR_SNOOZE_MS + 1000);
    navOnGpsStale();                                  // watchdog tick after it
    expect(navStore.getState().alarmVisible).toBe(true);
    expect(Nav.anchor.blind).toBe(true);
    anchorRaise();
  });

  it('a radius change mid-watch applies live and re-evaluates', () => {
    drop();
    const out = llAt(BASE, 60);
    setFix(out);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    expect(navStore.getState().alarmVisible).toBe(true);
    anchorRadiusChanged('300');
    expect(Nav.anchor.radiusFt).toBe(300);
    expect(navStore.getState().alarmVisible).toBe(false);
    expect(JSON.parse(localStorage.getItem('fishapp.anchor')).radiusFt).toBe(300);
  });

  it('FIX: a radius change while blind does not clear blind on a stale position', () => {
    drop();
    setFix(BASE);
    navOnGpsStale();
    anchorRadiusChanged('200');
    expect(Nav.anchor.radiusFt).toBe(200);
    expect(Nav.anchor.blind).toBe(true);
    expect(navStore.getState().alarmVisible).toBe(true);
    anchorRaise();
  });

  it('a radius change with no watch only updates the field', () => {
    anchorRadiusChanged('80');
    expect(Nav.anchor.watching).toBe(false);
    expect(navStore.getState().anchorField).toBe('80');
    setFix(BASE);
    anchorDrop();
    expect(Nav.anchor.radiusFt).toBe(80);
  });

  it('raise clears everything and releases the keep-alive / background GPS', () => {
    drop();
    anchorRaise();
    expect(Nav.anchor.watching).toBe(false);
    expect(localStorage.getItem('fishapp.anchor')).toBeNull();
    expect(Awake.reasons.has('anchor')).toBe(false);
    expect(backgroundLocation).toHaveBeenLastCalledWith(false);
  });

  it('navOnFix evaluates the anchor before anything else, even if Go-To throws', () => {
    drop();
    const out = llAt(BASE, 60);
    Goto.active = true; Goto.dest = null;              // gotoOnFix would throw on a null dest
    expect(() => navOnFix(out, 0)).toThrow();
    expect(() => navOnFix(out, 0)).toThrow();
    expect(navStore.getState().alarmVisible).toBe(true);
    Goto.active = false;
    anchorRaise();
  });
});

/* A minimal Web Audio stand-in: resume() only starts the context when `gesture.ok` is true —
 * the way iOS WebKit refuses to start audio outside real user activation. */
function installFakeAudio(gesture) {
  class FakeAudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    resume() { if (gesture.ok) this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { value: 0 } }; }
    createGain() { return { connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  }
  window.AudioContext = FakeAudioContext;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('anchorRestore', () => {
  afterEach(() => { delete window.AudioContext; });
  const saveWatch = (ageMs = 3600e3) =>
    localStorage.setItem('fishapp.anchor', JSON.stringify({ lat: BASE.lat, lng: BASE.lng, radiusFt: 120, ts: Date.now() - ageMs }));

  it('restores a watch younger than 36 h and FIX: re-acquires the keep-alive / background GPS', () => {
    saveWatch();
    anchorRestore();
    expect(Nav.anchor.watching).toBe(true);
    expect(Nav.anchor.radiusFt).toBe(120);
    expect(navStore.getState().anchorField).toBe('120');
    expect(Awake.reasons.has('anchor')).toBe(true);
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    expect(toast).toHaveBeenLastCalledWith('Anchor watch restored — tap anywhere once to re-enable the alarm sound');
    expect(anchorPrimePending()).toBe(true);
    anchorRaise();
    expect(anchorPrimePending()).toBe(false);          // raising stops listening for the gesture
  });

  it('FIX: pointerdown / touchstart are not user activation on iOS — they do not "arm" anything', async () => {
    const gesture = { ok: true };
    installFakeAudio(gesture);
    saveWatch();
    anchorRestore();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('touchstart'));
    await flush();
    expect(toast).not.toHaveBeenCalledWith('Anchor watch alarm armed');
    expect(anchorPrimePending()).toBe(true);
    anchorRaise();
  });

  it('FIX: says "armed" only once the audio really runs, and keeps retrying on later taps until then', async () => {
    const gesture = { ok: false };
    installFakeAudio(gesture);
    saveWatch();
    anchorRestore();
    document.dispatchEvent(new Event('touchend'));     // WebKit refused this one
    await flush();
    expect(toast).not.toHaveBeenCalledWith('Anchor watch alarm armed');
    expect(anchorPrimePending()).toBe(true);           // still listening
    expect(anchorAudioReady()).toBe(false);
    gesture.ok = true;
    document.dispatchEvent(new Event('click'));
    await flush();
    expect(Nav.anchor.audio.state).toBe('running');
    expect(anchorAudioReady()).toBe(true);
    expect(toast).toHaveBeenLastCalledWith('Anchor watch alarm armed');
    expect(anchorPrimePending()).toBe(false);
    expect(toast.mock.calls.filter((c) => c[0] === 'Anchor watch alarm armed')).toHaveLength(1);
    document.dispatchEvent(new Event('click'));        // no second "armed"
    await flush();
    expect(toast.mock.calls.filter((c) => c[0] === 'Anchor watch alarm armed')).toHaveLength(1);
    anchorRaise();
  });

  it('FIX: waits for the background keep-alive to actually play, too', async () => {
    installFakeAudio({ ok: true });
    mediaPlayRejects(true);
    saveWatch();
    anchorRestore();                                   // no gesture: the keep-alive is refused
    await flush();
    expect(Awake.audio).toBeNull();
    document.dispatchEvent(new Event('keydown'));      // still refused
    await flush();
    expect(toast).not.toHaveBeenCalledWith('Anchor watch alarm armed');
    mediaPlayRejects(false);
    document.dispatchEvent(new Event('pointerup'));
    await flush();
    expect(Awake.audio).not.toBeNull();
    expect(Awake.audio.paused).toBe(false);
    expect(toast).toHaveBeenLastCalledWith('Anchor watch alarm armed');
    anchorRaise();
  });

  it('drops a watch older than 36 h', () => {
    saveWatch(37 * 3600e3);
    anchorRestore();
    expect(Nav.anchor.watching).toBe(false);
    expect(localStorage.getItem('fishapp.anchor')).toBeNull();
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: false });   // and disarms a native leftover
  });
  it('ignores junk', () => {
    localStorage.setItem('fishapp.anchor', '{"lat":"x"}');
    anchorRestore();
    expect(Nav.anchor.watching).toBe(false);
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: false });
  });
});

describe('FIX: the iPhone app\'s native (locked-screen) anchor monitor mirrors the watch', () => {
  it('drop arms it with the circle', () => {
    setFix(BASE);
    Nav.anchor.field = '150';
    anchorDrop();
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: true, lat: BASE.lat, lng: BASE.lng, radiusM: 150 / FT_PER_M });
  });
  it('a radius change re-sends it with the new radius', () => {
    setFix(BASE);
    anchorDrop();
    anchorRadiusChanged('300');
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: true, lat: BASE.lat, lng: BASE.lng, radiusM: 300 / FT_PER_M });
  });
  it('a radius change without a watch sends nothing', () => {
    anchorRadiusChanged('300');
    expect(nativeAnchorWatch).not.toHaveBeenCalled();
  });
  it('raise disarms it', () => {
    setFix(BASE);
    anchorDrop();
    anchorRaise();
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: false });
  });
  it('restore re-arms it with the restored circle', () => {
    localStorage.setItem('fishapp.anchor', JSON.stringify({ lat: BASE.lat, lng: BASE.lng, radiusFt: 120, ts: Date.now() }));
    anchorRestore();
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith({ on: true, lat: BASE.lat, lng: BASE.lng, radiusM: 120 / FT_PER_M });
    anchorRaise();
  });
  it('Silence snoozes the native alarm too', () => {
    setFix(BASE);
    anchorDrop();
    const out = llAt(BASE, 60);
    setFix(out);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    anchorDismissAlarm();
    expect(nativeAnchorSilence).toHaveBeenCalledTimes(1);
    anchorRaise();
  });
  it('a failing bridge never breaks the web watch', () => {
    nativeAnchorWatch.mockImplementationOnce(() => { throw new Error('bridge gone'); });
    setFix(BASE);
    expect(() => anchorDrop()).not.toThrow();
    expect(Nav.anchor.watching).toBe(true);
    anchorRaise();
  });
});

describe('FIX: snooze and "outside" state reach the panel', () => {
  it('silenced while still outside publishes anchorOutside; back inside clears snooze AND publishes it', () => {
    setFix(BASE);
    anchorDrop();
    const out = llAt(BASE, 60);
    setFix(out);
    navAnchorEvaluate(out); navAnchorEvaluate(out);
    anchorDismissAlarm();
    navAnchorEvaluate(out);
    expect(navStore.getState()).toMatchObject({ anchorOutside: true, anchorDragging: false, alarmDistFt: distFt(out, BASE) });
    expect(navStore.getState().anchorSnoozeUntil).toBeGreaterThan(Date.now());
    navAnchorEvaluate(llAt(BASE, 5));
    expect(navStore.getState()).toMatchObject({ anchorOutside: false, anchorSnoozeUntil: 0 });
    expect(navStore.getState().anchorStatus).toBe('Watching — alarms if you drift past 150 ft');
    anchorRaise();
  });
  it('a quiet night inside the circle does not republish on every fix', () => {
    setFix(BASE);
    anchorDrop();
    const spy = vi.fn();
    const unsub = navStore.subscribe(spy);
    navAnchorEvaluate(llAt(BASE, 5)); navAnchorEvaluate(llAt(BASE, 6)); navAnchorEvaluate(llAt(BASE, 4));
    expect(spy).not.toHaveBeenCalled();
    unsub();
    anchorRaise();
  });
});

describe('trip stats', () => {
  it('counts only real movement: ≥10 m, > 0.5 kn, non-coarse', () => {
    setFix(BASE);
    tripToggle();
    expect(Nav.trip.active).toBe(true);
    const p5 = llAt(BASE, 5);
    navOnFix(p5, 3);
    expect(Nav.trip.dist).toBe(0);                   // under 10 m
    const p20 = llAt(BASE, 20);
    navOnFix(p20, 0.3);
    expect(Nav.trip.dist).toBe(0);                   // drifting at 0.3 kn is noise
    GPS.coarse = true;
    navOnFix(p20, 4);
    expect(Nav.trip.dist).toBe(0);                   // coarse fix ignored
    GPS.coarse = false;
    navOnFix(p20, 4);
    expect(Nav.trip.dist).toBeCloseTo(20 / 1852, 6);
    navOnFix(llAt(BASE, 40), null);                  // unknown speed: distance alone decides
    expect(Nav.trip.dist).toBeCloseTo(40 / 1852, 6);
    expect(Nav.trip.maxKn).toBe(4);
    const s = navStore.getState();
    expect(s.tripMaxKn).toBe(4);
    expect(s.tripAvgKn).toBeCloseTo((3 + 0.3 + 4 + 4) / 4, 6);
    expect(s.tripButton).toBe('Pause trip');
  });

  it('pause banks time, resume does not count distance moved while paused', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    setFix(BASE);
    tripToggle();
    vi.setSystemTime(Date.now() + 10 * 60000);
    tripToggle();                                    // pause
    expect(Nav.trip.active).toBe(false);
    expect(Nav.trip.accMs).toBe(10 * 60000);
    expect(navStore.getState().tripButton).toBe('Resume trip');
    vi.setSystemTime(Date.now() + 30 * 60000);
    const far = llAt(BASE, 5000);
    setFix(far);
    tripToggle();                                    // resume from here
    navOnFix(far, 5);
    expect(Nav.trip.dist).toBe(0);
    vi.setSystemTime(Date.now() + 5 * 60000);
    expect(tripDurationMs(Nav.trip, Date.now())).toBe(15 * 60000);
    tripReset();
    expect(navStore.getState()).toMatchObject({ tripActive: false, tripStart: 0, tripDistNm: 0, tripMaxKn: null, tripAvgKn: null, tripButton: 'Start trip' });
  });
});

describe('route planner', () => {
  it('summarises legs, total, time at speed and fuel', () => {
    const a = BASE, b = llAt(BASE, 1852), c = llAt(b, 0, 1852);
    const s = routeSummarize([a, b, c], 7, 8);
    expect(s.legs.map((l) => l.brg)).toEqual([0, 90]);
    expect(s.legs[0].nm).toBeCloseTo(1, 4);
    expect(s.totalNm).toBeCloseTo(2, 3);
    expect(s.hrs).toBeCloseTo(2 / 7, 3);
    expect(s.durText).toBe('17m');
    expect(s.gal).toBeCloseTo(16 / 7, 2);
    expect(s.summary).toBe('2.0 nm total · 17m at 7 kn · 2.3 gal · 3 points');
    const z = routeSummarize([a, b], 0, 8);
    expect(z.hrs).toBeNull();
    expect(z.gal).toBeNull();
    expect(z.summary).toBe('1.0 nm total · 2 points');
  });

  it('publishes the planner and walks the user through it', () => {
    navSetMode('route');
    expect(navStore.getState().mode).toBe('route');
    expect(navHandleClick(BASE)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith('Navigation point 1 dropped — click another point on the map to make a route');
    expect(navStore.getState().routeHint).toBe('Navigation point 1 dropped — click another point on the map to make a route.');
    routeAddPoint(llAt(BASE, 1852));
    expect(toast).toHaveBeenLastCalledWith('Point 2 added — keep tapping to extend, or press Start route');
    expect(navStore.getState().routePts).toBe(2);
    expect(navStore.getState().routeLegs).toHaveLength(1);
    routeUndo();
    expect(navStore.getState().routePts).toBe(1);
    navSetMode('route');
    expect(navStore.getState().mode).toBeNull();
    expect(navHandleClick(BASE)).toBe(false);
  });

  it('refuses to start with fewer than 2 points', async () => {
    routeAddPoint(BASE);
    await routeStart();
    expect(toast).toHaveBeenLastCalledWith('Drop at least 2 points first — tap Add points, then tap the map');
  });

  it('FIX: cancelling the "voyage in progress" question keeps the planned route', async () => {
    Goto.active = true;
    Goto.track = [[1, 1], [1, 2], [1, 3]];
    routeAddPoint(BASE);
    routeAddPoint(llAt(BASE, 1852));
    confirmDialog.mockResolvedValueOnce(false);
    await routeStart();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(Nav.route.pts).toHaveLength(2);
    expect(closePanels).not.toHaveBeenCalled();
    expect(Goto.route).toBeNull();
  });

  it('starting hands a copy to Go-To, closes the panel and takes the planner down', async () => {
    navSetMode('route');
    routeAddPoint(BASE);
    routeAddPoint(llAt(BASE, 1852));
    routeAddPoint(llAt(BASE, 3704));
    await routeStart();
    expect(Goto.active).toBe(true);
    expect(Goto.route).toHaveLength(3);
    expect(Goto.destName).toBe('WP 1 of 3');
    expect(Nav.route.pts).toHaveLength(0);
    expect(Nav.mode).toBeNull();
    expect(closePanels).toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Route started — 3 waypoints. Follow the course line.');
  });
});

describe('cruise speed / fuel burn', () => {
  it('are engine state, persisted, and non-positive means "none"', () => {
    setRouteSpeedKn('12.5');
    expect(getRouteSpeedKn()).toBe(12.5);
    expect(localStorage.getItem('fishapp.routeSpeed')).toBe('12.5');
    setRouteSpeedKn('');
    expect(getRouteSpeedKn()).toBe(0);
    setRouteSpeedKn('-3');
    expect(getRouteSpeedKn()).toBe(0);
    setRouteGph(6);
    expect(getRouteGph()).toBe(6);
    expect(localStorage.getItem('fishapp.routeGph')).toBe('6');
    expect(navStore.getState().routeSpeedKn).toBe(0);
    expect(navStore.getState().routeGph).toBe(6);
  });

  it('defaults to 20 kn / 8 gph and reads the persisted values at load', async () => {
    vi.resetModules();
    localStorage.removeItem('fishapp.routeSpeed');
    localStorage.removeItem('fishapp.routeGph');
    let m = await import('../../../src/engine/nav.js');
    expect(m.getRouteSpeedKn()).toBe(20);
    expect(m.getRouteGph()).toBe(8);
    vi.resetModules();
    localStorage.setItem('fishapp.routeSpeed', '17');
    localStorage.setItem('fishapp.routeGph', '0');
    m = await import('../../../src/engine/nav.js');
    expect(m.getRouteSpeedKn()).toBe(17);
    expect(m.getRouteGph()).toBe(0);
  });
});

describe('anchor watch screen copy: iPhone app vs browser', () => {
  afterEach(() => { isNativeShell.mockReturnValue(false); });

  function drop() {
    setFix(BASE);
    Nav.anchor.field = '150';
    anchorDrop();
  }

  it('a browser keeps the legacy "screen on" wording', () => {
    expect(anchorScreenCopy(false)).toBe(ANCHOR_SCREEN_COPY.web);
    expect(ANCHOR_SCREEN_COPY.web).toEqual({
      armed: 'keep the app open, screen on',
      band: 'keep the screen on',
      blind: 'Keep the app in front with the screen on until GPS comes back.',
    });
  });

  it('the iPhone app never says to keep the screen on — its native monitor watches with the screen locked', () => {
    const c = anchorScreenCopy(true);
    expect(c).toBe(ANCHOR_SCREEN_COPY.native);
    expect(Object.keys(c).sort()).toEqual(Object.keys(ANCHOR_SCREEN_COPY.web).sort());
    for (const line of Object.values(c)) {
      expect(line).not.toMatch(/screen on|keep the screen|in front/i);
      expect(line).not.toMatch(/\bphone\b/i);     // the same app runs on iPad
    }
    expect(c.armed).toMatch(/screen locked/);
    expect(c.armed).toMatch(/close the app/);      // what really stops it there
    expect(c.band).toBe('OK to lock the screen');
  });

  it('dropping the anchor toasts the wording for where it runs', () => {
    drop();
    expect(toast).toHaveBeenLastCalledWith('Anchor watch on (150 ft) — keep the app open, screen on');
    anchorRaise();
    isNativeShell.mockReturnValue(true);
    drop();
    expect(toast).toHaveBeenLastCalledWith('Anchor watch on (150 ft) — keeps watching with the screen locked. Don\'t close the app.');
    expect(nativeAnchorWatch).toHaveBeenLastCalledWith(expect.objectContaining({ on: true }));
  });
});

describe('measure', () => {
  it('two taps give nm, statute miles and a true bearing; a third starts over', () => {
    navSetMode('measure');
    measureClick(BASE);
    expect(navStore.getState().measurePending).toBe(true);
    measureClick(llAt(BASE, 0, 1852));
    const r = navStore.getState().measure;
    expect(r.nm).toBeCloseTo(1, 3);
    expect(r.mi).toBeCloseTo(1.15078, 3);
    expect(r.brg).toBe(90);
    expect(navStore.getState().measurePending).toBe(false);
    measureClick(BASE);
    expect(navStore.getState().measure).toBeNull();
    expect(navStore.getState().measurePending).toBe(true);
  });
});
