// @vitest-environment jsdom
/* Hey Fish engine: commands report what really happened, the echo guard, the mic session
   lifecycle (stale recognisers, permission errors, backgrounding, relaunch resume) and the
   view store the tab button renders. Everything outside voice.js is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  GPS: { lastLatLng: null, last: null, lastFixTs: 0, coarse: false },
  stale: false,
  Nav: { route: { pts: [] }, anchor: { watching: false, radiusFt: 150 } },
  Goto: { active: false, route: null, startTs: 0 },
  Tracks: { recording: false, points: [] },
  ASST: { speak: false, streaming: false },
  map: { z: 12, setZoom: null, getZoom: null },
  fns: {},
}));

function fn(name, impl) { h.fns[name] = vi.fn(impl); return (...a) => h.fns[name](...a); }

vi.mock('../../../src/engine/gps.js', () => ({
  GPS: h.GPS,
  // same algorithm as gps.js formatCoord (the VHF degrees + decimal minutes format)
  formatCoord: (v, axis) => {
    const hemi = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    const t = Math.round(Math.abs(v) * 60000);
    return Math.floor(t / 60000) + '°' + ((t % 60000) / 1000).toFixed(3) + "'" + hemi;
  },
  gpsIsStale: () => h.stale,
  requestWakeLock: fn('requestWakeLock'),
  setFollow: fn('setFollow'),
}));
vi.mock('../../../src/engine/tracks.js', () => ({ Tracks: h.Tracks, trackStart: fn('trackStart'), trackStop: fn('trackStop') }));
vi.mock('../../../src/engine/nav.js', () => ({
  Nav: h.Nav, anchorDrop: fn('anchorDrop'), anchorRaise: fn('anchorRaise'), routeStart: fn('routeStart'), unlockAudio: fn('unlockAudio'),
}));
vi.mock('../../../src/engine/goto.js', () => ({ Goto: h.Goto, gotoCancel: fn('gotoCancel') }));
vi.mock('../../../src/engine/bite.js', () => ({ biteSpokenSummary: fn('biteSpokenSummary', () => 'Best window is tomorrow.'), biteWindows: fn('biteWindows', async () => ({ windows: [] })) }));
vi.mock('../../../src/engine/assistant.js', () => ({
  ASST: h.ASST,
  asstCreateSpot: fn('asstCreateSpot', async (o) => o),
  asstSend: fn('asstSend', async () => {}),
  // records whether speech was enabled at the moment it was asked to speak
  asstSpeak: fn('asstSpeak', (t) => ({ t, speak: h.ASST.speak })),
  asstUpdateSpeakBtn: fn('asstUpdateSpeakBtn'),
}));
vi.mock('../../../src/engine/app.js', () => ({
  applyPendingUpdate: fn('applyPendingUpdate'),
  getMap: () => ({ getZoom: () => h.map.z, setZoom: (z, o) => { h.map.set = [z, o]; } }),
}));

/* A stand-in for (webkit)SpeechRecognition. */
class FakeRec {
  static instances = [];
  constructor() { FakeRec.instances.push(this); this.started = 0; this.aborted = 0; }
  start() { this.started++; if (FakeRec.throwOnStart) throw new Error('busy'); }
  abort() { this.aborted++; }
  stop() {}
  say(text) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); }
}

let V, ui;
async function load({ supported = true, native = false } = {}) {
  vi.resetModules();
  if (supported) window.webkitSpeechRecognition = FakeRec; else delete window.webkitSpeechRecognition;
  if (native) window.FishNative = { platform: 'ios', version: 1, post: vi.fn() }; else delete window.FishNative;
  V = await import('../../../src/engine/voice.js');
  ui = await import('../../../src/services/ui');
}
const spoken = () => h.fns.asstSpeak.mock.calls.map((c) => c[0]);
const lastSaid = () => spoken().at(-1);
function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
}

beforeEach(async () => {
  Object.assign(h.GPS, { lastLatLng: null, last: null, lastFixTs: 0, coarse: false });
  h.stale = false;
  h.Nav.route.pts = [];
  Object.assign(h.Nav.anchor, { watching: false, radiusFt: 150, ll: null });
  Object.assign(h.Goto, { active: false, route: null, startTs: 0 });
  Object.assign(h.Tracks, { recording: false, points: [] });
  delete h.Tracks.unsaved;
  Object.assign(h.ASST, { speak: false, streaming: false });
  h.map.z = 12; h.map.set = null;
  for (const f of Object.values(h.fns)) f.mockClear();
  FakeRec.instances = []; FakeRec.throwOnStart = false;
  setHidden(false);
  localStorage.clear();
  window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] };   // a device with TTS
  await load();
});
/* Each test gets a fresh voice.js (vi.resetModules), but every instance keeps its
   visibilitychange listener on the shared jsdom document — switch the old one fully off. */
afterEach(() => { V.voiceStop(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('commands report what actually happened', () => {
  it('route start with fewer than 2 points says so and does not try', async () => {
    h.Nav.route.pts = [{ lat: 1, lng: 1 }];
    await V.voiceRun('start the route');
    expect(h.fns.routeStart).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('There is no route to follow yet. Plan at least two points first.');
  });
  it('route start that really starts says so', async () => {
    h.Nav.route.pts = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
    h.fns.routeStart.mockImplementation(async () => { Object.assign(h.Goto, { active: true, route: [1, 2], startTs: 5 }); });
    await V.voiceRun('start the route');
    expect(lastSaid()).toBe('Starting the route.');
  });
  it('"follow the route" while already following it (the planner is cleared on start) says so', async () => {
    h.Nav.route.pts = [];
    Object.assign(h.Goto, { active: true, route: [1, 2, 3], startTs: 5 });
    await V.voiceRun('follow the route');
    expect(h.fns.routeStart).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('You are already following the route.');
    // a single-destination Go-To is not a route
    Object.assign(h.Goto, { active: true, route: null });
    await V.voiceRun('start the route');
    expect(lastSaid()).toBe('There is no route to follow yet. Plan at least two points first.');
  });
  it('route start the user backs out of (voyage in progress) is reported', async () => {
    h.Nav.route.pts = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
    Object.assign(h.Goto, { active: true, route: null, startTs: 3 });
    h.fns.routeStart.mockImplementation(async () => {});
    await V.voiceRun('follow route');
    expect(lastSaid()).toBe('The route did not start.');
  });

  it('stop navigation when not navigating', async () => {
    await V.voiceRun('stop navigation');
    expect(h.fns.gotoCancel).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('You are not navigating right now.');
  });
  it('stop navigation the user cancels at the confirm keeps navigating — and says so', async () => {
    h.Goto.active = true;
    h.fns.gotoCancel.mockImplementation(async () => {});           // confirm answered "Cancel"
    await V.voiceRun('stop navigation');
    expect(lastSaid()).toBe('Navigation is still on.');
  });
  it('stop navigation that ends it', async () => {
    h.Goto.active = true;
    h.fns.gotoCancel.mockImplementation(async () => { h.Goto.active = false; });
    await V.voiceRun('cancel the route');
    expect(lastSaid()).toBe('Navigation stopped.');
  });
  it('a confirm left open on screen gets a spoken heads-up, then the real result', async () => {
    vi.useFakeTimers();
    h.Goto.active = true;
    h.fns.gotoCancel.mockImplementation(async () => {
      const ok = await ui.confirmDialog({ title: 'End navigation without saving this voyage?' });
      if (ok) h.Goto.active = false;
    });
    const p = V.voiceRun('stop navigation');
    await vi.advanceTimersByTimeAsync(V.VOICE_CONFIRM_HINT_MS + 50);
    expect(lastSaid()).toBe('Check the screen to end navigation without saving this voyage.');
    ui.uiStore.getState().dialogs[0].resolve(false);
    await p;
    expect(lastSaid()).toBe('Navigation is still on.');
  });

  it('raise anchor with no watch says so and does nothing', async () => {
    await V.voiceRun('raise the anchor');
    expect(h.fns.anchorRaise).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('There is no anchor watch on.');
  });
  it('raise anchor that ends the watch', async () => {
    h.Nav.anchor.watching = true;
    h.fns.anchorRaise.mockImplementation(() => { h.Nav.anchor.watching = false; });
    await V.voiceRun('anchor watch off');
    expect(lastSaid()).toBe('Anchor up.');
  });
  it('drop anchor reports the real watch state and why it failed', async () => {
    await V.voiceRun('drop the anchor');
    expect(lastSaid()).toBe('No GPS fix yet, so I could not set the anchor watch.');
    h.GPS.lastLatLng = { lat: 33, lng: -118 }; h.stale = true;
    await V.voiceRun('drop the anchor');
    expect(lastSaid()).toBe('My last GPS fix is too old, so I could not set the anchor watch.');
    h.stale = false; h.GPS.coarse = true;
    await V.voiceRun('drop the anchor');
    expect(lastSaid()).toBe('GPS is not accurate enough yet, so I could not set the anchor watch.');
    h.GPS.coarse = false;
    h.Nav.anchor.radiusFt = 200;
    h.fns.anchorDrop.mockImplementation(() => { h.Nav.anchor.watching = true; });
    await V.voiceRun('anchor watch on');
    expect(lastSaid()).toBe('Anchor watch on, 200 feet.');
  });
  it('a refused re-drop says the existing watch stays put (not "Anchor watch on")', async () => {
    Object.assign(h.Nav.anchor, { watching: true, ll: { lat: 1, lng: 1 } });
    h.GPS.lastLatLng = { lat: 33, lng: -118 }; h.stale = true;
    h.fns.anchorDrop.mockImplementation(() => {});      // refused: stale fix
    await V.voiceRun('drop the anchor');
    expect(lastSaid()).toBe('My last GPS fix is too old, so the anchor watch stays where it was.');
    h.stale = false;
    h.fns.anchorDrop.mockImplementation(() => { h.Nav.anchor.ll = { lat: 33, lng: -118 }; });
    await V.voiceRun('drop the anchor');
    expect(lastSaid()).toBe('Anchor watch on, 150 feet.');
  });

  it('"start tracking" while already recording does not stop it', async () => {
    h.Tracks.recording = true;
    await V.voiceRun('start tracking');
    expect(h.fns.trackStart).not.toHaveBeenCalled();
    expect(h.fns.trackStop).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('Already recording your track.');
  });
  it('"stop track" while idle does not start one', async () => {
    await V.voiceRun('stop track');
    expect(h.fns.trackStart).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('No track is recording.');
  });
  it('start tracking', async () => {
    h.fns.trackStart.mockImplementation(() => { h.Tracks.recording = true; });
    await V.voiceRun('record a track');
    expect(lastSaid()).toBe('Recording your track.');
  });
  it('a too-short track is not reported as saved', async () => {
    Object.assign(h.Tracks, { recording: true, points: [[1, 1]] });
    h.fns.trackStop.mockImplementation(async () => { h.Tracks.recording = false; });
    await V.voiceRun('stop tracking');
    expect(lastSaid()).toBe('Track too short, so it was not saved.');
  });
  it('a real track is saved', async () => {
    Object.assign(h.Tracks, { recording: true, points: [[1, 1], [1, 2], [1, 3]] });
    h.fns.trackStop.mockImplementation(async () => { h.Tracks.recording = false; });
    await V.voiceRun('stop the track');
    expect(lastSaid()).toBe('Track saved.');
  });
  it('a track whose storage write failed is never reported as saved', async () => {
    const older = { id: 'unsaved-1' };
    Object.assign(h.Tracks, { recording: true, points: [[1, 1], [1, 2], [1, 3]], unsaved: [older] });
    // trackStop's storage-error path: keeps the track in memory (unshift), does not throw
    h.fns.trackStop.mockImplementation(async () => { h.Tracks.recording = false; h.Tracks.unsaved.unshift({ id: 'unsaved-2' }); });
    await V.voiceRun('stop the track');
    expect(lastSaid()).toBe('The track could not be saved. It is kept until the app closes. Retry or save it as a file from Spots and tracks.');
    // an older unsaved track being retried away meanwhile does not hide a new failure…
    Object.assign(h.Tracks, { recording: true, points: [[1, 1], [1, 2]], unsaved: [older] });
    h.fns.trackStop.mockImplementation(async () => { h.Tracks.recording = false; h.Tracks.unsaved = [{ id: 'unsaved-3' }]; });
    await V.voiceRun('stop track');
    expect(lastSaid()).toMatch(/^The track could not be saved\./);
    // …and an existing unsaved track does not make a good save sound like a failure
    Object.assign(h.Tracks, { recording: true, points: [[1, 1], [1, 2]], unsaved: [older] });
    h.fns.trackStop.mockImplementation(async () => { h.Tracks.recording = false; });
    await V.voiceRun('stop track');
    expect(lastSaid()).toBe('Track saved.');
  });
  it('an action that throws says it did not work', async () => {
    Object.assign(h.Tracks, { recording: true, points: [[1, 1], [1, 2]] });
    h.fns.trackStop.mockImplementation(async () => { throw new Error('idb'); });
    await V.voiceRun('stop track');
    expect(lastSaid()).toBe('That did not work.');
  });

  it('mark spot refuses without a fresh fix and never uses the map centre', async () => {
    await V.voiceRun('mark this spot');
    expect(lastSaid()).toBe('No GPS fix yet, so I can’t mark a spot.');
    h.GPS.lastLatLng = { lat: 33.1, lng: -118.2 }; h.stale = true;
    await V.voiceRun('mark this spot');
    expect(lastSaid()).toBe('My last GPS fix is too old to mark a spot.');
    expect(h.fns.asstCreateSpot).not.toHaveBeenCalled();
    h.stale = false;
    await V.voiceRun('drop a pin');
    expect(h.fns.asstCreateSpot).toHaveBeenCalledWith(expect.objectContaining({ lat: 33.1, lng: -118.2, type: 'fish' }));
    expect(h.fns.asstCreateSpot.mock.calls[0][0].name).toMatch(/^Voice mark /);
    expect(lastSaid()).toBe('Marked this spot.');
  });

  it('position is read in the VHF format, and an old fix is never spoken as current', async () => {
    expect(V.voiceSayPosition()).toBe('No GPS fix yet.');
    h.GPS.lastLatLng = { lat: 32.5, lng: -117.25 };
    h.GPS.lastFixTs = Date.now();
    expect(V.voiceSayPosition()).toBe("You are at 32°30.000'N, 117°15.000'W");
    h.stale = true; h.GPS.lastFixTs = Date.now() - 5 * 60000;
    expect(V.voiceSayPosition()).toBe("My last GPS fix is 5 minutes old. Last known position 32°30.000'N, 117°15.000'W");
  });
  it('speed is SOG in knots, refused on an old fix', async () => {
    expect(V.voiceSaySpeed()).toBe('No speed reading yet.');
    h.GPS.last = { coords: { speed: 5 } };
    expect(V.voiceSaySpeed()).toBe('10 knots.');
    h.stale = true;
    expect(V.voiceSaySpeed()).toBe('No current speed reading. My last GPS fix is too old.');
  });

  it('zoom uses animate:false', async () => {
    await V.voiceRun('zoom in');
    expect(h.map.set).toEqual([13, { animate: false }]);
    await V.voiceRun('wider');
    expect(h.map.set).toEqual([11, { animate: false }]);
  });

  it('"when\'s the bite" reaches the bite prediction', async () => {
    await V.voiceHandleTranscript("hey fish when's the bite");
    expect(h.fns.biteWindows).toHaveBeenCalledWith({ days: 7, limit: 3 });
    expect(lastSaid()).toBe('Best window is tomorrow.');
  });
});

describe('panels', () => {
  it('"fish id" and "limits" open Guides on the Fish & limits tab', async () => {
    await V.voiceRun('fish id');
    expect(ui.uiStore.getState().panel).toBe('guides');
    expect(ui.uiStore.getState().panelData).toEqual({ tab: 'fish' });
    expect(lastSaid()).toBe('Fish and limits.');
    ui.closePanels();
    await V.voiceRun('show me the limits');
    expect(ui.uiStore.getState().panelData).toEqual({ tab: 'fish' });
  });
  it('"knots" opens the Knots tab; "guides" keeps the last tab', async () => {
    await V.voiceRun('knots');
    expect(ui.uiStore.getState().panelData).toEqual({ tab: 'knots' });
    ui.closePanels();
    await V.voiceRun('guides');
    expect(ui.uiStore.getState().panel).toBe('guides');
    expect(ui.uiStore.getState().panelData).toBeNull();
  });
  it('asking for an open panel again never closes it', async () => {
    await V.voiceRun('weather');
    await V.voiceRun('show me the weather');
    expect(ui.uiStore.getState().panel).toBe('weather');
  });
  it('a question goes to First Mate instead of a panel', async () => {
    await V.voiceRun('what s the weather in catalina');
    expect(ui.uiStore.getState().panel).toBeNull();
    expect(h.fns.asstSend).toHaveBeenCalledWith('what s the weather in catalina');
  });
});

describe('speech and the echo guard', () => {
  it('voiceSay mutes recognition for the utterance plus a tail', () => {
    const t0 = Date.now();
    V.voiceSay('Anchor up.');
    expect(V.Voice._muteUntil).toBeGreaterThanOrEqual(t0 + 1200 + 10 * 60);
    expect(V.Voice.speaking).toBe(true);
  });
  it('hands-free replies are spoken even when First Mate read-aloud is muted, and the setting is restored', () => {
    h.ASST.speak = false;
    V.voiceSay('Weather alert.');
    expect(h.fns.asstSpeak.mock.results[0].value).toEqual({ t: 'Weather alert.', speak: true });
    expect(h.ASST.speak).toBe(false);
  });
  it('the First Mate fallthrough forces speech for one reply and never shortens the guard', async () => {
    const far = Date.now() + 60000;
    V.Voice._muteUntil = far;
    let speakDuring = null;
    h.fns.asstSend.mockImplementation(async () => { speakDuring = h.ASST.speak; });
    await V.voiceRun('tell me a joke');
    expect(speakDuring).toBe(true);
    expect(h.ASST.speak).toBe(false);
    expect(h.fns.asstUpdateSpeakBtn).toHaveBeenCalled();
    expect(V.Voice._muteUntil).toBe(far);
  });
  it('says so instead of silently dropping a question while First Mate is still answering', async () => {
    h.ASST.streaming = true;
    await V.voiceRun('tell me a joke');
    expect(h.fns.asstSend).not.toHaveBeenCalled();
    expect(lastSaid()).toBe('Hang on, I am still answering the last question.');
  });
  it('with no speech engine at all the reply is shown instead of lost', () => {
    delete window.speechSynthesis;
    V.voiceSay('Anchor up.');
    expect(ui.uiStore.getState().toast.msg).toBe('Anchor up.');
  });
  it('a shown reply stays up long enough to read; a caller can set the time', () => {
    delete window.speechSynthesis;
    V.voiceSay('Anchor up.');
    expect(ui.uiStore.getState().toast.ms).toBe(4000);
    const warn = 'Heads up — wind is building. 12 knots now, 22 by 4 PM. Worth thinking about heading in.';
    V.voiceSay(warn);
    expect(ui.uiStore.getState().toast.ms).toBe(9000);
    V.voiceSay('Short alert.', { ms: 9000 });
    expect(ui.uiStore.getState().toast.ms).toBe(9000);
    expect(V.voiceCaptionMs('x'.repeat(30))).toBe(4900);
  });
  it('a shown reply never replaces a toast with an action (Retry); it shows once that is gone', () => {
    delete window.speechSynthesis;
    ui.toast('Track NOT saved — storage error', { action: { label: 'Retry', run() {} }, ms: 9000 });
    V.voiceSay('Track saved.');
    expect(ui.uiStore.getState().toast.msg).toBe('Track NOT saved — storage error');
    // a newer action toast holds it back again
    ui.toast('Voyage NOT saved', { action: { label: 'Retry', run() {} }, ms: 9000 });
    expect(ui.uiStore.getState().toast.msg).toBe('Voyage NOT saved');
    ui.dismissToast();
    expect(ui.uiStore.getState().toast.msg).toBe('Track saved.');
  });
  it('with a speech engine nothing is toasted', () => {
    V.voiceSay('Anchor up.');
    expect(ui.uiStore.getState().toast).toBeNull();
  });
  it('extend never shortens; set is exact', () => {
    V.voiceSetMuteUntil(1000);
    V.voiceExtendMuteUntil(500);
    expect(V.Voice._muteUntil).toBe(1000);
    V.voiceExtendMuteUntil(2000);
    expect(V.Voice._muteUntil).toBe(2000);
    V.voiceSetMuteUntil(10);
    expect(V.Voice._muteUntil).toBe(10);
  });
});

describe('wake word handling', () => {
  it('ignores speech without the wake word', async () => {
    await V.voiceHandleTranscript('I caught a fish, drop the anchor');
    expect(h.fns.anchorDrop).not.toHaveBeenCalled();
  });
  it('"hey fish" alone opens a 9 s command window', async () => {
    vi.useFakeTimers();
    await V.voiceHandleTranscript('Hey Fish');
    expect(V.Voice.awake).toBe(true);
    expect(lastSaid()).toBe('Aye?');
    await V.voiceHandleTranscript('zoom in');
    expect(h.map.set).toEqual([13, { animate: false }]);
    expect(V.Voice.awake).toBe(false);
    await V.voiceHandleTranscript('hey fish');
    vi.advanceTimersByTime(V.VOICE_AWAKE_MS + 1);
    expect(V.Voice.awake).toBe(false);
  });
  it('a command in the same breath runs immediately', async () => {
    await V.voiceHandleTranscript('ok fish zoom out');
    expect(h.map.set).toEqual([11, { animate: false }]);
  });
});

describe('mic session lifecycle', () => {
  it('toggle on: starts one recogniser, persists, and publishes Listening', () => {
    V.voiceToggle();
    expect(FakeRec.instances).toHaveLength(1);
    expect(FakeRec.instances[0].started).toBe(1);
    expect(V.Voice.on).toBe(true);
    expect(localStorage.getItem('fishapp.voice')).toBe('on');
    expect(h.fns.unlockAudio).toHaveBeenCalled();
    expect(h.fns.requestWakeLock).toHaveBeenCalled();
    expect(ui.uiStore.getState().toast.msg).toBe('Listening — say “Hey Fish” then your command');
    expect(V.voiceStore.getState()).toMatchObject({ supported: true, on: true, listening: true, label: 'Listening' });
    expect(lastSaid()).toBe('Hands free on. Say hey fish when you need me.');
  });
  it('toggle off: aborts, persists off, applies a pending update', () => {
    V.voiceToggle();
    V.voiceToggle();
    expect(FakeRec.instances[0].aborted).toBe(1);
    expect(V.Voice._wantOn).toBe(false);
    expect(localStorage.getItem('fishapp.voice')).toBe('off');
    expect(h.fns.applyPendingUpdate).toHaveBeenCalled();
    expect(ui.uiStore.getState().toast.msg).toBe('Hands-free off');
    expect(V.voiceStore.getState()).toMatchObject({ on: false, listening: false, label: 'Hey Fish' });
  });
  it('a throwing localStorage never leaves hands-free stuck on (which would block updates)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    V.voiceToggle();
    expect(V.Voice.on).toBe(true);
    V.voiceToggle();
    expect(V.Voice._wantOn).toBe(false);
    expect(V.Voice.on).toBe(false);
  });
  it('a throwing localStorage does not break voiceInit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => V.voiceInit()).not.toThrow();
    expect(V.voiceStore.getState().resumePending).toBe(false);
  });
  it('a stale recogniser can neither run commands nor end the live session', () => {
    V.voiceToggle();
    const old = FakeRec.instances[0];
    setHidden(true); document.dispatchEvent(new Event('visibilitychange'));
    setHidden(false); document.dispatchEvent(new Event('visibilitychange'));
    const live = FakeRec.instances[1];
    expect(V.Voice.rec).toBe(live);
    V.Voice._muteUntil = 0; V.Voice.speaking = false;
    old.say('hey fish drop the anchor');
    expect(h.fns.anchorDrop).not.toHaveBeenCalled();
    old.onend();
    expect(V.Voice.rec).toBe(live);
  });
  it('results are ignored while we are speaking (echo guard)', async () => {
    V.voiceToggle();                                   // speaks "Hands free on…" → muted
    FakeRec.instances[0].say('hey fish drop the anchor');
    expect(h.fns.anchorDrop).not.toHaveBeenCalled();
  });
  it('a heard result runs the command and resets the failure count', async () => {
    V.voiceToggle();
    V.Voice._muteUntil = 0; V.Voice.speaking = false; V.Voice._fails = 3;
    FakeRec.instances[0].say('hey fish zoom in');
    await vi.waitFor(() => expect(h.map.set).toEqual([13, { animate: false }]));
    expect(V.Voice._fails).toBe(0);
  });
  it('restarts after the engine ends a session, with backoff, and does not reset _fails on start', () => {
    vi.useFakeTimers();
    V.voiceToggle();
    const r = FakeRec.instances[0];
    r.onerror({ error: 'network' });
    r.onerror({ error: 'network' });
    expect(V.Voice._fails).toBe(2);
    r.onend();
    vi.advanceTimersByTime(799);
    expect(FakeRec.instances).toHaveLength(1);
    vi.advanceTimersByTime(2);                         // 200 * 2^2 = 800 ms
    expect(FakeRec.instances).toHaveLength(2);
    expect(V.Voice._fails).toBe(2);
  });
  it('never respins while hidden', () => {
    vi.useFakeTimers();
    V.voiceToggle();
    setHidden(true);
    FakeRec.instances[0].onend();
    vi.advanceTimersByTime(10000);
    expect(FakeRec.instances).toHaveLength(1);
  });
  it('hidden: aborts and stops claiming Listening; visible: a clean new session', () => {
    V.voiceToggle();
    setHidden(true); document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeRec.instances[0].aborted).toBe(1);
    expect(V.Voice.on).toBe(false);
    expect(V.Voice._wantOn).toBe(true);
    expect(V.voiceStore.getState()).toMatchObject({ on: true, listening: false, label: 'Starting' });
    setHidden(false); document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeRec.instances).toHaveLength(2);
    expect(V.voiceStore.getState()).toMatchObject({ listening: true, label: 'Listening' });
  });
  it('mic permission refused: stop, remember off, say why', () => {
    V.voiceToggle();
    FakeRec.instances[0].onerror({ error: 'not-allowed' });
    expect(V.Voice._wantOn).toBe(false);
    expect(localStorage.getItem('fishapp.voice')).toBe('off');
    expect(ui.uiStore.getState().toast.msg).toBe('Microphone blocked — enable mic access to use Hey Fish');
    expect(V.voiceStore.getState().supported).toBe(true);
  });
  it('speech refused inside the iPhone app hides Hey Fish so First Mate takes the slot', async () => {
    await load({ native: true });
    V.voiceToggle();
    FakeRec.instances[0].onerror({ error: 'service-not-allowed' });
    expect(V.voiceStore.getState().supported).toBe(false);
    expect(ui.uiStore.getState().toast.msg).toMatch(/iOS Settings/);
    V.voiceToggle();                                     // would-be second tap: no new session
    expect(FakeRec.instances).toHaveLength(1);
    expect(ui.uiStore.getState().panel).toBe('assistant');
    delete window.FishNative;
  });
  it('mic refused inside the iPhone app also hides it (only iOS Settings can fix it)', async () => {
    await load({ native: true });
    V.voiceToggle();
    FakeRec.instances[0].onerror({ error: 'not-allowed' });
    expect(V.voiceStore.getState().supported).toBe(false);
    expect(ui.uiStore.getState().toast.msg).toBe('Microphone or speech recognition is off for FishApp — allow both in iOS Settings to use Hey Fish');
    delete window.FishNative;
  });
  it('unsupported: says so and opens First Mate', async () => {
    await load({ supported: false });
    expect(V.voiceStore.getState().supported).toBe(false);
    V.voiceToggle();
    expect(ui.uiStore.getState().panel).toBe('assistant');
    expect(ui.uiStore.getState().toast.msg).toBe("This browser can't do always-on voice — use the mic in First Mate to talk");
  });
});

describe('relaunch resume', () => {
  it('resumes on the first tap anywhere', () => {
    localStorage.setItem('fishapp.voice', 'on');
    V.voiceInit();
    expect(V.voiceStore.getState().resumePending).toBe(true);
    expect(ui.uiStore.getState().toast.msg).toBe('Tap anywhere to resume hands-free');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(V.Voice._wantOn).toBe(true);
    expect(FakeRec.instances).toHaveLength(1);
    expect(V.voiceStore.getState().resumePending).toBe(false);
    expect(ui.uiStore.getState().toast.msg).toBe('Hands-free resumed — say “Hey Fish”');
  });
  it('leaves a tap on the voice button to voiceToggle (no double toggle)', () => {
    localStorage.setItem('fishapp.voice', 'on');
    V.voiceInit();
    const btn = document.createElement('button');
    btn.setAttribute('data-voice-toggle', '');
    const inner = document.createElement('span');
    btn.appendChild(inner);
    document.body.appendChild(btn);
    inner.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(V.Voice._wantOn).toBe(false);
    V.voiceToggle();                                     // the click that follows
    expect(V.Voice._wantOn).toBe(true);
    expect(FakeRec.instances).toHaveLength(1);
    btn.remove();
  });
  it('a resume no longer pending (switched on and off by keyboard) does not turn it back on', () => {
    localStorage.setItem('fishapp.voice', 'on');
    V.voiceInit();
    V.voiceToggle();                                     // on (no pointer involved)
    V.voiceToggle();                                     // off again
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(V.Voice._wantOn).toBe(false);
  });
  it('does nothing when hands-free was off', () => {
    V.voiceInit();
    expect(V.voiceStore.getState().resumePending).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(V.Voice._wantOn).toBe(false);
  });
});

describe('tab label', () => {
  it('shows the command it heard for 2 s, then the state again', async () => {
    vi.useFakeTimers();
    V.voiceToggle();
    await V.voiceRun('zoom in');
    expect(V.voiceStore.getState()).toMatchObject({ label: 'zoom in', transcript: 'zoom in' });
    vi.advanceTimersByTime(V.VOICE_HEARD_MS + 1);
    expect(V.voiceStore.getState()).toMatchObject({ label: 'Listening', transcript: '' });
  });
  it('awake is published for the button', async () => {
    V.voiceToggle();
    await V.voiceHandleTranscript('hey fish');
    expect(V.voiceStore.getState().awake).toBe(true);
  });
});
