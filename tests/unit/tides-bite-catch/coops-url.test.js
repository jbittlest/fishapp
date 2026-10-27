// The tide panel's CO-OPS request names the app (application=, which NOAA asks every caller to
// send) and keeps its two-day hi/lo shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setOnline, fetchRouter, gps } from './mocks.js';

vi.mock('../../../src/engine/gps.js', async () => (await import('./mocks.js')).gps);
vi.mock('../../../src/engine/app.js', async () => (await import('./mocks.js')).app);

const { Tides, tidesStore, loadTidesTimes, ymd } = await import('../../../src/engine/tides.js');
const { COOPS_APP } = await import('../../../src/engine/datasources.js');

beforeEach(() => {
  localStorage.clear();
  Tides.stations = [{ id: '9410660', n: 'Los Angeles', la: 33.72, lo: -118.27 }];
  Tides.loaded = true; Tides.status = 'ready';
  Tides._loading = false; Tides._loadingId = null; Tides._rerun = false;
  tidesStore.setState({ station: null, status: 'idle', hilo: [], fromCache: false, refreshing: false, updatedAt: 0, astro: null });
  gps.GPS.lastLatLng = { lat: 33.72, lng: -118.27 };
  setOnline(true);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('loadTidesTimes request', () => {
  it('sends application=<brand id> with the station and a two-day window', async () => {
    const f = fetchRouter([['tidesandcurrents', { predictions: [] }]]);
    vi.stubGlobal('fetch', f);
    await loadTidesTimes();
    expect(f).toHaveBeenCalledTimes(1);
    const p = new URL(String(f.mock.calls[0][0])).searchParams;
    expect(p.get('application')).toBe(COOPS_APP);
    expect(p.get('station')).toBe('9410660');
    expect(p.get('product')).toBe('predictions');
    expect(p.get('interval')).toBe('hilo');
    expect(p.get('begin_date')).toBe(ymd(new Date()));
    expect(p.get('end_date')).toBe(ymd(new Date(Date.now() + 2 * 86400000)));
  });
});
