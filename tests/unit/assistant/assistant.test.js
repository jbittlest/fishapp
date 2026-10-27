/* First Mate (engine/assistant.js) — characterisation tests for the logic moved out of the
   legacy module: model migration, the offline intent router, cached-weather rules, the proxy
   prompt budget, the send state machine (busy / generation / consent / fallback), the agent
   loop, tools and the speech echo guard. Collaborating engine modules are mocked; astro.js,
   fish-id.js and fish-tips.js are the real data. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';

const h = vi.hoisted(() => {
  const layers = { state: { sst: false, rain: false, wind: false, reefs: false, mpa: false, fish: false } };
  return {
    GPS: { lastLatLng: null, last: null },
    Spots: { all: [] },
    Catch: { all: [] },
    Nav: { trip: { active: false, dist: 0, maxKn: 0, sumKn: 0, nKn: 0 }, anchor: { watching: false, radiusFt: 100 } },
    Voice: { _muteUntil: 0 },
    layers,
    layersStore: { getState: () => layers.state, setState: (p) => { layers.state = { ...layers.state, ...p }; } },
    map: null,
    dialogs: [],
    panelOpen: true,
  };
});

vi.mock('../../../src/engine/db.js', () => ({ idb: { put: vi.fn(async () => 42) } }));
vi.mock('../../../src/engine/gps.js', () => ({
  GPS: h.GPS,
  nmBetween: (a, b) => a.distanceTo(b) / 1852,
  bearingBetween: (a, b) => {
    const r = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  },
  formatCoord: (v, axis) => (axis === 'lat' ? 'LAT ' : 'LON ') + v.toFixed(3),
  gpsIsStale: vi.fn(() => false),
  mapProgrammatic: (fn) => fn(),
  setFollow: vi.fn(),
}));
vi.mock('../../../src/engine/spots.js', () => ({
  Spots: h.Spots, addSpotMarker: vi.fn(), spotsChanged: vi.fn(),
  deleteSpot: vi.fn(async (id) => { h.Spots.all = h.Spots.all.filter((s) => s.id !== id); }),
}));
vi.mock('../../../src/engine/weather.js', () => ({
  compass: (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8],
}));
vi.mock('../../../src/engine/reefs.js', () => ({ Reefs: { reefs: [] } }));
vi.mock('../../../src/engine/sst.js', () => ({ SST: {} }));
vi.mock('../../../src/engine/tides.js', () => ({ nearestTideStation: vi.fn(() => null) }));
vi.mock('../../../src/engine/catch.js', () => ({ Catch: h.Catch }));
vi.mock('../../../src/engine/nav.js', () => ({
  Nav: h.Nav, tripReset: vi.fn(), tripToggle: vi.fn(),
  getRouteSpeedKn: vi.fn(() => 0), getRouteGph: vi.fn(() => 8),
}));
vi.mock('../../../src/engine/knots.js', () => ({
  KNOTS: [{ name: 'Palomar Knot', use: 'Line → hook', level: 'Easy', steps: ['Double the line.', 'Tie an overhand.'], tip: 'Wet it.' }],
}));
vi.mock('../../../src/engine/areadata.js', () => ({
  areaPackFor: vi.fn(() => null), areaFcstIndex: vi.fn(() => -1), areaDailyForecast: vi.fn(() => []),
  areaTidesNext: vi.fn(() => []), areaSstStats: vi.fn(() => null), areaDepthAt: vi.fn(() => null), areaPackSummary: vi.fn(() => ({})),
}));
vi.mock('../../../src/engine/bite.js', () => ({ biteWindows: vi.fn(async () => null), biteFmtWindow: vi.fn(), biteReason: vi.fn() }));
vi.mock('../../../src/engine/voice.js', () => ({ Voice: h.Voice }));
vi.mock('../../../src/engine/layers.js', () => ({ layersStore: h.layersStore, setDataOverlay: vi.fn() }));
vi.mock('../../../src/engine/app.js', () => ({ getMap: vi.fn(() => h.map) }));
vi.mock('../../../src/services/ui', () => ({
  confirmDialog: vi.fn(async () => true), toast: vi.fn(),
  isPanelOpen: vi.fn(() => h.panelOpen),
  uiStore: { getState: () => ({ dialogs: h.dialogs }) },
}));

import * as A from '../../../src/engine/assistant.js';
import worker from '../../../proxy/first-mate-worker.js';
import { SITE } from '../../../src/services/site';
import { idb } from '../../../src/engine/db.js';
import { gpsIsStale } from '../../../src/engine/gps.js';
import { addSpotMarker, spotsChanged } from '../../../src/engine/spots.js';
import { getRouteGph, getRouteSpeedKn } from '../../../src/engine/nav.js';
import { setDataOverlay } from '../../../src/engine/layers.js';
import { confirmDialog, toast } from '../../../src/services/ui';

const HERE = { lat: 33.6, lng: -118.0 };
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/u;
let onLine = true;

function setOnline(v) { onLine = v; }
function saveWx(over = {}) {
  localStorage.setItem('fishapp.lastwx', JSON.stringify({
    lat: HERE.lat, lng: HERE.lng, ts: Date.now() - 20 * 60000,
    wx: { current: { wind_speed_10m: 22, wind_direction_10m: 270, wind_gusts_10m: 30, temperature_2m: 64 } },
    marine: { current: { wave_height: 1.2, wave_period: 9, wave_direction: 260 } },
    ...over,
  }));
}
function jsonResponse(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, blob: async () => new Blob([]) };
}
const msgs = () => A.asstStore.getState().messages;
const lastBot = () => [...msgs()].reverse().find((m) => m.role === 'bot');

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
  setOnline(true);
  h.GPS.lastLatLng = L.latLng(HERE.lat, HERE.lng);
  h.GPS.last = null;
  h.Spots.all = [];
  h.Catch.all = [];
  h.map = null;
  h.dialogs = [];
  h.panelOpen = true;
  h.GPS.lastFixTs = undefined;
  vi.mocked(gpsIsStale).mockReset().mockReturnValue(false);
  A.ASST._consentPending = false;
  h.layers.state = { sst: false, rain: false, wind: false, reefs: false, mpa: false, fish: false };
  A.ASST.history = [];
  A.ASST.lastLoc = null;
  A.ASST.streaming = false;
  A.ASST.speak = false;
  A.ASST._proxyBlocked = false;
  A.ASST._relayHold = {};
  A.asstStore.setState({ messages: [], busy: false, showChips: false });
  vi.mocked(idb.put).mockReset().mockResolvedValue(42);
  vi.mocked(confirmDialog).mockReset().mockResolvedValue(true);
  vi.mocked(toast).mockReset();
  vi.mocked(addSpotMarker).mockReset();
  vi.mocked(spotsChanged).mockReset();
  vi.mocked(setDataOverlay).mockReset();
  vi.mocked(getRouteSpeedKn).mockReset().mockReturnValue(0);
  vi.mocked(getRouteGph).mockReset().mockReturnValue(8);
  globalThis.fetch = vi.fn(async () => { throw new Error('fetch not stubbed'); });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/* ------------------------------------------------------------------ models */
describe('models', () => {
  it('migrates the stale legacy ids to the closest current model', () => {
    expect(A.asstMigrateModel('claude-opus-4-8')).toBe('claude-opus-5-5');
    expect(A.asstMigrateModel('claude-sonnet-5')).toBe('claude-sonnet-5-5');
    expect(A.asstMigrateModel('claude-haiku-4-5')).toBe('claude-haiku-5-5');
    expect(A.asstMigrateModel('claude-fable-5')).toBe('claude-opus-5-5');
    expect(A.asstMigrateModel('')).toBe('claude-opus-5-5');
    expect(A.asstMigrateModel(null)).toBe('claude-opus-5-5');
    for (const m of A.ASST_MODELS) expect(A.asstMigrateModel(m.id)).toBe(m.id);
  });
  it('defaults to Opus and rewrites a saved legacy id at init', () => {
    expect(A.ASST.model()).toBe('claude-opus-5-5');
    localStorage.setItem('fishapp.asst.model', 'claude-haiku-4-5');
    expect(A.ASST.model()).toBe('claude-haiku-5-5');
    A.asstInit();
    expect(localStorage.getItem('fishapp.asst.model')).toBe('claude-haiku-5-5');
    expect(A.asstModelLabel()).toBe('Haiku 5.5');
  });
  it('sends adaptive thinking to every model in the picker but not to Haiku 4.5', () => {
    for (const m of A.ASST_MODELS) expect(A.asstSupportsThinking(m.id)).toBe(true);
    expect(A.asstSupportsThinking('claude-haiku-4-5')).toBe(false);
    expect(A.asstSupportsThinking('claude-opus-4-8')).toBe(true);
    expect(A.asstSupportsFallback('claude-opus-5-5')).toBe(true);
    expect(A.asstSupportsFallback('claude-sonnet-5-5')).toBe(true);
    expect(A.asstSupportsFallback('claude-haiku-5-5')).toBe(false);
  });
  it('builds the Messages request: key header, adaptive thinking, effort, fallback, 120 s deadline', async () => {
    localStorage.setItem('fishapp.asst.key', ' sk-ant-test ');
    globalThis.fetch = vi.fn(async () => jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }));
    await A.asstApiCall([{ role: 'user', content: 'hi' }], 'SYS');
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.timeoutMs).toBe(120000);
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, system: 'SYS', thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, fallbacks: 'default' });
    expect(body.temperature).toBeUndefined();
    expect(body.tools.map((t) => t.name)).toContain('place_waypoint');

    localStorage.setItem('fishapp.asst.model', 'claude-haiku-5-5');
    await A.asstApiCall([{ role: 'user', content: 'hi' }], 'SYS');
    const [, init2] = vi.mocked(globalThis.fetch).mock.calls[1];
    expect(JSON.parse(init2.body).fallbacks).toBeUndefined();
    expect(init2.headers['anthropic-beta']).toBeUndefined();
  });
});

/* ------------------------------------------------------------ small helpers */
describe('helpers', () => {
  it('asstAgo buckets minutes / hours / days', () => {
    const now = Date.now();
    expect(A.asstAgo(now - 10 * 1000)).toBe('1 min ago');
    expect(A.asstAgo(now - 30 * 60000)).toBe('30 min ago');
    expect(A.asstAgo(now - 3 * 3600000)).toBe('3 h ago');
    expect(A.asstAgo(now - 50 * 3600000)).toBe('2 d ago');
  });
  it('asstParseWhen reads "tomorrow afternoon", "tonight" and weekdays (next occurrence, never today)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0));   // Wednesday 21 Oct 2026, 10:00 local
    const tmr = A.asstParseWhen('weather tomorrow afternoon');
    expect(tmr.label).toBe('Tomorrow afternoon');
    expect(new Date(tmr.ms)).toEqual(new Date(2026, 9, 22, 14, 0, 0));
    expect(A.asstParseWhen('tonight').label).toBe('Tonight');
    expect(new Date(A.asstParseWhen('tonight').ms).getHours()).toBe(20);
    const sat = A.asstParseWhen('saturday morning');
    expect(sat.label).toBe('Saturday morning');
    expect(new Date(sat.ms)).toEqual(new Date(2026, 9, 24, 8, 0, 0));
    expect(new Date(A.asstParseWhen('wednesday').ms).getDate()).toBe(28);
    expect(A.asstParseWhen('how windy is it').label).toBe('Now');
  });
  it('asstExtractPlaces returns most-specific places and skips time words', () => {
    expect(A.asstExtractPlaces('weather near catalina or around catalina island')).toEqual(['catalina island', 'catalina']);
    expect(A.asstExtractPlaces('wind at the dock')).toEqual([]);
    expect(A.asstExtractPlaces('tides for tomorrow')).toEqual([]);
    expect(A.asstExtractPlaces('swell off point loma today?')).toEqual(['point loma']);
  });
  it('asstParseWaypointName reads quoted and "call it" names', () => {
    expect(A.asstParseWaypointName('drop a pin here and call it Rock Pile')).toBe('Rock Pile');
    expect(A.asstParseWaypointName('mark this "Kelp Line" please')).toBe('Kelp Line');
    expect(A.asstParseWaypointName('drop a pin')).toBeNull();
  });
  it('asstIsQuestion tells questions from polite requests', () => {
    expect(A.asstIsQuestion("what's this spot called?")).toBe(true);
    expect(A.asstIsQuestion('is there a spot named rock pile')).toBe(true);
    expect(A.asstIsQuestion('call it rock pile here')).toBe(false);
    expect(A.asstIsQuestion('can you call it the kelp line here?')).toBe(false);
  });
  it('strips emoji for display and for speech without eating text', () => {
    expect(A.asstCleanText('\u{1F3A3} Best days\n   wind 5–8kn → go, 64°F • ok')).toBe('Best days\n   wind 5–8kn → go, 64°F • ok');
    expect(A.asstCleanText('Tap \u{26A0}\u{FE0F} now')).toBe('Tap now');
    expect(A.asstStripForSpeech('**Rough** → stay in \u{26D4}')).toBe('Rough stay in');
  });
  it('asstSplitBold yields plain and bold runs only', () => {
    expect(A.asstSplitBold('a **b c** d')).toEqual([{ text: 'a ', bold: false }, { text: 'b c', bold: true }, { text: ' d', bold: false }]);
    expect(A.asstSplitBold('<b>x</b>')).toEqual([{ text: '<b>x</b>', bold: false }]);
    expect(A.asstSplitBold('')).toEqual([]);
  });
  it('asstNormalizeProxy: empty or the default means the FishApp relay; only https', () => {
    expect(A.asstNormalizeProxy('')).toEqual({ value: '' });
    expect(A.asstNormalizeProxy(A.ASST_PROXY + '/')).toEqual({ value: '' });
    expect(A.asstNormalizeProxy('https://mine.workers.dev')).toEqual({ value: 'https://mine.workers.dev' });
    expect(A.asstNormalizeProxy('http://evil.example')).toHaveProperty('error');
    expect(A.asstNormalizeProxy('http://localhost:8787')).toEqual({ value: 'http://localhost:8787' });
  });
  it('asstPickBrain: Claude needs signal + key, cloud only when not switched off', () => {
    const base = { online: true, hasKey: false, proxy: true, consent: null };
    expect(A.asstPickBrain(base)).toBe('proxy');
    expect(A.asstPickBrain({ ...base, hasKey: true })).toBe('claude');
    expect(A.asstPickBrain({ ...base, hasKey: true, consent: 'no' })).toBe('data');
    expect(A.asstPickBrain({ ...base, online: false, hasKey: true })).toBe('offline');
    expect(A.asstPickBrain({ ...base, proxy: false })).toBe('data');
  });
  it('status line copy follows the brain', () => {
    A.asstSetStatus();
    expect(A.asstStore.getState().statusText).toBe('Free AI chat — no key needed');
    localStorage.setItem('fishapp.asst.key', 'k');
    A.asstSetStatus();
    expect(A.asstStore.getState().statusText).toBe('Claude Opus 5.5 · your key');
    setOnline(false);
    A.asstSetStatus();
    expect(A.asstStore.getState()).toMatchObject({ brain: 'offline', statusText: 'Offline — answering from your boat data' });
    setOnline(true);
    A.asstSetCloudConsent(false);
    expect(A.asstStore.getState()).toMatchObject({ brain: 'data', statusText: 'Data mode — answering from your boat data', consent: 'no' });
  });
});

/* --------------------------------------------------------- cached weather */
describe('cached weather (0.25° / 12 h rule)', () => {
  it('accepts weather saved for this place recently', () => {
    const now = Date.now();
    expect(A.asstWxUsable({ lat: 33.7, lng: -118.1, ts: now - 3600000 }, HERE, now)).toBe(true);
  });
  it('rejects another place, an old save, a payload without a location, or no position', () => {
    const now = Date.now();
    expect(A.asstWxUsable({ lat: 34.0, lng: -118.0, ts: now }, HERE, now)).toBe(false);
    expect(A.asstWxUsable({ lat: 33.6, lng: -118.0, ts: now - 13 * 3600000 }, HERE, now)).toBe(false);
    expect(A.asstWxUsable({ ts: now }, HERE, now)).toBe(false);
    expect(A.asstWxUsable({ lat: 33.6, lng: -118.0, ts: now }, null, now)).toBe(false);
  });
  it('offline answers no longer quote another harbour', async () => {
    saveWx({ lat: 34.4, lng: -119.7 });
    expect(await A.asstOffline('how windy is it')).toMatch(/no recent weather cached/);
    saveWx();
    expect(await A.asstOffline('how windy is it')).toMatch(/^Wind now \(cached 20 min ago\)/);
  });
});

/* ------------------------------------------------------- offline router */
describe('offline intent router', () => {
  it('"what\'s this spot called?" never drops a junk pin', async () => {
    const out = await A.asstOffline("what's this spot called?");
    expect(idb.put).not.toHaveBeenCalled();
    expect(out).toMatch(/no saved spots yet/);
  });
  it('drops and names a waypoint at the live fix, awaiting the write', async () => {
    const out = await A.asstOffline('drop a pin here and call it Rock Pile');
    expect(idb.put).toHaveBeenCalledWith('spots', expect.objectContaining({ name: 'Rock Pile', type: 'hazard' }));
    expect(out).toMatch(/^Dropped "Rock Pile" \(hazard\) at 33\.60000, -118\.00000\.\nSaved and on the map/);
    expect(out).not.toMatch(/map center/);
    expect(addSpotMarker).toHaveBeenCalled();
    expect(spotsChanged).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Rock Pile saved');
    expect(h.Spots.all).toHaveLength(1);
    expect(h.Spots.all[0].id).toBe(42);
  });
  it('flags a map-center waypoint and reports a failed write honestly', async () => {
    h.GPS.lastLatLng = null;
    h.map = { getCenter: () => L.latLng(33, -117.5) };
    expect(await A.asstOffline('mark this spot')).toMatch(/\(map center — no GPS fix yet\)/);
    vi.mocked(idb.put).mockRejectedValueOnce(new Error('QuotaExceeded'));
    expect(await A.asstOffline('drop a waypoint named Kelp')).toBe('Couldn\'t save "Kelp" — storage may be full or blocked. Nothing was written.');
  });
  it('a marker/list redraw failure after the commit is not reported as a failed save', async () => {
    vi.mocked(addSpotMarker).mockImplementationOnce(() => { throw new Error('no map'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await A.asstOffline('drop a pin')).toMatch(/^Dropped "Waypoint 1"/);
    spy.mockRestore();
  });
  it('"season" is not "seas": a regs question reaches the regulations intent', async () => {
    const out = await A.asstOffline("what's the season for lingcod");
    expect(out).toMatch(/^Lingcod/);
    expect(out).toMatch(/confirm current CA regs with CDFW/);
  });
  it('distance beats knots ("25 knots") and "heading to" is not a heading readout', async () => {
    h.Spots.all = [{ id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 }];
    const a = await A.asstOffline('how far to rock pile at 25 knots');
    expect(a).toMatch(/^Rock Pile: \d+\.\d nm, bearing \d+°/);
    expect(a).toMatch(/At 25 kn/);
    expect(await A.asstOffline('heading to rock pile — how far?')).toMatch(/^Rock Pile: /);
  });
  it('trip time uses the Nav tools speed and fuel when the question gives none', async () => {
    h.Spots.all = [{ id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 }];
    vi.mocked(getRouteSpeedKn).mockReturnValue(10);
    vi.mocked(getRouteGph).mockReturnValue(5);
    const out = await A.asstOffline('how far to rock pile and back');
    expect(out).toMatch(/At 10 kn/);
    expect(out).toMatch(/Round trip: /);
    expect(out).toMatch(/Assumes 5 gal\/hr — set speed & GPH in Nav tools\./);
  });
  it('go/no-go reads cached wind and always carries the official-forecast caveat', async () => {
    saveWx();
    const out = await A.asstOffline('is it too rough today?');
    expect(out).toMatch(/^\*\*Rough — think hard before going\./);
    expect(out).toMatch(/\*\*Rough read only — always get an official marine forecast \(VHF WX \/ NOAA\) before you head out\.\*\*$/);
    saveWx({ wx: { current: { wind_speed_10m: 5, wind_direction_10m: 0, wind_gusts_10m: 8, temperature_2m: 60 } }, marine: { current: { wave_height: 0.4, wave_period: 8, wave_direction: 0 } } });
    expect(await A.asstOffline('is it calm enough')).toMatch(/^\*\*Looks calm and fishable\.\*\*/);
  });
  it('emergency answer keeps the safety script', async () => {
    const out = await A.asstOffline('mayday we are sinking');
    expect(out).toMatch(/^EMERGENCY\n• VHF Channel 16 — hail & distress\n• Call 911 \/ Coast Guard \(needs signal\)/);
    expect(out).toMatch(/• Your position: 33\.60000, -118\.00000/);
    expect(out).toMatch(/Tap the SOS button for the full script, one-tap texting, and satellite steps\.$/);
  });
  it('" mpa" with its leading space: "compare" is not a closures question', async () => {
    h.Spots.all = [
      { id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 },
      { id: 2, name: 'Kelp Line', type: 'fish', lat: 33.65, lng: -118.05 },
    ];
    expect(await A.asstOffline('compare rock pile vs kelp line')).toMatch(/^Comparing Rock Pile vs Kelp Line:\nClosest to you: Kelp Line\./);
    expect(await A.asstOffline('any mpa closures here?')).toMatch(/^No closure data captured offline here/);
  });
  it('nearest dock resolves to saved ramps', async () => {
    h.Spots.all = [{ id: 3, name: 'Main Ramp', type: 'ramp', lat: 33.61, lng: -118.01 }];
    expect(await A.asstOffline('nearest dock')).toMatch(/^Nearest ramp\/dock:\n1\. Main Ramp — /);
  });
  it('knots, species and the help fallback', async () => {
    expect(await A.asstOffline('how do I tie a palomar')).toMatch(/^Palomar Knot — Line → hook \(Easy\)\n1\. Double the line\./);
    expect(await A.asstOffline('xyzzy')).toMatch(/^I'm First Mate\. Even with NO signal or key/);
  });
  it('bait answers come from the fishing knowledge base with the CDFW caveat', async () => {
    const out = await A.asstOffline('what should i throw for calico bass at catalina');
    expect(out).toMatch(/^Kelp \(Calico\) Bass\n• Lures\/jigs: /);
    expect(out).toMatch(/• Catalina: /);
    expect(out).toMatch(/\*\*Confirm size\/bag limits with CDFW before keeping fish\.\*\*$/);
  });
  it('no offline answer carries an emoji', async () => {
    saveWx();
    h.Spots.all = [{ id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 }];
    const qs = ['where am i', 'best time to fish', 'sunrise', 'moon phase', 'tides today', "what's biting here",
      'any closures', 'how big is the swell', 'weather', 'water temp', 'how deep is it', 'nearest reef',
      'limit on yellowtail', 'knot', 'my catches', 'my spots', 'mayday', 'rock pile', 'xyzzy', 'best day to fish this week',
      'outlook this week', 'is it rough', 'how fast am i going'];
    for (const q of qs) expect(await A.asstOffline(q), q).not.toMatch(EMOJI);
  });
});

/* ------------------------------------------------ waypoint naming clause */
describe('waypoint naming clause (no junk pins, legacy imperatives still create)', () => {
  it.each([
    ['new spot here called Rock Pile', 'Rock Pile'],
    ['spot here named the Ledge', 'the Ledge'],
    ['waypoint here called Kelp Edge', 'Kelp Edge'],
    ['mark the spot called Boiler', 'Boiler'],
  ])('"%s" creates a waypoint named %s', async (q, name) => {
    const out = await A.asstOffline(q);
    expect(idb.put).toHaveBeenCalledWith('spots', expect.objectContaining({ name }));
    expect(out).toMatch(new RegExp('^Dropped "' + name + '"'));
  });
  it.each([
    "what's this spot called?",
    'tell me about the spot called rock pile',
    'is there a waypoint named kelp edge',
  ])('"%s" does not create one', async (q) => {
    await A.asstOffline(q);
    expect(idb.put).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------- position honesty (live / stale / map) */
describe('position honesty: live fix, stale fix, map center', () => {
  it('a live fix keeps the legacy wording', async () => {
    expect(await A.asstOffline('where am i')).toBe('Your position:\nLAT 33.600  LON -118.000\n33.60000, -118.00000\n\nFor the Coast Guard, read the top line. Tap SOS to copy or text it.');
  });
  it('a stale fix is labelled with its age, never as "Your position"', async () => {
    vi.mocked(gpsIsStale).mockReturnValue(true);
    h.GPS.lastFixTs = Date.now() - 7 * 60000;
    const out = await A.asstOffline('where am i');
    expect(out).toMatch(/^Last known GPS fix \(7 min old\):\nLAT 33\.600/);
    expect(out).toMatch(/tell the Coast Guard this is your last known position/);
    expect(out).not.toMatch(/Your position/);
  });
  it('the map center is not offered as the line to read to the Coast Guard', async () => {
    h.GPS.lastLatLng = null;
    h.map = { getCenter: () => L.latLng(33, -117.5) };
    const out = await A.asstOffline('where am i');
    expect(out).toMatch(/^Map center \(no live GPS fix yet\):\n/);
    expect(out).toMatch(/not a GPS position — don't read it to the Coast Guard as yours/);
    expect(out).not.toMatch(/read the top line/);
  });
  it('speed: an old SOG is refused, like voice.js voiceSaySpeed', async () => {
    h.GPS.last = { coords: { speed: 5, heading: 90 } };
    expect(await A.asstOffline('how fast am i going')).toMatch(/^Speed over ground: 9\.7 kn/);
    vi.mocked(gpsIsStale).mockReturnValue(true);
    expect(await A.asstOffline('how fast am i going')).toBe('No current speed reading. My last GPS fix is too old.');
  });
  it('emergency: the position line says what it is; the rest of the script is word for word', async () => {
    const live = await A.asstOffline('mayday');
    expect(live).toMatch(/\n• Your position: 33\.60000, -118\.00000\n/);

    vi.mocked(gpsIsStale).mockReturnValue(true);
    h.GPS.lastFixTs = Date.now() - 12 * 60000;
    const stale = await A.asstOffline('mayday');
    expect(stale).toMatch(/\n• Last known GPS fix \(12 min old\): 33\.60000, -118\.00000 — say it is your last known position\n/);
    expect(stale).not.toMatch(/Your position/);

    vi.mocked(gpsIsStale).mockReturnValue(false);
    h.GPS.lastLatLng = null;
    h.map = { getCenter: () => L.latLng(33, -117.5) };
    const mc = await A.asstOffline('mayday');
    expect(mc).toMatch(/\n• Map center \(NO GPS fix\): 33\.00000, -117\.50000 — not your position; give your position from a chartplotter or landmarks\n/);
    expect(mc).not.toMatch(/Your position/);

    for (const s of [live, stale, mc]) {
      expect(s).toMatch(/^EMERGENCY\n• VHF Channel 16 — hail & distress\n• Call 911 \/ Coast Guard \(needs signal\)\n/);
      expect(s).toMatch(/\n\nMAYDAY \(life-threatening\), say 3×: your boat name, position above, nature of emergency, # people aboard\.\nNo signal \+ iPhone 14\+\? Emergency SOS via satellite — point at open sky\.\n\nTap the SOS button for the full script, one-tap texting, and satellite steps\.$/);
    }
  });
  it('the AI snapshot never sends a stale fix as live GPS, nor its old speed', () => {
    h.GPS.last = { coords: { speed: 5, heading: 90 } };
    expect(A.asstSnapshot()).toMatch(/Position: 33\.60000, -118\.00000 \(live GPS\)\nSpeed over ground: 9\.7 kn/);
    vi.mocked(gpsIsStale).mockReturnValue(true);
    h.GPS.lastFixTs = Date.now() - 5 * 60000;
    const s = A.asstSnapshot();
    expect(s).toMatch(/Position: 33\.60000, -118\.00000 \(LAST KNOWN GPS fix, 5 min old/);
    expect(s).toMatch(/Speed \/ heading: no current reading/);
    expect(s).not.toMatch(/live GPS|Speed over ground|Heading: /);
  });
  it('a waypoint on a stale fix is saved, and the reply, toast and tool say where it came from', async () => {
    vi.mocked(gpsIsStale).mockReturnValue(true);
    h.GPS.lastFixTs = Date.now() - 3 * 60000;
    const src = 'last known GPS fix, 3 min old — the boat may have moved';
    expect(await A.asstOffline('drop a pin')).toMatch(new RegExp('^Dropped "Waypoint 1" \\(fish\\) at 33\\.60000, -118\\.00000 \\(' + src + '\\)\\.\\nSaved'));
    expect(toast).toHaveBeenCalledWith('Waypoint 1 saved (' + src + ')');
    const tool = await A.asstToolPlaceWaypoint({ name: 'X' });
    expect(tool.position_source).toBe(src);
    expect(tool.note).toMatch(/tell the user/);
  });
  it('trip time never uses an old SOG', async () => {
    h.Spots.all = [{ id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 }];
    h.GPS.last = { coords: { speed: 5 } };
    expect(await A.asstOffline('how far to rock pile')).toMatch(/At 10 kn/);
    vi.mocked(gpsIsStale).mockReturnValue(true);
    expect(await A.asstOffline('how far to rock pile')).toMatch(/At 20 kn/);
  });
});

/* ------------------------------------------- live-answer hint and status */
describe('the live-answer hint and Data-mode status follow the reason', () => {
  it('suggests the switch only when cloud AI is not allowed', () => {
    expect(A.asstNoWx()).toMatch(/turn on Allow cloud AI in First Mate settings for a live answer\.$/);   // never asked
    localStorage.setItem('fishapp.asst.cloudConsent', 'no');
    expect(A.asstNoWx()).toMatch(/turn on Allow cloud AI in First Mate settings/);
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    A.ASST._proxyBlocked = true;
    expect(A.asstNoWx()).toMatch(/The AI relay isn't available right now, so I can't fetch a live answer\.$/);
    expect(A.asstNoWx()).not.toMatch(/Allow cloud AI/);
    A.ASST._proxyBlocked = false;
    expect(A.asstNoWx()).toMatch(/Try again in a moment for a live answer\.$/);
    setOnline(false);
    expect(A.asstNoWx()).toMatch(/it caches so I can read it offline\. $/);
  });
  it('Data mode says when the relay, not the user, is the reason', () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    A.ASST._proxyBlocked = true;
    A.asstSetStatus();
    expect(A.asstStore.getState()).toMatchObject({ brain: 'data', statusText: 'Data mode — AI relay unavailable, answering from your boat data' });
    localStorage.setItem('fishapp.asst.cloudConsent', 'no');
    A.asstSetStatus();
    expect(A.asstStore.getState().statusText).toBe('Data mode — answering from your boat data');
  });
});

/* ------------------------------------------ consent never strands First Mate */
describe('cloud-AI consent never strands First Mate', () => {
  it('hands-free with the sheet closed: answers on the phone at once, decides nothing, asks on the next open', async () => {
    h.panelOpen = false;
    await A.asstSend('where am i');
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('fishapp.asst.cloudConsent')).toBeNull();
    expect(lastBot().text).toMatch(/^Your position:/);
    expect(lastBot().text).toMatch(/\n\n\(Answered on this phone from your boat data\. Cloud AI needs your OK on screen first — First Mate will ask the next time you open it\.\)$/);
    expect(A.asstStore.getState().busy).toBe(false);

    h.panelOpen = true;
    vi.mocked(confirmDialog).mockResolvedValueOnce(true);
    A.asstOnOpen();
    await vi.waitFor(() => expect(localStorage.getItem('fishapp.asst.cloudConsent')).toBe('yes'));
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    A.asstOnOpen();
    expect(confirmDialog).toHaveBeenCalledTimes(1);                 // asked once
  });
  it('an unanswered question times out: taken down, nothing saved, answered on the phone, not busy', async () => {
    vi.useFakeTimers();
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise((r) => {
      const d = { id: 7, resolve: (v) => { h.dialogs = h.dialogs.filter((x) => x !== d); r(v); } };
      h.dialogs.push(d);
    }));
    const p = A.asstSend('where am i');
    await vi.advanceTimersByTimeAsync(A.ASST_CONSENT_TIMEOUT_MS - 1);
    expect(A.asstStore.getState().busy).toBe(true);
    expect(h.dialogs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(h.dialogs).toHaveLength(0);
    expect(localStorage.getItem('fishapp.asst.cloudConsent')).toBeNull();
    expect(lastBot().text).toMatch(/^Your position:/);
    expect(lastBot().text).toMatch(/The cloud AI question went unanswered — ask again and choose Allow/);
    expect(A.asstStore.getState().busy).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('two askers share one open question', async () => {
    let answer;
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const a = A.asstAskCloudConsent('proxy');
    const b = A.asstAskCloudConsent('proxy');
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    answer(false);
    expect(await a).toBe('no');
    expect(await b).toBe('no');
    expect(localStorage.getItem('fishapp.asst.cloudConsent')).toBe('no');
  });
});

/* ----------------------------------------------------- proxy prompt budget */
describe('proxy system prompt fits the Worker cap', () => {
  it('asstFitSections keeps required parts, trims reference tables at whole lines', () => {
    const out = A.asstFitSections([
      { text: 'HEAD' }, { text: 'LIVE' },
      { text: 'TABLE\nrow one\nrow two\nrow three', trim: true },
      { text: 'OTHER\nx', trim: true },
    ], 4 + 2 + 4 + 2 + 'TABLE\nrow one\n…'.length);
    expect(out).toBe('HEAD\n\nLIVE\n\nTABLE\nrow one\n…');
  });
  it('drops a trimmable section that would be a header alone', () => {
    expect(A.asstFitSections([{ text: 'HEAD' }, { text: 'T\nlong row here', trim: true }], 9)).toBe('HEAD');
  });
  it('puts LIVE data before the reference tables and stays under 8000 chars', () => {
    const live = 'LIVE CONDITIONS — just fetched for Avalon:\n' + JSON.stringify({ wind_kn: 12, wave_ft: 3.1, swell_ft: 2.2, water_temp_f: 66 });
    const sys = A.asstProxySystem('what should I throw for calico at catalina, and how are the waves?', live);
    expect(sys.length).toBeLessThanOrEqual(A.ASST_PROXY_SYSTEM_CAP);
    expect(sys).toContain(live);
    expect(sys.indexOf(live)).toBeLessThan(sys.indexOf('=== LIVE BOAT DATA'));
    expect(sys).toMatch(/MOST RELEVANT TO THIS QUESTION:\n- Kelp \(Calico\) Bass/);
    expect(sys).not.toMatch(EMOJI);
    const huge = A.asstProxySystem('hi', 'LIVE ' + 'x'.repeat(3000));
    expect(huge.length).toBeLessThanOrEqual(8000);
    expect(huge).toContain('x'.repeat(3000));
  });
  it('the legacy order would have lost the live block (regression guard)', () => {
    const full = [A.asstSnapshot(), A.asstRegsTable(), A.asstTipsTable()].join('\n');
    expect(full.length + 2600).toBeGreaterThan(8000);
  });
});

/* ---------------------------------------------------------------- send */
describe('asstSend', () => {
  it('offline: answers from boat data, leaves history alone, clears busy', async () => {
    setOnline(false);
    await A.asstSend('  where am i  ');
    const m = msgs();
    expect(m[0]).toMatchObject({ role: 'user', text: 'where am i' });
    expect(m[1]).toMatchObject({ role: 'bot', thinking: false });
    expect(m[1].text).toMatch(/^Your position:/);
    expect(A.ASST.history).toEqual([]);
    expect(A.asstStore.getState().busy).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('asks for cloud consent once; declined → offline answer, says how to turn it on, nothing sent', async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    await A.asstSend('where am i');
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(confirmDialog).mock.calls[0][0];
    expect(arg.message).toContain(A.ASST_CLOUD_DATA);
    expect(arg.message).toMatch(/your position, speed and heading, local conditions, nearby reefs, your saved spots \(names, positions and notes\), your catch log \(species, sizes, baits and dates\), and trip and anchor-watch status/);
    expect(arg.message).toMatch(/Cloudflare Workers AI through the FishApp relay/);
    expect(localStorage.getItem('fishapp.asst.cloudConsent')).toBe('no');
    expect(lastBot().text).toMatch(/\n\n\(Answered on this phone from your boat data\. To use cloud AI, turn on Allow cloud AI in First Mate settings\.\)$/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await A.asstSend('where am i');
    expect(confirmDialog).toHaveBeenCalledTimes(1);           // remembered
    expect(lastBot().text).not.toMatch(/Answered on this phone/);
  });
  it('the consent question names Anthropic when the user has a key', async () => {
    localStorage.setItem('fishapp.asst.key', 'k');
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    await A.asstSend('hello');
    expect(vi.mocked(confirmDialog).mock.calls[0][0].message).toMatch(/Anthropic \(Claude\), using your own API key/);
  });
  it('proxy: sends system + the 12 messages the Worker keeps with a 90 s deadline, keeps the last 24 history entries', async () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    A.ASST.history = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
    A.ASST.history[22].content = 'z'.repeat(5000);
    globalThis.fetch = vi.fn(async () => jsonResponse({ reply: ' Fish the **kelp** edge. ' }));
    await A.asstSend('what lure for calico');
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(A.ASST_PROXY);
    expect(init.timeoutMs).toBe(90000);
    const body = JSON.parse(init.body);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'what lure for calico' });
    expect(body.messages).toHaveLength(12);
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'm13' });
    expect(body.messages.at(-3).content).toBe('z'.repeat(4000));
    expect(body.system.length).toBeLessThanOrEqual(8000);
    expect(lastBot()).toMatchObject({ text: 'Fish the **kelp** edge.', thinking: false });
    expect(A.ASST.history).toHaveLength(24);
    expect(A.ASST.history.at(-1)).toEqual({ role: 'assistant', content: 'Fish the **kelp** edge.' });
  });
  it('proxy failure: red bubble with a plain reason (never the relay\'s own text) and the offline answer; history untouched', async () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'model overloaded at /srv/x.py:12' }, 502));
    await A.asstSend('where am i');
    expect(lastBot()).toMatchObject({ error: true, thinking: false });
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(relay error 502\)\. Offline answer:\n\nYour position:/);
    expect(lastBot().text).not.toMatch(/overloaded|srv/);
    expect(A.ASST.history).toEqual([]);
    expect(A.asstStore.getState().busy).toBe(false);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);                    // a plain error doesn't hold the relay
  });
  it('a relay that refuses this origin (403) is not retried every question', async () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => { throw new Error('not json'); } }));
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(the free AI relay refused this app\)\. Offline answer:/);
    expect(A.asstStore.getState().brain).toBe('data');
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(lastBot().error).toBeFalsy();
    A.asstSaveSettings({ proxy: '' });
    expect(A.asstStore.getState().brain).toBe('proxy');
  });
  it('drops a second send while one is in flight (busy guard), then recovers', async () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = r; }));
    const p = A.asstSend('first');
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(A.asstStore.getState().busy).toBe(true);
    await A.asstSend('second');
    expect(msgs().filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['first']);
    release(jsonResponse({ reply: 'done' }));
    await p;
    expect(A.asstStore.getState().busy).toBe(false);
  });
  it('Clear chat while a reply is in flight: the reply is never written, spoken or remembered', async () => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = r; }));
    const p = A.asstSend('first');
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    A.asstClearChat();
    release(jsonResponse({ reply: 'late answer' }));
    await p;
    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].greeting).toBe(true);
    expect(A.ASST.history).toEqual([]);
    expect(A.asstStore.getState().busy).toBe(false);
  });
  it('Claude: one system prompt per question, tools run, progress shown, history recorded', async () => {
    localStorage.setItem('fishapp.asst.key', 'k');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    h.Spots.all = [{ id: 1, name: 'Rock Pile', type: 'fish', lat: 33.7, lng: -118.1 }];
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 't1', name: 'list_waypoints', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have one spot: Rock Pile.' }] },
    ];
    globalThis.fetch = vi.fn(async () => jsonResponse(replies.shift()));
    await A.asstSend('list my spots');
    const calls = vi.mocked(globalThis.fetch).mock.calls.map((c) => JSON.parse(c[1].body));
    expect(calls).toHaveLength(2);
    expect(calls[1].system).toBe(calls[0].system);
    expect(calls[1].messages[1].content[0]).toEqual({ type: 'thinking', thinking: '' });   // replayed unchanged
    expect(calls[1].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: false });
    expect(JSON.parse(calls[1].messages[2].content[0].content).waypoints[0].name).toBe('Rock Pile');
    expect(lastBot().text).toBe('You have one spot: Rock Pile.');
    expect(A.ASST.history).toEqual([{ role: 'user', content: 'list my spots' }, { role: 'assistant', content: 'You have one spot: Rock Pile.' }]);
  });
  it('Claude: a 401 is labelled "bad API key"', async () => {
    localStorage.setItem('fishapp.asst.key', 'bad');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: { message: 'invalid x-api-key' } }, 401));
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(bad API key\)\. Offline answer:/);
  });
  it('Claude: a refusal falls back to the offline answer and is not remembered', async () => {
    localStorage.setItem('fishapp.asst.key', 'k');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => jsonResponse({ stop_reason: 'refusal', content: [] }));
    await A.asstSend('where am i');
    expect(lastBot()).toMatchObject({ error: true });
    expect(lastBot().text).toMatch(/^The AI wouldn't answer that one\. Offline answer:\n\nYour position:/);
    expect(A.ASST.history).toEqual([]);
  });
  it('Claude: after 6 tool rounds it reports what it did instead of "(no reply)"', async () => {
    localStorage.setItem('fishapp.asst.key', 'k');
    globalThis.fetch = vi.fn(async () => jsonResponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'list_waypoints', input: {} }] }));
    const out = await A.asstAskOnline('loop', null);
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
    expect(out).toBe("I ran out of steps before finishing that one. Here's what I did do: reading waypoints.\n\nAsk me again — more simply, or one part at a time.");
  });
  it('greeting and chips appear on open, also after a hands-free first question', () => {
    A.asstOnOpen();
    expect(msgs()[0]).toMatchObject({ role: 'bot', greeting: true });
    expect(msgs()[0].text).toMatch(/^Ahoy! I'm First Mate\./);
    expect(A.asstStore.getState().showChips).toBe(true);
    A.asstStore.setState({ messages: [{ id: 999, role: 'user', text: 'tides' }], showChips: false });
    A.asstOnOpen();
    expect(A.asstStore.getState().showChips).toBe(true);
  });
});

/* ------------------------------------------- relay back-off (Worker 429 / 503) */
describe('relay back-off: a busy or failing relay is not hammered', () => {
  const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
  const at = (s) => vi.setSystemTime(T0 + s * 1000);
  beforeEach(() => {
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  it('429: offline answer at once, then no request (not even live data) until retryAfter has passed', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'rate_limited', retryAfter: 45 }, 429));
    await A.asstSend('where am i');
    expect(lastBot()).toMatchObject({ error: true, thinking: false });
    expect(lastBot().text).toMatch(/^The free AI is busy \(try again in under a minute\)\. Offline answer:\n\nYour position:/);
    expect(A.ASST.history).toEqual([]);
    at(30);
    await A.asstSend("what's the wind and swell like");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(lastBot().text).toMatch(/^The free AI is busy \(try again in under a minute\)\. Offline answer:/);
    expect(A.asstStore.getState().busy).toBe(false);
    at(45);
    globalThis.fetch = vi.fn(async () => jsonResponse({ reply: 'back' }));
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(lastBot()).toMatchObject({ text: 'back' });
  });
  it('503: no internal detail; a long wait (spent allowance) is checked again within 30 min', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'ai_unavailable', retryAfter: 40000 }, 503));
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^The free AI is unavailable right now \(try again in about 30 min\)\. Offline answer:\n\nYour position:/);
    expect(lastBot().text).not.toMatch(/ai_unavailable/);
    at(29 * 60);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(lastBot().text).toMatch(/^The free AI is unavailable right now \(try again in about a minute\)\./);
    at(30 * 60);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it('asstRetryAfterS: body first, then the Retry-After header, then the default — clamped to 5 s … 30 min', () => {
    const hdr = (v) => ({ headers: { get: (k) => (k === 'Retry-After' ? v : null) } });
    expect(A.asstRetryAfterS(hdr('99'), { retryAfter: 12 }, 60)).toBe(12);
    expect(A.asstRetryAfterS(hdr('99'), {}, 60)).toBe(99);
    expect(A.asstRetryAfterS(hdr('Wed, 21 Oct 2026 07:28:00 GMT'), null, 60)).toBe(60);
    expect(A.asstRetryAfterS({}, { retryAfter: 0.2 }, 60)).toBe(5);
    expect(A.asstRetryAfterS(hdr(null), { retryAfter: 86000 }, 60)).toBe(1800);
    expect(A.asstRetryAfterS(hdr(null), { retryAfter: -3 }, 60)).toBe(60);
  });
  it('a timeout holds the relay for a minute; a plain connection failure does not, and its text never shows', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('timed out after 90s'); });
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^The free AI didn't answer in time \(try again in about a minute\)\. Offline answer:/);
    at(59);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    at(60);
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(no connection\)\. Offline answer:/);
    expect(lastBot().text).not.toMatch(/Failed to fetch/);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it('a 200 that is not JSON (a captive portal) reads as no connection; a 413 (a relay with a smaller cap) says how to recover', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'"); } }));
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(no connection\)\. Offline answer:/);
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'too_large' }, 413));
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(the conversation is too long — Clear chat and ask again\)\. Offline answer:/);
  });
  it('the consent question still comes first while the relay is held', async () => {
    localStorage.removeItem('fishapp.asst.cloudConsent');
    A.asstRelayHold('chat', 30, 'busy');
    await A.asstSend('where am i');
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(lastBot().text).toMatch(/^The free AI is busy \(try again in under a minute\)\. Offline answer:/);
  });
  it('saving the endpoint gives the relay a fresh chance', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'rate_limited', retryAfter: 60 }, 429));
    await A.asstSend('where am i');
    expect(A.asstRelayHeld('chat')).toEqual({ why: 'busy', waitS: 60 });
    A.asstSaveSettings({ proxy: 'https://mine.workers.dev' });
    expect(A.asstRelayHeld('chat')).toBeNull();
  });
});

/* ------------------------------- the relay body, against the real Worker (proxy/first-mate-worker.js) */
describe('relay request vs the real Worker', () => {
  const SITE_ORIGIN = new URL(SITE.siteUrl).origin;
  const bytes = (s) => new TextEncoder().encode(s).length;
  const workerEnv = () => ({ AI: { run: vi.fn(async () => ({ response: 'Fish the kelp edge.' })) } });
  /* A browser page at `origin` calling the Worker: the preflight, then the POST, each readable only
     when CORS allows it — otherwise fetch rejects exactly as a dropped connection does. */
  function browserTo(origin, wenv) {
    return vi.fn(async (url, init) => {
      if (url !== A.asstProxyUrl()) throw new TypeError('Failed to fetch');
      const headers = { Origin: origin, 'CF-Connecting-IP': '192.0.2.44' };
      const pre = await worker.fetch(new Request(url, { method: 'OPTIONS', headers }), wenv);
      if (pre.headers.get('Access-Control-Allow-Origin') !== origin) throw new TypeError('Failed to fetch');
      const r = await worker.fetch(new Request(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: init.body }), wenv);
      if (r.headers.get('Access-Control-Allow-Origin') !== origin) throw new TypeError('Failed to fetch');
      return r;
    });
  }
  beforeEach(() => { localStorage.setItem('fishapp.asst.cloudConsent', 'yes'); });

  it('the web app\'s own origin gets its answer', async () => {
    const wenv = workerEnv();
    globalThis.fetch = browserTo(SITE_ORIGIN, wenv);
    await A.asstSend('what lure for calico');
    expect(lastBot()).toMatchObject({ text: 'Fish the kelp edge.', thinking: false });
  });
  it('a refused origin reads as refused (Data mode, not asked again), never as "no connection" on every question', async () => {
    const wenv = workerEnv();
    globalThis.fetch = browserTo('https://fishapp.example', wenv);
    await A.asstSend('where am i');
    expect(lastBot().text).toMatch(/^Couldn't reach the AI \(the free AI relay refused this app\)\. Offline answer:/);
    expect(A.asstStore.getState().brain).toBe('data');
    expect(A.asstStore.getState().statusText).toMatch(/AI relay unavailable/);
    await A.asstSend('where am i');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(wenv.AI.run).not.toHaveBeenCalled();
  });
  it('long non-Latin pastes no longer push the body past 64 KB and 413 every later question', async () => {
    // Five 3,500-character CJK pastes with replies used to make a 73 KB body for "any bait tips?".
    for (const c of ['鱼', '浪', '潮', '风', '船']) A.ASST.history.push({ role: 'user', content: c.repeat(3500) }, { role: 'assistant', content: 'r'.repeat(700) });
    const wenv = workerEnv();
    globalThis.fetch = browserTo(SITE_ORIGIN, wenv);
    await A.asstSend('any bait tips?');
    expect(lastBot()).toMatchObject({ text: 'Fish the kelp edge.', thinking: false });
    const body = vi.mocked(globalThis.fetch).mock.calls[0][1].body;
    expect(bytes(body)).toBeLessThanOrEqual(A.ASST_PROXY_MAX_BODY);
    const sent = JSON.parse(body).messages;
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'any bait tips?' });
    expect(sent.at(-2)).toEqual({ role: 'assistant', content: 'r'.repeat(700) });   // newest history kept, oldest dropped
    await A.asstSend('and tomorrow?');
    expect(lastBot()).toMatchObject({ text: 'Fish the kelp edge.' });
  });
  it('asstProxyBody: history that fits the token budget but not the byte cap is dropped oldest first', () => {
    const ctl = '\u0001'.repeat(4000);                 // 1000 tokens, but 24 KB once escaped
    const msgs = [ctl, ctl, ctl, ctl].map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }));
    msgs.push({ role: 'user', content: 'q' });
    const body = A.asstProxyBody('S', msgs);
    expect(bytes(body)).toBeLessThanOrEqual(A.ASST_PROXY_MAX_BODY);
    expect(JSON.parse(body).messages.map((m) => m.content.length)).toEqual([4000, 4000, 1]);
  });
  it('asstEstTokens: ~4 ASCII characters a token, any other unit one each', () => {
    expect(A.asstEstTokens('')).toBe(0);
    expect(A.asstEstTokens('abcde')).toBe(2);
    expect(A.asstEstTokens('鱼鱼')).toBe(2);
    expect(A.asstEstTokens('🐟')).toBe(2);
  });
  it('our own 8000-character system prompt is never cut by the token cap, and leaves room for the conversation', () => {
    const t = A.asstEstTokens(A.asstProxySystem('what lure for calico', ''));
    expect(t).toBeLessThan(A.ASST_PROXY_SYSTEM_TOKENS);
    expect(A.ASST_PROXY_INPUT_TOKENS - t).toBeGreaterThan(1500);
  });
  /* The two sides must agree on what the model gets: the app should never upload what the Worker
     will throw away, and the Worker should never cut what the app thought it sent. */
  it.each([
    ['a long ASCII history', () => [A.asstProxySystem('what lure for calico', ''), [...Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })), { role: 'user', content: 'q'.repeat(4000) }]]],
    ['CJK pastes', () => [A.asstProxySystem('tides', ''), ['鱼', '浪', '潮'].flatMap((c) => [{ role: 'user', content: c.repeat(3500) }, { role: 'assistant', content: '好'.repeat(900) }]).concat({ role: 'user', content: '潮'.repeat(4000) })]],
    ['a non-Latin system prompt and an emoji question', () => ['海'.repeat(8000), [{ role: 'user', content: 'a' + '🐟'.repeat(3000) }]]],
    ['escape-heavy history', () => ['S', ['"\n'.repeat(2000), '\u0001'.repeat(4000), '"\n'.repeat(2000)].map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content })).concat({ role: 'user', content: 'ok?' })]],
  ])('%s: the Worker accepts the body and forwards every character of it', async (_, make) => {
    const [system, messages] = make();
    const body = A.asstProxyBody(system, messages);
    expect(bytes(body)).toBeLessThanOrEqual(A.ASST_PROXY_MAX_BODY);
    const wenv = workerEnv();
    const r = await worker.fetch(new Request(A.ASST_PROXY, { method: 'POST', headers: { Origin: SITE_ORIGIN, 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.45' }, body }), wenv);
    expect(r.status).toBe(200);
    const sent = JSON.parse(body);
    expect(sent.messages.at(-1).role).toBe('user');
    expect(wenv.AI.run.mock.calls[0][1].messages).toEqual([{ role: 'system', content: sent.system }, ...sent.messages]);
  });
});

/* ---------------------------------------------------------------- tools */
describe('tools', () => {
  it('get_conditions never turns missing data into NaN or 0', async () => {
    globalThis.fetch = vi.fn(async (url) => jsonResponse(String(url).includes('marine') ? { current: { wave_height: null } } : { error: true, reason: 'x' }));
    const out = await A.asstToolConditions({});
    expect(out).toEqual({ position: '33.6000, -118.0000', wind: 'unavailable (offline?)' });
  });
  it('toggle_layer goes through setDataOverlay and reports a refusal', () => {
    vi.mocked(setDataOverlay).mockImplementation((id, on) => { if (id !== 'sst') h.layersStore.setState({ [id]: on }); });
    expect(A.asstToolToggleLayer({ layer: 'wind', on: true })).toEqual({ layer: 'wind', on: true });
    expect(setDataOverlay).toHaveBeenCalledWith('wind', true);
    const sst = A.asstToolToggleLayer({ layer: 'sst', on: true });
    expect(sst.on).toBe(false);
    expect(sst.note).toMatch(/could not turn this layer on/);
    expect(A.asstToolToggleLayer({ layer: 'tides', on: true })).toEqual({ error: 'unknown layer "tides"' });
  });
  it('place_waypoint says when it used the map center instead of a fix', async () => {
    const live = await A.asstToolPlaceWaypoint({ name: 'Live' });
    expect(live).toMatchObject({ ok: true, position_source: 'live GPS' });
    expect(live.note).toBeUndefined();
    h.GPS.lastLatLng = null;
    h.map = { getCenter: () => L.latLng(33, -117.5) };
    const guess = await A.asstToolPlaceWaypoint({ name: 'Guess' });
    expect(guess).toMatchObject({ ok: true, position_source: 'map center — no GPS fix yet', lat: 33, lng: -117.5 });
    expect(guess.note).toMatch(/tell the user/);
    expect(toast).toHaveBeenLastCalledWith('Guess saved (map center — no GPS fix yet)');
  });
  it('delete_waypoint removes the first partial match and reports the rest', async () => {
    h.Spots.all = [{ id: 1, name: 'Rock Pile North', lat: 0, lng: 0 }, { id: 2, name: 'Rock Pile South', lat: 0, lng: 0 }];
    expect(await A.asstToolDeleteWaypoint({ name: 'rock pile' })).toEqual({ deleted: 'Rock Pile North', other_matches: 1 });
    expect(h.Spots.all.map((s) => s.id)).toEqual([2]);
    expect(await A.asstToolDeleteWaypoint({ name: 'nope' })).toEqual({ error: 'no waypoint matching "nope"' });
  });
});

/* --------------------------------------------------------------- speech */
describe('speech', () => {
  let spoken;
  beforeEach(() => {
    spoken = [];
    window.speechSynthesis = { speak: (u) => spoken.push(u), cancel: vi.fn(), getVoices: () => [] };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  afterEach(() => { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; });

  it('is silent with Speak off; the settings test plays anyway', () => {
    A.ASST.speak = false;
    A.asstSpeak('hello');
    expect(spoken).toHaveLength(0);
    A.asstTestVoice('', false);
    expect(spoken[0].text).toBe('This is how I sound.');
  });
  it('device speech holds the mic shut (Voice._muteUntil) and releases 700 ms after it ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    A.ASST.speak = true;
    h.Voice._muteUntil = 0;
    const text = 'x'.repeat(140);
    A.asstSpeak(text);
    expect(h.Voice._muteUntil).toBe(1_000_000 + 1200 + (140 / 14) * 1000);
    h.Voice._muteUntil = 9_999_999;             // a longer guard is never shortened
    A.asstSpeak(text);
    expect(h.Voice._muteUntil).toBe(9_999_999);
    spoken[1].onend();
    expect(h.Voice._muteUntil).toBe(1_000_000 + 700);
  });
  it('strips markdown and emoji and caps at 700 characters', () => {
    A.ASST.speak = true;
    A.asstSpeak('**Rough** \u{26A0}\u{FE0F} ' + 'y'.repeat(900));
    expect(spoken[0].text.startsWith('Rough y')).toBe(true);
    expect(spoken[0].text.length).toBe(700);
  });
  it('stop cancels the device voice and invalidates an in-flight cloud utterance', () => {
    A.ASST._speakWanted = true;
    const g = A.ASST._speakGen || 0;
    A.asstStopSpeech();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(A.ASST._speakWanted).toBe(false);
    expect(A.ASST._speakGen).toBe(g + 1);
  });
  it('the cloud voice needs cloud AI allowed: off when switched off AND when never asked', () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    expect(A.asstCloudVoiceOn()).toBe(false);              // consent null (never asked)
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    expect(A.asstCloudVoiceOn()).toBe(true);
    localStorage.setItem('fishapp.asst.cloudConsent', 'no');
    expect(A.asstCloudVoiceOn()).toBe(false);
  });
  it('consent null + a saved cloudvoice=1 (legacy build): speech uses the device voice, nothing is POSTed', () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    A.ASST.speak = true;
    A.asstSpeak('You are at 33.6, -118.0');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('You are at 33.6, -118.0');
    A.asstTestVoice('', true);                             // the settings test asking for the cloud voice
    expect(spoken).toHaveLength(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('with cloud AI allowed the natural voice goes to the relay /tts route', () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    A.ASST.speak = true;
    A.asstSpeak('hello');
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(A.ASST_PROXY + '/tts');
    expect(spoken).toHaveLength(0);
  });
  it('a 429 from /tts speaks on the device and holds /tts (not the chat) instead of asking again', async () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'rate_limited', retryAfter: 20 }, 429));
    A.ASST.speak = true;
    A.asstSpeak('hello');
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(A.asstRelayHeld('tts')).toMatchObject({ why: 'busy' });
    expect(A.asstRelayHeld('chat')).toBeNull();
    A.asstSpeak('again');
    expect(spoken.map((u) => u.text)).toEqual(['hello', 'again']);     // straight to the device voice
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('a 403 from /tts (this origin refused) stops offering the relay, voice and chat alike', async () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'forbidden' }, 403));
    A.ASST.speak = true;
    A.asstSpeak('hello');
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(A.ASST._proxyBlocked).toBe(true);
    expect(A.asstBrainInputs().proxy).toBe(false);
    A.asstSpeak('again');
    expect(spoken).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('a /tts timeout holds the cloud voice for a minute', async () => {
    localStorage.setItem('fishapp.asst.cloudvoice', '1');
    localStorage.setItem('fishapp.asst.cloudConsent', 'yes');
    globalThis.fetch = vi.fn(async () => { throw new Error('timed out after 30s'); });
    A.ASST.speak = true;
    A.asstSpeak('hello');
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(A.asstRelayHeld('tts')).toMatchObject({ why: 'slow', waitS: 60 });
    A.asstSpeak('again');
    expect(spoken).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('ranks natural voices first and picks the honest hint', () => {
    const vs = [
      { name: 'Samantha (Compact)', lang: 'en-US' }, { name: 'Ava (Enhanced)', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB', localService: true },
    ];
    expect(vs.slice().sort((a, b) => A.asstVoiceScore(b) - A.asstVoiceScore(a))[0].name).toBe('Ava (Enhanced)');
    expect(A.asstVoiceHintKind([], '', false)).toBe('none');
    expect(A.asstVoiceHintKind(['Ava (Enhanced)', 'Daniel'], 'Ava (Enhanced)', true)).toBe('natural');
    expect(A.asstVoiceHintKind(['Ava (Enhanced)', 'Daniel'], 'Daniel', true)).toBe('pick-natural');
    expect(A.asstVoiceHintKind(['Samantha'], 'Samantha', true)).toBe('ios');
    expect(A.asstVoiceHintKind(['Samantha'], 'Samantha', false)).toBe('no-natural');
  });
});
