// Characterisation tests for engine/bite.js — the personal bite-pattern engine and the
// conditions watch. Expected values are derived from the legacy js/bite.js maths.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setOnline, fetchRouter, gps, ui, voice } from './mocks.js';

vi.mock('../../../src/engine/gps.js', async () => (await import('./mocks.js')).gps);
vi.mock('../../../src/engine/app.js', async () => (await import('./mocks.js')).app);
vi.mock('../../../src/engine/weather.js', async () => (await import('./mocks.js')).weather);
vi.mock('../../../src/engine/voice.js', async () => (await import('./mocks.js')).voice);
vi.mock('../../../src/engine/spots.js', async () => (await import('./mocks.js')).spots);
vi.mock('../../../src/engine/db.js', async () => (await import('./mocks.js')).db);
vi.mock('../../../src/services/ui', async () => (await import('./mocks.js')).ui);
vi.mock('../../../src/services/native', async () => (await import('./mocks.js')).native);
vi.mock('../../../src/engine/nav.js', async () => (await import('./mocks.js')).nav);

const B = await import('../../../src/engine/bite.js');
const { Catch } = await import('../../../src/engine/catch.js');
const { Tides } = await import('../../../src/engine/tides.js');
const {
  Bite, Watch, biteMedian, biteQuantile, biteDist, biteProfile, biteScore, biteConfidence, biteHourIdx, biteCondAt,
  biteWindows, biteReason, biteSpokenSummary, biteFmtWindow, biteForecast, watchEvaluate, watchCheck,
  biteViewFromResult, biteStore, renderBiteWindows, BITE_FC_MAX_DEG,
} = B;

const HERE = { lat: 33.7, lng: -118.3 };
const pad = (n) => String(n).padStart(2, '0');
/** Open-Meteo style location-local ISO hour string for a device-local ms. */
const iso = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':00'; };
const hourFloor = (ms) => Math.floor(ms / 3600000) * 3600000;

/** A 10-day-pack shaped forecast: n hourly samples from `start`, values from fns of the index. */
function forecast({ start = hourFloor(Date.now()), n = 24 * 8, wind = () => 8, wave = () => 0.6, sst = () => 63, ts = Date.now(), at = HERE } = {}) {
  const time = Array.from({ length: n }, (_, i) => iso(start + i * 3600000));
  return {
    ts, lat: at.lat, lng: at.lng,
    wx: { hourly: { time, wind_speed_10m: time.map((_, i) => wind(i)), wind_direction_10m: time.map(() => 270), pressure_msl: time.map(() => 1015), cloud_cover: time.map(() => 20) } },
    marine: { hourly: { time: time.slice(), wave_height: time.map((_, i) => wave(i)), sea_surface_temperature: time.map((_, i) => sst(i)) } },
  };
}
const catches = (vals) => vals.map((sst, i) => ({ id: i + 1, lat: HERE.lat, lng: HERE.lng, ts: Date.now() - i * 86400000, species: 'Calico Bass', cond: { sst } }));

beforeEach(() => {
  localStorage.clear();
  Catch.all = [];
  Tides.stations = [];
  Watch._last = {};
  gps.GPS.lastLatLng = { ...HERE };
  voice.Voice.on = false;
  voice.voiceSay.mockClear(); ui.toast.mockClear();
  setOnline(true);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('stats helpers', () => {
  it('median / quantile / circular distance', () => {
    expect(biteMedian([])).toBeNull();
    expect(biteMedian([3, 1, 2])).toBe(2);
    expect(biteMedian([4, 1, 3, 2])).toBe(2.5);
    expect(biteQuantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(biteQuantile([0, 10], 0.8)).toBeCloseTo(8);
    expect(biteDist(0.98, 0.02, 1)).toBeCloseTo(0.04);
    expect(biteDist(350, 10, 360)).toBe(20);
    expect(biteDist(5, 2, null)).toBe(3);
  });
});

describe('biteProfile', () => {
  it('skips dimensions with fewer than 3 values', () => {
    const p = biteProfile([{ cond: { sst: 60, windKn: 5 } }, { cond: { sst: 61, windKn: 5 } }, { cond: { sst: 62 } }]);
    expect(Object.keys(p.num)).toEqual(['sst']);
    expect(p.n).toBe(3);
  });
  it('weights a tight cluster up and a scattered one down (floor 0.15)', () => {
    const tight = biteProfile(catches([62, 63, 63, 64]));
    expect(tight.num.sst.med).toBe(63);
    expect(tight.num.sst.weight).toBe(1);
    const loose = biteProfile(catches([50, 58, 66, 74, 82]));
    // IQR 16 → consistency 3/16
    expect(loose.num.sst.weight).toBeCloseTo(3 / 16);
    const wild = biteProfile(catches([10, 40, 70, 100, 130]));
    expect(wild.num.sst.weight).toBe(0.15);
  });
  it('categorical weight: a 50/50 split says nothing, 5 of 6 says a lot', () => {
    const half = biteProfile(['incoming', 'outgoing', 'incoming', 'outgoing'].map((tide) => ({ cond: { tide } })));
    expect(half.cat.tide.weight).toBe(0);
    const lean = biteProfile(['incoming', 'incoming', 'incoming', 'incoming', 'incoming', 'outgoing'].map((tide) => ({ cond: { tide } })));
    expect(lean.cat.tide.top).toBe('incoming');
    expect(lean.cat.tide.weight).toBeCloseTo((5 / 6 - 0.5) * 2);
  });
});

describe('biteScore', () => {
  const prof = biteProfile([62, 63, 63, 64].map((sst, i) => ({ cond: { sst, windKn: [5, 6, 5, 6][i] } })));
  it('1 inside tolerance, tapering to 0 at twice tolerance', () => {
    expect(biteScore(prof, { sst: 64, windKn: 5 }).score).toBe(1);
    const far = biteScore(prof, { sst: 69, windKn: 5.5 });   // 6 off with tol 3 → 0
    expect(far.hits.map((h) => h.key)).toEqual(['windKn']);
    expect(far.misses.map((h) => h.key)).toEqual(['sst']);
  });
  it('caps tolerance at 2x even when the history is scattered', () => {
    const p = { n: 5, num: { windDir: { med: 180, iqr: 170, tol: 50, period: 360, weight: 0.3 } }, cat: {} };
    // tol = min(max(50,170), 100) = 100 → 150° off scores 0.5, not 1
    expect(biteScore(p, { windDir: 330 }).score).toBeCloseTo(0.5);
  });
  it('coverage counts against the whole profile, so an hour missing water temp is not confident', () => {
    const sc = biteScore(prof, { windKn: 5 });
    expect(sc.score).toBe(1);
    expect(sc.coverage).toBeCloseTo(prof.num.windKn.weight / (prof.num.windKn.weight + prof.num.sst.weight));
    expect(sc.scoredOf).toEqual([1, 2]);
  });
});

describe('biteConfidence (honest labels)', () => {
  it('matches the legacy wording', () => {
    expect(biteConfidence(3)).toEqual({ level: 'none', label: 'not enough catches yet' });
    expect(biteConfidence(4).label).toBe('very low confidence — only 4 catches');
    expect(biteConfidence(8).label).toBe('low confidence — 8 catches');
    expect(biteConfidence(15).label).toBe('moderate confidence — 15 catches');
    expect(biteConfidence(40).label).toBe('good confidence — 40 catches');
  });
});

describe('biteHourIdx / biteCondAt', () => {
  it('never matches a sample more than 90 minutes away', () => {
    const t0 = hourFloor(Date.now());
    const times = [iso(t0), iso(t0 + 3600000), iso(t0 + 7200000)];
    expect(biteHourIdx(times, t0 + 3600000 + 20 * 60000)).toBe(1);
    expect(biteHourIdx(times, t0 + 7200000 + 89 * 60000)).toBe(2);
    expect(biteHourIdx(times, t0 + 7200000 + 91 * 60000)).toBe(-1);
    expect(biteHourIdx([], t0)).toBe(-1);
  });
  it('reconstructs forecast, tide and astronomy dimensions for an hour', () => {
    const t0 = hourFloor(Date.now()) + 3600000;
    const fc = forecast({ start: t0 - 6 * 3600000, wave: () => 1, sst: () => 61.6 });
    const tides = [{ t: t0 - 3 * 3600000, type: 'L' }, { t: t0 + 3 * 3600000, type: 'H' }];
    const c = biteCondAt(t0, HERE, fc, tides);
    expect(c).toMatchObject({ windKn: 8, windDir: 270, pressureHpa: 1015, pressureTrend3h: 0, cloudPct: 20, waveFt: 3.3, sst: 62 });
    expect(c.tide).toBe('incoming');
    expect(c.minsToTideChange).toBe(180);
    expect(c.tidePct).toBe(50);
    expect(['major', 'minor', 'off']).toContain(c.solunar);
    expect(['dawn', 'dusk', 'day', 'night']).toContain(c.lightPhase);
    expect(typeof c.moonPhase).toBe('number');
  });
  it('keeps the legacy quirk: a missing hourly wind rounds to 0 kn (ported verbatim)', () => {
    const t0 = hourFloor(Date.now());
    const fc = forecast({ start: t0, wind: () => null });
    expect(biteCondAt(t0, HERE, fc, []).windKn).toBe(0);
  });
});

describe('biteWindows', () => {
  it('refuses below 4 catches', async () => {
    Catch.all = catches([62, 63, 64]);
    const r = await biteWindows({});
    expect(r).toMatchObject({ error: 'too few', n: 3, need: 4 });
  });
  it('needs a forecast for HERE: answers at once, but still warms the bite tide cache with signal (legacy)', async () => {
    Catch.all = catches([62, 63, 63, 64]);
    Tides.stations = [{ id: 'X', n: 'x', la: 33.7, lo: -118.3 }];
    let answer = null;
    const f = vi.fn(() => new Promise((r) => { answer = r; }));
    vi.stubGlobal('fetch', f);
    expect((await biteWindows({})).error).toBe('no forecast');     // not held up by the 11-day tide call
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('tidesandcurrents');
    answer({ json: async () => ({ predictions: [{ t: '2026-10-25 06:00', type: 'H' }] }) });
    await vi.waitFor(() => expect(localStorage.getItem(Bite.TIDE_CACHE)).not.toBeNull());
    // a forecast saved for somewhere > 0.25° away is not "here" (the fresh tide cache serves the warm-up)
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({ at: { lat: HERE.lat + BITE_FC_MAX_DEG + 0.01, lng: HERE.lng } })));
    expect((await biteWindows({})).error).toBe('no forecast');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('no forecast and no signal: nothing is fetched', async () => {
    Catch.all = catches([62, 63, 63, 64]);
    Tides.stations = [{ id: 'X', n: 'x', la: 33.7, lo: -118.3 }];
    setOnline(false);
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect((await biteWindows({})).error).toBe('no forecast');
    expect(f).not.toHaveBeenCalled();
  });
  it('ranks the hours that look like your catches', async () => {
    Catch.all = catches([62, 63, 63, 64, 63]);
    const start = hourFloor(Date.now());
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({ start, sst: (i) => (i >= 30 && i < 36 ? 63 : 75) })));
    const r = await biteWindows({ limit: 4 });
    expect(r.n).toBe(5);
    expect(r.confidence.level).toBe('very low');
    expect(r.windows.length).toBe(1);
    const w = r.windows[0];
    expect(w.startMs).toBe(start + 30 * 3600000);
    expect(w.endMs).toBe(start + 36 * 3600000);   // covers the hour it ends on
    expect(w.score).toBe(1);
    expect(biteReason(w.best.hits[0])).toBe('water 63°');
  });
  it('species filter is a case-insensitive substring', async () => {
    Catch.all = [...catches([62, 63, 63, 64]), ...catches([70, 70, 70, 70]).map((c) => ({ ...c, species: 'Yellowtail' }))];
    const r = await biteWindows({ species: 'yellow' });
    expect(r.error).toBe('no forecast');
    const r2 = await biteWindows({ species: 'halibut' });
    expect(r2).toMatchObject({ error: 'too few', n: 0 });
  });
});

describe('plain-English copy', () => {
  it('biteReason', () => {
    expect(biteReason({ key: 'windKn', v: 7.6 })).toBe('wind 8 kn');
    expect(biteReason({ key: 'waveFt', v: 2 })).toBe('swell 2.0 ft');
    expect(biteReason({ key: 'pressureTrend3h', v: 1.5 })).toBe('pressure rising');
    expect(biteReason({ key: 'pressureTrend3h', v: -0.5 })).toBe('pressure steady');
    expect(biteReason({ key: 'minsFromLightChange', v: -15 })).toBe('right at first/last light');
    expect(biteReason({ key: 'minsFromLightChange', v: 45 })).toBe('45 min from light change');
    expect(biteReason({ key: 'minsToTideChange', v: 40 })).toBe('40 min off the tide turn');
    expect(biteReason({ key: 'tide', v: 'incoming' })).toBe('incoming tide');
    expect(biteReason({ key: 'solunar', v: 'off' })).toBe('outside solunar');
    expect(biteReason({ key: 'solunar', v: 'major' })).toBe('major solunar period');
    expect(biteReason({ key: 'moonPhase', v: 0.5 })).toBe('similar moon');
    expect(biteReason({ key: 'windDir', v: 270 })).toBe('wind from W');
    expect(biteReason({ key: 'cloudPct', v: 20 })).toBe('cloud');
  });
  it('biteFmtWindow is "day, start–end"', () => {
    const s = new Date(2026, 9, 25, 5, 0).getTime();
    const txt = biteFmtWindow({ startMs: s, endMs: s + 3 * 3600000 });
    expect(txt).toContain(', ');
    expect(txt).toContain('–');
  });
  it('biteSpokenSummary', () => {
    expect(biteSpokenSummary({ error: 'too few', n: 2 })).toBe('I need at least 4 logged catches with conditions before I can find your patterns. You have 2.');
    expect(biteSpokenSummary(null)).toContain('You have 0.');
    expect(biteSpokenSummary({ error: 'no forecast' })).toBe("I don't have a forecast saved for here yet — open the 10-day tab once with signal.");
    expect(biteSpokenSummary({ error: 'failed' })).toBe("I can't work out a window from what I have here.");
    expect(biteSpokenSummary({ windows: [] }, { species: 'halibut' })).toBe('Nothing in the next week looks much like your past halibut catches.');
    const s = new Date(2026, 9, 25, 5, 0).getTime();
    const res = { n: 6, confidence: biteConfidence(6), windows: [{ startMs: s, endMs: s + 7200000, best: { hits: [{ key: 'sst', v: 63 }, { key: 'tide', v: 'incoming' }] } }] };
    const txt = biteSpokenSummary(res);
    expect(txt.startsWith('Best window is ')).toBe(true);
    expect(txt).toContain('water 63°, incoming tide — matching your 6 logged catches. That is very low confidence — only 6 catches.');
  });
});

describe('panel view + request token', () => {
  it('maps results onto panel states', () => {
    expect(biteViewFromResult({ error: 'too few', n: 2, need: 4 })).toMatchObject({ status: 'too-few', n: 2, need: Bite.MIN_CATCHES });
    expect(biteViewFromResult({ error: 'no forecast' }).status).toBe('no-forecast');
    expect(biteViewFromResult({ error: 'no forecast overlap' }).status).toBe('nothing');
    expect(biteViewFromResult({ error: 'failed' }).status).toBe('nothing');
    expect(biteViewFromResult({ n: 5, windows: [] }).status).toBe('nothing');
    const s = new Date(2026, 9, 25, 5, 0).getTime();
    const v = biteViewFromResult({
      n: 5, confidence: biteConfidence(5),
      windows: [{ startMs: s, endMs: s + 3600000, score: 0.734, best: { hits: [{ key: 'sst', v: 63 }, { key: 'windKn', v: 5 }, { key: 'tide', v: 'incoming' }, { key: 'solunar', v: 'major' }] } }],
    });
    expect(v.status).toBe('ready');
    expect(v.confidence.label).toBe('very low confidence — only 5 catches');
    expect(v.windows[0]).toMatchObject({ pct: 73, reasons: ['water 63°', 'wind 5 kn', 'incoming tide'] });
  });

  it('only the newest renderBiteWindows call may publish', async () => {
    Catch.all = catches([62, 63, 63, 64]);
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({})));
    Tides.stations = [{ id: 'X', n: 'x', la: 33.7, lo: -118.3 }];
    let release;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', fetchRouter([['tidesandcurrents', async () => { await gate; return { predictions: [] }; }]]));
    const slow = renderBiteWindows();
    expect(biteStore.getState().status).toBe('loading');
    Catch.all = catches([62]);
    await renderBiteWindows();
    expect(biteStore.getState()).toMatchObject({ status: 'too-few', n: 1 });
    release();
    await slow;
    expect(biteStore.getState().status).toBe('too-few');
  });
});

describe('conditions watch', () => {
  it('wind building: ≥18 kn AND ≥6 kn rise within 3 h; swell second', () => {
    const t0 = hourFloor(Date.now());
    const fc = forecast({ start: t0, wind: (i) => [10, 12, 15, 19, 25][i] ?? 25 });
    const a = watchEvaluate(fc, t0);
    expect(a.type).toBe('wind');
    expect(a.msg.startsWith('Heads up — wind is building. 10 knots now, 19 by ')).toBe(true);
    expect(a.msg.endsWith('. Worth thinking about heading in.')).toBe(true);
    expect(watchEvaluate(forecast({ start: t0, wind: (i) => [14, 16, 18, 18][i] ?? 18 }), t0)).toBeNull();   // rise only 4
    const swell = watchEvaluate(forecast({ start: t0, wind: () => 8, wave: (i) => [1.0, 1.5, 2.0][i] ?? 2.0 }), t0);
    expect(swell.type).toBe('wave');
    expect(swell.msg.startsWith('Swell is building — 3.3 feet now, 6.6 by ')).toBe(true);
    // both building: wind wins
    expect(watchEvaluate(forecast({ start: t0, wind: (i) => [10, 20][i] ?? 20, wave: (i) => [1.0, 2.0][i] ?? 2.0 }), t0).type).toBe('wind');
    expect(watchEvaluate(null, t0)).toBeNull();
  });

  it('biteForecast only accepts a forecast for here (≤0.25°) and now (≤6 h)', () => {
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({})));
    expect(biteForecast(HERE)).not.toBeNull();
    expect(biteForecast({ lat: HERE.lat, lng: HERE.lng + 0.3 })).toBeNull();
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({ ts: Date.now() - 7 * 3600000 })));
    expect(biteForecast(HERE)).toBeNull();
    localStorage.setItem('fishapp.fc10', JSON.stringify({ ...forecast({}), lat: null }));
    expect(biteForecast(HERE)).toBeNull();
  });

  it('watchCheck: live fix + visible page + fresh local forecast; 2 h cooldown; speak OR toast', () => {
    const t0 = hourFloor(Date.now());
    // now matches sample 0 or 1 depending on the minute; either way 10 kn now, 20 within 3 h
    localStorage.setItem('fishapp.fc10', JSON.stringify(forecast({ start: t0, wind: (i) => (i <= 1 ? 10 : 20) })));
    gps.GPS.lastLatLng = null;
    expect(watchCheck()).toBeNull();                         // no GPS: never the map centre
    gps.GPS.lastLatLng = { ...HERE };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    expect(watchCheck()).toBeNull();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    const a = watchCheck();
    expect(a.type).toBe('wind');
    expect(ui.toast).toHaveBeenCalledTimes(1);
    // the legacy warning emoji became a word (never colour/emoji alone) + the alert tone
    expect(ui.toast.mock.calls[0][0]).toBe('Warning: ' + a.msg);
    expect(ui.toast.mock.calls[0][0]).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(ui.toast.mock.calls[0][1]).toMatchObject({ ms: 9000, tone: 'alert' });
    expect(voice.voiceSay).not.toHaveBeenCalled();
    expect(watchCheck()).toBeNull();                         // cooldown
    Watch._last = {};
    voice.Voice.on = true;
    watchCheck();
    expect(voice.voiceSay).toHaveBeenCalledTimes(1);
    expect(ui.toast).toHaveBeenCalledTimes(1);               // never both
  });
});
