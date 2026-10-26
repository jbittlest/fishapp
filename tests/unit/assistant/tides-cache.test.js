/* First Mate's offline tide answer falls back to the predictions the Tides panel cached for the
   nearest station (fishapp.tides.{id}), instead of telling the user to fetch tides they already have. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';

const h = vi.hoisted(() => ({ GPS: { lastLatLng: null, last: null }, station: null }));

vi.mock('../../../src/engine/db.js', () => ({ idb: { put: vi.fn() } }));
vi.mock('../../../src/engine/gps.js', () => ({
  GPS: h.GPS, nmBetween: () => 0, bearingBetween: () => 0, formatCoord: (v) => String(v),
  gpsIsStale: () => false, mapProgrammatic: (fn) => fn(), setFollow: vi.fn(),
}));
vi.mock('../../../src/engine/spots.js', () => ({ Spots: { all: [] }, addSpotMarker: vi.fn(), spotsChanged: vi.fn(), deleteSpot: vi.fn() }));
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'N' }));
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/sst.js', () => ({ SST: {} }));
vi.mock('../../../src/engine/tides.js', () => ({ nearestTideStation: vi.fn(() => h.station) }));
vi.mock('../../../src/engine/catch.js', () => ({ Catch: { all: [] } }));
vi.mock('../../../src/engine/nav.js', () => ({ Nav: { trip: {}, anchor: {} }, tripReset: vi.fn(), tripToggle: vi.fn(), getRouteSpeedKn: () => 0, getRouteGph: () => 8 }));
vi.mock('../../../src/engine/knots.js', () => ({ KNOTS: [] }));
vi.mock('../../../src/engine/areadata.js', () => ({
  areaPackFor: vi.fn(() => null), areaFcstIndex: vi.fn(() => -1), areaDailyForecast: vi.fn(() => []),
  areaTidesNext: vi.fn(() => []), areaSstStats: vi.fn(() => null), areaDepthAt: vi.fn(() => null), areaPackSummary: vi.fn(() => ({})),
}));
vi.mock('../../../src/engine/bite.js', () => ({ biteWindows: vi.fn(async () => null), biteFmtWindow: vi.fn(), biteReason: vi.fn() }));
vi.mock('../../../src/engine/voice.js', () => ({ Voice: { _muteUntil: 0 } }));
vi.mock('../../../src/engine/layers.js', () => ({ layersStore: { getState: () => ({}), setState: vi.fn() }, setDataOverlay: vi.fn() }));
vi.mock('../../../src/engine/app.js', () => ({ getMap: vi.fn(() => null) }));
vi.mock('../../../src/services/ui', () => ({ confirmDialog: vi.fn(), toast: vi.fn(), isPanelOpen: vi.fn(() => false), uiStore: { getState: () => ({ dialogs: [] }) } }));

const { asstAnsTides } = await import('../../../src/engine/assistant.js');

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

describe('offline tides from the Tides panel cache', () => {
  beforeEach(() => {
    localStorage.clear();
    h.GPS.lastLatLng = L.latLng(33.77, -118.42);
    h.station = { id: '9410840', n: 'Santa Monica' };
  });

  it("answers today's highs and lows from the saved predictions", () => {
    const today = ymd(new Date());
    localStorage.setItem('fishapp.tides.9410840', JSON.stringify({
      ts: Date.now() - 3 * 3600_000,
      hl: [
        { t: today + ' 05:12', v: '4.6', type: 'H' },
        { t: today + ' 11:40', v: '0.3', type: 'L' },
        { t: today + ' 18:02', v: '5.1', type: 'H' },
      ],
    }));
    const a = asstAnsTides('tides today');
    expect(a).toContain('Santa Monica');
    expect(a).toContain('High  05:12   4.6 ft');
    expect(a).toContain('Low   11:40   0.3 ft');
    expect(a).toMatch(/saved/);
  });

  it('still says how to get tides when nothing is cached', () => {
    expect(asstAnsTides('tides today')).toMatch(/don't have tide predictions offline/);
  });

  it('says so honestly when there is no station near', () => {
    h.station = null;
    expect(asstAnsTides('tides today')).toMatch(/don't have tide predictions offline/);
  });
});
