/* Map card for a saved spot (replaces the Leaflet popup): name, type, notes, distance and
 * bearing from the boat, and Navigate / Share / Edit / Delete. Reads the live record by id, so an
 * edit shows up while the card is open and a delete (here, in the list, or by First Mate) closes
 * it. Share sends a link that opens the spot in the web app (engine shareSpot). */
import { useEffect } from 'react';
import { Button, Num, useStoreValue } from '../../ui';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { closeCard } from '../../services/ui';
import { confirmDeleteSpot, navigateToSpot, openSpotModal, shareSpot, spotDistBrg, spotsStore, spotTypeLabel } from '../../engine/spots.js';
import { formatCoord } from '../../engine/gps.js';
import { SpotDisc } from './SpotGlyph';
import { fromText, useFix } from './useFix';
import { shortDate } from './format';
import './spots.css';

export default function SpotCard({ data }: CardProps) {
  const id = data?.id as number | undefined;
  const spot = useStoreValue(spotsStore, (s) => s.items.find((x) => x.id === id) ?? null);
  const status = useStoreValue(spotsStore, (s) => s.status);
  const fix = useFix();

  useEffect(() => { if (!spot && status === 'ready') closeCard('spot'); }, [spot, status]);
  if (!spot) return null;

  /* From the boat while the fix is live; from the last fix — dimmed, with its age — once it
     has gone quiet or been lost (the store keeps the last position). */
  const { distNm, brgDeg } = spotDistBrg(fix.here, spot);
  const subtitle = distNm != null && brgDeg != null ? (
    <span className="spot-meta">
      <Num value={distNm} digits={2} unit="nm" size="row" stale={!fix.live} /><span className="spot-meta__sep">·</span><Num value={brgDeg} deg="°T" size="row" stale={!fix.live} /> <span className="spot-meta__from">{fromText(fix)}</span>
    </span>
  ) : 'No GPS fix — distance unknown';

  return (
    <MapCard eyebrow={spotTypeLabel(spot.type)} title={spot.name} subtitle={subtitle}
      media={<SpotDisc type={spot.type} large />}
      actions={(
        <>
          <Button variant="primary" icon="navigation" className="spot-card__act" onClick={() => { void navigateToSpot(spot); }}>Navigate</Button>
          <Button icon="share" className="spot-card__act" onClick={() => { void shareSpot(spot); }}>Share</Button>
          <Button icon="pencil" className="spot-card__act" onClick={() => openSpotModal(spot)}>Edit</Button>
          <Button variant="ghost" icon="trash" className="spot-card__act" onClick={() => { void confirmDeleteSpot(spot); }}>Delete</Button>
        </>
      )}>
      {spot.notes && <p className="spot-card__notes">{spot.notes}</p>}
      <p className="ui-caption spot-card__foot">
        <span className="spot-card__pos">{formatCoord(spot.lat, 'lat')}  {formatCoord(spot.lng, 'lon')}</span> · Saved {shortDate(spot.ts)}
      </p>
    </MapCard>
  );
}
