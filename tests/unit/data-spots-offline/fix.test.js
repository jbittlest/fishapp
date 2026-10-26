/* "From you" honesty (features/spots/useFix): the spot and reef cards and lists read the last fix
 * from gpsStore, which keeps lat/lng when the fix is lost. These pin when a distance may be shown
 * as live and what the subtitle says otherwise (DESIGN §0.7: never show a stale value as live). */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/engine/gps.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return { gpsStore: createStore(() => ({ status: 'searching', lat: null, lng: null, fixAt: 0 })) };
});

const F = await import('../../../src/features/spots/useFix');

describe('fixInfo', () => {
  const now = 1_000_000;
  it('a fresh fix is live', () => {
    expect(F.fixInfo('fix', 33.7, -118.4, now - 2000, now)).toEqual({ here: { lat: 33.7, lng: -118.4 }, live: true, ageMs: 2000 });
    expect(F.fixInfo('fix', 33.7, -118.4, now - F.FIX_FRESH_MS, now).live).toBe(true);
  });
  it('goes stale after the HUD threshold (10 s) even while the status still says fix', () => {
    expect(F.FIX_FRESH_MS).toBe(10_000);
    expect(F.fixInfo('fix', 33.7, -118.4, now - 10_001, now).live).toBe(false);
  });
  it('a lost or denied fix keeps its last position but is never live', () => {
    const lost = F.fixInfo('lost', 33.7, -118.4, now - 3000, now);
    expect(lost.here).toEqual({ lat: 33.7, lng: -118.4 });
    expect(lost.live).toBe(false);
    expect(F.fixInfo('denied', 33.7, -118.4, now - 3000, now).live).toBe(false);
  });
  it('no position at all', () => {
    expect(F.fixInfo('searching', null, null, 0, now)).toEqual({ here: null, live: false, ageMs: Infinity });
  });
});

describe('copy', () => {
  it('fixAgeText', () => {
    expect(F.fixAgeText(8000)).toBe('8 s');
    expect(F.fixAgeText(185_000)).toBe('3 min');
    expect(F.fixAgeText(2.2 * 3600_000)).toBe('2 h');
    expect(F.fixAgeText(Infinity)).toBe('');
  });
  it('fromText says "from you" only for a live fix', () => {
    expect(F.fromText({ here: { lat: 1, lng: 2 }, live: true, ageMs: 1000 })).toBe('from you');
    expect(F.fromText({ here: { lat: 1, lng: 2 }, live: false, ageMs: 240_000 })).toBe('from your last fix (4 min ago)');
    expect(F.fromText({ here: { lat: 1, lng: 2 }, live: false, ageMs: Infinity })).toBe('from your last fix');
  });
});
