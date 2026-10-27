// @vitest-environment jsdom
/* Characterisation tests for engine/awake.js: the watch-band model (legacy copy), the
 * keep-alive settings line, native background-location gating and notification fallbacks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ui', () => ({
  toast: vi.fn(), closePanels: vi.fn(), openCard: vi.fn(), closeCard: vi.fn(), updateCard: vi.fn(), setDetent: vi.fn(),
  isPanelOpen: vi.fn(() => false), confirmDialog: vi.fn(async () => true),
  uiStore: { getState: () => ({ card: null }) },
}));
vi.mock('../../../src/services/native', () => ({
  backgroundLocation: vi.fn(), haptic: vi.fn(), isNativeShell: vi.fn(() => false),
  nativeAnchorWatch: vi.fn(), nativeAnchorSilence: vi.fn(),
  saveOrShareFile: vi.fn(async () => 'downloaded'),
}));
vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null, applyPendingUpdate: vi.fn() }));
vi.mock('../../../src/engine/spots.js', () => ({ escapeHtml: (s) => String(s), refreshSpotDistances: () => {} }));
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'N' }));
vi.mock('../../../src/engine/db.js', () => ({
  idb: { put: vi.fn(async () => 1), getAll: vi.fn(async () => []), del: vi.fn(async () => undefined) },
}));

import {
  Awake, awakeStore, awakeBannerModel, awakeSetEnabled, awakeAcquire, awakeRelease, awakeSyncBackgroundLocation,
  awakeNotify, awakeAskNotify, awakeUpdateUi, KEEPALIVE_ON_TEXT, KEEPALIVE_OFF_TEXT, NOTIFY_SW_WAIT_MS,
  KEEPALIVE_NATIVE_TEXT, awakeKeepAliveWanted, awakeKeepAliveOk, awakeApply, awakeHealth,
} from '../../../src/engine/awake.js';
import { Nav } from '../../../src/engine/nav.js';
import { Goto } from '../../../src/engine/goto.js';
import { GPS } from '../../../src/engine/gps.js';
import { backgroundLocation, isNativeShell } from '../../../src/services/native';
import { mediaPlayRejects, resetAll } from './helpers.js';

beforeEach(() => { resetAll(); vi.clearAllMocks(); });
afterEach(() => {
  vi.useRealTimers();
  delete window.Notification;
  try { delete navigator.serviceWorker; } catch (e) { /* ignore */ }
});

const healthy = { armed: true, keepAlive: true, keepAliveWanted: true, screenLock: true, screenLockWanted: true, fixAgeS: 4, gpsOk: true };

describe('awakeBannerModel', () => {
  it('is hidden when nothing is armed', () => {
    expect(awakeBannerModel({ ...healthy, armed: false }, true, false)).toEqual({ visible: false, warn: false, what: '', detail: '' });
  });
  it('healthy watch: what is armed and the live fix age', () => {
    expect(awakeBannerModel(healthy, true, false)).toEqual({ visible: true, warn: false, what: 'Anchor watch', detail: 'GPS 4s ago · keep the screen on' });
    expect(awakeBannerModel({ ...healthy, fixAgeS: null }, false, true).detail).toBe('keep the screen on');
    expect(awakeBannerModel(healthy, true, true).what).toBe('Anchor watch · Recording');
    expect(awakeBannerModel(healthy, false, false).what).toBe('Watching');
  });
  it('turns to a warning for each thing that is not working (legacy copy)', () => {
    expect(awakeBannerModel({ ...healthy, gpsOk: false, fixAgeS: null }, true, false)).toMatchObject({ warn: true, detail: 'no GPS fix yet' });
    expect(awakeBannerModel({ ...healthy, gpsOk: false, fixAgeS: 75 }, true, false).detail).toBe('no GPS for 75s');
    expect(awakeBannerModel({ ...healthy, screenLock: false }, true, false).detail).toBe('screen may sleep');
    expect(awakeBannerModel({ ...healthy, screenLock: false, screenLockWanted: false }, true, false).warn).toBe(false);
    expect(awakeBannerModel({ ...healthy, keepAlive: false }, true, false).detail).toBe('background keep-alive not running');
    expect(awakeBannerModel({ ...healthy, keepAlive: false, keepAliveWanted: false }, true, false).warn).toBe(false);
    expect(awakeBannerModel({ ...healthy, gpsOk: false, fixAgeS: 90, screenLock: false, keepAlive: false }, true, true).detail)
      .toBe('no GPS for 90s · screen may sleep · background keep-alive not running');
  });
  it('iPhone app: an anchor watch says it is OK to lock the screen, not "keep the screen on"', () => {
    const native = { ...healthy, native: true, keepAliveWanted: false };
    expect(awakeBannerModel(native, true, false)).toEqual({ visible: true, warn: false, what: 'Anchor watch', detail: 'GPS 4s ago · OK to lock the screen' });
    expect(awakeBannerModel({ ...native, fixAgeS: null }, true, false).detail).toBe('OK to lock the screen');
    expect(awakeBannerModel(native, true, true).detail).toBe('GPS 4s ago · OK to lock the screen');
    // a recording alone has no native monitor behind it: browser wording
    expect(awakeBannerModel(native, false, true).detail).toBe('GPS 4s ago · keep the screen on');
    // problems still win over the calm line
    expect(awakeBannerModel({ ...native, gpsOk: false, fixAgeS: 75 }, true, false)).toMatchObject({ warn: true, detail: 'no GPS for 75s' });
  });
});

describe('watch band store', () => {
  it('follows the reasons and the GPS fix age', () => {
    Nav.anchor.watching = true;
    GPS.lastFixTs = Date.now() - 2000;
    awakeAcquire('anchor');
    const s = awakeStore.getState();
    expect(s).toMatchObject({ visible: true, anchor: true, track: false, what: 'Anchor watch' });
    expect(s.fixAgeS).toBe(2);
    Nav.anchor.watching = false;
    awakeRelease('anchor');
    expect(awakeStore.getState().visible).toBe(false);
  });
});

describe('keep-alive setting', () => {
  it('persists and publishes the legacy status line', () => {
    awakeSetEnabled(false);
    expect(localStorage.getItem('fishapp.keepalive')).toBe('off');
    expect(awakeStore.getState()).toMatchObject({ keepAliveKind: 'off', keepAliveText: KEEPALIVE_OFF_TEXT });
    awakeSetEnabled(true);
    expect(localStorage.getItem('fishapp.keepalive')).toBe('on');
    expect(awakeStore.getState()).toMatchObject({ keepAliveKind: 'on', keepAliveText: KEEPALIVE_ON_TEXT });
    expect(KEEPALIVE_ON_TEXT).toBe('On — the app keeps running in the background while a watch or recording is armed. May interrupt music.');
    expect(KEEPALIVE_OFF_TEXT).toBe('Off — the anchor watch and track recording stop when you switch apps.');
  });
  it('runs only while a reason is held, ref-counted', () => {
    awakeAcquire('anchor');
    awakeAcquire('track');
    expect(Awake.audio).not.toBeNull();
    awakeRelease('anchor');
    expect(Awake.audio).not.toBeNull();             // the recording still needs it
    awakeRelease('track');
    expect(Awake.audio).toBeNull();
  });
});

describe('FIX: no silent keep-alive audio inside the iPhone app (App Review 2.5.4)', () => {
  afterEach(() => { isNativeShell.mockReturnValue(false); });

  it('never creates or plays the loop, even with the setting on and a watch armed', () => {
    isNativeShell.mockReturnValue(true);
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    awakeSetEnabled(true);
    awakeAcquire('anchor');
    awakeAcquire('track');
    expect(Awake.audio).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(awakeKeepAliveWanted()).toBe(false);
    expect(awakeKeepAliveOk()).toBe(true);
    play.mockRestore();
  });

  it('background GPS is still switched on there', () => {
    isNativeShell.mockReturnValue(true);
    awakeAcquire('anchor');
    Nav.anchor.watching = true;
    awakeSyncBackgroundLocation();
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    Nav.anchor.watching = false;
    awakeSyncBackgroundLocation();
  });

  it('the band does not warn about a keep-alive that is deliberately not used', () => {
    isNativeShell.mockReturnValue(true);
    GPS.lastFixTs = Date.now() - 2000;
    awakeAcquire('anchor');
    Nav.anchor.watching = true;
    awakeUpdateUi();
    const s = awakeStore.getState();
    expect(s.detail).not.toContain('background keep-alive not running');
    expect(s.warn).toBe(false);
    Nav.anchor.watching = false;
  });

  it('the band tells an anchor watch it can lock the screen (the native monitor keeps watching)', () => {
    isNativeShell.mockReturnValue(true);
    GPS.lastFixTs = Date.now() - 2000;
    Nav.anchor.watching = true;
    awakeAcquire('anchor');
    expect(awakeHealth().native).toBe(true);
    expect(awakeStore.getState()).toMatchObject({ warn: false, detail: 'GPS 2s ago · OK to lock the screen' });
    isNativeShell.mockReturnValue(false);
    awakeApply();                                   // a browser: the keep-alive loop starts, then the band
    expect(awakeStore.getState().detail).toBe('GPS 2s ago · keep the screen on');
    Nav.anchor.watching = false;
  });

  it('the Device line says it is not used, instead of "On … may interrupt music"', () => {
    isNativeShell.mockReturnValue(true);
    awakeSetEnabled(true);
    expect(awakeStore.getState()).toMatchObject({ keepAliveKind: 'native', keepAliveText: KEEPALIVE_NATIVE_TEXT });
  });

  it('in a browser the loop still runs, and the band still warns when it does not', async () => {
    awakeAcquire('anchor');
    expect(Awake.audio).not.toBeNull();
    expect(awakeKeepAliveOk()).toBe(true);
    expect(awakeStore.getState().keepAliveKind).toBe('running');
    awakeRelease('anchor');
    mediaPlayRejects(true);
    await awakeAcquire('anchor');
    await Promise.resolve(); await Promise.resolve();
    expect(Awake.audio).toBeNull();
    expect(awakeKeepAliveOk()).toBe(false);
    expect(awakeStore.getState().keepAliveKind).toBe('warn');
    expect(awakeHealth()).toMatchObject({ keepAlive: false, keepAliveWanted: true });
  });

  it('a loop the OS paused counts as not running, and the next apply restarts it', async () => {
    awakeAcquire('anchor');
    const a = Awake.audio;
    a.pause();                                   // e.g. a phone call took the audio session
    expect(awakeKeepAliveOk()).toBe(false);
    expect(awakeHealth().keepAlive).toBe(false);
    await awakeApply();
    expect(Awake.audio).toBe(a);
    expect(a.paused).toBe(false);
    expect(awakeKeepAliveOk()).toBe(true);
  });
});

describe('native background location', () => {
  it('is requested only while an anchor watch, a recording or a Go-To needs it, and only on change', () => {
    Goto.active = true;
    awakeSyncBackgroundLocation();
    awakeSyncBackgroundLocation();
    expect(backgroundLocation).toHaveBeenCalledTimes(1);
    expect(backgroundLocation).toHaveBeenLastCalledWith(true);
    expect(awakeStore.getState().bgLocation).toBe(true);
    Goto.active = false;
    awakeSyncBackgroundLocation();
    expect(backgroundLocation).toHaveBeenLastCalledWith(false);
    expect(awakeStore.getState().bgLocation).toBe(false);
  });
});

describe('notifications', () => {
  function grantNotifications() {
    const N = vi.fn();
    N.permission = 'granted';
    N.requestPermission = vi.fn(async () => 'granted');
    window.Notification = N;
    return N;
  }

  it('are skipped entirely in the native iPhone app', () => {
    const N = grantNotifications();
    isNativeShell.mockReturnValue(true);
    awakeNotify('ANCHOR DRAGGING', 'x');
    awakeAskNotify();
    expect(N).not.toHaveBeenCalled();
    expect(N.requestPermission).not.toHaveBeenCalled();
    isNativeShell.mockReturnValue(false);
  });

  it('fall back to a page notification when no service worker ever becomes ready', async () => {
    vi.useFakeTimers();
    const N = grantNotifications();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: new Promise(() => {}) } });
    awakeNotify('ANCHOR DRAGGING', 'You have drifted past the 150 ft watch circle.');
    expect(N).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NOTIFY_SW_WAIT_MS + 10);
    expect(N).toHaveBeenCalledTimes(1);
    expect(N.mock.calls[0][0]).toBe('ANCHOR DRAGGING');
    expect(N.mock.calls[0][1]).toMatchObject({ tag: 'fishapp-alarm', requireInteraction: true, renotify: true });
  });

  it('use the service worker when it is ready', async () => {
    const N = grantNotifications();
    const showNotification = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ showNotification }) } });
    awakeNotify('Anchor watch blind', 'No GPS fix');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(showNotification).toHaveBeenCalledWith('Anchor watch blind', expect.objectContaining({ tag: 'fishapp-alarm' }));
    expect(N).not.toHaveBeenCalled();
  });

  it('awakeUpdateUi never throws without a fix', () => {
    GPS.lastFixTs = 0;
    awakeAcquire('anchor');
    expect(() => awakeUpdateUi()).not.toThrow();
    expect(awakeStore.getState().detail).toContain('no GPS fix yet');
  });
});
