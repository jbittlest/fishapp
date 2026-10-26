// @vitest-environment jsdom
/* Characterisation tests for the pure weather formatters (legacy weather.js). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/engine/gps.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    GPS: { lastLatLng: null },
    gpsStore: createStore(() => ({ fixAt: 0 })),
    formatCoord: (v, axis) => v.toFixed(3) + (axis === 'lat' ? 'N' : 'W'),
    nmBetween: (a, b) => a.distanceTo(b) / 1852,
  };
});
vi.mock('../../../src/engine/app.js', () => ({
  getMap: () => null,
  readJSON: (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },
}));
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));

import {
  windColor, windBand, windRough, windCues, wxNum, wxRound, dirArrow, compass, wmoIcon, fcHourIdx, wxAgeLabel, wxIsStale, wxCacheFor,
  longRangeNote, MS_TO_FT, ROUGH_WIND_KN, ROUGH_WAVE_FT, windHourLabel,
} from '../../../src/engine/weather.js';

describe('windColor (speed bands, unknown is grey)', () => {
  it('maps the legacy bands', () => {
    expect(windColor(0)).toBe('#4aa3e0');
    expect(windColor(6.9)).toBe('#4aa3e0');
    expect(windColor(7)).toBe('#3dd464');
    expect(windColor(13.99)).toBe('#3dd464');
    expect(windColor(14)).toBe('#e8c93d');
    expect(windColor(20.9)).toBe('#e8c93d');
    expect(windColor(21)).toBe('#f2803d');
    expect(windColor(27.9)).toBe('#f2803d');
    expect(windColor(28)).toBe('#e8453d');
  });
  it('never paints unknown as calm blue or stay-home red', () => {
    expect(windColor(null)).toBe('#8a9aa8');
    expect(windColor(undefined)).toBe('#8a9aa8');
    expect(windColor(NaN)).toBe('#8a9aa8');
  });
});

describe('windBand / windRough (the panel cue that replaces the legacy card colours)', () => {
  const COLORS = ['#4aa3e0', '#3dd464', '#e8c93d', '#f2803d', '#e8453d'];
  it('uses exactly the windColor thresholds', () => {
    for (const kn of [0, 3, 6.9, 7, 10, 13.99, 14, 17, 20.9, 21, 25, 27.9, 28, 40]) {
      expect(COLORS[windBand(kn)]).toBe(windColor(kn));
    }
  });
  it('unknown has no band and is never rough', () => {
    expect(windBand(null)).toBeNull();
    expect(windBand(undefined)).toBeNull();
    expect(windBand(NaN)).toBeNull();
    expect(windRough(null)).toBe(false);
    expect(windRough(NaN)).toBe(false);
  });
  it('rough at the rough-day wind threshold (20 kn), for wind and gusts alike', () => {
    expect(windRough(ROUGH_WIND_KN - 1)).toBe(false);
    expect(windRough(ROUGH_WIND_KN)).toBe(true);
    expect(windCues(12, 25)).toEqual({ windBand: 1, gustBand: 3, windRough: false, gustRough: true });
    expect(windCues(null, 30)).toEqual({ windBand: null, gustBand: 4, windRough: false, gustRough: true });
  });
});

describe('wxNum / wxRound — unknown is a dash, never 0', () => {
  it('wxNum', () => {
    expect(wxNum(null)).toBe('—');
    expect(wxNum(undefined, ' kn')).toBe('—');
    expect(wxNum(NaN)).toBe('—');
    expect(wxNum(12.6, ' kn')).toBe('13 kn');
    expect(wxNum(0)).toBe('0');
    expect(wxNum(3.14159, ' ft', 1)).toBe('3.1 ft');
  });
  it('wxRound', () => {
    expect(wxRound(null)).toBeNull();
    expect(wxRound(undefined)).toBeNull();
    expect(wxRound(NaN)).toBeNull();
    expect(wxRound(Infinity)).toBeNull();
    expect(wxRound(0)).toBe(0);
    expect(wxRound(12.5)).toBe(13);
  });
});

describe('direction helpers (meteo FROM; arrows point where it goes)', () => {
  it('dirArrow: a north wind blows toward the south', () => {
    expect(dirArrow(0)).toBe('↓');
    expect(dirArrow(90)).toBe('←');
    expect(dirArrow(180)).toBe('↑');
    expect(dirArrow(270)).toBe('→');
    expect(dirArrow(360)).toBe('↓');
    expect(dirArrow(null)).toBe('');
    expect(dirArrow(NaN)).toBe('');
  });
  it('compass', () => {
    expect(compass(0)).toBe('N');
    expect(compass(44)).toBe('NE');
    expect(compass(337.4)).toBe('NW');
    expect(compass(337.5)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(null)).toBe('—');
    expect(compass(undefined)).toBe('—');
  });
});

describe('wmoIcon', () => {
  it('describes WMO codes with line-icon names (no emoji)', () => {
    expect(wmoIcon(0)).toEqual(['sun', 'Clear']);
    expect(wmoIcon(2)[1]).toBe('Mostly clear');
    expect(wmoIcon(3)[1]).toBe('Overcast');
    expect(wmoIcon(48)[1]).toBe('Fog');
    expect(wmoIcon(55)[1]).toBe('Drizzle');
    expect(wmoIcon(63)[1]).toBe('Rain');
    expect(wmoIcon(75)[1]).toBe('Snow');
    expect(wmoIcon(81)[1]).toBe('Showers');
    expect(wmoIcon(86)[1]).toBe('Snow showers');
    expect(wmoIcon(99)).toEqual(['cloud-lightning', 'Thunderstorm']);
    expect(wmoIcon(42)[1]).toBe('Partly cloudy');
    for (const c of [0, 1, 3, 45, 51, 61, 71, 80, 85, 95, 7]) {
      expect(wmoIcon(c)[0]).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('fcHourIdx matches by timestamp', () => {
  it('finds the exact time or -1', () => {
    expect(fcHourIdx(['a', 'b', 'c'], 'b')).toBe(1);
    expect(fcHourIdx(['a'], 'z')).toBe(-1);
    expect(fcHourIdx(null, 'a')).toBe(-1);
  });
});

describe('wxAgeLabel / wxIsStale', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-25T12:00:00')); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('fresh within 10 minutes', () => {
    expect(wxAgeLabel(Date.now() - 10 * 60000, 'fresh')).toBe('fresh');
    expect(wxIsStale(Date.now() - 10 * 60000)).toBe(false);
    expect(wxIsStale(Date.now() - 11 * 60000)).toBe(true);
  });
  it('minutes / hours / days, "refreshing" only while a refresh is in flight', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f', false, true)).toBe('Saved forecast from 40 min ago — refreshing…');
    expect(wxAgeLabel(Date.now() - 121 * 60000, 'f', false, true)).toBe('Saved forecast from 2 hours ago — refreshing…');
    expect(wxAgeLabel(Date.now() - 2881 * 60000, 'f', false, true)).toBe('Saved forecast from 2 days ago — refreshing…');
    // online, nothing running (e.g. just reconnected): no false "refreshing…" claim
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f')).toBe('Saved forecast from 40 min ago');
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f', false, false)).toBe('Saved forecast from 40 min ago');
  });
  it('says offline only when offline, and admits a failed refresh', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f')).toBe('Saved forecast from 40 min ago (offline)');
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f', true, true)).toBe('Saved forecast from 40 min ago (offline)');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f', true)).toBe('Saved forecast from 40 min ago — couldn’t refresh');
    // a retry in flight after a failure says it is refreshing
    expect(wxAgeLabel(Date.now() - 40 * 60000, 'f', true, true)).toBe('Saved forecast from 40 min ago — refreshing…');
  });
  it('contains no emoji', () => {
    expect(wxAgeLabel(Date.now() - 400 * 60000, 'f')).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('wxCacheFor — never another place, age-capped online', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-25T12:00:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('accepts a payload within 0.25° and the age cap', () => {
    localStorage.setItem('k', JSON.stringify({ lat: 33.7, lng: -118.3, ts: Date.now() - 3600000, x: 1 }));
    expect(wxCacheFor('k', { lat: 33.9, lng: -118.1 }, 12 * 3600000)).toMatchObject({ x: 1 });
  });
  it('rejects another location', () => {
    localStorage.setItem('k', JSON.stringify({ lat: 33.7, lng: -118.3, ts: Date.now() }));
    expect(wxCacheFor('k', { lat: 34.0, lng: -118.3 }, null)).toBeNull();
    expect(wxCacheFor('k', { lat: 33.7, lng: -118.6 }, null)).toBeNull();
  });
  it('rejects old payloads only when an age cap is given (offline = any age)', () => {
    localStorage.setItem('k', JSON.stringify({ lat: 33.7, lng: -118.3, ts: Date.now() - 13 * 3600000 }));
    expect(wxCacheFor('k', { lat: 33.7, lng: -118.3 }, 12 * 3600000)).toBeNull();
    expect(wxCacheFor('k', { lat: 33.7, lng: -118.3 }, null)).not.toBeNull();
  });
  it('rejects a payload with no location, and survives garbage', () => {
    localStorage.setItem('k', JSON.stringify({ ts: Date.now() }));
    expect(wxCacheFor('k', { lat: 0, lng: 0 }, null)).toBeNull();
    localStorage.setItem('k', '{not json');
    expect(wxCacheFor('k', { lat: 0, lng: 0 }, null)).toBeNull();
  });
});

describe('constants and copy', () => {
  it('keeps the shared conversion and the rough-day thresholds', () => {
    expect(MS_TO_FT).toBe(3.28084);
    expect(ROUGH_WIND_KN).toBe(20);
    expect(ROUGH_WAVE_FT).toBe(5);
  });
  it('long-range note is the legacy sentence', () => {
    expect(longRangeNote(8)).toBe('~ 8 days out — long-range model output. Treat this as a trend, not a temperature; it typically shifts several degrees per day as the date nears.');
  });
  it('wind loop hour label has no play marker', () => {
    expect(windHourLabel('2026-10-26T15:00')).not.toMatch(/▸/);
  });
});
