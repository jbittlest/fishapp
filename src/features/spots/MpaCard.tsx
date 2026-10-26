/* Map card for a California Marine Protected Area (replaces the Leaflet popup). The take rule and
 * the regulations disclaimer are the legacy wording; the polygon's look is echoed by the card's
 * media tile: its data colour by day (red no-take, magenta special closure, orange limited) and
 * its line pattern always (solid / dashed / dotted), so the kind never rests on colour alone and
 * the tile stays red-safe at night. */
import type { CSSProperties } from 'react';
import { Badge, Button, Hint, Icon } from '../../ui';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { openExternal } from '../../services/native';
import { CDFW_MPA_URL } from '../../engine/reefs.js';
import './spots.css';

const EXPLAIN: Record<string, string> = {
  notake: 'Reserves (SMR, FMR) and no-take conservation areas protect all marine life: no fishing or collecting of any kind inside the boundary.',
  limited: 'Conservation areas (SMCA, FMCA) and marine parks allow only the take their regulations list for this specific area — every other species and method is off limits.',
  closure: 'Special closures restrict access to protect wildlife. Check the boundary and the dates before you enter.',
};
const BADGE: Record<string, string> = { notake: 'No take', limited: 'Limited take', closure: 'Special closure' };

export default function MpaCard({ data }: CardProps) {
  const kind: string = data?.kind ?? 'limited';
  const type: string = data?.type ?? '';
  const typeName: string = data?.typeName ?? '';
  const restrictive = kind === 'notake' || kind === 'closure';
  const name = String(data?.name ?? 'Marine Protected Area');
  /* "Point Vicente SMCA (No-Take)" already carries the designation: spell it out once, not twice. */
  const subtitle = type
    ? (typeName && typeName !== type ? (name.includes(type) ? typeName : `${type} · ${typeName}`) : type)
    : undefined;

  return (
    <MapCard eyebrow="Marine Protected Area" title={name} subtitle={subtitle}
      media={(
        <span className={'spot-mpa-media spot-mpa-media--' + kind} style={data?.color ? { '--mpa': data.color } as CSSProperties : undefined}>
          <Icon name={restrictive ? 'no-fishing' : 'fish'} size={28} />
        </span>
      )}
      actions={<Button icon="external" onClick={() => openExternal(CDFW_MPA_URL)}>CDFW regulations</Button>}>
      <div className="spot-mpa__head">
        <Badge tone={restrictive ? 'alert' : 'neutral'} icon={restrictive ? 'ban' : 'info'}>{BADGE[kind] ?? 'Restricted'}</Badge>
      </div>
      {data?.take && <p className="spot-mpa__take">{data.take}</p>}
      <Hint>{EXPLAIN[kind] ?? EXPLAIN.limited}</Hint>
      <Hint className="spot-mpa__legal">Always confirm current CA DFW regulations before fishing.</Hint>
    </MapCard>
  );
}
