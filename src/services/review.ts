/* App Store rating prompt, asked at a genuinely happy moment — a catch just logged, a real trip
 * just saved — and never while anything that matters on the water is running.
 *
 * iOS shows the system prompt at most three times a year and may skip any request, so this policy
 * is about not spending those on a bad moment: someone who keeps coming back (used on 3+ different
 * days, first use 3+ days ago), on their second happy moment or later, asked at most once per 120
 * days, with no anchor watch or alarm, SOS screen, Go-To or hands-free mic live, and never under
 * way (a track recording, or the last GPS fix making way) — the system alert is modal over the
 * chart, and a trip saved at the harbour mouth is someone at the helm. A moment that can't ask
 * still counts, so the next one at rest can. iOS app only — a browser has no rating prompt.
 * State lives in localStorage; every access is guarded.
 *
 * The live safety state comes from the engine's own flag objects, handed in by boot through
 * noteAppOpen(). Services sit below the engine and don't import it: catch.js and tracks.js call
 * reviewMoment(), and importing nav/goto/voice here would knot the whole engine into their imports. */
import { isNativeShell, requestReview } from './native';
import { isPanelOpen } from './ui';
import { appStoreUrl } from './site';

export type ReviewMomentKind = 'catch' | 'trip';

export interface ReviewState {
  /** ms epoch of the first recorded use, 0 = none yet */
  first: number;
  /** distinct local calendar days the app was used on */
  days: number;
  /** local 'YYYY-MM-DD' of the last day counted */
  lastDay: string;
  /** happy moments recorded so far */
  moments: number;
  /** ms epoch of the last request the shell confirmed StoreKit got, 0 = never */
  askedAt: number;
}

/** The engine flags the safety guard reads: engine/nav.js `Nav`, goto.js `Goto`, voice.js `Voice`,
 *  tracks.js `Tracks` (the same ones the update deferral in engine/app.js trusts) and gps.js `GPS`
 *  — `last` is the last accepted GeolocationPosition (speed in m/s or null), `lastFixTs` when it
 *  was accepted (Date.now(), 0 = never). */
export interface ReviewLive {
  Nav: { anchor: { watching: boolean; alarmTimer: unknown } };
  Goto: { active: boolean };
  Voice: { on: boolean; _wantOn: boolean };
  Tracks: { recording: boolean };
  GPS: { last: { coords: { speed: number | null } } | null; lastFixTs: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_KEY = 'fishapp.review';
export const REVIEW_MIN_MOMENTS = 2;
export const REVIEW_MIN_DAYS = 3;
export const REVIEW_MIN_AGE_MS = 3 * DAY_MS;
export const REVIEW_GAP_MS = 120 * DAY_MS;
/** A recorded track shorter than this was a test or a drift, not a trip worth celebrating. */
export const REVIEW_TRIP_MIN_NM = 0.5;
/** Let the "Catch logged" / "Track saved" toast land before the system sheet covers the screen. */
export const REVIEW_DELAY_MS = 2000;
/** Making way at this speed over ground or more is under way — someone is driving the boat. A
 *  drift with the wind or current stays below it. */
export const REVIEW_UNDER_WAY_KN = 2;
/** A fix older than this says nothing about now (engine/gps.js GPS_STALE_MS). */
const FIX_FRESH_MS = 60000;
const KNOTS_PER_MS = 1.94384;

const EMPTY: ReviewState = { first: 0, days: 0, lastDay: '', moments: 0, askedAt: 0 };

function num(v: unknown): number { return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0; }

export function readReviewState(): ReviewState {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object') return { ...EMPTY };
    return {
      first: num(o.first), days: Math.floor(num(o.days)), lastDay: typeof o.lastDay === 'string' ? o.lastDay : '',
      moments: Math.floor(num(o.moments)), askedAt: num(o.askedAt),
    };
  } catch { return { ...EMPTY }; }
}

function writeReviewState(s: ReviewState): void {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: then we just never ask */ }
}

/** Local calendar day — "different days" means the user's days, not UTC ones. */
export function reviewDayKey(now: number): string {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Count `now`'s day as a day of use (once per day). Pure. */
export function withUsageDay(s: ReviewState, now: number): ReviewState {
  const day = reviewDayKey(now);
  return { ...s, first: s.first || now, days: day === s.lastDay ? s.days : s.days + 1, lastDay: day };
}

/** The whole "is this a good time to ask" rule except the live safety state. Pure. */
export function reviewDue(s: ReviewState, now: number): boolean {
  return s.moments >= REVIEW_MIN_MOMENTS
    && s.days >= REVIEW_MIN_DAYS
    && s.first > 0 && now - s.first >= REVIEW_MIN_AGE_MS
    && (!s.askedAt || now - s.askedAt >= REVIEW_GAP_MS);
}

let live: ReviewLive | null = null;

/** Under way: a track recording (the engine's own rule, goto.js navUnderWay) or the last fresh
 *  GPS fix making way. Trip-saved is the moment this matters: Stop is tapped with the boat still
 *  running home, and nothing else is live by then. No fix, a stale one or no speed = can't tell,
 *  so not under way — someone with location off still gets asked. */
function underWay(l: ReviewLive, now: number): boolean {
  if (l.Tracks.recording) return true;
  const speed = l.GPS.last?.coords?.speed;
  return typeof speed === 'number' && isFinite(speed) && speed * KNOTS_PER_MS >= REVIEW_UNDER_WAY_KN
    && l.GPS.lastFixTs > 0 && now - l.GPS.lastFixTs <= FIX_FRESH_MS;
}

/** A system sheet must never cover the anchor alarm, the SOS screen, a Go-To or someone at the
 *  helm, and it would take the audio session from the hands-free mic. Unknown (boot never handed
 *  the flags in) = blocked. */
export function reviewBlockedBySafety(now: number = Date.now()): boolean {
  if (!live) return true;
  const a = live.Nav.anchor;
  return !!(a.watching || a.alarmTimer || live.Goto.active || live.Voice.on || live.Voice._wantOn
    || underWay(live, now) || isPanelOpen('emergency'));
}

function noteDay(now: number): void {
  writeReviewState(withUsageDay(readReviewState(), now));
}

let resumeHooked = false;

/** Boot hook: count today as a day of use and take the engine's safety flags. iOS keeps the app
 *  alive in the background for days, so coming back to the foreground counts too. */
export function noteAppOpen(flags: ReviewLive, now: number = Date.now()): void {
  try {
    if (!isNativeShell()) return;
    live = flags;
    noteDay(now);
    if (resumeHooked) return;
    resumeHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { try { noteDay(Date.now()); } catch { /* never mind */ } }
    });
  } catch { /* a rating prompt is never worth a boot error */ }
}

let pending: ReturnType<typeof setTimeout> | null = null;
/** A request is out and the shell hasn't answered yet. */
let asking = false;

/** A happy moment just happened (a new catch saved, a real trip saved). Records it and, if the
 *  policy allows, asks iOS for the rating prompt a moment later. Never throws: it sits on the
 *  save paths, and a rating prompt is never worth losing a catch over. */
export function reviewMoment(kind: ReviewMomentKind): void {
  try {
    if (!isNativeShell() || (kind !== 'catch' && kind !== 'trip')) return;
    const now = Date.now();
    const s = withUsageDay(readReviewState(), now);
    s.moments += 1;
    writeReviewState(s);
    if (pending || asking || !reviewDue(s, now) || reviewBlockedBySafety(now)) return;
    pending = setTimeout(askIfStillGood, REVIEW_DELAY_MS);
  } catch { /* see above */ }
}

/* Two seconds is long enough for an alarm to go off, SOS to open, the boat to get going or the
   app to leave the foreground. The 120 days start only when the shell confirms StoreKit got the
   request: one it dropped — Control Center, a call banner or Siri over the app (the page still
   reads 'visible' then), or the app leaving the foreground in between — was never a prompt, and
   recording it would waste the next 120 days. An older shell without the command keeps the
   chance the same way. */
function askIfStillGood(): void {
  pending = null;
  try {
    const now = Date.now();
    if (!reviewDue(readReviewState(), now) || reviewBlockedBySafety(now)) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    asking = true;
    requestReview()
      .then((requested) => { if (requested) writeReviewState({ ...readReviewState(), askedAt: now }); })
      .catch(() => { /* see above */ })
      .finally(() => { asking = false; });
  } catch { asking = false; }
}

/** The App Store "Write a Review" page, or null while there is no listing (SITE.appStoreId). */
export function appStoreReviewUrl(): string | null {
  const base = appStoreUrl();
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set('action', 'write-review');
  return u.toString();
}
