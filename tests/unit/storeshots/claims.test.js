// @vitest-environment node
/* captions.json against the shipping app. App Store guideline 2.3 wants accurate metadata, so each
   factual claim a caption makes is checked against the code or data that makes it true. When one
   of these fails, either the app changed (re-word the caption) or the caption overclaims. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadCaptions } from '../../../tools/storeshots/listing.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const captions = loadCaptions(path.join(ROOT, 'tools/storeshots/captions.json'));
/** Everything a caption says, as one string. */
const said = (c) => [c.headline, c.subline].filter(Boolean).join(' · ');

/** Every "N-day …" claim in a caption, with the topics that run up to the next one:
 *  "10-day wind, 8-day waves" → [{ n: 10, topics: ['wind'] }, { n: 8, topics: ['wave'] }]. */
function dayClaims(text) {
  const marks = [...text.matchAll(/(\d+)-day\b/gi)];
  return marks.map((m, k) => {
    const span = text.slice(m.index + m[0].length, k + 1 < marks.length ? marks[k + 1].index : undefined).toLowerCase();
    const topics = [];
    if (/\bwinds?\b|\bweather\b|\bforecast\b/.test(span)) topics.push('wind');
    if (/\bwaves?\b|\bswells?\b|\bseas\b|\bmarine\b/.test(span)) topics.push('wave');
    if (/\btides?\b/.test(span)) topics.push('tide');
    return { n: Number(m[1]), topics };
  });
}

/** The longest forecast an Open-Meteo API is asked for anywhere in a source file. */
function requestedDays(src, api) {
  const days = [...src.matchAll(new RegExp(api.replace(/[.?/]/g, '\\$&') + "[^;]*?forecast_days=(\\d+)", 'g'))].map((m) => Number(m[1]));
  expect(days.length, `no ${api} request with forecast_days found — update this test`).toBeGreaterThan(0);
  return Math.max(...days);
}
const FORECAST_API = 'api.open-meteo.com/v1/forecast?';
const MARINE_API = 'marine-api.open-meteo.com/v1/marine?';

describe('dayClaims', () => {
  it('splits a caption into its day-count claims', () => {
    expect(dayClaims('10-day wind, 8-day waves')).toEqual([{ n: 10, topics: ['wind'] }, { n: 8, topics: ['wave'] }]);
    expect(dayClaims('10-day wind & waves')).toEqual([{ n: 10, topics: ['wind', 'wave'] }]);
    expect(dayClaims('Charts plus a 7-day wind, wave and tide pack')).toEqual([{ n: 7, topics: ['wind', 'wave', 'tide'] }]);
    expect(dayClaims('Works with zero bars')).toEqual([]);
  });
});

describe('forecast lengths', () => {
  /* Where each frame's numbers come from: the Weather panel's 10-day view (weather.js), and the
     data pack an offline download captures (areadata.js). */
  const weather = read('src/engine/weather.js');
  const pack = read('src/engine/areadata.js');
  const tideMs = /coopsHiLoUrl\([^;]*Date\.now\(\) \+ (\d+) \* 864e5/.exec(pack);
  const HORIZON = {
    weather: { wind: requestedDays(weather, FORECAST_API), wave: requestedDays(weather, MARINE_API) },
    download: { wind: requestedDays(pack, FORECAST_API), wave: requestedDays(pack, MARINE_API), tide: tideMs && Number(tideMs[1]) },
  };

  it('match what the app fetches (no "10-day waves" from an 8-day marine forecast)', () => {
    const claims = captions.screens.flatMap((c) => dayClaims(said(c)).map((d) => ({ ...d, c })));
    expect(claims.length).toBeGreaterThan(0);
    for (const { n, topics, c } of claims) {
      const have = HORIZON[c.id];
      expect(have, `${c.id}: "${said(c)}" claims ${n} days — add where that number comes from to this test`).toBeTruthy();
      expect(topics.length, `${c.id}: "${n}-day" of what?`).toBeGreaterThan(0);
      for (const t of topics) {
        expect(have[t], `${c.id}: nothing backs a ${n}-day ${t} claim`).toBeTruthy();
        expect(n, `${c.id}: "${said(c)}" claims ${n} days of ${t}, the app fetches ${have[t]}`).toBeLessThanOrEqual(have[t]);
      }
    }
  });
});

describe('night mode', () => {
  it('only dims the chart, so no caption calls the chart (or the whole app) red', () => {
    /* base.css dims the tile pane on every base but the US bathymetry one, which #lut-night darkens
       instead (and that table is a dark blue, not red). Only the chrome turns red (tokens.css). */
    const css = read('src/styles/base.css');
    const rule = /:root\[data-theme="night"\][^{]*\.leaflet-tile-pane\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'the night chart rule in base.css').not.toBeNull();
    expect(rule[1]).toMatch(/brightness\(/);
    if (/sepia|hue-rotate/.test(rule[1])) return;   // the chart really is tinted: re-think this test
    for (const c of captions.screens) {
      // within one clause, so "Red controls, dimmed chart" is fine and "the chart goes red" is not
      for (const cl of said(c).split(/[,.;·]/)) {
        expect(cl, `${c.id}: the night chart is dimmed, not red`).not.toMatch(/\b(chart|map)s?\b.*\bred\b|\bred\b.*\b(chart|map)s?\b/i);
        expect(cl, `${c.id}: only the controls go red at night`).not.toMatch(/\b(whole|entire|everything|all)\b.*\bred\b/i);
      }
    }
  });
});

describe('MPAs', () => {
  const mpas = JSON.parse(read('public/data/mpa-ca.json'));
  const fields = new Set(mpas.flatMap((m) => Object.keys(m)));
  const aboutMpas = captions.screens.filter((c) => /\bMPAs?\b|protected area|no-take|closure|reserve/i.test(said(c)));

  it('a caption sells them', () => {
    expect(aboutMpas.length).toBeGreaterThan(0);
  });
  it('the bundled data is boundaries and designations only, so no caption promises the rules', () => {
    // name, type, geometry: the card sends limited-take areas to CDFW for what may be taken there
    expect([...fields].sort()).toEqual(['g', 'n', 't']);
    for (const c of aboutMpas) {
      expect(said(c), `${c.id}: the app has no per-area take rules`).not.toMatch(/\b(rules?|regulations?|regs|limits?|seasons?|species)\b/i);
    }
  });
  it('"no-take zones" is backed by no-take designations in the data', () => {
    const notake = [...read('src/engine/reefs.js').matchAll(/'([^']+)':\s*\{[^}]*kind: 'notake'/g)].map((m) => m[1]);
    expect(notake.length).toBeGreaterThan(0);
    if (aboutMpas.some((c) => /no-take/i.test(said(c)))) expect(mpas.some((m) => notake.includes(m.t))).toBe(true);
  });
});
