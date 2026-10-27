// @vitest-environment jsdom
/* engine/gps.js fix sanity filter (audit 2026-10-27). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'N' }));
vi.mock('../../../src/engine/db.js', () => ({
  idb: { put: vi.fn(async () => 1), getAll: vi.fn(async () => []), del: vi.fn(async () => undefined) },
}));

import { GPS, gpsFixIsSane } from '../../../src/engine/gps.js';
import { BASE, llAt, resetAll, setFix } from './helpers.js';

const coords = (ll) => ({ latitude: ll.lat, longitude: ll.lng, accuracy: 5 });

beforeEach(() => { resetAll(); });

describe('gpsFixIsSane', () => {
  it('drops null island and out-of-range values', () => {
    expect(gpsFixIsSane({ latitude: 0, longitude: 0 }, Date.now())).toBe(false);
    expect(gpsFixIsSane({ latitude: 91, longitude: 0 }, Date.now())).toBe(false);
    expect(gpsFixIsSane({ latitude: NaN, longitude: 1 }, Date.now())).toBe(false);
  });

  it('drops a teleport from a trusted fix', () => {
    setFix(BASE, 5);
    GPS.lastFixPosTs = 1_000_000;
    expect(gpsFixIsSane(coords(llAt(BASE, 2000)), 1_003_000)).toBe(false);   // 2 km in 3 s
    expect(gpsFixIsSane(coords(llAt(BASE, 20)), 1_003_000)).toBe(true);
  });

  it('accepts the real GPS lock after a coarse wifi/cell first fix kilometres away', () => {
    /* Regression: the lock was rejected as a "teleport" from the guess, and every later fix
       with it, so the position stayed stuck on the guess for up to a minute. */
    setFix(llAt(BASE, 2000), 1500);          // coarse = true
    GPS.lastFixPosTs = 1_000_000;
    expect(GPS.coarse).toBe(true);
    expect(gpsFixIsSane(coords(BASE), 1_003_000)).toBe(true);
  });
});
