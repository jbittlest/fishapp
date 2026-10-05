/* Modal, in-app dialogs (confirm/prompt/alert) and the toast. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, TextInput } from './primitives';
import { dismissToast, useUi, type DialogState } from '../services/ui';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="ui-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ui-modal surface-paper" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
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
  const cancel = () => d.resolve(d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined);
  const ok = () => d.resolve(d.kind === 'confirm' ? true : d.kind === 'prompt' ? vals : undefined);
  return (
    <div className="ui-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="ui-modal surface-paper" role="alertdialog" aria-modal="true" aria-label={d.title}>
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
    <div className="ui-toast" role="status" aria-live="polite" key={t.id}>
      <span className="ui-toast__msg">{t.msg}</span>
      {t.action && <button type="button" className="ui-toast__action" onClick={() => { t.action!.run(); dismissToast(); }}>{t.action.label}</button>}
    </div>
  );
}
