// @vitest-environment jsdom
/* Hey Fish command parsing: wake word, normalisation, question routing and the rule table.
   Characterised against the legacy voice.js (evaluated as-is), so the only differences are the
   deliberate fixes listed at the bottom. */
import { describe, expect, it, vi } from 'vitest';

// voice.js imports the live engine; none of it is touched by the pure matchers below.
vi.mock('../../../src/engine/gps.js', () => ({ GPS: {}, formatCoord: () => '', gpsIsStale: () => false, requestWakeLock: () => {}, setFollow: () => {} }));
vi.mock('../../../src/engine/tracks.js', () => ({ Tracks: {}, trackStart: () => {}, trackStop: () => {} }));
vi.mock('../../../src/engine/nav.js', () => ({ Nav: {}, anchorDrop: () => {}, anchorRaise: () => {}, routeStart: () => {}, unlockAudio: () => {} }));
vi.mock('../../../src/engine/goto.js', () => ({ Goto: {}, gotoCancel: () => {} }));
vi.mock('../../../src/engine/bite.js', () => ({ biteSpokenSummary: () => '', biteWindows: async () => ({}) }));
vi.mock('../../../src/engine/assistant.js', () => ({ ASST: {}, asstCreateSpot: async () => ({}), asstSend: async () => {}, asstSpeak: () => {}, asstUpdateSpeakBtn: () => {} }));
vi.mock('../../../src/engine/app.js', () => ({ applyPendingUpdate: () => {}, getMap: () => null }));

const { voiceNorm, voiceIsQuestion, voiceMatch, WAKE_RE, VOICE_COMMANDS } = await import('../../../src/engine/voice.js');
const { loadLegacy } = await import('./legacy.js');
const legacy = loadLegacy('voice.js', ['VOICE_COMMANDS', 'voiceNorm', 'voiceIsQuestion', 'WAKE_RE']);

/* The legacy table had no ids; this is its rule order. */
const LEGACY_IDS = ['mark', 'route-start', 'nav-stop', 'anchor-drop', 'anchor-raise', 'track', 'zoom-in', 'zoom-out',
  'follow', 'close', 'bite', 'position', 'speed', 'weather', 'tides', 'spots', 'tools', 'download', 'layers', 'guides',
  'emergency', 'more'];
function legacyMatch(cmd) {
  const asking = legacy.voiceIsQuestion(cmd);
  for (let i = 0; i < legacy.VOICE_COMMANDS.length; i++) {
    const c = legacy.VOICE_COMMANDS[i];
    if (c.panel && asking) continue;
    if (c.re.test(cmd)) return LEGACY_IDS[i];
  }
  return null;
}
/* The Guides rule was split three ways (fish tab / knots tab / last tab); compare as one. */
const collapse = (id) => (id && id.startsWith('guides') ? 'guides' : id);
const idOf = (raw) => { const c = voiceMatch(voiceNorm(raw)); return c ? c.id : null; };

describe('voiceNorm', () => {
  it('lower-cases, turns punctuation into spaces and squeezes whitespace', () => {
    expect(voiceNorm("  Hey FISH, what's   the TIDE?! ")).toBe('hey fish what s the tide');
    expect(voiceNorm('when’s the bite')).toBe('when s the bite');
    expect(voiceNorm(null)).toBe('');
    expect(voiceNorm(undefined)).toBe('');
  });
  it('is the legacy function', () => {
    for (const s of ["What's up", 'Drop   the anchor.', 'ok-fish', 'Hey, Fish! Zoom in']) expect(voiceNorm(s)).toBe(legacy.voiceNorm(s));
  });
});

describe('wake word', () => {
  const wakes = (s) => WAKE_RE.test(voiceNorm(s));
  it('accepts the common mishearings of "hey fish"', () => {
    for (const s of ['hey fish', 'Hay fish', 'hi fish', 'high fish', 'ok fish', 'okay fish', 'hey fisch', 'hey fist', 'hey phish', 'hey vish', 'hey fresh', 'hey finch', 'heyfish'])
      expect(wakes(s), s).toBe(true);
  });
  it('does NOT wake on a bare "a fish" (a fishing boat says it all day)', () => {
    for (const s of ['I caught a fish', 'a fish', 'that is a fish', 'nice fish', 'fish on']) expect(wakes(s), s).toBe(false);
  });
  it('is the legacy pattern', () => {
    expect(WAKE_RE.source).toBe(legacy.WAKE_RE.source);
  });
});

describe('voiceIsQuestion', () => {
  it('question words make it a question', () => {
    for (const s of ['what s the weather', 'whats the weather', 'when is high tide', 'where is the reef', 'how deep is it', 'is it windy', 'should i go', 'any fish here'])
      expect(voiceIsQuestion(s), s).toBe(true);
  });
  it('a named place makes it a question, but "near me / here / the boat" does not', () => {
    expect(voiceIsQuestion('weather in catalina')).toBe(true);
    expect(voiceIsQuestion('tides at dana point')).toBe(true);
    expect(voiceIsQuestion('tides near me')).toBe(false);
    expect(voiceIsQuestion('weather around here')).toBe(false);
    expect(voiceIsQuestion('weather by the boat')).toBe(false);
  });
  it('"in 30 feet" is not somewhere else', () => {
    expect(voiceIsQuestion('mark this spot in 30 feet')).toBe(false);
  });
});

describe('command table', () => {
  it('every rule has a unique id', () => {
    const ids = VOICE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ['mark this spot', 'mark'], ['save my spot', 'mark'], ['save this location', 'mark'], ['drop a pin', 'mark'],
    // the mark rule needs an object noun — these must NOT drop a waypoint
    ['save my track', 'spots'], ['mark the route', null],
    ['start the route', 'route-start'], ['follow route', 'route-start'],
    ['stop navigation', 'nav-stop'], ['cancel the route', 'nav-stop'], ['end nav', 'nav-stop'],
    ['drop the anchor', 'anchor-drop'], ['anchor watch on', 'anchor-drop'],
    ['raise the anchor', 'anchor-raise'], ['anchor watch off', 'anchor-raise'],
    ['start tracking', 'track'], ['stop track', 'track'], ['record a track', 'track'],
    ['zoom in', 'zoom-in'], ['closer', 'zoom-in'], ['zoom out', 'zoom-out'], ['wider', 'zoom-out'],
    ['follow me', 'follow'], ['recenter', 'follow'], ['never mind', 'close'], ['go back', 'close'],
    ['when should i go', 'bite'], ['best time to fish', 'bite'], ['should i go fishing', 'bite'],
    ["when's the bite", 'bite'], ['when’s the bite', 'bite'], ['whens the bite', 'bite'], ['when is the bite', 'bite'],
    ['where am i', 'position'], ['my position', 'position'],
    ['how fast are we going', 'speed'], ['boat speed', 'speed'], ['sog', 'speed'],
    // the BOAT's speed only — never answer the wind question with SOG
    ["what's the wind speed", null], ['wind speed', 'weather'],
    ['show me the weather', 'weather'], ['tides near me', 'tides'], ["what's the tide in catalina", null],
    ['offline charts', 'download'], ['charts', 'layers'], ['nav tools', 'tools'], ['catch log', 'tools'],
    ['fish id', 'guides-fish'], ['show me the limits', 'guides-fish'], ['regulations', 'guides-fish'],
    ['knots', 'guides-knots'], ['open guides', 'guides'],
    ['emergency', 'emergency'], ['mayday', 'emergency'], ['menu', 'more'],
    ['tell me a joke', null],
  ])('%s → %s', (phrase, id) => {
    expect(idOf(phrase)).toBe(id);
  });

  it('matches the legacy table on a broad corpus, except the documented fixes', () => {
    const corpus = [
      'mark this spot', 'save my spot', 'save this location', 'drop a pin', 'mark this', 'save my track', 'mark the route',
      'start the route', 'follow route', 'stop navigation', 'cancel the route', 'end nav', 'drop the anchor',
      'anchor watch on', 'raise the anchor', 'anchor watch off', 'start tracking', 'stop track', 'record a track',
      'start the track', 'zoom in', 'closer', 'zoom out', 'wider', 'follow me', 'center', 'find me', 'close',
      'never mind', 'go back', 'when should i go', 'best time to fish', 'when to go', 'should i go fishing', 'best day',
      'where am i', 'my position', 'coordinates', 'how fast are we going', 'my speed', 'boat speed', 'sog',
      "what's the wind speed", 'show me the weather', 'wind', 'forecast', 'swell', 'tides', 'tides near me',
      'bite time', 'moon', "what's the tide in catalina", 'spots', 'my waypoints', 'tracks', 'voyages', 'nav tools',
      'catch log', 'trip', 'download', 'offline charts', 'layers', 'chart', 'map', 'guides', 'knots', 'fish id',
      'regulations', 'limits', 'emergency', 'mayday', 'sos', 'more', 'menu', "what's the weather in catalina",
      'how deep is it in 30 feet', 'tell me a joke', 'show me the weather near me', 'whens the bite',
      'mark this spot at the point', 'weather at catalina', 'is there wind',
    ].map(voiceNorm);
    for (const c of corpus) expect(collapse(voiceMatch(c)?.id ?? null), c).toBe(legacyMatch(c));
    // FIX: "when's the bite" normalises to "when s the bite", which the legacy pattern never matched.
    expect(legacyMatch(voiceNorm("when's the bite"))).toBeNull();
    expect(idOf("when's the bite")).toBe('bite');
  });

  it('questions skip only the panel rules', () => {
    expect(idOf('what is my position')).toBe('position');
    expect(idOf('what is the weather')).toBeNull();
    expect(idOf('can you mark this spot')).toBe('mark');
  });
});
