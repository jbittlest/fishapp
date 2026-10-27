/* tools/web/places.mjs: place records from the bundled CDFW data, region grouping, and the generated
 * pages — escaped names, the agreed shared-spot link, CDFW links, and no facts the data lacks.
 * Also pins the generator's copies of the MPA tables to engine/reefs.js (Node can't import it). */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/engine/gps.js', async () => (await import('../data-spots-offline/_mocks.js')).gpsMock());
vi.mock('../../../src/engine/app.js', async () => (await import('../data-spots-offline/_mocks.js')).appMock());
vi.mock('../../../src/engine/nav.js', async () => (await import('../data-spots-offline/_mocks.js')).navMock());
vi.mock('../../../src/engine/goto.js', async () => (await import('../data-spots-offline/_mocks.js')).gotoMock());
vi.mock('../../../src/engine/layers.js', async () => (await import('../data-spots-offline/_mocks.js')).layersMock());
vi.mock('../../../src/engine/inspect.js', async () => (await import('../data-spots-offline/_mocks.js')).inspectMock());
vi.mock('../../../src/engine/weather.js', async () => (await import('../data-spots-offline/_mocks.js')).weatherMock());
vi.mock('../../../src/engine/spots.js', () => ({ openSpotModal: vi.fn() }));

const engine = await import('../../../src/engine/reefs.js');
const P = await import('../../../tools/web/places.mjs');
const { insidePolygons } = await import('../../../tools/web/geo.mjs');

const ROOT = path.resolve(__dirname, '../../..');
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8'));
const MPAS = data('mpa-ca.json');
const REEFS = data('reefs-ca.json');
const SITE = { brandName: 'Brand<X>', siteUrl: 'https://example.test/fishapp/' };
const CTX = (all) => ({ site: SITE, css: 'site/site.test.css', all, notice: 'Not for navigation.', credit: 'Data credit.' });

const square = (lng, lat, d = 0.01) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] });

describe('tables match the app', () => {
  it('MPA designation names and the CDFW link are the engine’s', () => {
    expect(P.MPA_TYPE_NAMES).toEqual(engine.MPA_TYPE_NAMES);
    expect(P.CDFW_MPA_URL).toBe(engine.CDFW_MPA_URL);
  });
});

describe('regionOf (CDFW MPA regions)', () => {
  it.each([
    ['Pyramid Point SMCA', 41.98, -124.255, 'north-coast'],
    ['Point Arena SMR', 38.96, -123.753, 'north-central-coast'],
    ['Montara SMR', 37.521, -122.547, 'north-central-coast'],
    ['Pillar Point SMCA', 37.487, -122.537, 'north-central-coast'],
    ['Bair Island SMP', 37.526, -122.222, 'san-francisco-bay'],
    ['Corte Madera Marsh SMP', 37.933, -122.499, 'san-francisco-bay'],
    ['Duxbury Reef SMCA', 37.904, -122.729, 'north-central-coast'],
    ['Año Nuevo SMR', 37.1, -122.319, 'central-coast'],
    ['Vandenberg SMR', 34.663, -120.643, 'central-coast'],
    ['Point Conception SMR', 34.424, -120.469, 'south-coast'],
    ['Kashtayit SMCA', 34.463, -120.224, 'south-coast'],
    ['Richardson Rock SMR', 34.096, -120.519, 'south-coast'],
    ['Cabrillo SMR', 32.667, -117.246, 'south-coast'],
  ])('%s → %s', (_n, lat, lng, region) => {
    expect(P.regionOf(lat, lng)).toBe(region);
  });
});

describe('buildPlaces on the bundled data', () => {
  const places = P.buildPlaces(MPAS, REEFS);
  const mpas = places.filter((p) => p.kind === 'mpa');
  const reefs = places.filter((p) => p.kind === 'reef');

  it('one page per MPA and per named reef (multi-module reefs are one reef)', () => {
    expect(mpas).toHaveLength(MPAS.length);
    expect(reefs).toHaveLength(new Set(REEFS.map((r) => r.n)).size);
    const wheeler = reefs.find((p) => p.name === 'SONGS Wheeler North Reef');
    expect(wheeler.points.length).toBe(REEFS.filter((r) => r.n === 'SONGS Wheeler North Reef').length);
    expect(wheeler.slug).toBe('songs-wheeler-north-reef');
  });
  it('slugs are unique, URL-safe and reefs say what they are', () => {
    const slugs = places.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(reefs.find((p) => p.name === 'Carlsbad').slug).toBe('carlsbad-artificial-reef');
    expect(places.find((p) => p.name === 'Año Nuevo SMR').slug).toBe('ano-nuevo-smr');
  });
  it('every MPA centre point lies on its own outline', () => {
    for (const p of mpas) expect(insidePolygons(p.centre, p.polys), p.name).toBe(true);
  });
  it('every place gets a region; all five regions are used', () => {
    const ids = new Set(P.REGIONS.map((r) => r.id));
    for (const p of places) expect(ids.has(p.region), p.name).toBe(true);
    expect(new Set(places.map((p) => p.region)).size).toBe(5);
  });
});

describe('place pages', () => {
  const evil = '<img src=x onerror=alert(1)> "Q" & Co';
  const all = P.buildPlaces(
    [{ n: evil + ' SMR', t: 'SMR', g: square(-118.4, 33.7) },
      { n: 'Ruled SMCA', t: 'SMCA', g: square(-118.38, 33.7), reg: 'Take of <b>lobster</b> allowed', url: 'https://wildlife.ca.gov/x' }],
    [{ n: evil + ' Reef', la: 33.71, lo: -118.39, d: 60, c: 'Quarry Rock, Concrete' },
      { n: 'Bare', la: 33.72, lo: -118.38 }],
  );
  const [mpa, ruled, reef, bare] = all;

  it('escapes names everywhere (title, H1, lists, SVG, JSON-LD)', () => {
    for (const html of [P.placePage(mpa, CTX(all)), P.placePage(reef, CTX(all)), P.placesIndex(all, CTX(all))]) {
      expect(html).not.toContain('<img src=x');
      expect(html).not.toMatch(/<b>lobster|Brand<X>/);
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
  it('a reef’s Open link is the shared-spot link at the centre point, attribute-escaped', () => {
    const html = P.placePage(reef, CTX(all));
    const href = 'https://example.test/fishapp/#s=33.71000,-118.39000&n=' + encodeURIComponent(reef.name);
    expect(html).toContain(`href="${href.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}">Open in Brand&lt;X&gt;</a>`);
  });
  it('a protected area only frames the chart (#v= its outline box): never a spot to save or navigate to', () => {
    for (const p of [mpa, ruled]) {
      const html = P.placePage(p, CTX(all));
      const b = p.box, f = (x) => x.toFixed(5);
      const href = `https://example.test/fishapp/#v=${f(b.minLat)},${f(b.minLng)},${f(b.maxLat)},${f(b.maxLng)}`;
      expect(html).toContain(`<a class="btn primary" href="${href}">View on the Brand&lt;X&gt; chart</a>`);
      expect(html).not.toContain('#s=');
      expect(html).not.toContain('Open in Brand');
    }
    expect(P.placePage(mpa, CTX(all))).toContain('#v=33.70000,-118.40000,33.71000,-118.39000"');
  });
  it('MPA pages link CDFW (the data URL when present) and only show a rule summary the data has', () => {
    const plain = P.placePage(mpa, CTX(all));
    expect(plain).toContain('href="https://wildlife.ca.gov/Conservation/Marine/MPAs"');
    expect(plain).toContain('not summarised here');
    const withRegs = P.placePage(ruled, CTX(all));
    expect(withRegs).toContain('href="https://wildlife.ca.gov/x"');
    expect(withRegs).toContain('Take of &lt;b&gt;lobster&lt;/b&gt; allowed <em>(summary — check CDFW for current rules)</em>');
  });
  it('reef facts come from the data only', () => {
    const html = P.placePage(reef, CTX(all));
    expect(html).toContain('<dt>Listed depth</dt><dd>60 ft</dd>');
    expect(html).toContain('<dt>Materials</dt><dd>Quarry Rock, Concrete</dd>');
    const none = P.placePage(bare, CTX(all));
    expect(none).not.toContain('Listed depth');
    expect(none).not.toContain('Materials');
    expect(none).not.toContain('Fishing rules');
  });
  it('designation labels never nest parentheses', () => {
    const [noTake, smr] = P.buildPlaces(
      [{ n: 'Point Vicente SMCA (No-Take)', t: 'SMCA (No-Take)', g: square(-118.43, 33.72) },
        { n: 'Abalone Cove SMR', t: 'SMR', g: square(-118.38, 33.73) }], []);
    const html = P.placePage(noTake, CTX([noTake, smr]));
    expect(html).toContain('<p class="eyebrow">State Marine Conservation Area, no-take (SMCA)</p>');
    expect(html).not.toContain('(SMCA (No-Take))');
    expect(P.placeDescription(noTake, 'B')).toMatch(/^Point Vicente SMCA \(No-Take\), State Marine Conservation Area \(no-take\): boundary map/);
    expect(P.placePage(smr, CTX([noTake, smr]))).toContain('<p class="eyebrow">State Marine Reserve (SMR)</p>');
  });
  it('titles and descriptions are search-friendly and short', () => {
    expect(P.placeTitle(ruled, 'B')).toBe('Ruled SMCA MPA map & boundaries — B');
    expect(P.placeTitle(bare, 'B')).toBe('Bare artificial reef GPS coordinates & map — B');
    for (const p of all) expect(P.placeDescription(p, 'B').length).toBeLessThanOrEqual(158);
  });
  it('carries canonical, Open Graph and Place JSON-LD; relative links stay inside the site', () => {
    const html = P.placePage(ruled, CTX(all));
    expect(html).toContain(`<link rel="canonical" href="https://example.test/fishapp/places/${ruled.slug}.html">`);
    expect(html).toContain('<meta property="og:image" content="https://example.test/fishapp/og.png">');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    expect(ld['@graph'][0]).toMatchObject({ '@type': 'Place', name: 'Ruled SMCA', geo: { '@type': 'GeoCoordinates' } });
    expect(html).not.toContain('apple-itunes-app');
  });
  it('the index groups by region and links every place', () => {
    const html = P.placesIndex(all, CTX(all));
    for (const p of all) expect(html).toContain(`href="${p.slug}.html"`);
    expect(html).toContain('id="south-coast"');
    expect(html).not.toContain('id="north-coast"');   // empty regions are left out
  });
});
