// @vitest-environment jsdom
/* Characterisation tests for engine/tracks.js: the distance noise filter, the recorder's
 * point filter, the trackOnFix guard, and the fixed storage-failure handling. */
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
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'N' }));
vi.mock('../../../src/engine/db.js', () => ({
  idb: { put: vi.fn(async () => 1), getAll: vi.fn(async () => []), del: vi.fn(async () => undefined) },
}));

import {
  Tracks, tracksStore, trackDistanceNm, trackOnFix, trackStart, trackStop, trackToggle, trackRetrySave,
  trackSaveAsFile, renderTracksList, deleteTrack, tracksHaveUnsaved, toggleTrackShown,
} from '../../../src/engine/tracks.js';
import { Awake } from '../../../src/engine/awake.js';
import { Goto } from '../../../src/engine/goto.js';
import { GPS } from '../../../src/engine/gps.js';
import { idb } from '../../../src/engine/db.js';
import { applyPendingUpdate, getMap } from '../../../src/engine/app.js';
import { toast, confirmDialog, closeCard, openCard, updateCard, uiStore } from '../../../src/services/ui';
import { backgroundLocation, saveOrShareFile } from '../../../src/services/native';
import { BASE, llAt, resetAll } from './helpers.js';

beforeEach(() => {
  resetAll(); vi.clearAllMocks();
  getMap.mockImplementation(() => null);
  uiStore.getState.mockImplementation(() => ({ card: null }));
});

function fakeMap() {
  return { addLayer: vi.fn(function addLayer() { return this; }), removeLayer: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), hasLayer: () => false };
}

const pt = (ll) => [ll.lat, ll.lng];

describe('trackDistanceNm', () => {
  it('sums only segments of 10 m or more', () => {
    const jitter = [pt(BASE), pt(llAt(BASE, 4)), pt(llAt(BASE, 1)), pt(llAt(BASE, 7)), pt(llAt(BASE, 2))];
    expect(trackDistanceNm(jitter)).toBe(0);
    const run = [pt(BASE), pt(llAt(BASE, 20)), pt(llAt(BASE, 25)), pt(llAt(BASE, 45))];
    expect(trackDistanceNm(run)).toBeCloseTo(40 / 1852, 6);       // 20 + (5 dropped) + 20
    expect(trackDistanceNm([])).toBe(0);
    expect(trackDistanceNm([pt(BASE)])).toBe(0);
  });
});

describe('trackOnFix', () => {
  it('does nothing unless recording', () => {
    trackOnFix(BASE, 1000, 5);
    expect(Tracks.points).toHaveLength(0);
  });

  it('records on a 10 m move, or after 5 s only when under way', () => {
    trackStart();
    trackOnFix(BASE, 0, 0);                          // first point always
    trackOnFix(llAt(BASE, 5), 10000, 0.2);           // 5 m, 10 s, stationary (kn < 0.5) → noise
    trackOnFix(llAt(BASE, 5), 3000, 3);              // 5 m, under way, but < 5 s
    expect(Tracks.points).toHaveLength(1);
    trackOnFix(llAt(BASE, 5), 6000, 3);              // 5 m, under way, ≥ 5 s → keepalive point
    expect(Tracks.points).toHaveLength(2);
    trackOnFix(llAt(BASE, 17), 6500, 3);             // 12 m → always
    expect(Tracks.points).toHaveLength(3);
    // unknown speed: < 3 m counts as stationary even after 5 s; 4 m after 5 s is a point
    trackOnFix(llAt(BASE, 19), 20000, null);
    expect(Tracks.points).toHaveLength(3);
    trackOnFix(llAt(BASE, 21), 20000, null);
    expect(Tracks.points).toHaveLength(4);
    expect(tracksStore.getState().points).toBe(4);
  });

  it('FIX: never throws into gps.js (the anchor check runs after it)', () => {
    trackStart();
    trackOnFix(BASE, 0, 0);
    const bad = { lat: 1, lng: 2, distanceTo() { throw new Error('boom'); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => trackOnFix(bad, 99999, 3)).not.toThrow();
    err.mockRestore();
  });
});

describe('recording', () => {
  it('start takes the keep-alive and background GPS, publishes the state', () => {
    trackToggle();
    expect(Tracks.recording).toBe(true);
    expect(tracksStore.getState()).toMatchObject({ recording: true, points: 0 });
    expect(tracksStore.getState().startedAt).toBeGreaterThan(0);
    expect(Awake.reasons.has('track')).toBe(true);
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    expect(toast).toHaveBeenLastCalledWith('Recording track — tap the record button again to stop');
  });

  it('a track of fewer than 2 points is not saved', async () => {
    trackStart();
    trackOnFix(BASE, 0, 0);
    await trackStop();
    expect(idb.put).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Track too short — not saved');
    expect(applyPendingUpdate).toHaveBeenCalled();
    expect(Awake.reasons.has('track')).toBe(false);
    expect(backgroundLocation).toHaveBeenLastCalledWith(false);
  });

  it('saves name, points, times and filtered distance', async () => {
    trackStart();
    trackOnFix(BASE, 0, 4);
    trackOnFix(llAt(BASE, 100), 20000, 4);
    trackOnFix(llAt(BASE, 300), 40000, 4);
    await trackStop();
    expect(idb.put).toHaveBeenCalledTimes(1);
    const [store, rec] = idb.put.mock.calls[0];
    expect(store).toBe('tracks');
    expect(rec.name.startsWith('Track ')).toBe(true);
    expect(rec.points).toHaveLength(3);
    expect(rec.nm).toBeCloseTo(300 / 1852, 6);
    expect(toast).toHaveBeenLastCalledWith('Track saved (' + (300 / 1852).toFixed(2) + ' nm)');
    expect(tracksStore.getState().recording).toBe(false);
  });

  it('FIX: a storage failure is reported, the track kept in memory, and no update reload', async () => {
    trackStart();
    trackOnFix(BASE, 0, 4);
    trackOnFix(llAt(BASE, 100), 20000, 4);
    idb.put.mockRejectedValueOnce(new Error('write aborted (storage full?)'));
    await trackStop();
    expect(tracksHaveUnsaved()).toBe(true);
    expect(toast.mock.lastCall[0]).toContain('Track NOT saved');
    expect(toast.mock.lastCall[1].action.label).toBe('Retry');
    expect(tracksStore.getState().saved[0]).toMatchObject({ unsaved: true, error: 'write aborted (storage full?)', points: 2 });
    expect(applyPendingUpdate).not.toHaveBeenCalled();

    const id = Tracks.unsaved[0].id;
    await trackSaveAsFile(id);
    const file = saveOrShareFile.mock.lastCall[0];
    expect(file.mime).toBe('application/json');
    const data = JSON.parse(file.data);
    expect(data.app).toBe('FishApp');
    expect(data.tracks).toHaveLength(1);
    expect(data.tracks[0].id).toBeUndefined();

    expect(await trackRetrySave(id)).toBe(true);
    expect(tracksHaveUnsaved()).toBe(false);
    expect(applyPendingUpdate).toHaveBeenCalled();
  });
});

describe('saved tracks', () => {
  it('load newest first; read errors are reported', async () => {
    idb.getAll.mockResolvedValueOnce([
      { id: 1, name: 'A', start: 10, end: 20, nm: 1, points: [[0, 0], [0, 1]] },
      { id: 2, name: 'B', start: 30, end: 40, nm: 2, points: [[0, 0]] },
    ]);
    await renderTracksList();
    expect(tracksStore.getState().status).toBe('ready');
    expect(tracksStore.getState().saved.map((t) => t.name)).toEqual(['B', 'A']);
    expect(tracksStore.getState().saved[1].points).toBe(2);
    idb.getAll.mockRejectedValueOnce(new Error('nope'));
    await renderTracksList();
    expect(tracksStore.getState()).toMatchObject({ status: 'error', error: 'nope' });
  });

  it('delete asks first', async () => {
    idb.getAll.mockResolvedValueOnce([{ id: 3, name: 'C', start: 1, end: 2, nm: 0.5, points: [] }]);
    await renderTracksList();
    confirmDialog.mockResolvedValueOnce(false);
    expect(await deleteTrack(3)).toBe(false);
    expect(idb.del).not.toHaveBeenCalled();
    confirmDialog.mockResolvedValueOnce(true);
    expect(await deleteTrack(3)).toBe(true);
    expect(idb.del).toHaveBeenCalledWith('tracks', 3);
  });
});

async function failedTrack() {
  trackStart();
  trackOnFix(BASE, 0, 4);
  trackOnFix(llAt(BASE, 100), 20000, 4);
  idb.put.mockRejectedValueOnce(new Error('write aborted (storage full?)'));
  await trackStop();
  return Tracks.unsaved[0];
}

describe('FIX: no update reload while a track OR a voyage exists only in memory', () => {
  it('stopping a recording does not reload away an unsaved voyage', async () => {
    Goto.unsaved.push({ id: 'unsaved-1', name: 'To Spot', points: [], start: 1, end: 2 });
    trackStart();
    trackOnFix(BASE, 0, 4);
    trackOnFix(llAt(BASE, 100), 20000, 4);
    await trackStop();
    expect(idb.put).toHaveBeenCalledTimes(1);          // the track itself saved fine
    expect(applyPendingUpdate).not.toHaveBeenCalled();
    Goto.unsaved = [];
  });
  it('nor does a too-short recording', async () => {
    Goto.unsaved.push({ id: 'unsaved-2', name: 'To Spot', points: [], start: 1, end: 2 });
    trackStart();
    await trackStop();
    expect(applyPendingUpdate).not.toHaveBeenCalled();
    Goto.unsaved = [];
  });
  it('nor a successful track retry', async () => {
    const rec = await failedTrack();
    Goto.unsaved.push({ id: 'unsaved-3', name: 'To Spot', points: [], start: 1, end: 2 });
    expect(await trackRetrySave(rec.id)).toBe(true);
    expect(applyPendingUpdate).not.toHaveBeenCalled();
    Goto.unsaved = [];
  });
});

describe('FIX: a successful retry keeps the history card (and the line) on the saved record', () => {
  it('re-points the open card at the new storage key', async () => {
    const rec = await failedTrack();
    uiStore.getState.mockImplementation(() => ({ card: { id: 11, kind: 'history', data: { type: 'track', id: rec.id } } }));
    idb.put.mockResolvedValueOnce(77);
    idb.getAll.mockImplementationOnce(async () => [{ ...rec, id: 77 }]);
    expect(await trackRetrySave(rec.id)).toBe(true);
    expect(updateCard).toHaveBeenCalledWith(11, { id: 77 });
    expect(closeCard).not.toHaveBeenCalledWith('history');
    expect(tracksStore.getState().saved.find((t) => t.id === 77)).toMatchObject({ unsaved: false, points: 2 });
  });
  it('moves a shown line to the new key', async () => {
    getMap.mockImplementation(() => fakeMap());
    const rec = await failedTrack();
    toggleTrackShown(rec.id);
    expect(tracksStore.getState().shown[rec.id]).toBe(true);
    idb.put.mockResolvedValueOnce(78);
    idb.getAll.mockImplementationOnce(async () => [{ ...rec, id: 78 }]);
    await trackRetrySave(rec.id);
    expect(tracksStore.getState().shown).toEqual({ 78: true });
  });
  it('closes the card when the new key is unknown', async () => {
    const rec = await failedTrack();
    uiStore.getState.mockImplementation(() => ({ card: { id: 12, kind: 'history', data: { type: 'track', id: rec.id } } }));
    idb.put.mockResolvedValueOnce(undefined);
    await trackRetrySave(rec.id);
    expect(closeCard).toHaveBeenCalledWith('history');
  });
});

describe('FIX: showing a saved track during a Go-To', () => {
  const saved = { id: 4, name: 'Track A', start: 1, end: 2, nm: 1, points: [[BASE.lat, BASE.lng], [BASE.lat + 0.01, BASE.lng]] };
  it('keeps Follow on and opens no card over the Go-To card', () => {
    getMap.mockImplementation(() => fakeMap());
    Tracks.saved = { 4: saved };
    Goto.active = true;
    GPS.follow = true;
    toggleTrackShown(4);
    expect(GPS.follow).toBe(true);
    expect(openCard).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Track shown on the chart — Follow stays on while you navigate');
    expect(tracksStore.getState().shown[4]).toBe(true);
    Goto.active = false;
  });
  it('not under way it still turns Follow off and opens the card', () => {
    getMap.mockImplementation(() => fakeMap());
    Tracks.saved = { 4: saved };
    GPS.follow = true;
    toggleTrackShown(4);
    expect(GPS.follow).toBe(false);
    expect(openCard).toHaveBeenCalledWith('history', { type: 'track', id: 4 });
  });
});
