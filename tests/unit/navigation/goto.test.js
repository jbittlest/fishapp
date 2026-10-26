// @vitest-environment jsdom
/* Characterisation tests for engine/goto.js: arrival radius, leg completion, steer cue, ETA,
 * waypoint advance, arrival hysteresis, the async confirms, the double-tap guard and the
 * fixed "no fix" / "storage failure" behaviour. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ui', () => ({
  toast: vi.fn(), closePanels: vi.fn(), openCard: vi.fn(), closeCard: vi.fn(), updateCard: vi.fn(), setDetent: vi.fn(),
  isPanelOpen: vi.fn(() => false), confirmDialog: vi.fn(async () => true),
  uiStore: { getState: vi.fn(() => ({ card: null })) },
}));
vi.mock('../../../src/services/native', () => ({
  backgroundLocation: vi.fn(), haptic: vi.fn(), isNativeShell: vi.fn(() => false),
  nativeAnchorWatch: vi.fn(), nativeAnchorSilence: vi.fn(),
  saveOrShareFile: vi.fn(async () => 'downloaded'),
}));
vi.mock('../../../src/engine/app.js', () => ({ getMap: vi.fn(() => null), applyPendingUpdate: vi.fn() }));
vi.mock('../../../src/engine/spots.js', () => ({ escapeHtml: (s) => String(s), refreshSpotDistances: () => {} }));
vi.mock('../../../src/engine/weather.js', () => ({
  compass: (deg) => (deg == null || !isFinite(deg)) ? '—' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8],
}));
vi.mock('../../../src/engine/db.js', () => ({
  idb: { put: vi.fn(async () => 1), getAll: vi.fn(async () => []), del: vi.fn(async () => undefined) },
}));

import {
  Goto, gotoStore, tripsStore, gotoArrivalNm, gotoLegIsDone, gotoSteerCue, gotoEta, gotoStart, gotoStartRoute,
  gotoOnFix, gotoArrive, gotoCancel, tripRetrySave, renderTripsList, deleteTrip, gotoRouteRemainingNm,
  gotoArrivalExitNm, gotoToggleTripPath, navUnsavedInMemory, navUnderWay,
} from '../../../src/engine/goto.js';
import { setRouteSpeedKn } from '../../../src/engine/nav.js';
import { GPS } from '../../../src/engine/gps.js';
import { Tracks } from '../../../src/engine/tracks.js';
import { idb } from '../../../src/engine/db.js';
import { applyPendingUpdate, getMap } from '../../../src/engine/app.js';
import { toast, confirmDialog, closeCard, openCard, updateCard, uiStore } from '../../../src/services/ui';
import { backgroundLocation } from '../../../src/services/native';
import { BASE, llAt, resetAll, setFix } from './helpers.js';

const NM = 1852;

beforeEach(() => {
  resetAll(); vi.clearAllMocks(); setRouteSpeedKn(20);
  getMap.mockImplementation(() => null);
  uiStore.getState.mockImplementation(() => ({ card: null }));
});

/** Just enough of an L.Map for layers to be added / removed and bounds fitted. */
function fakeMap() {
  return { addLayer: vi.fn(function addLayer() { return this; }), removeLayer: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), hasLayer: () => false };
}

describe('gotoArrivalNm', () => {
  it('is 0.08 nm up to 6 kn, grows 0.006 nm per kn, capped at 0.25', () => {
    expect(gotoArrivalNm(null)).toBe(0.08);
    expect(gotoArrivalNm(NaN)).toBe(0.08);
    expect(gotoArrivalNm(3)).toBe(0.08);
    expect(gotoArrivalNm(6)).toBe(0.08);
    expect(gotoArrivalNm(10)).toBeCloseTo(0.104, 10);
    expect(gotoArrivalNm(30)).toBeCloseTo(0.224, 10);
    expect(gotoArrivalNm(40)).toBe(0.25);
  });
});

describe('gotoSteerCue', () => {
  it('reads "on course" within ±5°', () => {
    expect(gotoSteerCue(100, 97)).toMatchObject({ dir: 'on-course', text: 'on course' });
    expect(gotoSteerCue(100, 105)).toMatchObject({ dir: 'on-course' });
  });
  it('turn right / left relative to the course, across north', () => {
    expect(gotoSteerCue(100, 88)).toMatchObject({ dir: 'right', text: 'turn 12° right', deg: 12 });
    expect(gotoSteerCue(80, 92)).toMatchObject({ dir: 'left', text: 'turn 12° left', deg: -12 });
    expect(gotoSteerCue(10, 350).text).toBe('turn 20° right');
    expect(gotoSteerCue(350, 10).text).toBe('turn 20° left');
  });
  it('has no cue without a heading', () => {
    expect(gotoSteerCue(100, null)).toEqual({ deg: null, dir: null, text: '' });
    expect(gotoSteerCue(null, 100)).toEqual({ deg: null, dir: null, text: '' });
  });
});

describe('gotoEta', () => {
  const now = new Date('2026-10-25T12:00:00').getTime();
  it('uses live SOG above 1 kn', () => {
    const e = gotoEta(10, 5, 20, now);
    expect(e.planned).toBe(false);
    expect(e.ttgText).toBe('2h 0m');
    expect(e.text).toBe('ETA ' + e.clock + ' · 2h 0m');
    expect(e.at).toBe(now + 2 * 3600e3);
  });
  it('falls back to the planned cruise speed and says so', () => {
    const e = gotoEta(10, 0.5, 20, now);
    expect(e.planned).toBe(true);
    expect(e.ttgText).toBe('30m');
    expect(e.text.endsWith(' · 30m @20kn')).toBe(true);
  });
  it('gives no ETA without a speed or a distance', () => {
    expect(gotoEta(10, null, 0, now).text).toBe('ETA —');
    expect(gotoEta(null, 5, 20, now)).toMatchObject({ text: 'ETA —', clock: '', ttgSec: null });
  });
});

describe('gotoStart', () => {
  it('FIX: with no fix shows dashes, not "steer 0° N" and a fake ETA', async () => {
    expect(await gotoStart({ lat: BASE.lat, lng: BASE.lng }, ' Wreck ')).toBe(true);
    const s = gotoStore.getState();
    expect(s).toMatchObject({ active: true, name: 'Wreck', hasFix: false, distNm: null, brgDeg: null, steerText: '', etaText: 'ETA —', steerLine: 'steer —' });
    expect(toast).toHaveBeenLastCalledWith('Navigating to Wreck — waiting for GPS');
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    expect(closeCard).toHaveBeenCalled();
  });

  it('publishes distance, bearing, compass and the steer cue from the course over ground', async () => {
    setFix(BASE);
    GPS.heading = 80;                                  // sticky COG; coords.heading is null
    const dest = llAt(BASE, 0, 2.1 * NM);              // 2.1 nm due east
    await gotoStart(dest, 'Kelp');
    const s = gotoStore.getState();
    expect(s.distNm).toBeCloseTo(2.1, 3);
    expect(Math.round(s.brgDeg)).toBe(90);
    expect(s.brgCompass).toBe('E');
    expect(s.steerText).toBe('turn 10° right');
    expect(s.steerLine).toBe('steer 90° E');
    expect(s.etaPlanned).toBe(true);
    expect(s.ttgText).toBe('6m');                      // 2.1 nm at the planned 20 kn
    expect(Goto.planNm).toBeCloseTo(2.1, 3);
    expect(Goto.track).toHaveLength(1);
  });

  it('asks before discarding a voyage with more than 2 breadcrumbs and backs out cleanly', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'A');
    Goto.track.push([1, 1], [1, 2]);
    confirmDialog.mockResolvedValueOnce(false);
    expect(await gotoStart(llAt(BASE, 2 * NM), 'B')).toBe(false);
    expect(Goto.destName).toBe('A');
    expect(Goto.track).toHaveLength(3);
    confirmDialog.mockResolvedValueOnce(true);
    expect(await gotoStart(llAt(BASE, 2 * NM), 'B')).toBe(true);
    expect(Goto.destName).toBe('B');
  });
});

describe('gotoOnFix', () => {
  it('records a breadcrumb every 10 m (or 5 s) and the max speed', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'A');
    gotoOnFix(llAt(BASE, 2), 3);
    expect(Goto.track).toHaveLength(2);                // first fix of the run always lands
    gotoOnFix(llAt(BASE, 6), 4);
    expect(Goto.track).toHaveLength(2);                // 4 m, <5 s
    gotoOnFix(llAt(BASE, 20), 9);
    expect(Goto.track).toHaveLength(3);
    expect(Goto.maxKn).toBe(9);
  });

  it('arriving has hysteresis: in below the radius, out only at ≥ 0.12 nm', async () => {
    setFix(BASE);
    const dest = llAt(BASE, NM);
    await gotoStart(dest, 'Reef');
    gotoOnFix(llAt(dest, -0.05 * NM), 3);
    expect(gotoStore.getState().arriving).toBe(true);
    expect(toast).toHaveBeenLastCalledWith('Arriving at Reef — tap Arrived to log it');
    gotoOnFix(llAt(dest, -0.10 * NM), 3);
    expect(gotoStore.getState().arriving).toBe(true);
    gotoOnFix(llAt(dest, -0.13 * NM), 3);
    expect(gotoStore.getState().arriving).toBe(false);
  });

  it('a new run never inherits the previous run\'s arriving state', async () => {
    setFix(BASE);
    const dest = llAt(BASE, NM);
    await gotoStart(dest, 'Reef');
    gotoOnFix(llAt(dest, -0.05 * NM), 3);
    expect(gotoStore.getState().arriving).toBe(true);
    await gotoStart(llAt(BASE, 5 * NM), 'Far');
    expect(gotoStore.getState().arriving).toBe(false);
  });

  it('advances waypoints by radius and by passing abeam', async () => {
    setFix(BASE);
    const wp1 = llAt(BASE, NM), wp2 = llAt(BASE, 2 * NM), wp3 = llAt(BASE, 2.3 * NM), wp4 = llAt(BASE, 2.6 * NM);
    expect(await gotoStartRoute([wp1, wp2, wp3, wp4])).toBe(true);
    expect(gotoStore.getState()).toMatchObject({ name: 'WP 1 of 4', isRoute: true, wpIndex: 1, wpCount: 4 });
    // headline distance is the whole remaining run
    expect(gotoRouteRemainingNm(BASE)).toBeCloseTo(2.6, 3);
    expect(gotoStore.getState().distNm).toBeCloseTo(2.6, 3);

    gotoOnFix(llAt(wp1, -0.05 * NM), 5);               // inside the 0.08 nm radius
    expect(Goto.legIdx).toBe(1);
    expect(Goto.destName).toBe('WP 2 of 4');
    expect(toast).toHaveBeenLastCalledWith('WP 1 reached — steering to WP 2');

    // set 0.3 nm wide of WP 2 and already past it: never inside the radius, but abeam
    gotoOnFix(llAt(wp2, 0.02 * NM, 0.3 * NM), 5);
    expect(Goto.legIdx).toBe(2);
    expect(gotoStore.getState().name).toBe('WP 3 of 4');
    expect(gotoStore.getState().legText).toMatch(/^leg \d+\.\d\d nm$/);
  });

  it('catches up across several short legs after a GPS gap', async () => {
    setFix(BASE);
    const wp1 = llAt(BASE, NM), wp2 = llAt(BASE, 2 * NM), wp3 = llAt(BASE, 2.3 * NM), wp4 = llAt(BASE, 2.6 * NM);
    await gotoStartRoute([wp1, wp2, wp3, wp4]);
    gotoOnFix(llAt(wp1, -0.05 * NM), 5);
    expect(Goto.legIdx).toBe(1);
    // next fix arrives just past WP 3: the legs to WP 2 and WP 3 both complete in one go
    gotoOnFix(llAt(wp3, 0.01 * NM), 5);
    expect(Goto.legIdx).toBe(3);
    expect(gotoStore.getState().name).toBe('WP 4 of 4');
    expect(toast).toHaveBeenLastCalledWith('WP 3 reached — steering to WP 4');
  });

  it('a wild fix far beyond a mark (> 2 nm) does not skip the leg', async () => {
    setFix(BASE);
    const wp1 = llAt(BASE, NM), wp2 = llAt(BASE, 3 * NM);
    await gotoStartRoute([wp1, wp2]);
    gotoOnFix(llAt(wp1, 2.5 * NM), 5);                 // "behind the beam" but 2.5 nm off
    expect(Goto.legIdx).toBe(0);
  });

  it('gotoLegIsDone uses the previous waypoint (or the start) for the leg bearing', async () => {
    setFix(BASE);
    const wp1 = llAt(BASE, NM), wp2 = llAt(BASE, 2 * NM);
    await gotoStartRoute([wp1, wp2]);
    expect(gotoLegIsDone(llAt(BASE, 0.5 * NM), 0.5, 5)).toBe(false);
    expect(gotoLegIsDone(llAt(wp1, 0.1 * NM), 0.1, 5)).toBe(true);
  });
});

describe('ending a run', () => {
  async function runWithTrack() {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    gotoOnFix(llAt(BASE, 200), 6);
    gotoOnFix(llAt(BASE, 400), 6);
  }

  it('Arrived saves once even when double-tapped', async () => {
    await runWithTrack();
    await Promise.all([gotoArrive(), gotoArrive()]);
    expect(idb.put).toHaveBeenCalledTimes(1);
    const [store, trip] = idb.put.mock.calls[0];
    expect(store).toBe('trips');
    expect(trip).toMatchObject({ name: 'To Spot', dest: { name: 'Spot' }, planNm: expect.any(Number), maxKn: 6 });
    expect(trip.actualNm).toBeCloseTo(400 / NM, 4);
    expect(Goto.active).toBe(false);
    expect(gotoStore.getState()).toMatchObject({ active: false, ending: false });
    expect(applyPendingUpdate).toHaveBeenCalled();
    expect(backgroundLocation).toHaveBeenLastCalledWith(false);
  });

  it('too short to save says so and still ends', async () => {
    await gotoStart(llAt(BASE, NM), 'Spot');           // no fix → no start, no track
    await gotoArrive();
    expect(idb.put).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Voyage too short to save');
    expect(Goto.active).toBe(false);
  });

  it('FIX: a storage failure is reported and the voyage is kept in memory', async () => {
    await runWithTrack();
    idb.put.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await gotoArrive();
    expect(Goto.active).toBe(false);
    expect(Goto.unsaved).toHaveLength(1);
    expect(toast.mock.lastCall[0]).toContain('Voyage NOT saved');
    expect(toast.mock.lastCall[0]).toContain('QuotaExceededError');
    expect(toast.mock.lastCall[1].action.label).toBe('Retry');
    expect(tripsStore.getState().items[0]).toMatchObject({ unsaved: true, error: 'QuotaExceededError', name: 'To Spot' });
    expect(applyPendingUpdate).not.toHaveBeenCalled();  // a reload would lose it

    const id = Goto.unsaved[0].id;
    expect(await tripRetrySave(id)).toBe(true);
    expect(idb.put).toHaveBeenCalledTimes(2);
    expect(idb.put.mock.calls[1][1].id).toBeUndefined();
    expect(Goto.unsaved).toHaveLength(0);
    expect(applyPendingUpdate).toHaveBeenCalled();
  });

  it('Stop asks first above 2 breadcrumbs and keeps navigating on "no"', async () => {
    await runWithTrack();
    expect(Goto.track.length).toBeGreaterThan(2);
    confirmDialog.mockResolvedValueOnce(false);
    await gotoCancel();
    expect(Goto.active).toBe(true);
    confirmDialog.mockResolvedValueOnce(true);
    await gotoCancel();
    expect(Goto.active).toBe(false);
    expect(idb.put).not.toHaveBeenCalled();
  });

  it('Stop with a short track ends without asking', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    await gotoCancel();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(Goto.active).toBe(false);
  });
});

describe('voyage archive', () => {
  it('loads newest first and reports read errors', async () => {
    idb.getAll.mockResolvedValueOnce([
      { id: 1, name: 'Old', start: 1000, end: 5000, actualNm: 1, planNm: 1, avgKn: 2, maxKn: 3, dest: { name: 'x' } },
      { id: 2, name: 'New', start: 9000, end: 9900, actualNm: 2, planNm: 2, avgKn: 4, maxKn: 5, dest: { name: 'y' } },
    ]);
    await renderTripsList();
    const s = tripsStore.getState();
    expect(s.status).toBe('ready');
    expect(s.items.map((t) => t.name)).toEqual(['New', 'Old']);
    idb.getAll.mockRejectedValueOnce(new Error('Offline storage is unavailable on this device'));
    await renderTripsList();
    expect(tripsStore.getState()).toMatchObject({ status: 'error', error: 'Offline storage is unavailable on this device' });
  });

  it('delete asks first and only deletes on yes', async () => {
    idb.getAll.mockResolvedValue([{ id: 7, name: 'V', start: 1, end: 2, actualNm: 1, planNm: 1, avgKn: 1, maxKn: 1, dest: { name: 'd' } }]);
    await renderTripsList();
    confirmDialog.mockResolvedValueOnce(false);
    expect(await deleteTrip(7)).toBe(false);
    expect(idb.del).not.toHaveBeenCalled();
    confirmDialog.mockResolvedValueOnce(true);
    expect(await deleteTrip(7)).toBe(true);
    expect(idb.del).toHaveBeenCalledWith('trips', 7);
    idb.getAll.mockReset();
    idb.getAll.mockImplementation(async () => []);
  });
});

describe('FIX: arrival hysteresis at speed', () => {
  it('the exit is 1.5x the entry radius, never below the legacy 0.12 nm', () => {
    expect(gotoArrivalExitNm(0.08)).toBeCloseTo(0.12, 10);
    expect(gotoArrivalExitNm(0.224)).toBeCloseTo(0.336, 10);
    expect(gotoArrivalExitNm(0.25)).toBeCloseTo(0.375, 10);
    expect(gotoArrivalExitNm(0.02)).toBe(0.12);
    expect(gotoArrivalExitNm(null)).toBe(0.12);
    expect(gotoArrivalExitNm(NaN)).toBe(0.12);
  });

  it('at 30 kn "arriving" no longer flips on every fix between 0.12 nm and the 0.224 nm radius', async () => {
    setFix(BASE);
    const dest = llAt(BASE, 3 * NM);
    await gotoStart(dest, 'Bank');
    gotoOnFix(llAt(dest, -0.20 * NM), 30);
    expect(gotoStore.getState().arriving).toBe(true);
    gotoOnFix(llAt(dest, -0.15 * NM), 30);            // the legacy code cleared it here (>= 0.12)...
    expect(gotoStore.getState().arriving).toBe(true);
    gotoOnFix(llAt(dest, -0.14 * NM), 30);            // ...and set it again here, re-toasting
    expect(gotoStore.getState().arriving).toBe(true);
    expect(toast.mock.calls.filter((c) => String(c[0]).startsWith('Arriving at Bank'))).toHaveLength(1);
    gotoOnFix(llAt(dest, -0.30 * NM), 30);            // still inside 1.5 x 0.224
    expect(gotoStore.getState().arriving).toBe(true);
    gotoOnFix(llAt(dest, -0.34 * NM), 30);            // past 0.336 nm: cleared
    expect(gotoStore.getState().arriving).toBe(false);
  });

  it('speeding up while arriving widens the exit with it (no flap from a growing radius)', async () => {
    setFix(BASE);
    const dest = llAt(BASE, 3 * NM);
    await gotoStart(dest, 'Bank');
    gotoOnFix(llAt(dest, -0.05 * NM), 3);             // entered at the 0.08 nm base radius
    gotoOnFix(llAt(dest, -0.20 * NM), 30);            // 30 kn: radius now 0.224, exit 0.336
    expect(gotoStore.getState().arriving).toBe(true);
    expect(toast.mock.calls.filter((c) => String(c[0]).startsWith('Arriving at Bank'))).toHaveLength(1);
  });
});

describe('FIX: a stale last fix is not a start position', () => {
  it('gotoStart waits for GPS instead of measuring from an hours-old fix', async () => {
    setFix(BASE);
    GPS.lastFixTs = Date.now() - 3 * 3600e3;
    await gotoStart(llAt(BASE, NM), 'Reef');
    expect(Goto.startLL).toBeNull();
    expect(gotoStore.getState()).toMatchObject({ hasFix: false, distNm: null, brgDeg: null, etaText: 'ETA —' });
    expect(toast).toHaveBeenLastCalledWith('Navigating to Reef — waiting for GPS');
    const live = llAt(BASE, 100);
    setFix(live);
    gotoOnFix(live, 5);                                // the first live fix becomes the start
    expect(Goto.startLL).toBe(live);
    expect(gotoStore.getState().hasFix).toBe(true);
  });
  it('a fresh fix still starts the run immediately', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Reef');
    expect(Goto.startLL).toBe(GPS.lastLatLng);
    expect(gotoStore.getState().hasFix).toBe(true);
  });
});

describe('FIX: no update reload while a voyage OR a track exists only in memory', () => {
  it('ending a Go-To does not reload away an unsaved track', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    Tracks.unsaved.push({ id: 'unsaved-1', name: 'Track', points: [[0, 0], [0, 1]], start: 1, end: 2, nm: 1 });
    expect(navUnsavedInMemory()).toBe(true);
    await gotoArrive();
    expect(applyPendingUpdate).not.toHaveBeenCalled();
    Tracks.unsaved = [];
    expect(navUnsavedInMemory()).toBe(false);
  });
  it('a successful voyage retry does not reload while a track is still unsaved', async () => {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    gotoOnFix(llAt(BASE, 200), 6); gotoOnFix(llAt(BASE, 400), 6);
    idb.put.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await gotoArrive();
    Tracks.unsaved.push({ id: 'unsaved-9', name: 'Track', points: [], start: 1, end: 2, nm: 0 });
    expect(await tripRetrySave(Goto.unsaved[0].id)).toBe(true);
    expect(applyPendingUpdate).not.toHaveBeenCalled();
    Tracks.unsaved = [];
  });
});

describe('FIX: a successful retry keeps the history card (and the path) on the saved record', () => {
  async function failedVoyage() {
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    gotoOnFix(llAt(BASE, 200), 6); gotoOnFix(llAt(BASE, 400), 6);
    idb.put.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await gotoArrive();
    return Goto.unsaved[0];
  }

  it('re-points the open card at the new storage key and lists it there', async () => {
    const rec = await failedVoyage();
    uiStore.getState.mockImplementation(() => ({ card: { id: 7, kind: 'history', data: { type: 'trip', id: rec.id } } }));
    idb.put.mockResolvedValueOnce(42);
    idb.getAll.mockImplementationOnce(async () => [{ ...rec, id: 42, _error: undefined }]);
    expect(await tripRetrySave(rec.id)).toBe(true);
    expect(updateCard).toHaveBeenCalledWith(7, { id: 42 });
    expect(closeCard).not.toHaveBeenCalledWith('history');
    expect(tripsStore.getState().items.find((t) => t.id === 42)).toMatchObject({ unsaved: false, name: 'To Spot' });
  });

  it('moves a shown path to the new key', async () => {
    const map = fakeMap();
    getMap.mockImplementation(() => map);
    const rec = await failedVoyage();
    gotoToggleTripPath(rec.id);
    expect(tripsStore.getState().shown[rec.id]).toBe(true);
    idb.put.mockResolvedValueOnce(43);
    idb.getAll.mockImplementationOnce(async () => [{ ...rec, id: 43 }]);
    await tripRetrySave(rec.id);
    expect(tripsStore.getState().shown).toEqual({ 43: true });
  });

  it('closes the card when the new key is unknown', async () => {
    const rec = await failedVoyage();
    uiStore.getState.mockImplementation(() => ({ card: { id: 3, kind: 'history', data: { type: 'trip', id: rec.id } } }));
    idb.put.mockResolvedValueOnce(undefined);
    await tripRetrySave(rec.id);
    expect(closeCard).toHaveBeenCalledWith('history');
    expect(updateCard).not.toHaveBeenCalled();
  });
});

describe('FIX: showing a saved voyage while under way', () => {
  const saved = { id: 5, name: 'To Reef', start: 1, end: 2, actualNm: 1, planNm: 1, avgKn: 1, maxKn: 1,
    dest: { lat: BASE.lat + 0.01, lng: BASE.lng, name: 'Reef' }, points: [[BASE.lat, BASE.lng], [BASE.lat + 0.01, BASE.lng]] };

  it('not under way: Follow off, map fitted, history card opened (port behaviour)', () => {
    const map = fakeMap();
    getMap.mockImplementation(() => map);
    Goto.saved = { 5: saved };
    GPS.follow = true;
    gotoToggleTripPath(5);
    expect(GPS.follow).toBe(false);
    expect(map.fitBounds).toHaveBeenCalled();
    expect(openCard).toHaveBeenCalledWith('history', { type: 'trip', id: 5 });
  });

  it('during a Go-To: Follow stays on and no card covers the Go-To card', async () => {
    const map = fakeMap();
    getMap.mockImplementation(() => map);
    setFix(BASE);
    await gotoStart(llAt(BASE, NM), 'Spot');
    Goto.saved = { 5: saved };
    GPS.follow = true;
    expect(navUnderWay()).toBe(true);
    gotoToggleTripPath(5);
    expect(GPS.follow).toBe(true);
    expect(openCard).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Voyage shown on the chart — Follow stays on while you navigate');
    expect(tripsStore.getState().shown[5]).toBe(true);
  });

  it('while recording a track: Follow stays on, the card still opens', () => {
    const map = fakeMap();
    getMap.mockImplementation(() => map);
    Tracks.recording = true;
    Goto.saved = { 5: saved };
    GPS.follow = true;
    gotoToggleTripPath(5);
    expect(GPS.follow).toBe(true);
    expect(openCard).toHaveBeenCalledWith('history', { type: 'trip', id: 5 });
    Tracks.recording = false;
  });
});
