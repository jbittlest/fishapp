/* Fish sighting card — one iNaturalist research-grade observation (engine/fish.js builds the
 * data when the dot is tapped). Credits iNaturalist and the photographer. */
import { useState } from 'react';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { Button, KeyValues, Num } from '../../ui';
import { openExternal } from '../../services/native';
import type { FishCardData } from '../../engine/fish.js';
import './weather.css';

/** "2026-10-20" → "Oct 20, 2026" (the date the fish was seen, local calendar day). */
function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FishCard({ data }: CardProps) {
  const d = (data || {}) as Partial<FishCardData>;
  const [imgOk, setImgOk] = useState(true);
  const name = d.name || 'Fish';
  const seen = (d.when || 'date unknown') + (d.observedOn ? ' · ' + fmtDay(d.observedOn) : '');

  return (
    <MapCard eyebrow="Fish sighting" title={name}
      subtitle={d.sci ? <span className="wx-fish__sci">{d.sci}</span> : undefined}
      actions={d.url ? <Button variant="ghost" icon="external" onClick={() => openExternal(d.url!)}>View on iNaturalist</Button> : undefined}>
      {d.photo && imgOk && (
        <img className="wx-fish__photo" src={d.photo} alt={'Photo of ' + name} loading="lazy" decoding="async"
          referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
      )}
      <KeyValues items={[
        { key: 'seen', k: 'Seen', v: seen },
        {
          key: 'dist', k: 'From you',
          v: d.distNm != null
            ? <><Num size="row" value={d.distNm} digits={1} unit="nm" /> · <Num size="row" value={d.brgDeg ?? null} deg="°T" /></>
            : 'Needs a GPS fix',
        },
      ]} />
      <p className="wx-fish__credit">
        iNaturalist observation{d.photoCredit ? ' · Photo ' + d.photoCredit : ''}
      </p>
    </MapCard>
  );
}
