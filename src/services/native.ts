/* Bridge to the native iOS shell (FishApp-iOS). Everything here degrades to the web behaviour
 * when the page runs in a browser, so callers never branch on platform themselves.
 *
 * The shell injects Bridge.js at document start, which defines window.FishNative and replaces
 * navigator.geolocation / wakeLock with CoreLocation / UIKit-backed versions. Commands go to
 * WKScriptMessageHandler "native" (NativeBridge.swift). */

interface FishNativeApi {
  platform: 'ios';
  version: number;
  post(cmd: string, extra?: Record<string, unknown>): void;
}

/** How the shell answers requestReview (NativeBridge.swift). */
interface ReviewAnswer { requested?: unknown }

declare global {
  interface Window {
    FishNative?: FishNativeApi;
    __fishNativeReviewRequested?: (r: ReviewAnswer) => void;
  }
}

export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!window.FishNative;
}

/** Bridge.js version of the iOS shell, 0 in a browser. 3 added requestReview and shareText; an
 *  older installed shell silently drops commands it doesn't know, so gate new ones on this. */
export function nativeBridgeVersion(): number {
  const n = typeof window !== 'undefined' ? window.FishNative : undefined;
  return n && typeof n.version === 'number' ? n.version : 0;
}

function post(cmd: string, extra?: Record<string, unknown>): boolean {
  const n = typeof window !== 'undefined' ? window.FishNative : undefined;
  if (!n) return false;
  try { n.post(cmd, extra); return true; } catch { return false; }
}

/** Keep CoreLocation running with the screen locked — only while something needs it (anchor watch,
 *  track recording, an active Go-To). App Review expects background location to be purposeful. */
export function backgroundLocation(on: boolean): void { post('backgroundLocation', { on }); }

/** Arm/disarm the NATIVE anchor monitor (iOS app only). While the app is in the background it checks
 *  each fix against the watch circle itself and raises a notification + alarm tone, because iOS can
 *  suspend the web view's JavaScript with the phone locked. In the foreground the web watch owns it. */
export function nativeAnchorWatch(w: { on: false } | { on: true; lat: number; lng: number; radiusM: number }): void {
  post('anchorWatch', w as Record<string, unknown>);
}
/** The user silenced the alarm in the app: snooze the native one too (5 minutes, like the web). */
export function nativeAnchorSilence(): void { post('anchorSilence'); }

/** Light warning haptic (alarms, arming). No-op on the web. */
export function haptic(): void { post('haptic'); }

/* The shell answers within a main-thread hop; past this, treat the request as lost. */
export const REVIEW_ANSWER_MS = 5000;
let reviewAsk: Promise<boolean> | null = null;

/** Ask iOS for the App Store rating prompt. Resolves true once the shell has handed the request to
 *  StoreKit — iOS still decides whether the prompt appears (at most three times a year) and never
 *  says. False in a browser, on an older shell, when the app wasn't the active foreground scene
 *  (the shell drops it then), or with no answer in time. One request at a time: a second call
 *  while one is out shares its answer. WHEN to ask is services/review's job — never call this
 *  from a button. */
export function requestReview(): Promise<boolean> {
  if (nativeBridgeVersion() < 3) return Promise.resolve(false);
  if (reviewAsk) return reviewAsk;
  let settle!: (requested: boolean) => void;
  const ask = new Promise<boolean>((resolve) => { settle = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = (requested: boolean) => {
    clearTimeout(timer);
    if (window.__fishNativeReviewRequested === answer) delete window.__fishNativeReviewRequested;
    if (reviewAsk === ask) reviewAsk = null;
    settle(requested);
  };
  const answer = (r: ReviewAnswer) => done(!!r && r.requested === true);
  window.__fishNativeReviewRequested = answer;
  if (!post('requestReview')) { done(false); return ask; }
  reviewAsk = ask;
  timer = setTimeout(() => done(false), REVIEW_ANSWER_MS);
  return ask;
}

/** Open a link outside the app (Safari / Phone / Messages in the iOS shell; a new tab on the web). */
export function openExternal(url: string): void {
  if (post('openURL', { url })) return;
  // tel:/sms:/mailto: hand off to another app; the page itself stays loaded.
  if (/^(tel|sms|mailto):/i.test(url)) { window.location.href = url; return; }
  /* NEVER assign location.href for http(s): the app may be running an anchor alarm, a voyage, a
     track or the hands-free mic, and offshore the new page would be a browser error with no way
     back (an installed PWA has no back button). Note window.open with 'noopener' in its features
     always returns null by spec, so it can't be used to detect a blocked popup. */
  let w: Window | null = null;
  try { w = window.open(url, '_blank'); } catch { w = null; }
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } return; }
  try {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  } catch { /* nothing else is safe to try */ }
}

/** Copy text. The iOS shell uses UIPasteboard (a custom-scheme page may not get the async
 *  clipboard API); browsers use navigator.clipboard. Resolves false if nothing worked. */
export async function copyText(text: string): Promise<boolean> {
  if (post('copyText', { text })) return true;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/* Web Share only where it opens a real share sheet: desktop browsers that have it show a thin
   system dialog, and there the clipboard is what people expect. */
const PHONE_UA = /iPhone|iPad|Android/i;

/** Share a short message and a link (a spot, a catch, the app itself).
 *  iOS shell → native share sheet. Phone browser → Web Share. Anywhere else, or when sharing is
 *  refused, the message and link go to the clipboard: on 'copied' the caller should say so.
 *  'cancelled' means nothing happened — the user closed the sheet, or no clipboard either.
 *  `title` is used by Web Share only (the iOS sheet has no title line). */
export async function shareText(opts: { text: string; url?: string; title?: string }): Promise<'shared' | 'copied' | 'cancelled'> {
  const text = String(opts.text ?? '').trim();
  const url = String(opts.url ?? '').trim();
  if (!text && !url) return 'cancelled';
  if (isNativeShell()) {
    if (nativeBridgeVersion() >= 3 && post('shareText', { text, url })) return 'shared';
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && PHONE_UA.test(navigator.userAgent)) {
    const data: ShareData = {};
    if (text) data.text = text;
    if (url) data.url = url;
    if (opts.title) data.title = opts.title;
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user gesture left after an await) and the like: copy instead
    }
  }
  const line = !url || text.includes(url) ? text : text ? text + ' ' + url : url;
  return (await copyText(line)) ? 'copied' : 'cancelled';
}

/** Save a generated file (backup export, catch card, motor session).
 *  iOS shell → native share sheet (Save to Files, AirDrop, Messages…).
 *  Browser → Web Share with files when available (iPhone Safari), else a normal download. */
export async function saveOrShareFile(opts: { name: string; mime: string; data: Blob | string; title?: string }): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = typeof opts.data === 'string' ? new Blob([opts.data], { type: opts.mime }) : opts.data;
  if (isNativeShell()) {
    post('shareFile', { name: opts.name, mime: opts.mime, base64: await blobToBase64(blob) });
    return 'shared';
  }
  try {
    const file = new File([blob], opts.name, { type: opts.mime });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] }) && PHONE_UA.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: opts.title ?? opts.name });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = opts.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
