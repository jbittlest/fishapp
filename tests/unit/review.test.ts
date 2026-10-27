// @vitest-environment jsdom
/* services/review: the App Store rating-prompt policy — distinct days of use, every guard (moments,
 * days, age, the 120-day window, each safety flag, under way), the delayed re-check, that the 120
 * days start only on the shell's confirmation, and that nothing at all happens outside the iOS app.
 * Each test loads a fresh copy (the module keeps the pending ask and the engine flags it was
 * handed). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: { isNativeShell: vi.fn(() => true), requestReview: vi.fn((): Promise<boolean> => Promise.resolve(true)) },
  ui: { isPanelOpen: vi.fn((_id: string) => false) },
  site: { appStoreUrl: vi.fn((): string | null => null) },
}));
vi.mock('../../src/services/native', () => h.native);
vi.mock('../../src/services/ui', () => h.ui);
vi.mock('../../src/services/site', () => h.site);

type Review = typeof import('../../src/services/review');
type Live = import('../../src/services/review').ReviewLive;

const KEY = 'fishapp.review';
const DAY = 24 * 60 * 60 * 1000;
// June: no daylight-saving change anywhere near, so calendar days are exactly 24 h apart
const at = (day: number, hour = 9) => new Date(2026, 5, day, hour, 0, 0).getTime();

/** At rest: no watch, Go-To, mic or recording, and a fresh fix sitting still. */
function flags(): Live {
  return {
    Nav: { anchor: { watching: false, alarmTimer: null } }, Goto: { active: false }, Voice: { on: false, _wantOn: false },
    Tracks: { recording: false }, GPS: { last: { coords: { speed: 0 } }, lastFixTs: Date.now() },
  };
}

/** A fresh fix at this speed over ground (knots). */
function moving(f: Live, kn: number) {
  f.GPS.last = { coords: { speed: kn / 1.94384 } };
  f.GPS.lastFixTs = Date.now();
}

/** Run the delay, then let the shell's answer (a promise) land. */
async function settle() {
  await vi.runAllTimersAsync();
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A shell answer the test hands back when it chooses. */
function deferredAnswer() {
  let answer!: (requested: boolean) => void;
  h.native.requestReview.mockImplementation(() => new Promise<boolean>((r) => { answer = r; }));
  return (requested: boolean) => answer(requested);
}

async function load(): Promise<Review> {
  vi.resetModules();
  return import('../../src/services/review');
}

function stored() { return JSON.parse(localStorage.getItem(KEY) || 'null'); }

/** A returning user: opened on June 1, 2 and 4 (3 days, first use 3 days back), one catch already. */
function seedReturning(extra: Record<string, unknown> = {}) {
  localStorage.setItem(KEY, JSON.stringify({ first: at(1), days: 3, lastDay: '2026-06-04', moments: 1, askedAt: 0, ...extra }));
}

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.native.isNativeShell.mockImplementation(() => true);
  h.native.requestReview.mockImplementation(() => Promise.resolve(true));
  h.ui.isPanelOpen.mockImplementation(() => false);
  h.site.appStoreUrl.mockImplementation(() => null);
  vi.useFakeTimers();
  vi.setSystemTime(at(4, 10));
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('day counting', () => {
  it('keys days by the local calendar date', async () => {
    const r = await load();
    expect(r.reviewDayKey(at(4, 0))).toBe('2026-06-04');
    expect(r.reviewDayKey(at(4, 23))).toBe('2026-06-04');
    expect(r.reviewDayKey(at(5, 0))).toBe('2026-06-05');
  });

  it('counts each distinct day once and keeps the first use', async () => {
    const r = await load();
    let s = r.readReviewState();
    s = r.withUsageDay(s, at(1, 8));
    s = r.withUsageDay(s, at(1, 20));
    expect(s).toMatchObject({ first: at(1, 8), days: 1, lastDay: '2026-06-01' });
    s = r.withUsageDay(s, at(2, 7));
    s = r.withUsageDay(s, at(9, 7));
    expect(s).toMatchObject({ first: at(1, 8), days: 3, lastDay: '2026-06-09' });
  });

  it('noteAppOpen records the day once per day in the iOS app', async () => {
    const r = await load();
    r.noteAppOpen(flags(), at(1));
    r.noteAppOpen(flags(), at(1, 15));
    r.noteAppOpen(flags(), at(3));
    expect(stored()).toMatchObject({ first: at(1), days: 2, lastDay: '2026-06-03', moments: 0, askedAt: 0 });
  });

  it('coming back to the foreground on a later day counts that day', async () => {
    const r = await load();
    r.noteAppOpen(flags(), at(1));
    vi.setSystemTime(at(2, 18));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stored()).toMatchObject({ days: 2, lastDay: '2026-06-02' });
  });

  it('a happy moment counts its own day too', async () => {
    const r = await load();
    r.noteAppOpen(flags(), at(1));
    vi.setSystemTime(at(3));
    r.reviewMoment('catch');
    expect(stored()).toMatchObject({ days: 2, moments: 1 });
  });
});

describe('reviewDue', () => {
  const base = { first: at(1), days: 3, lastDay: '2026-06-04', moments: 2, askedAt: 0 };

  it('is due when every condition holds', async () => {
    const r = await load();
    expect(r.reviewDue(base, at(4))).toBe(true);
  });

  it('needs two happy moments', async () => {
    const r = await load();
    expect(r.reviewDue({ ...base, moments: 1 }, at(4))).toBe(false);
  });

  it('needs three different days of use', async () => {
    const r = await load();
    expect(r.reviewDue({ ...base, days: 2 }, at(20))).toBe(false);
  });

  it('needs the first use to be at least three days back', async () => {
    const r = await load();
    expect(r.reviewDue(base, at(4) - 1)).toBe(false);
    expect(r.reviewDue({ ...base, first: 0 }, at(4))).toBe(false);
  });

  it('asks at most once per 120 days', async () => {
    const r = await load();
    const asked = at(4);
    expect(r.reviewDue({ ...base, askedAt: asked }, asked + 119 * DAY)).toBe(false);
    expect(r.reviewDue({ ...base, askedAt: asked }, asked + 120 * DAY)).toBe(true);
  });
});

describe('reviewMoment', () => {
  it('asks iOS two seconds after the second happy moment of a returning user', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    expect(stored().moments).toBe(2);
    await vi.advanceTimersByTimeAsync(r.REVIEW_DELAY_MS - 1);
    expect(h.native.requestReview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
    await settle();
    expect(stored().askedAt).toBe(at(4, 10) + r.REVIEW_DELAY_MS);
  });

  it('does not ask on the first happy moment', async () => {
    const r = await load();
    seedReturning({ moments: 0 });
    r.noteAppOpen(flags());
    r.reviewMoment('trip');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
    expect(stored().moments).toBe(1);
  });

  it('does not ask again inside 120 days, and does after', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);

    vi.setSystemTime(at(4, 10) + 100 * DAY);
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);

    vi.setSystemTime(at(4, 10) + 121 * DAY);
    r.reviewMoment('trip');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(2);
  });

  it('a burst of moments schedules one request', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    r.reviewMoment('catch');
    r.reviewMoment('trip');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
    expect(stored().moments).toBe(4);
  });

  it.each([
    ['anchor watch armed', (f: Live) => { f.Nav.anchor.watching = true; }],
    ['anchor alarm sounding', (f: Live) => { f.Nav.anchor.alarmTimer = 7; }],
    ['Go-To or route running', (f: Live) => { f.Goto.active = true; }],
    ['hands-free mic listening', (f: Live) => { f.Voice.on = true; }],
    ['hands-free mic switched on, restarting', (f: Live) => { f.Voice._wantOn = true; }],
    ['track recording', (f: Live) => { f.Tracks.recording = true; }],
    ['boat making way at 15 kn', (f: Live) => { moving(f, 15); }],
    ['boat making way at 3 kn', (f: Live) => { moving(f, 3); }],
  ])('never asks with the %s', async (_what, set) => {
    const r = await load();
    seedReturning();
    const f = flags();
    set(f);
    r.noteAppOpen(f);
    expect(r.reviewBlockedBySafety()).toBe(true);
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
    expect(stored().askedAt).toBe(0);
  });

  it.each([
    ['drifting at 1.5 kn', (f: Live) => { moving(f, 1.5); }],
    ['speed unknown', (f: Live) => { f.GPS.last = { coords: { speed: null } }; }],
    ['no fix at all (location off)', (f: Live) => { f.GPS.last = null; f.GPS.lastFixTs = 0; }],
    ['only a stale fix that was moving', (f: Live) => { moving(f, 15); f.GPS.lastFixTs = Date.now() - 61_000; }],
  ])('is not under way %s', async (_what, set) => {
    const r = await load();
    seedReturning();
    const f = flags();
    set(f);
    r.noteAppOpen(f);
    expect(r.reviewBlockedBySafety()).toBe(false);
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
  });

  it('a trip saved while still running home counts, and the next moment at rest asks', async () => {
    const r = await load();
    seedReturning();
    const f = flags();
    r.noteAppOpen(f);
    moving(f, 18);                               // Stop tapped heading in, no Go-To, nothing else live
    r.reviewMoment('trip');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ moments: 2, askedAt: 0 });

    moving(f, 0);                                // tied up, a catch photo logged later
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the boat got going during the delay', async () => {
    const r = await load();
    seedReturning();
    const f = flags();
    r.noteAppOpen(f);
    r.reviewMoment('catch');
    moving(f, 12);
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
  });

  it('never asks with the SOS screen open', async () => {
    const r = await load();
    seedReturning();
    h.ui.isPanelOpen.mockImplementation((id: string) => id === 'emergency');
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
  });

  it('is blocked when boot never handed in the engine flags', async () => {
    const r = await load();
    seedReturning();
    expect(r.reviewBlockedBySafety()).toBe(true);
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
  });

  it('re-checks the guards when the delay is up, and keeps the chance if something started', async () => {
    const r = await load();
    seedReturning();
    const f = flags();
    r.noteAppOpen(f);
    r.reviewMoment('catch');
    f.Nav.anchor.alarmTimer = 3;                 // the anchor alarm went off during the 2 s
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
    expect(stored().askedAt).toBe(0);

    f.Nav.anchor.alarmTimer = null;
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the app went to the background during the delay', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    setVisibility('hidden');
    await settle();
    expect(h.native.requestReview).not.toHaveBeenCalled();
    expect(stored().askedAt).toBe(0);
  });

  it('an older shell without the command does not use up the 120 days', async () => {
    const r = await load();
    seedReturning();
    h.native.requestReview.mockImplementation(() => Promise.resolve(false));
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
    expect(stored().askedAt).toBe(0);
  });

  it('a request the shell dropped (scene not active) keeps the chance for the next moment', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    // the page still says 'visible' — Control Center or a call banner is over the app
    h.native.requestReview.mockImplementation(() => Promise.resolve(false));
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
    expect(stored().askedAt).toBe(0);

    h.native.requestReview.mockImplementation(() => Promise.resolve(true));
    vi.setSystemTime(at(4, 15));
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(2);
    expect(stored().askedAt).toBe(at(4, 15) + r.REVIEW_DELAY_MS);
  });

  it('starts the 120 days only when the shell confirms, without losing moments logged meanwhile', async () => {
    const r = await load();
    seedReturning();
    r.noteAppOpen(flags());
    const answer = deferredAnswer();
    r.reviewMoment('catch');
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);
    expect(stored().askedAt).toBe(0);            // posted is not asked

    r.reviewMoment('catch');                     // another catch while the answer is out
    await settle();
    expect(h.native.requestReview).toHaveBeenCalledTimes(1);   // one request at a time

    answer(true);
    await settle();
    expect(stored()).toMatchObject({ moments: 3, askedAt: at(4, 10) + r.REVIEW_DELAY_MS });
  });

  it('does nothing at all in a browser', async () => {
    const r = await load();
    h.native.isNativeShell.mockImplementation(() => false);
    seedReturning();
    const before = localStorage.getItem(KEY);
    r.noteAppOpen(flags());
    r.reviewMoment('catch');
    r.reviewMoment('trip');
    await settle();
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(h.native.requestReview).not.toHaveBeenCalled();
  });

  it('survives broken or unavailable storage without throwing', async () => {
    const r = await load();
    localStorage.setItem(KEY, '{not json');
    expect(r.readReviewState()).toEqual({ first: 0, days: 0, lastDay: '', moments: 0, askedAt: 0 });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    try {
      expect(() => r.noteAppOpen(flags())).not.toThrow();
      expect(() => r.reviewMoment('catch')).not.toThrow();
      await settle();
      expect(h.native.requestReview).not.toHaveBeenCalled();
    } finally {
      get.mockRestore(); set.mockRestore();
    }
  });

  it('ignores junk in the stored state', async () => {
    const r = await load();
    localStorage.setItem(KEY, JSON.stringify({ first: 'x', days: -4, lastDay: 9, moments: NaN, askedAt: null }));
    expect(r.readReviewState()).toEqual({ first: 0, days: 0, lastDay: '', moments: 0, askedAt: 0 });
  });
});

describe('appStoreReviewUrl', () => {
  it('is null while there is no App Store listing', async () => {
    const r = await load();
    expect(r.appStoreReviewUrl()).toBeNull();
  });

  it('opens the write-a-review page of the listing', async () => {
    const r = await load();
    h.site.appStoreUrl.mockImplementation(() => 'https://apps.apple.com/app/id123456789');
    expect(r.appStoreReviewUrl()).toBe('https://apps.apple.com/app/id123456789?action=write-review');
  });
});
