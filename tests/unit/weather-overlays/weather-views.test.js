// @vitest-environment jsdom
/* Characterisation tests for the Now/24h and 10-day view models (legacy renderWeather /
   renderForecast10 / fc3hStrip, minus the HTML). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nowPayload, fc10Payload, isoHour } from './fixtures.js';

vi.mock('../../../src/engine/gps.js', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    GPS: { lastLatLng: null },
    gpsStore: createStore(() => ({ fixAt: 0 })),
    formatCoord: (v) => v.toFixed(3),
    nmBetween: () => 0,
  };
});
vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null, readJSON: (k, f) => f }));
vi.mock('../../../src/engine/layers.js', () => ({ setDataOverlay: vi.fn(), reportDataOverlay: vi.fn() }));

import { nowView, forecast10View, fc3hStrip, renderWeather, renderForecast10, wxStore, MS_TO_FT } from '../../../src/engine/weather.js';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-25T10:30:00')); });
afterEach(() => { vi.useRealTimers(); });

describe('nowView', () => {
  it('current conditions, rounded, unknown kept as null (never 0)', () => {
    const p = nowPayload();
    p.wx.current.wind_gusts_10m = null;
    p.marine.current.wave_period = null;
    const { current } = nowView(p);
    expect(current.windKn).toBe(12);
    expect(current.windFromDeg).toBe(315);
    expect(current.gustKn).toBeNull();
    expect(current.tempF).toBe(66);
    expect(current.waveFt).toBeCloseTo(1 * MS_TO_FT, 5);
    expect(current.wavePerS).toBeNull();            // legacy: don't invent "@ 0s"
    expect(current.waveFromDeg).toBe(270);
    expect(current.swellFt).toBeCloseTo(0.8 * MS_TO_FT, 5);
    expect(current.swellPerS).toBe(12);
  });

  it('no marine payload: waves unknown', () => {
    const p = nowPayload(); p.marine = null;
    const { current } = nowView(p);
    expect(current.waveFt).toBeNull();
    expect(current.hasMarine).toBe(false);
  });

  it('next 24 h: starts at the current hour (≤ 1 h back) and stops at 24 rows', () => {
    const { hours } = nowView(nowPayload());
    expect(hours).toHaveLength(24);
    expect(hours[0].key).toBe(isoHour('2026-10-25', 10));
    expect(hours[23].key).toBe(isoHour('2026-10-25', 33));
  });

  it('matches marine readings by TIME, not array index', () => {
    const { hours } = nowView(nowPayload());
    // marine hour h has wave_height h/10 m regardless of where it sits in the marine array
    expect(hours[0].waveFt).toBeCloseTo(1.0 * MS_TO_FT, 5);   // 10:00 → 1.0 m
    expect(hours[1].waveFt).toBeCloseTo(1.1 * MS_TO_FT, 5);
  });

  it('a missing hourly value is null, not 0', () => {
    const p = nowPayload();
    p.wx.hourly.wind_speed_10m[10] = null;
    p.wx.hourly.wind_gusts_10m[10] = null;
    p.wx.hourly.precipitation_probability[10] = null;
    p.wx.hourly.temperature_2m[10] = null;
    const h = nowView(p).hours[0];
    expect(h.windKn).toBeNull();
    expect(h.gustKn).toBeNull();
    expect(h.rainPct).toBeNull();
    expect(h.tempF).toBeNull();
  });

  it('marks strong wind and gusts from the DISPLAYED figure (no colour in the panel)', () => {
    const p = nowPayload();
    p.wx.current.wind_speed_10m = 19.6;   // shows "20" → rough
    p.wx.current.wind_gusts_10m = 28.2;
    const { current, hours } = nowView(p);
    expect(current).toMatchObject({ windKn: 20, windRough: true, windBand: 2, gustKn: 28, gustRough: true, gustBand: 4 });
    // hourly fixture: wind 5 + i/2 kn, gusts 9 + i/2 kn; rows start at 10:00 (i = 10)
    expect(hours[0]).toMatchObject({ windKn: 10, windRough: false, windBand: 1, gustKn: 14, gustRough: false, gustBand: 2 });
    const firstRoughWind = hours.find((h) => h.windRough);
    expect(firstRoughWind.windKn).toBe(20);
    p.wx.current.wind_gusts_10m = null;
    expect(nowView(p).current).toMatchObject({ gustKn: null, gustBand: null, gustRough: false });
  });

  it('summary figures for the strip', () => {
    const { current, hours } = nowView(nowPayload());
    expect(current.rainPctNow).toBe(hours[0].rainPct);
    expect(current.maxWind24).toBe(Math.max(...hours.map((h) => h.windKn)));
    expect(current.maxGust24).toBe(Math.max(...hours.map((h) => h.gustKn)));
  });

  it('throws on a structurally broken payload (poisoned-cache guard relies on it)', () => {
    expect(() => nowView({ wx: {} })).toThrow();
    expect(() => nowView({ wx: { current: {} } })).toThrow();
  });

  it('renderWeather publishes plain data (no HTML) to wxStore', () => {
    renderWeather(nowPayload());
    const s = wxStore.getState().now;
    expect(s.status).toBe('ready');
    expect(JSON.stringify(s)).not.toMatch(/<\w/);
  });
});

describe('forecast10View', () => {
  it('labels from the actual date and drops past days', () => {
    const days = forecast10View(fc10Payload());
    expect(days).toHaveLength(9);                   // yesterday dropped
    expect(days[0].key).toBe('2026-10-25');
    expect(days[0].wd).toBe('Today');
    expect(days[1].wd).toBe('Tomorrow');
    expect(days[2].wd).not.toMatch(/Today|Tomorrow/);
    expect(days[0].md2).toMatch(/25/);
  });

  it('marks day 7 and later as long range', () => {
    const days = forecast10View(fc10Payload());
    expect(days.filter((d) => d.longRange).map((d) => d.dayOut)).toEqual([7, 8]);
    expect(days[6].longRange).toBe(false);
  });

  it('missing daily values are null, not 0 kn / 0°', () => {
    const days = forecast10View(fc10Payload());
    const d = days.find((x) => x.key === '2026-10-29');   // the null wind day
    expect(d.windMax).toBeNull();
    expect(d.gust).toBeNull();
    expect(days[0].wavePer).toBe(11);
    expect(days[1].wavePer).toBeNull();                  // null period stays null
  });

  it('matches daily marine by date, not by index', () => {
    const days = forecast10View(fc10Payload());
    // the marine day list starts one day later than the forecast's
    expect(days[0].waveFt).toBeCloseTo(0.6 * MS_TO_FT, 5);
    expect(days[1].waveFt).toBeCloseTo(1.6 * MS_TO_FT, 5);
  });

  it('flags rough days: wind ≥ 20 kn or waves ≥ 5 ft', () => {
    const days = forecast10View(fc10Payload());
    const by = Object.fromEntries(days.map((d) => [d.key, d]));
    expect(by['2026-10-25'].rough).toBe(false);   // 10 kn, 2.0 ft
    expect(by['2026-10-26'].rough).toBe(true);    // 22 kn
    expect(by['2026-10-27'].rough).toBe(false);   // 12 kn, 3.3 ft
    expect(by['2026-10-28'].rough).toBe(false);   // 19 kn, 4.9 ft
    expect(by['2026-10-26'].waveFt).toBeGreaterThanOrEqual(5);
  });

  it('carries the extras: icon/desc, rain chance and amount, water temp at noon, UV, sun times', () => {
    const d = forecast10View(fc10Payload())[0];
    expect(d.icon).toBe('sun');
    expect(d.desc).toBe('Clear');
    expect(d.pop).toBe(10);
    expect(d.sst).toBe(63);
    expect(d.uv).toBe(5);
    expect(d.sunrise).toMatch(/6:58/);
    expect(d.hi).toBe(70);
    expect(d.lo).toBe(61);
    expect(d.wdir).toBe('NW');
  });

  it('throws on a broken payload (poisoned-cache guard)', () => {
    const p = fc10Payload();
    delete p.wx.daily.wind_speed_10m_max;
    expect(() => forecast10View(p)).toThrow();
  });

  it('renderForecast10 publishes to wxStore', () => {
    renderForecast10(fc10Payload());
    expect(wxStore.getState().fc10.days).toHaveLength(9);
  });
});

describe('fc3hStrip', () => {
  it('returns the 00/03/…/21 rows of one day, unknown wind as null', () => {
    const p = fc10Payload();
    const rows = fc3hStrip(p.wx.hourly, p.marine.hourly, '2026-10-25');
    expect(rows.map((r) => r.key.slice(11, 13))).toEqual(['00', '03', '06', '09', '12', '15', '18', '21']);
    expect(rows[2].windKn).toBeNull();               // 06:00 has no wind value
    expect(rows[0].windKn).toBe(8);
    expect(rows[0].waveFt).toBeCloseTo(0.7 * MS_TO_FT, 5);
    expect(rows[0]).toMatchObject({ windBand: 1, windRough: false, gustBand: 1, gustRough: false });
    expect(rows[2]).toMatchObject({ windBand: null, windRough: false });   // unknown is never "calm" or "rough"
  });
  it('flags a strong 3-hourly wind or gust', () => {
    const p = fc10Payload();
    const i = p.wx.hourly.time.indexOf('2026-10-25T12:00');
    p.wx.hourly.wind_speed_10m[i] = 22.4;
    p.wx.hourly.wind_gusts_10m[i] = 31;
    const row = fc3hStrip(p.wx.hourly, p.marine.hourly, '2026-10-25').find((r) => r.key === '2026-10-25T12:00');
    expect(row).toMatchObject({ windKn: 22, windRough: true, windBand: 3, gustKn: 31, gustRough: true, gustBand: 4 });
  });
  it('handles a missing hourly block', () => {
    expect(fc3hStrip(null, null, '2026-10-25')).toEqual([]);
  });
});
