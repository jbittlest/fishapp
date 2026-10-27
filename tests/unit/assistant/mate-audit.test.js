/* First Mate audit regressions (2026-10-27): distress routing, waypoint type, later-time
   weather, species closures, generic "fish", knot-by-use, empty cloud replies, and the voice
   rules that fired on ordinary questions. Real knots / fish-tips / fish-id / astro data. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';

const h = vi.hoisted(() => ({
  GPS: { lastLatLng: null, last: null, lastFixTs: 0 },
  Spots: { all: [] },
  Catch: { all: [] },
  Nav: { trip: { active: false, dist: 0, maxKn: 0, sumKn: 0, nKn: 0 }, anchor: { watching: false, radiusFt: 100 } },
}));
vi.mock('../../../src/engine/db.js', () => ({ idb: { put: vi.fn(async () => 42) } }));
vi.mock('../../../src/engine/gps.js', () => ({
  GPS: h.GPS, nmBetween: (a, b) => a.distanceTo(b) / 1852, bearingBetween: () => 200,
  formatCoord: (v) => v.toFixed(3), gpsIsStale: vi.fn(() => false), mapProgrammatic: (fn) => fn(), setFollow: vi.fn(),
}));
vi.mock('../../../src/engine/spots.js', () => ({ Spots: h.Spots, addSpotMarker: vi.fn(), spotsChanged: vi.fn(), deleteSpot: vi.fn() }));
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'W' }));
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/sst.js', () => ({ SST: {} }));
vi.mock('../../../src/engine/tides.js', () => ({ nearestTideStation: vi.fn(() => null) }));
vi.mock('../../../src/engine/catch.js', () => ({ Catch: h.Catch }));
vi.mock('../../../src/engine/nav.js', () => ({ Nav: h.Nav, tripReset: vi.fn(), tripToggle: vi.fn(), getRouteSpeedKn: () => 0, getRouteGph: () => 8 }));
vi.mock('../../../src/engine/areadata.js', () => ({
  areaPackFor: () => null, areaFcstIndex: () => -1, areaDailyForecast: () => [],
  areaTidesNext: () => [], areaSstStats: () => null, areaDepthAt: () => null, areaPackSummary: () => ({}),
}));
vi.mock('../../../src/engine/bite.js', () => ({ biteWindows: vi.fn(async () => null), biteFmtWindow: vi.fn(), biteReason: vi.fn() }));
vi.mock('../../../src/engine/voice.js', () => ({ Voice: { _muteUntil: 0 } }));
vi.mock('../../../src/engine/layers.js', () => ({ layersStore: { getState: () => ({}), setState: () => {} }, setDataOverlay: vi.fn() }));
vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null }));
vi.mock('../../../src/services/ui', () => ({
  confirmDialog: vi.fn(async () => true), toast: vi.fn(), isPanelOpen: () => true, uiStore: { getState: () => ({ dialogs: [] }) },
}));

import * as A from '../../../src/engine/assistant.js';
import { idb } from '../../../src/engine/db.js';
import { confirmDialog } from '../../../src/services/ui';

const EMERGENCY = /^EMERGENCY\n• VHF Channel 16/;
const json = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, headers: { get: () => null } });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  h.GPS.lastLatLng = L.latLng(33.77, -118.42);
  h.Spots.all = [];
  A.ASST.history = []; A.ASST.streaming = false; A.ASST._relayHold = {}; A.ASST._proxyBlocked = false;
  A.asstStore.setState({ messages: [], busy: false });
  vi.mocked(confirmDialog).mockReset().mockResolvedValue(true);
  globalThis.fetch = vi.fn(async () => { throw new Error('fetch not stubbed'); });
});

describe('distress is answered first, and only distress', () => {
  it.each([
    'my buddy fell overboard', 'man overboard!', 'we are taking on water', "we're sinking", 'the boat is sinking how far to shore',
    'engine fire', 'fire aboard', 'the boat is on fire', 'someone is hurt and bleeding badly', 'he is not breathing',
    'mayday, we are sinking, nearest ramp?', 'help we are taking on water and its too rough', 'we ran aground', 'we capsized',
    'pan pan', 'what channel for the coast guard',
  ])('%s → emergency script', async (q) => {
    expect(await A.asstOffline(q)).toMatch(EMERGENCY);
  });
  it.each([
    'best slow sinking jig for yellowtail', 'the bite is on fire, what should i throw for calico bass', 'how do i bleed a tuna',
    'when is the flood tide', 'help me tie a knot', 'how do i catch halibut',
  ])('%s → not the emergency script', async (q) => {
    expect(await A.asstOffline(q)).not.toMatch(EMERGENCY);
  });
  it('a distress call never waits on the cloud (no consent question, no fetch)', async () => {
    await A.asstSend('Mayday we are sinking');
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const bot = A.asstStore.getState().messages.find((m) => m.role === 'bot');
    expect(bot.text).toMatch(EMERGENCY);
  });
});

describe('offline answers', () => {
  it('a waypoint named "Rock Pile" is a fish spot, not a hazard', async () => {
    const a = await A.asstOffline('drop a pin here called Rock Pile');
    expect(a).toMatch(/Dropped "Rock Pile" \(fish\)/);
    expect(vi.mocked(idb.put).mock.calls.at(-1)[1]).toMatchObject({ name: 'Rock Pile', type: 'fish' });
    expect(await A.asstOffline('mark this as a ramp named Rocky Point')).toMatch(/\(ramp\)/);
  });
  it('weather for a later time says it is not a forecast', async () => {
    localStorage.setItem('fishapp.lastwx', JSON.stringify({ lat: 33.77, lng: -118.42, ts: Date.now() - 60000,
      wx: { current: { wind_speed_10m: 8, wind_direction_10m: 270, wind_gusts_10m: 10, temperature_2m: 64 } } }));
    expect(await A.asstOffline('weather tomorrow afternoon')).toMatch(/^I don't have a forecast for tomorrow afternoon offline[^]*Wind now/);
    expect(await A.asstOffline("what's the weather")).toMatch(/^Wind now/);
  });
  it('a species closure is the species card, an area closure is the MPA answer', async () => {
    expect(await A.asstOffline('what are the rockfish depth closures')).toMatch(/^Rockfish[^]*DEPTH CLOSURES/);
    expect(await A.asstOffline('can i fish here')).toMatch(/closure data|Protected areas/);
  });
  it('"fish" alone never names a species', async () => {
    expect(A.asstFindSpecies('how many fish can i keep')).toBeNull();
    expect(A.asstFindSpecies('is it legal to keep this fish')).toBeNull();
    expect(A.asstFindSpecies('lingcod season')?.name).toBe('Lingcod');
  });
  it('species + area gets the game plan', async () => {
    expect(await A.asstOffline('calico bass at catalina')).toMatch(/Lures\/jigs/);
  });
  it('picks a knot by what it is for', async () => {
    expect(await A.asstOffline('best knot for braid to fluoro')).toMatch(/^FG Knot/);
    expect(await A.asstOffline('what knot for a swivel')).toMatch(/^Palomar Knot/);
    expect(await A.asstOffline('knot to tie line to the reel spool')).toMatch(/^Arbor Knot/);
    expect(await A.asstOffline('help me tie a knot')).toMatch(/^Which knot\?/);
  });
});

describe('legal review: where First Mate is not the last word', () => {
  it('both cloud prompts carry the regs / go-no-go / medical exceptions and no blanket NEVER-defer', () => {
    for (const sys of [A.asstSystemPrompt(), A.asstProxySystem('what should i throw at catalina', '')]) {
      expect(sys).toContain(A.ASST_LIMITS_RULE);
      expect(sys).toMatch(/MPA lines with CDFW/);
      expect(sys).toMatch(/decision is the skipper's — point them to the NWS marine forecast/);
      expect(sys).toMatch(/no treatment advice beyond basic first aid/);
      expect(sys).not.toMatch(/The only thing to defer|Only defer on confirming/);
      expect(sys).not.toMatch(/never tell the user to look it up elsewhere/i);
    }
  });
  it('the proxy prompt still fits its cap with the rule kept whole', () => {
    const sys = A.asstProxySystem('calico bass at catalina', 'LIVE CONDITIONS — x');
    expect(sys.length).toBeLessThanOrEqual(A.ASST_PROXY_SYSTEM_CAP);
    expect(sys).toContain(A.ASST_LIMITS_RULE);
  });
  it('MPA-adjacent area tips carry the MPA warning, offline and in the cloud tables', async () => {
    const { AREA_TIPS, MPA_TIP_NOTE } = await import('../../../src/engine/fish-tips.js');
    for (const n of ['Catalina Island', 'Palos Verdes', 'San Diego', 'Channel Islands']) expect(AREA_TIPS.find((a) => a.name === n).mpa).toBe(true);
    expect(AREA_TIPS.find((a) => a.name === 'Huntington / Belmont Flats').mpa).toBeFalsy();
    expect(await A.asstOffline('what is biting at point vicente')).toContain(MPA_TIP_NOTE);
    expect(await A.asstOffline('fishing at la jolla, what should i throw')).toContain(MPA_TIP_NOTE);
    expect(await A.asstOffline('calico bass at catalina')).toContain(MPA_TIP_NOTE);
    expect(await A.asstOffline('what should i throw at the huntington flats')).not.toContain(MPA_TIP_NOTE);
    expect(A.asstTipsTable()).toMatch(/Catalina Island: [^\n]*Check MPA boundaries/);
  });
  it('offline go/no-go leaves the call to the skipper and names the NWS marine forecast', async () => {
    localStorage.setItem('fishapp.lastwx', JSON.stringify({ lat: 33.77, lng: -118.42, ts: Date.now() - 60000,
      wx: { current: { wind_speed_10m: 5, wind_direction_10m: 270, wind_gusts_10m: 7, temperature_2m: 64 } } }));
    expect(await A.asstOffline('is it too rough to go out')).toMatch(/the call is the skipper's\. Get the NWS marine forecast/);
  });
});

describe('an empty cloud reply falls back to the offline answer', () => {
  it('relay 200 with no reply', async () => {
    localStorage.setItem(A.ASST_CONSENT_KEY, 'yes');
    globalThis.fetch = vi.fn(async () => json({ reply: '   ' }));
    await A.asstSend('when is sunrise');
    const bot = A.asstStore.getState().messages.find((m) => m.role === 'bot');
    expect(bot.error).toBe(true);
    expect(bot.text).toMatch(/^The free AI sent back an empty answer\. Offline answer:\n\nToday:\nSunrise/);
    expect(A.ASST.history).toEqual([]);
  });
  it('Claude with no text and no tools', async () => {
    localStorage.setItem(A.ASST_CONSENT_KEY, 'yes');
    localStorage.setItem('fishapp.asst.key', 'sk-ant-test');
    globalThis.fetch = vi.fn(async () => json({ stop_reason: 'end_turn', content: [] }));
    await A.asstSend('when is sunrise');
    const bot = A.asstStore.getState().messages.find((m) => m.role === 'bot');
    expect(bot.text).toMatch(/^The AI sent back an empty answer\. Offline answer:/);
  });
});
