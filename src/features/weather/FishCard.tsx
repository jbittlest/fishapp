/* Fish sighting card — one iNaturalist research-grade observation (engine/fish.js builds the
 * data when the dot is tapped). Credits iNaturalist and the photographer. */
import { useState } from 'react';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { Button, Icon, Num } from '../../ui';
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
  const photo = !!d.photo && imgOk;

  /* Photo beside the facts (not above them), so the card stays one glance tall on a phone. */
  return (
    <MapCard eyebrow="Fish sighting" title={name}
      subtitle={d.sci ? <span className="wx-fish__sci">{d.sci}</span> : undefined}
      actions={d.url ? <Button variant="ghost" icon="external" block onClick={() => openExternal(d.url!)}>View on iNaturalist</Button> : undefined}>
      <div className={'wx-fish' + (photo ? ' has-photo' : '')}>
        {photo && (
          <div className="wx-fish__frame">
            <Icon name="fish" size={28} />
            <img className="wx-fish__photo" src={d.photo} alt={'Photo of ' + name} decoding="async"
              referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
          </div>
        )}
        <dl className="wx-fish__facts">
          <div className="wx-fish__fact">
            <dt className="ui-label">Seen</dt>
            <dd>
              <span>{d.when || 'date unknown'}</span>
              {d.observedOn && <span className="wx-fish__sub">{fmtDay(d.observedOn)}</span>}
            </dd>
          </div>
          <div className="wx-fish__fact">
            <dt className="ui-label">From you</dt>
            <dd>
              {d.distNm != null
                ? <span><Num size="row" value={d.distNm} digits={1} unit="nm" /> · <Num size="row" value={d.brgDeg ?? null} deg="°T" /></span>
                : <span className="wx-fish__sub">Needs a GPS fix</span>}
            </dd>
          </div>
        </dl>
      </div>
      <p className="wx-fish__credit">
        iNaturalist observation{d.photoCredit ? ' · Photo ' + d.photoCredit : ''}
      </p>
    </MapCard>
  );
}
