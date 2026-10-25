/* MapCard — the docked card for anything selected on the chart (tap-to-inspect, a reef, a spot,
 * a catch, a sighting, a saved voyage). Replaces Leaflet's speech-bubble popups: on a phone it
 * docks above the tab bar at full width; on desktop it floats bottom-left of the chart.
 * Paper surface in the sun theme. */
import type { ReactNode } from 'react';
import { IconButton } from '../ui';
import { closeCard } from '../services/ui';

export interface MapCardProps {
  /** small caps line above the title ("Tap to inspect", "Artificial reef") */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** buttons row at the bottom (Save spot, Navigate here, 10-day forecast…) */
  actions?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  /** media (a photo) shown on the left of the header */
  media?: ReactNode;
}

export function MapCard({ eyebrow, title, subtitle, actions, children, onClose, media }: MapCardProps) {
  return (
    <section className="shell-card surface-paper" role="dialog" aria-modal="false" aria-label={typeof title === 'string' ? title : undefined}>
      <header className="shell-card__head">
        {media && <div className="shell-card__media">{media}</div>}
        <div className="shell-card__titles">
          {eyebrow && <div className="ui-label shell-card__eyebrow">{eyebrow}</div>}
          <h2 className="ui-title-2 shell-card__title">{title}</h2>
          {subtitle && <div className="ui-sub">{subtitle}</div>}
        </div>
        <IconButton icon="x" label="Close" size="sm" onClick={onClose ?? (() => closeCard())} />
      </header>
      {children && <div className="shell-card__body">{children}</div>}
      {actions && <div className="shell-card__actions">{actions}</div>}
    </section>
  );
}
