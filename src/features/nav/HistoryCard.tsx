/* History card — what a saved voyage or track shown on the chart was (registry kind
 * 'history', data {type: 'trip'|'track', id}). Reads the live archive stores, so a delete or
 * a successful retry elsewhere updates it. A successful "Retry save" gives the record a new
 * storage key; the engine (tripRetrySave / trackRetrySave) re-points this card's data.id at
 * it, so the card keeps showing the now-saved record instead of "no longer saved". */
import { Button, KeyValues, Num, StatStrip, useStoreValue } from '../../ui';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { deleteTrip, toggleTripShown, tripRetrySave, tripSaveAsFile, tripsStore } from '../../engine/goto.js';
import { deleteTrack, toggleTrackShown, trackRetrySave, trackSaveAsFile, tracksStore } from '../../engine/tracks.js';
import { fmtDur } from '../../engine/nav.js';
import './nav.css';

function when(start: number, end: number) {
  if (!start) return '';
  const d = new Date(start);
  const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + t(start) + (end > start ? '–' + t(end) : '');
}

function TripCard({ id }: { id: number | string }) {
  const t = useStoreValue(tripsStore, (s) => s.items.find((x) => x.id === id) ?? null);
  const shown = useStoreValue(tripsStore, (s) => !!s.shown[String(id)]);
  if (!t) return <MapCard eyebrow="Voyage" title="This voyage is no longer saved" />;
  const durS = Math.max(0, (t.end - t.start) / 1000);
  return (
    <MapCard eyebrow={t.unsaved ? 'Voyage · not saved' : 'Saved voyage'} title={t.name} subtitle={when(t.start, t.end)}
      actions={
        <>
          {t.unsaved && <Button compact variant="primary" icon="refresh" onClick={() => { tripRetrySave(id); }}>Retry save</Button>}
          {t.unsaved && <Button compact icon="download" onClick={() => { tripSaveAsFile(id); }}>Save as file</Button>}
          {shown && <Button compact icon="x" onClick={() => toggleTripShown(id)}>Hide from map</Button>}
          <Button compact variant="ghost" icon="trash" onClick={() => { deleteTrip(id); }}>Delete</Button>
        </>
      }>
      <StatStrip cells={[
        { key: 'nm', label: 'Distance', value: <Num value={t.actualNm} digits={1} unit="nm" size="s" /> },
        { key: 't', label: 'Time', value: fmtDur(durS) },
        { key: 'avg', label: 'Avg', value: <Num value={t.avgKn > 0 ? t.avgKn : null} digits={1} unit="kn" size="s" /> },
        { key: 'max', label: 'Max', value: <Num value={t.maxKn > 0 ? t.maxKn : null} digits={1} unit="kn" size="s" /> },
      ]} />
      {(t.destName || t.planNm > 0) && (
        <KeyValues className="nav-block" items={[
          ...(t.destName ? [{ key: 'dest', k: 'Destination', v: t.destName }] : []),
          ...(t.planNm > 0 ? [{ key: 'plan', k: 'Straight line at start', v: <Num value={t.planNm} digits={1} unit="nm" size="row" /> }] : []),
        ]} />
      )}
      {t.unsaved && <p className="ui-hint">Storage refused this voyage{t.error ? ` (${t.error})` : ''}. It is kept until the app closes — retry, or save it as a file and import it later.</p>}
    </MapCard>
  );
}

function TrackCard({ id }: { id: number | string }) {
  const t = useStoreValue(tracksStore, (s) => s.saved.find((x) => x.id === id) ?? null);
  const shown = useStoreValue(tracksStore, (s) => !!s.shown[String(id)]);
  if (!t) return <MapCard eyebrow="Track" title="This track is no longer saved" />;
  const durS = Math.max(0, (t.end - t.start) / 1000);
  return (
    <MapCard eyebrow={t.unsaved ? 'Track · not saved' : 'Saved track'} title={t.name} subtitle={when(t.start, t.end)}
      actions={
        <>
          {t.unsaved && <Button compact variant="primary" icon="refresh" onClick={() => { trackRetrySave(id); }}>Retry save</Button>}
          {t.unsaved && <Button compact icon="download" onClick={() => { trackSaveAsFile(id); }}>Save as file</Button>}
          {shown && <Button compact icon="x" onClick={() => toggleTrackShown(id)}>Hide from map</Button>}
          <Button compact variant="ghost" icon="trash" onClick={() => { deleteTrack(id); }}>Delete</Button>
        </>
      }>
      <StatStrip cells={[
        { key: 'nm', label: 'Distance', value: <Num value={t.nm} digits={2} unit="nm" size="s" /> },
        { key: 't', label: 'Time', value: t.end > t.start ? fmtDur(durS) : '—' },
        { key: 'pts', label: 'Points', value: <Num value={t.points} digits={0} size="s" /> },
      ]} />
      {t.unsaved && <p className="ui-hint">Storage refused this track{t.error ? ` (${t.error})` : ''}. It is kept until the app closes — retry, or save it as a file and import it later.</p>}
    </MapCard>
  );
}

export default function HistoryCard({ data }: CardProps) {
  const id = data?.id as number | string | undefined;
  if (id == null) return <MapCard title="Nothing to show" />;
  return data?.type === 'track' ? <TrackCard id={id} /> : <TripCard id={id} />;
}
