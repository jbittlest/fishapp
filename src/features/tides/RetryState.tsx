/* An honest empty / offline / error state with a FULL-SIZE Retry (48 px, DESIGN.md §3: 44 px
 * minimum). StateBox's own Retry is a compact 40 px button — the main recovery action on a wet
 * phone was under the minimum (docs/requests/tides-bite-catch.md #7).
 * Laid out as one compact row (glyph · message · Retry) on a raised card, so in a sheet at its
 * medium detent the Retry is on screen with the message instead of below the tab bar. */
import type { ReactNode } from 'react';
import { Button, Icon, type IconName } from '../../ui';
import './tides.css';

export function RetryState({ icon, tone, onRetry, retryLabel = 'Retry', children }: {
  icon: IconName; tone?: 'neutral' | 'alert'; onRetry: () => void; retryLabel?: string; children: ReactNode;
}) {
  return (
    <div className={'tide-retry' + (tone === 'alert' ? ' is-alert' : '')}>
      <Icon name={icon} size={22} className="tide-retry__icon" />
      <div className="tide-retry__msg">{children}</div>
      <Button icon="refresh" className="tide-retry__btn" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}
