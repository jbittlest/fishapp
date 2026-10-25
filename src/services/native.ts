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

declare global {
  interface Window { FishNative?: FishNativeApi }
}

export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!window.FishNative;
}

function post(cmd: string, extra?: Record<string, unknown>): boolean {
  const n = typeof window !== 'undefined' ? window.FishNative : undefined;
  if (!n) return false;
  try { n.post(cmd, extra); return true; } catch { return false; }
}

/** Keep CoreLocation running with the screen locked — only while something needs it (anchor watch,
 *  track recording, an active Go-To). App Review expects background location to be purposeful. */
export function backgroundLocation(on: boolean): void { post('backgroundLocation', { on }); }

/** Light warning haptic (alarms, arming). No-op on the web. */
export function haptic(): void { post('haptic'); }

/** Open a link outside the app (Safari / Phone / Messages in the iOS shell; a new tab on the web). */
export function openExternal(url: string): void {
  if (post('openURL', { url })) return;
  if (/^(tel|sms|mailto):/i.test(url)) { window.location.href = url; return; }
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) window.location.href = url;
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
    if (nav.canShare && nav.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
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
