/* Sheet — every panel in the app (DESIGN.md §8.8).
 *
 * Phone: a bottom sheet with two detents. `full` stops just below the persistent layer
 * (HUD + nav pill + SOS), so instruments and SOS are NEVER covered; `medium` leaves the top
 * half of the chart usable. Drag the grabber/header to move between them; drag down past
 * medium to close. The tab bar floats over the sheet's bottom edge, so navigation stays
 * tappable with a sheet open (legacy behaviour).
 * Desktop (≥900px): the same component docks as a 400px non-modal side panel beside the rail.
 *
 * Entrance is a short 16px rise. Never a full slide or an opacity fade: a stalled animation
 * must leave the sheet usable, never parked off-screen or invisible-but-present. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './primitives';
import { closePanels, setDetent, useUi } from '../services/ui';
import { useIsDesktop } from './useMedia';

export interface SheetProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** up to 3 trailing header actions (icon buttons / pills); the close button is always appended */
  actions?: ReactNode;
  /** pinned under the scroll area (chat input, primary action) */
  footer?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  /** reading surface: switches to paper in the high-glare "sun" theme */
  paper?: boolean;
  /** extra class on the scroll body */
  bodyClassName?: string;
  /** called with the body element (e.g. to keep a chat scrolled to the bottom) */
  bodyRef?: (el: HTMLDivElement | null) => void;
  label?: string;
}

export function Sheet({ title, subtitle, actions, footer, children, onClose, paper = true, bodyClassName, bodyRef, label }: SheetProps) {
  const desktop = useIsDesktop();
  const detent = useUi((s) => s.detent);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; t0: number; base: number; dy: number; lastY: number; lastT: number } | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  // visual only: a hairline under the header once the body has scrolled
  const [scrolled, setScrolled] = useState(false);

  const close = useCallback(() => { (onClose ?? closePanels)(); }, [onClose]);

  // Escape closes the sheet on keyboards (desktop / iPad).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (desktop || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    drag.current = { y0: e.clientY, t0: performance.now(), base: 0, dy: 0, lastY: e.clientY, lastT: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    d.dy = e.clientY - d.y0; d.lastY = e.clientY; d.lastT = performance.now();
    // resist dragging up past the full detent
    setDragY(d.dy < 0 ? (detent === 'full' ? d.dy * 0.15 : Math.max(d.dy, -window.innerHeight)) : d.dy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; if (!d) return;
    const dt = Math.max(1, performance.now() - d.t0);
    const v = (e.clientY - d.y0) / dt;            // px/ms, + = down
    setDragY(null);
    const h = sheetRef.current?.getBoundingClientRect().height ?? 600;
    if (Math.abs(d.dy) < 6 && Math.abs(v) < 0.2) return;                          // a tap, not a drag
    if (detent === 'full') {
      if (d.dy > h * 0.55 || (v > 1.1 && d.dy > 60)) close();
      else if (d.dy > 90 || v > 0.45) setDetent('medium');
    } else {
      if (d.dy < -60 || v < -0.45) setDetent('full');
      else if (d.dy > 80 || v > 0.45) close();
    }
  };

  const style = dragY != null ? { transform: `translateY(${Math.round(dragY)}px)`, transition: 'none' } : undefined;

  return (
    <div
      ref={sheetRef}
      className={'ui-sheet' + (desktop ? ' ui-sheet--panel' : ` ui-sheet--${detent}`) + (paper ? ' surface-paper' : '') + (scrolled ? ' is-scrolled' : '')}
      role="dialog" aria-modal="false" aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      style={style}
    >
      <header className="ui-sheet__head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {!desktop && <span className="ui-sheet__grabber" aria-hidden />}
        <div className="ui-sheet__titles">
          <h2 className="ui-title-1">{title}</h2>
          {subtitle && <div className="ui-sheet__subtitle">{subtitle}</div>}
        </div>
        <div className="ui-sheet__actions">
          {actions}
          <IconButton icon="x" label="Close" size="sm" onClick={close} />
        </div>
      </header>
      <div className={'ui-sheet__body' + (bodyClassName ? ' ' + bodyClassName : '')} ref={bodyRef}
        onScroll={(e) => { const s = e.currentTarget.scrollTop > 2; if (s !== scrolled) setScrolled(s); }}>
        {children}
      </div>
      {footer && <div className="ui-sheet__foot">{footer}</div>}
    </div>
  );
}
