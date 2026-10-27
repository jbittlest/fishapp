/* The offline area pack asks each source the way the live app does: iNaturalist for openly
 * licensed photos only (the same query as the sightings overlay), NOAA CO-OPS with the app's
 * application= id. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

vi.mock('../../../src/engine/db.js', async () => (await import('./_mocks.js')).dbMock());
vi.mock('../../../src/engine/gps.js', async () => (await import('./_mocks.js')).gpsMock());
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/fish.js', async () => (await import('./_mocks.js')).fishMock());
vi.mock('../../../src/engine/tides.js', async () => (await import('./_mocks.js')).tidesMock());

const A = await import('../../../src/engine/areadata.js');
const { COOPS_APP, INAT_PHOTO_LICENSES } = await import('../../../src/engine/datasources.js');

describe('area pack requests', () => {
  const bounds = L.latLngBounds([33.70, -118.45], [33.72, -118.43]);
  let calls;
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (/tidesandcurrents/.test(url)) return { json: async () => ({ predictions: [{ t: '2026-10-26 09:20', type: 'H', v: '4.9' }] }) };
      if (/inaturalist/.test(url)) return { json: async () => ({ total_results: 1, results: [] }) };
      if (/mpa-ca\.json/.test(url)) return { json: async () => [] };
      return { json: async () => ({}) };   // weather, marine, depth: not under test here
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('iNaturalist: openly licensed photos only, research grade, inside the area', async () => {
    await A.buildAreaPack(bounds);
    const inat = calls.filter((u) => u.includes('api.inaturalist.org'));
    expect(inat).toHaveLength(1);
    const p = new URL(inat[0]).searchParams;
    expect(p.get('photo_license')).toBe(INAT_PHOTO_LICENSES.join(','));
    expect(p.get('taxon_id')).toBe('1,2,3');   // FISH_TAXA from the mock
    expect(p.get('quality_grade')).toBe('research');
    expect(p.get('geoprivacy')).toBe('open');
    expect(+p.get('nelat')).toBeCloseTo(33.72, 4);
    expect(+p.get('swlng')).toBeCloseTo(-118.45, 4);
  });

  it('CO-OPS: names the app (application=) and asks for a week of hi/lo predictions', async () => {
    const pack = await A.buildAreaPack(bounds);
    const tides = calls.filter((u) => u.includes('api.tidesandcurrents.noaa.gov'));
    expect(tides).toHaveLength(1);
    const p = new URL(tides[0]).searchParams;
    expect(p.get('application')).toBe(COOPS_APP);
    expect(p.get('station')).toBe('9410660');
    expect(p.get('interval')).toBe('hilo');
    expect(p.get('datum')).toBe('MLLW');
    const day = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime();
    expect(Math.round((day(p.get('end_date')) - day(p.get('begin_date'))) / 864e5)).toBe(7);
    expect(pack.tides.preds).toHaveLength(1);
  });
});
