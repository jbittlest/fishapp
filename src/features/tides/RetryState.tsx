/* An honest empty / offline / error state with a FULL-SIZE Retry (48 px, DESIGN.md §3: 44 px
 * minimum). StateBox's own Retry is a compact 40 px button — the main recovery action on a wet
 * phone was under the minimum. Until StateBox is fixed (docs/requests/tides-bite-catch.md #7)
 * this group renders the message with StateBox and its own Retry under it. */
import type { ReactNode } from 'react';
import { Button, StateBox, type IconName } from '../../ui';
import './tides.css';

export function RetryState({ icon, tone, onRetry, retryLabel = 'Retry', children }: {
  icon: IconName; tone?: 'neutral' | 'alert'; onRetry: () => void; retryLabel?: string; children: ReactNode;
}) {
  return (
    <div className="tide-retry">
      <StateBox icon={icon} tone={tone}>{children}</StateBox>
      <Button icon="refresh" className="tide-retry__btn" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}
