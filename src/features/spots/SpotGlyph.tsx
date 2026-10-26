/* Spot type glyphs for the React UI — all six from the shared icon set ("ramp / dock" is the
 * life ring), matching the line glyphs the engine draws on the chart markers. */
import { Icon, type IconName } from '../../ui';

const TYPE_ICON: Record<string, IconName> = { fish: 'fish', anchor: 'anchor', hazard: 'alert', ramp: 'life-buoy', wreck: 'ship', other: 'pin' };

export function SpotGlyph({ type, size = 20 }: { type: string; size?: number }) {
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
