/* Modal, in-app dialogs (confirm/prompt/alert) and the toast. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, Field, TextInput } from './primitives';
import { Icon } from './Icon';
import { dismissToast, useUi, type DialogState } from '../services/ui';

/* A modal opened from inside another layer (the catch card's Share) renders through ModalPortal
   into ModalLayer, a node the shell keeps right after ModalHost, so it stacks exactly like a
   ModalHost modal: over the chrome, sheets and persistent layer, under dialogs, the toast and the
   anchor alarm. Left in place it would open under the sheets (the map card host is its own
   stacking context, and its rise animation would contain a fixed child); in document.body it
   would paint over the whole app, alarm included (#root is a stacking context too). */
const MODAL_LAYER_ID = 'ui-modal-layer';
export function ModalLayer() { return <div id={MODAL_LAYER_ID} />; }
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.getElementById(MODAL_LAYER_ID) ?? document.getElementById('root') ?? document.body);
}

/* Keyboard focus for the modal cards: opening moves focus onto the card (a screen reader
   announces it, and Tab starts inside instead of in the app behind the backdrop), Tab and
   Shift+Tab wrap inside it, and closing hands focus back to what opened it. Focus held by a
   layer painted above — the anchor alarm's Silence — is never taken: the shell stacks its
   layers in DOM order. */
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';
function tabbables(box: HTMLElement): HTMLElement[] {
  const laidOut = box.getClientRects().length > 0;   // no layout (jsdom): skip the visibility test
  return [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0
    && !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && (!laidOut || el.getClientRects().length > 0));
}

/** Escape belongs to the top-most layer only. True when a modal layer (aria-modal="true": a
 *  modal, a dialog, the first-run notice, the anchor alarm) is open above `el` — painted later in
 *  the DOM — or, with no `el`, when any is open (sheets and map cards sit under all of them).
 *  Every layer listens on window, so without this one Escape closed the sheet BEHIND a confirm
 *  and left the confirm up, or closed a modal and the sheet under it together. */
export function modalLayerAbove(el?: Element | null): boolean {
  if (typeof document === 'undefined') return false;
  const open = document.querySelectorAll('[aria-modal="true"]');
  if (!el) return open.length > 0;
  for (const m of open) if (m !== el && !el.contains(m) && (el.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)) return true;
  return false;
}

export function useModalFocus(box: RefObject<HTMLDivElement | null>) {
  // read while rendering, before a child's effect can move focus into the card
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const holder = document.activeElement?.closest('[aria-modal="true"]');
    const above = !!holder && holder !== el && !!(el.compareDocumentPosition(holder) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!above && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => {
      const at = document.activeElement;
      const lost = !at || at === document.body || el.contains(at);
      if (lost && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [box, opener]);
  return (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = tabbables(e.currentTarget);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey ? at === first || at === e.currentTarget : at === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
}

export interface ModalProps {
  title: ReactNode;
  children?: ReactNode;
  onCancel: () => void;
  /** omit for a modal whose body carries its own buttons */
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryBusy?: boolean;
  primaryDisabled?: boolean;
  destructive?: boolean;
  cancelLabel?: string;
  label?: string;
}

/** Centred card; scrolls when the keyboard or a photo makes it taller than the screen.
 *  Tapping the backdrop cancels (legacy behaviour). Paper surface in the sun theme. */
export function Modal({ title, children, onCancel, primaryLabel, onPrimary, primaryBusy, primaryDisabled, destructive, cancelLabel = 'Cancel', label }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modalLayerAbove(box.current)) { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const onKeyDown = useModalFocus(box);
  return (
    <div className="ui-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={box} tabIndex={-1} onKeyDown={onKeyDown} className="ui-modal surface-paper" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        <h2 className="ui-title-1 ui-modal__title">{title}</h2>
        {children && <div className="ui-modal__body">{children}</div>}
        {primaryLabel && (
          <div className="ui-modal__btns">
            <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
            <Button variant={destructive ? 'destructive' : 'primary'} onClick={onPrimary} busy={primaryBusy} disabled={primaryDisabled}>{primaryLabel}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DialogView({ d }: { d: DialogState }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries((d.fields ?? []).map((f) => [f.name, f.value ?? ''])));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { if (d.kind === 'prompt') setTimeout(() => first.current?.focus(), 60); }, [d.kind]);
  const box = useRef<HTMLDivElement>(null);
  const onKeyDown = useModalFocus(box);
  const cancel = () => d.resolve(d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined);
  const ok = () => d.resolve(d.kind === 'confirm' ? true : d.kind === 'prompt' ? vals : undefined);
  /* Escape = Cancel (an alert's only button), like a backdrop tap — and, like it, not for a
     decision that must be made on purpose (dismissible: false). */
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || d.dismissible === false || modalLayerAbove(box.current)) return;
      e.preventDefault();
      cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d.dismissible]);
  return (
    <div className="ui-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget && d.dismissible !== false) cancel(); }}>
      <div ref={box} tabIndex={-1} onKeyDown={onKeyDown} className="ui-modal surface-paper" role="alertdialog" aria-modal="true" aria-label={d.title}>
        <h2 className="ui-title-1 ui-modal__title">{d.title}</h2>
        {d.message && <p className="ui-modal__msg">{d.message}</p>}
        {d.kind === 'prompt' && (
          <form onSubmit={(e) => { e.preventDefault(); ok(); }} className="ui-modal__body">
            {(d.fields ?? []).map((f, i) => (
              <Field key={f.name} label={f.label}>
                <TextInput ref={i === 0 ? first : undefined} type={f.type ?? 'text'} inputMode={f.inputMode} placeholder={f.placeholder}
                  value={vals[f.name] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))} />
              </Field>
            ))}
            <button type="submit" hidden />
          </form>
        )}
        <div className={'ui-modal__btns' + (d.kind === 'alert' ? ' ui-modal__btns--one' : '')}>
          {d.kind !== 'alert' && <Button variant="secondary" onClick={cancel}>{d.cancelLabel ?? 'Cancel'}</Button>}
          <Button variant={d.destructive ? 'destructive' : 'primary'} onClick={ok}>{d.confirmLabel ?? (d.kind === 'confirm' ? 'Confirm' : 'OK')}</Button>
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const dialogs = useUi((s) => s.dialogs);
  const top = dialogs[dialogs.length - 1];
  return top ? <DialogView key={top.id} d={top} /> : null;
}

export function ToastHost() {
  const t = useUi((s) => s.toast);
  if (!t) return null;
  return (
    <div className={'ui-toast' + (t.tone === 'alert' ? ' ui-toast--alert' : '')} role={t.tone === 'alert' ? 'alert' : 'status'} aria-live={t.tone === 'alert' ? 'assertive' : 'polite'} key={t.id}>
      {t.tone === 'alert' && <Icon name="alert" size={18} className="ui-toast__icon" />}
      <span className="ui-toast__msg">{t.msg}</span>
      {t.action && <button type="button" className="ui-toast__action" onClick={() => { t.action!.run(); dismissToast(); }}>{t.action.label}</button>}
    </div>
  );
}
