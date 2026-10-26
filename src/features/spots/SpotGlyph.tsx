/* Spot type glyphs for the React UI. Five come from the shared icon set; "ramp / dock" is a
 * life ring, which the shared set does not have yet (requested in docs/requests), so it is
 * drawn here in the same style: 24 grid, round caps, currentColor. */
import { Icon, type IconName } from '../../ui';

const TYPE_ICON: Record<string, IconName> = { fish: 'fish', anchor: 'anchor', hazard: 'alert', wreck: 'ship', other: 'pin' };

function LifeRing({ size }: { size: number }) {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={size <= 16 ? 2 : 1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
      <path d="m4.93 4.93 4.24 4.24" /><path d="m14.83 9.17 4.24-4.24" />
      <path d="m14.83 14.83 4.24 4.24" /><path d="m9.17 14.83-4.24 4.24" />
    </svg>
  );
}

export function SpotGlyph({ type, size = 20 }: { type: string; size?: number }) {
  if (type === 'ramp') return <LifeRing size={size} />;
  return <Icon name={TYPE_ICON[type] ?? 'pin'} size={size} />;
}

/** The list / card lead: the spot's glyph on a round disc (a hazard gets the alert colour). */
export function SpotDisc({ type, large }: { type: string; large?: boolean }) {
  return (
    <span className={'spot-disc' + (large ? ' spot-disc--lg' : '') + (type === 'hazard' ? ' spot-disc--hazard' : '')} aria-hidden>
      <SpotGlyph type={type} size={large ? 26 : 18} />
    </span>
  );
}
