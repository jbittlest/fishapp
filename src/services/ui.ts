/* UI service — the single place the engine and React agree on what is on screen.
 *
 * A zustand *vanilla* store, so plain-JS engine modules can drive it (toast(), openPanel(),
 * confirmDialog() …) and React reads it with the useUi() hook. This replaces every legacy
 * `document.getElementById('panel-x').classList` dance, togglePanel/closePanels on window,
 * the #toast element, and the native prompt()/confirm() dialogs (which return null/false in
 * the iOS WKWebView shell and look like a 1998 browser everywhere else). */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type PanelId =
  | 'weather' | 'tides' | 'more' | 'layers' | 'spots' | 'download' | 'tools'
  | 'guides' | 'emergency' | 'assistant' | 'motor' | 'about';

export type Detent = 'medium' | 'full';

export interface ToastState { id: number; msg: string; action?: { label: string; run: () => void }; ms: number; tone?: 'alert'; until: number }

/** A map selection shown as a docked card (tap-to-inspect, a reef, a spot, a catch, a sighting…).
 *  `kind` selects the renderer registered in shell/cards.ts; `data` is that renderer's props. */
export interface CardState { id: number; kind: string; data: any; latlng?: { lat: number; lng: number } }

export interface DialogField { name: string; label: string; value?: string; placeholder?: string; type?: 'text' | 'tel' | 'number' | 'url'; inputMode?: 'text' | 'tel' | 'numeric' | 'decimal' | 'url' }
export interface DialogState {
  id: number;
  kind: 'confirm' | 'prompt' | 'alert';
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** false: a backdrop tap does nothing (a decision that must be made on purpose, e.g. AI consent) */
  dismissible?: boolean;
  fields?: DialogField[];
  resolve: (v: any) => void;
}

/** Feature-owned modals (spot editor, catch logger…) are registered by name in shell/modals.ts. */
export interface ModalState { id: number; name: string; data: any }

export interface UiState {
  panel: PanelId | null;
  panelData: any;            // optional payload for the open panel (e.g. weather → area forecast point)
  detent: Detent;
  card: CardState | null;
  modal: ModalState | null;
  toast: ToastState | null;
  dialogs: DialogState[];
  bootStatus: string;
  booted: boolean;
  online: boolean;
  build: { app: string; sw: string | null; updatePending: boolean };
}

let seq = 1;
export const uiStore = createStore<UiState>(() => ({
  panel: null,
  panelData: null,
  detent: 'full',
  card: null,
  modal: null,
  toast: null,
  dialogs: [],
  bootStatus: 'Starting up…',
  booted: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  build: { app: __APP_BUILD__, sw: null, updatePending: false },
}));

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}

/* ---------------------------------------------------------------- panels */
/** Panels that open at the half detent by default (the chart stays useful behind them). */
const MEDIUM_FIRST: ReadonlySet<PanelId> = new Set(['weather', 'tides', 'more', 'layers']);

const openListeners = new Set<(id: PanelId, data: any) => void>();
/** Engine hook: run something whenever a panel is opened (the old togglePanel on-open hooks). */
export function onPanelOpen(fn: (id: PanelId, data: any) => void): () => void {
  openListeners.add(fn);
  return () => { openListeners.delete(fn); };
}

export function openPanel(id: PanelId, data: any = null, detent?: Detent): void {
  const was = uiStore.getState().panel;
  uiStore.setState({ panel: id, panelData: data, card: null, detent: detent ?? (MEDIUM_FIRST.has(id) ? 'medium' : 'full') });
  if (was !== id) openListeners.forEach((fn) => { try { fn(id, data); } catch (e) { console.error(e); } });
}

/** Legacy semantics: open it (closing any other), or close it if it is already the open one. */
export function togglePanel(id: PanelId | string): void {
  const pid = normalizePanelId(id);
  if (uiStore.getState().panel === pid) closePanels();
  else openPanel(pid);
}

export function closePanels(): void {
  uiStore.setState({ panel: null, panelData: null });
}

export function isPanelOpen(id: PanelId | string): boolean {
  return uiStore.getState().panel === normalizePanelId(id);
}

export function setDetent(detent: Detent): void { uiStore.setState({ detent }); }

/** Accept the old DOM ids ('panel-weather', 'panel-knots') so ported engine code reads naturally. */
export function normalizePanelId(id: string): PanelId {
  const s = id.replace(/^panel-/, '');
  return (s === 'knots' ? 'guides' : s) as PanelId;
}

/* ----------------------------------------------------------------- cards */
export function openCard(kind: string, data: any, latlng?: { lat: number; lng: number }): void {
  /* On a phone the card docks where an open sheet is, so the sheet steps aside (the legacy app
     closed panels when it flew to a reef/catch/spot too). On desktop they sit side by side. */
  const phone = typeof window !== 'undefined' && window.innerWidth < 900;
  uiStore.setState(phone ? { card: { id: seq++, kind, data, latlng }, panel: null, panelData: null } : { card: { id: seq++, kind, data, latlng } });
}
export function closeCard(kind?: string): void {
  const c = uiStore.getState().card;
  if (!c || (kind && c.kind !== kind)) return;
  uiStore.setState({ card: null });
}
/** Replace the open card's data in place (e.g. live values arriving after the first paint). */
export function updateCard(id: number, patch: any): void {
  const c = uiStore.getState().card;
  if (!c || c.id !== id) return;
  uiStore.setState({ card: { ...c, data: { ...c.data, ...patch } } });
}

/* ---------------------------------------------------------------- modals */
export function openModal(name: string, data: any = null): void {
  uiStore.setState({ modal: { id: seq++, name, data } });
}
export function closeModal(name?: string): void {
  const m = uiStore.getState().modal;
  if (!m || (name && m.name !== name)) return;
  uiStore.setState({ modal: null });
}

/* ----------------------------------------------------------------- toast */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** One slot, last writer wins (legacy behaviour — boot notices relied on it) — EXCEPT that a plain
 *  toast never replaces a safety warning (tone 'alert') that is still on screen. */
export function toast(msg: string, opts: { action?: ToastState['action']; ms?: number; tone?: 'alert' } = {}): void {
  const ms = opts.ms ?? (opts.action ? 5000 : opts.tone === 'alert' ? 9000 : 3200);
  const cur = uiStore.getState().toast;
  if (cur && cur.tone === 'alert' && opts.tone !== 'alert' && Date.now() < cur.until) return;
  const t: ToastState = { id: seq++, msg: stripEmoji(String(msg)), action: opts.action, ms, tone: opts.tone, until: Date.now() + ms };
  uiStore.setState({ toast: t });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (uiStore.getState().toast?.id === t.id) uiStore.setState({ toast: null }); }, ms);
}
export function dismissToast(): void { clearTimeout(toastTimer); uiStore.setState({ toast: null }); }

/** Chrome never shows emoji (DESIGN.md). Engine copy still carries a few as leading markers. */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* --------------------------------------------------------------- dialogs */
function pushDialog<T>(d: Omit<DialogState, 'id' | 'resolve'>): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = seq++;
    const done = (v: T) => {
      uiStore.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== id) }));
      resolve(v);
    };
    uiStore.setState((s) => ({ dialogs: [...s.dialogs, { ...d, id, resolve: done } as DialogState] }));
  });
}

/** In-app replacement for window.confirm(). ASYNC: callers must re-check any state they rely on
 *  after the await (a GPS fix, a connection, an arm state can all change while it is open). */
export function confirmDialog(opts: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; dismissible?: boolean }): Promise<boolean> {
  return pushDialog<boolean>({ kind: 'confirm', ...opts });
}

/** In-app replacement for window.prompt(), with any number of fields. Resolves null on cancel. */
export function promptDialog(opts: { title: string; message?: string; fields: DialogField[]; confirmLabel?: string }): Promise<Record<string, string> | null> {
  return pushDialog<Record<string, string> | null>({ kind: 'prompt', ...opts });
}

export function alertDialog(opts: { title: string; message?: string; confirmLabel?: string }): Promise<void> {
  return pushDialog<void>({ kind: 'alert', ...opts });
}

/* ------------------------------------------------------------------ boot */
export function setBootStatus(msg: string): void { uiStore.setState({ bootStatus: msg }); }
export function markBooted(): void { uiStore.setState({ booted: true }); }

/* --------------------------------------------------------------- network */
if (typeof window !== 'undefined') {
  const sync = () => uiStore.setState({ online: navigator.onLine });
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}
