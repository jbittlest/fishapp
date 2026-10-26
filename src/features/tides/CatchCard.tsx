/* Map card for a catch marker (card kind 'catch', data { id }). Replaces the legacy Leaflet
 * popup: photo, size/bait, the conditions captured at the moment it was landed, notes, and
 * Share catch card (a 1080x1080 image — the share sheet in the iOS app, a download on the web),
 * Navigate (Go-To back to the spot) and Delete (confirmed). */
import { useState, type ReactNode } from 'react';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { Button, Hint, IconButton, KeyValues, Num, useStoreValue } from '../../ui';
import { catchStore, cleanMoonName, deleteCatch, makeCatchCard, type CatchView } from '../../engine/catch.js';
import { formatCoord } from '../../engine/gps.js';
import { compass } from '../../engine/weather.js';
import { navigateToCatch } from './catchActions';
import './tides.css';

/* Belt and braces: catchToView (condToView) already keeps only strings for these keys, but a
   non-string must never reach .charAt — the card would fall to its error boundary. */
const cap = (v: unknown) => { const s = v == null ? '' : String(v); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

/** Conditions rows, only for what was actually captured (older and imported catches have fewer). */
export function conditionRows(c: CatchView): Array<{ key: string; k: string; v: ReactNode }> {
  const d = c.cond;
  const rows: Array<{ key: string; k: string; v: ReactNode }> = [];
  if (d.sst != null) rows.push({ key: 'sst', k: 'Water temp', v: <Num value={d.sst} deg="°F" size="row" /> });
  if (d.tide) {
    const turn = d.minsToTideChange != null ? `, ${Math.round(d.minsToTideChange)} min to the turn` : '';
    rows.push({ key: 'tide', k: 'Tide', v: cap(d.tide) + turn });
  }
  if (d.moon) rows.push({ key: 'moon', k: 'Moon', v: cleanMoonName(d.moon) + (d.moonLit != null ? ` · ${Math.round(d.moonLit)}% lit` : '') });
  if (d.solunar) rows.push({ key: 'sol', k: 'Solunar', v: d.solunar === 'off' ? 'Outside a period' : cap(d.solunar) + ' period' });
  if (d.lightPhase) rows.push({ key: 'light', k: 'Light', v: cap(d.lightPhase) });
  if (d.windKn != null) {
    rows.push({
      key: 'wind', k: 'Wind',
      v: <><Num value={d.windKn} unit="kn" size="row" />{d.windDir != null ? ' ' + compass(d.windDir) : ''}{d.gustKn != null ? <>, gusts <Num value={d.gustKn} unit="kn" size="row" /></> : null}</>,
    });
  } else if (d.wind) rows.push({ key: 'wind', k: 'Wind', v: String(d.wind) });
  if (d.waveFt != null) rows.push({ key: 'wave', k: 'Swell', v: <Num value={d.waveFt} digits={1} unit="ft" size="row" /> });
  if (d.pressureHpa != null) {
    rows.push({ key: 'pres', k: 'Pressure', v: <><Num value={d.pressureHpa} digits={0} unit="hPa" size="row" />{d.pressureTrend ? ', ' + d.pressureTrend : ''}</> });
  }
  if (d.airF != null) rows.push({ key: 'air', k: 'Air', v: <Num value={d.airF} deg="°F" size="row" /> });
  return rows;
}

export default function CatchCard({ data }: CardProps) {
  const id = data?.id as number | undefined;
  const c = useStoreValue(catchStore, (s) => s.items.find((x) => x.id === id) ?? null);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!c) return <MapCard eyebrow="Catch" title="Catch not found" subtitle="It may have been deleted." />;

  const hasPos = c.lat != null && c.lng != null;
  const size = [c.length ? c.length + '"' : '', c.weight ? c.weight + ' lb' : ''].filter(Boolean).join(' · ');
  const conds = conditionRows(c);
  const facts: Array<{ key: string; k: ReactNode; v: ReactNode }> = [];
  if (size) facts.push({ key: 'size', k: 'Size', v: size });
  if (c.bait) facts.push({ key: 'bait', k: 'Bait / lure', v: c.bait });

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try { await makeCatchCard(c); } finally { setSharing(false); }
  };
  const del = async () => {
    if (deleting) return;
    setDeleting(true);
    try { await deleteCatch(c.id); } finally { setDeleting(false); }
  };

  return (
    <MapCard
      eyebrow="Catch"
      title={c.species}
      subtitle={<span className="tnum">{new Date(c.ts).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
      actions={(
        <>
          <Button icon="share" busy={sharing} onClick={() => { void share(); }}>Share catch card</Button>
          {hasPos && <Button icon="navigation" onClick={() => { void navigateToCatch(c); }}>Navigate</Button>}
          <IconButton icon="trash" label="Delete this catch" disabled={deleting} onClick={() => { void del(); }} />
        </>
      )}
    >
      {c.photo && <img className="tide-card__photo" src={c.photo} alt={'Photo of ' + c.species} />}
      {facts.length > 0 && <KeyValues className="tide-card__kv" items={facts} />}
      {conds.length > 0 ? (
        <>
          <div className="ui-label tide-card__label">Conditions when landed</div>
          <KeyValues className="tide-card__kv" items={conds} />
        </>
      ) : (
        <Hint>No conditions were captured for this catch.</Hint>
      )}
      {c.notes && <p className="tide-card__notes">{c.notes}</p>}
      {hasPos
        ? <p className="ui-caption tide-card__pos tnum">{formatCoord(c.lat, 'lat')} {formatCoord(c.lng, 'lon')}</p>
        : <Hint>No usable position is saved with this catch, so it isn’t on the chart.</Hint>}
    </MapCard>
  );
}
