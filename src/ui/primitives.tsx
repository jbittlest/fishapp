/* Design-system primitives (DESIGN.md §8). Every feature builds from these — no feature defines
 * its own button, switch, list row or number style. Styling lives in ui.css under `ui-*` classes. */
import { useId, useState, type ReactNode, type CSSProperties, type ButtonHTMLAttributes, type ComponentProps, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ Num */
export type NumSize = 'xl' | 'l' | 'm' | 's' | 'row' | 'alarm';
export interface NumProps {
  value: number | null | undefined;
  digits?: number;
  unit?: string;
  /** degree-style unit that hugs the number (°, °F, °T) */
  deg?: string;
  size?: NumSize;
  /** prefix "~" — the value is an estimate / interpolation */
  approx?: boolean;
  /** dims the value and shows its age — a value that is no longer live */
  stale?: boolean;
  /** proportional figures for static heroes; tabular (default) for live values and columns */
  proportional?: boolean;
  className?: string;
  /** shown instead of the dash when value is missing */
  empty?: string;
}
/** Every number in the app goes through here: tabular figures, a dash for missing values,
 *  "~" for estimates, never NaN, never "0" standing in for "unknown". */
export function Num({ value, digits = 0, unit, deg, size = 'm', approx, stale, proportional, className, empty = '—' }: NumProps) {
  const ok = value != null && Number.isFinite(value);
  return (
    <span className={cx('ui-num', `ui-num--${size}`, stale && 'is-stale', proportional && 'is-prop', !ok && 'is-empty', className)}>
      {ok && approx && <span className="ui-num__approx">~</span>}
      <span className="ui-num__v">{ok ? (value as number).toFixed(digits) : empty}</span>
      {ok && deg && <span className="ui-num__deg">{deg}</span>}
      {ok && unit && <span className="ui-num__unit">{unit}</span>}
    </span>
  );
}

/* --------------------------------------------------------------- Buttons */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  compact?: boolean;
  block?: boolean;
  busy?: boolean;
}
export function Button({ variant = 'secondary', icon, compact, block, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cx('ui-btn', `ui-btn--${variant}`, compact && 'ui-btn--compact', block && 'ui-btn--block', className)}>
      {busy ? <Spinner size="sm" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children != null && <span className="ui-btn__label">{children}</span>}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;           // required: icon-only buttons always carry an aria-label
  size?: 'md' | 'sm';
  active?: boolean;
  filled?: boolean;
  tone?: 'default' | 'signal' | 'plain';
}
export function IconButton({ icon, label, size = 'md', active, filled, tone = 'default', className, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active ?? undefined} {...rest}
      className={cx('ui-ibtn', `ui-ibtn--${size}`, `ui-ibtn--${tone}`, active && 'is-active', className)}>
      <Icon name={icon} size={size === 'sm' ? 18 : 20} filled={filled} />
    </button>
  );
}

/** Small toggle pill (Speak on/off, filters). */
export function PillButton({ icon, on, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest} className={cx('ui-pill', on && 'is-on', className)}>
      {icon && <Icon name={icon} size={16} />}<span>{children}</span>
    </button>
  );
}

/* ------------------------------------------------------------- Segmented */
export interface SegOption<T extends string> { value: T; label: ReactNode }
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={cx('ui-seg', className)} role="tablist" aria-label={label} style={{ '--n': options.length, '--i': idx } as CSSProperties}>
      <span className="ui-seg__thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={cx('ui-seg__opt', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Switch */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={cx('ui-switch', checked && 'is-on')} onClick={() => onChange(!checked)}>
      <span className="ui-switch__knob" />
    </button>
  );
}

/** A list row with a switch: Map Layers, Device settings. */
export function ToggleRow({ icon, title, detail, checked, onChange, disabled, children }: { icon?: IconName; title: ReactNode; detail?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('ui-row ui-row--toggle', disabled && 'is-disabled')}>
      {icon && <span className="ui-row__lead"><Icon name={icon} size={20} /></span>}
      <label className="ui-row__main" htmlFor={id} onClick={() => !disabled && onChange(!checked)}>
        <span className="ui-row__title">{title}</span>
        {detail && <span className="ui-row__sub">{detail}</span>}
        {children}
      </label>
      <span id={id} className="ui-row__trail"><Switch checked={checked} onChange={onChange} label={typeof title === 'string' ? title : 'Toggle'} disabled={disabled} /></span>
    </div>
  );
}

/** One option of a single-choice group (base map, download detail). */
export function RadioRow({ icon, title, detail, checked, onSelect, disabled }: { icon?: IconName; title: ReactNode; detail?: ReactNode; checked: boolean; onSelect: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={checked} disabled={disabled}
      className={cx('ui-row ui-row--radio', checked && 'is-on')} onClick={onSelect}>
      {icon && <span className="ui-row__lead"><Icon name={icon} size={20} /></span>}
      <span className="ui-row__main"><span className="ui-row__title">{title}</span>{detail && <span className="ui-row__sub">{detail}</span>}</span>
      <span className="ui-radio" aria-hidden><span /></span>
    </button>
  );
}

/* ---------------------------------------------------------------- Lists */
export interface ListRowProps {
  icon?: IconName;
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  className?: string;
  tone?: 'default' | 'alert';
}
export function ListRow({ icon, lead, title, subtitle, trailing, chevron, onPress, className, tone }: ListRowProps) {
  const inner = (
    <>
      {(icon || lead) && <span className="ui-row__lead">{lead ?? <Icon name={icon!} size={20} />}</span>}
      <span className="ui-row__main">
        <span className="ui-row__title">{title}</span>
        {subtitle && <span className="ui-row__sub">{subtitle}</span>}
      </span>
      {(trailing != null || chevron) && (
        <span className="ui-row__trail">{trailing}{chevron && <Icon name="chevron-right" size={16} className="ui-row__chev" />}</span>
      )}
    </>
  );
  const cls = cx('ui-row', tone === 'alert' && 'ui-row--alert', onPress && 'is-pressable', className);
  return onPress
    ? <button type="button" className={cls} onClick={onPress}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

/** A labelled section inside a sheet. `label` renders in the small-caps label style. */
export function Section({ label, action, children, className }: { label?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx('ui-section', className)}>
      {(label || action) && <div className="ui-section__head">{label && <h3 className="ui-label">{label}</h3>}{action}</div>}
      {children}
    </section>
  );
}

/** Raised inset group (cards of rows, stat grids). */
export function Group({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={cx('ui-group', className)} style={style}>{children}</div>;
}

/* ---------------------------------------------------------------- Stats */
export function DirectionDial({ towardDeg, size = 38, label }: { towardDeg: number | null | undefined; size?: number; label?: string }) {
  const ok = towardDeg != null && Number.isFinite(towardDeg);
  return (
    <svg className="ui-dial" width={size} height={size} viewBox="0 0 38 38" role="img" aria-label={label ?? (ok ? `toward ${Math.round(towardDeg!)}°` : 'direction unknown')}>
      <circle cx="19" cy="19" r="17" className="ui-dial__ring" />
      {[0, 90, 180, 270].map((a) => <line key={a} x1="19" y1="3.5" x2="19" y2="6.5" className="ui-dial__tick" transform={`rotate(${a} 19 19)`} />)}
      {ok && (
        <g transform={`rotate(${towardDeg} 19 19)`}>
          <line x1="19" y1="28" x2="19" y2="10" className="ui-dial__shaft" />
          <path d="M14.5 14.5 L19 9.5 L23.5 14.5" className="ui-dial__shaft" fill="none" />
        </g>
      )}
    </svg>
  );
}

export function StatTile({ icon, label, children, dial, detail, className }: { icon?: IconName; label: ReactNode; children: ReactNode; dial?: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={cx('ui-stat', className)}>
      <div className="ui-stat__label">{icon && <Icon name={icon} size={14} />}<span className="ui-label">{label}</span></div>
      <div className="ui-stat__row"><div className="ui-stat__value">{children}</div>{dial}</div>
      {detail && <div className="ui-stat__detail">{detail}</div>}
    </div>
  );
}

export function StatStrip({ cells, className }: { cells: Array<{ label: ReactNode; value: ReactNode; key?: string }>; className?: string }) {
  return (
    <div className={cx('ui-strip', className)} style={{ '--n': cells.length } as CSSProperties}>
      {cells.map((c, i) => (
        <div key={c.key ?? i} className="ui-strip__cell"><span className="ui-label">{c.label}</span><span className="ui-strip__v">{c.value}</span></div>
      ))}
    </div>
  );
}

/** Label/value pairs in a two-column list (trip stats, sun & moon, catch conditions). */
export function KeyValues({ items, className }: { items: Array<{ k: ReactNode; v: ReactNode; key?: string }>; className?: string }) {
  return (
    <dl className={cx('ui-kv', className)}>
      {items.map((it, i) => (<div className="ui-kv__row" key={it.key ?? i}><dt>{it.k}</dt><dd>{it.v}</dd></div>))}
    </dl>
  );
}

/* ---------------------------------------------------------------- Fields */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('ui-field', className)}>
      <span className="ui-label">{label}</span>
      {children}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </label>
  );
}
export function TextInput(props: ComponentProps<'input'>) {
  return <input autoComplete="off" autoCorrect="off" spellCheck={false} {...props} className={cx('ui-input', props.className)} />;
}
export function TextArea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx('ui-input ui-textarea', props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="ui-select">
      <select {...props} className={cx('ui-input', props.className)}>{children}</select>
      <Icon name="chevron-down" size={16} className="ui-select__chev" />
    </span>
  );
}

/* ----------------------------------------------------------------- Chips */
export function Chip({ children, onPress, selected, icon }: { children: ReactNode; onPress?: () => void; selected?: boolean; icon?: IconName }) {
  return (
    <button type="button" className={cx('ui-chip', selected && 'is-on')} onClick={onPress} aria-pressed={selected ?? undefined}>
      {icon && <Icon name={icon} size={16} />}{children}
    </button>
  );
}
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-chiprow', className)}>{children}</div>;
}

/* ---------------------------------------------------------- Badges/text */
export function Badge({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'signal' | 'alert' | 'ok'; icon?: IconName }) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`)}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}
/** Secondary explanatory copy. Keeps safety/honesty text visible (never below 13px). */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('ui-hint', className)}>{children}</p>;
}
/** A notice that must be read: the honesty/limitation copy (iPhone GPS, motor interlocks). */
export function Notice({ children, tone = 'neutral', icon, title }: { children: ReactNode; tone?: 'neutral' | 'alert'; icon?: IconName; title?: ReactNode }) {
  return (
    <div className={cx('ui-notice', `ui-notice--${tone}`)} role={tone === 'alert' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'alert' ? 'alert' : 'info')} size={18} />
      <div>{title && <div className="ui-notice__title">{title}</div>}<div className="ui-notice__body">{children}</div></div>
    </div>
  );
}

/* -------------------------------------------------------- Loading/state */
export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md'; label?: string }) {
  return <span className={cx('ui-spinner spin', size === 'sm' && 'ui-spinner--sm')} role={label ? 'status' : undefined} aria-label={label} />;
}
/** Replaces legacy loadingHTML(msg). */
export function LoadingRow({ children = 'Loading…' }: { children?: ReactNode }) {
  return <div className="ui-loading" role="status"><Spinner size="sm" /><span>{children}</span></div>;
}
/** Replaces legacy stateHTML(icon, msg, retryFn): empty / offline / error, with an optional Retry. */
export function StateBox({ icon = 'info', children, onRetry, retryLabel = 'Retry', tone = 'neutral' }: { icon?: IconName; children: ReactNode; onRetry?: () => void; retryLabel?: string; tone?: 'neutral' | 'alert' }) {
  return (
    <div className={cx('ui-state', tone === 'alert' && 'ui-state--alert')}>
      <Icon name={icon} size={24} />
      <div className="ui-state__msg">{children}</div>
      {onRetry && <Button compact icon="refresh" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="ui-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: pct + '%' }} />
    </div>
  );
}

/** Expand/collapse row group (10-day days, guides). State survives re-renders via `id`. */
export function Disclosure({ summary, children, defaultOpen = false, open: openProp, onToggle, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void; className?: string }) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  return (
    <div className={cx('ui-disc', open && 'is-open', className)}>
      <button type="button" className="ui-disc__sum" aria-expanded={open} onClick={() => { const n = !open; setInner(n); onToggle?.(n); }}>
        <span className="ui-disc__content">{summary}</span>
        <Icon name="chevron-down" size={16} className="ui-disc__chev" />
      </button>
      {open && <div className="ui-disc__body">{children}</div>}
    </div>
  );
}

/** Small bar chart for First Mate facts and hourly strips (DESIGN.md §8.14). */
export function MiniBarChart({ values, labels, nowIndex = 0, unit, height = 56 }: { values: Array<number | null>; labels?: string[]; nowIndex?: number; unit?: string; height?: number }) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  const max = finite.length ? Math.max(...finite) : 1;
  const maxI = values.findIndex((v) => v === max);
  return (
    <div className="ui-bars" style={{ height }} role="img" aria-label={`${finite.length} values${unit ? ' in ' + unit : ''}, max ${max}`}>
      {values.map((v, i) => {
        const h = v != null && Number.isFinite(v) && max > 0 ? Math.max(3, (v / max) * (height - 18)) : 0;
        return (
          <div className={cx('ui-bars__col', i === nowIndex && 'is-now')} key={i}>
            {(i === nowIndex || i === maxI) && v != null && <span className="ui-bars__val">{Math.round(v)}</span>}
            <span className="ui-bars__bar" style={{ height: h }} />
            {labels && <span className="ui-bars__lbl">{labels[i] ?? ''}</span>}
          </div>
        );
      })}
    </div>
  );
}
