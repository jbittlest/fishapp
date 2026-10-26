/* Voyages (saved Go-To runs) and Tracks (recordings) — the two archive sections of the
 * Spots & tracks sheet. Each loads its list on mount; showing an item draws it on the chart,
 * fits the map and opens its history card. A record whose storage write failed stays in
 * memory at the top of the list, with Retry and Save as file. */
import { useEffect, type ReactNode } from 'react';
import { Button, Group, IconButton, ListRow, LoadingRow, PillButton, Section, StateBox, useStoreValue, type IconName } from '../../ui';
import {
  deleteTrip, loadTrips, toggleTripShown, tripRetrySave, tripSaveAsFile, tripsStore, type TripItem,
} from '../../engine/goto.js';
import {
  deleteTrack, loadTracks, toggleTrackShown, trackRetrySave, trackSaveAsFile, tracksStore, type TrackItem,
} from '../../engine/tracks.js';
import { durWords } from './useNow';
import './nav.css';

const PER_GROUP = 8;

/* rows are grouped by month, so the row only needs the day */
function dateText(ms: number) { return ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; }
function monthText(ms: number) { return ms ? new Date(ms).toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Undated'; }

/** Unsaved first, then by month, at most 8 rows per group (DESIGN §4). */
function groupRows<T extends { start: number; unsaved: boolean }>(items: T[]): Array<{ key: string; label: string; rows: T[] }> {
  const out: Array<{ key: string; label: string; rows: T[] }> = [];
  const push = (label: string, row: T) => {
    const last = out[out.length - 1];
    if (last && last.label === label && last.rows.length < PER_GROUP) last.rows.push(row);
    else out.push({ key: label + ':' + out.length, label: last && last.label === label ? '' : label, rows: [row] });
  };
  items.forEach((it) => push(it.unsaved ? 'Not saved' : monthText(it.start), it));
  // one month and nothing unsaved: the header would only repeat what every row's date says
  if (out.length === 1 && !items[0].unsaved) out[0].label = '';
  return out;
}

function ArchiveRow({ icon, title, subtitle, unsaved, shown, onShow, onDelete, onRetry, onFile, kind }: {
  icon: IconName; title: string; subtitle: ReactNode; unsaved: boolean; shown: boolean; kind: string;
  onShow: () => void; onDelete: () => void; onRetry: () => void; onFile: () => void;
}) {
  return (
    <>
      <ListRow icon={unsaved ? 'alert' : icon} tone={unsaved ? 'alert' : 'default'} title={title} subtitle={subtitle}
        className={unsaved ? 'nav-list__unsaved' : undefined}
        trailing={
          <>
            <PillButton icon={shown ? 'eye-off' : 'eye'} on={shown} onClick={onShow} aria-label={(shown ? 'Hide ' : 'Show ') + kind + ' on the map'}>{shown ? 'Hide' : 'Show'}</PillButton>
            <IconButton icon="trash" size="sm" tone="plain" label={'Delete ' + kind} onClick={onDelete} />
          </>
        } />
      {unsaved && (
        <div className="nav-list__retry">
          <Button compact icon="refresh" onClick={onRetry}>Retry save</Button>
          <Button compact icon="download" variant="ghost" onClick={onFile}>Save as file</Button>
        </div>
      )}
    </>
  );
}

function tripSub(t: TripItem) {
  const dur = durWords(Math.max(0, (t.end - t.start) / 1000));
  if (t.unsaved) return 'Not saved — ' + (t.error || 'storage error') + ' · ' + t.actualNm.toFixed(1) + ' nm';
  return [dateText(t.start), t.actualNm.toFixed(1) + ' nm', dur, t.avgKn > 0 ? 'avg ' + t.avgKn.toFixed(1) + ' kn' : '']
    .filter(Boolean).join(' · ');
}

export function VoyagesSection() {
  const status = useStoreValue(tripsStore, (s) => s.status);
  const error = useStoreValue(tripsStore, (s) => s.error);
  const items = useStoreValue(tripsStore, (s) => s.items);
  const shown = useStoreValue(tripsStore, (s) => s.shown);
  useEffect(() => { loadTrips(); }, []);

  let body: ReactNode;
  if (status === 'error' && !items.length) {
    body = <div className="nav-empty"><StateBox icon="alert" tone="alert" onRetry={() => { loadTrips(); }}>Couldn't read saved voyages — {error}</StateBox></div>;
  } else if ((status === 'idle' || status === 'loading') && !items.length) {
    body = <LoadingRow>Loading voyages…</LoadingRow>;
  } else if (!items.length) {
    body = <div className="nav-empty"><StateBox icon="navigation">No voyages yet. Tap the map → Navigate here (or a saved spot → Navigate) to start one.</StateBox></div>;
  } else {
    body = groupRows(items).map((g) => (
      <div key={g.key}>
        {g.label && <div className="nav-list__month">{g.label}</div>}
        <Group className="nav-list">
          {g.rows.map((t) => (
            <ArchiveRow key={String(t.id)} kind="voyage" icon="navigation" title={t.name} subtitle={tripSub(t)}
              unsaved={t.unsaved} shown={!!shown[String(t.id)]}
              onShow={() => toggleTripShown(t.id)} onDelete={() => { deleteTrip(t.id); }}
              onRetry={() => { tripRetrySave(t.id); }} onFile={() => { tripSaveAsFile(t.id); }} />
          ))}
        </Group>
      </div>
    ));
  }
  return <Section label="Voyages">{body}</Section>;
}

function trackSub(t: TrackItem) {
  if (t.unsaved) return 'Not saved — ' + (t.error || 'storage error') + ' · ' + t.nm.toFixed(2) + ' nm';
  return [dateText(t.start), t.nm.toFixed(2) + ' nm', t.end > t.start ? durWords((t.end - t.start) / 1000) : '']
    .filter(Boolean).join(' · ');
}

export function TracksSection() {
  const status = useStoreValue(tracksStore, (s) => s.status);
  const error = useStoreValue(tracksStore, (s) => s.error);
  const items = useStoreValue(tracksStore, (s) => s.saved);
  const shown = useStoreValue(tracksStore, (s) => s.shown);
  const recording = useStoreValue(tracksStore, (s) => s.recording);
  useEffect(() => { loadTracks(); }, []);

  let body: ReactNode;
  if (status === 'error' && !items.length) {
    body = <div className="nav-empty"><StateBox icon="alert" tone="alert" onRetry={() => { loadTracks(); }}>Couldn't read saved tracks — {error}</StateBox></div>;
  } else if ((status === 'idle' || status === 'loading') && !items.length) {
    body = <LoadingRow>Loading tracks…</LoadingRow>;
  } else if (!items.length) {
    body = <div className="nav-empty"><StateBox icon="record">{recording ? 'Recording now — it appears here when you stop.' : 'No tracks recorded yet. Start one from More → Record track.'}</StateBox></div>;
  } else {
    body = groupRows(items).map((g) => (
      <div key={g.key}>
        {g.label && <div className="nav-list__month">{g.label}</div>}
        <Group className="nav-list">
          {g.rows.map((t) => (
            <ArchiveRow key={String(t.id)} kind="track" icon="route" title={t.name} subtitle={trackSub(t)}
              unsaved={t.unsaved} shown={!!shown[String(t.id)]}
              onShow={() => toggleTrackShown(t.id)} onDelete={() => { deleteTrack(t.id); }}
              onRetry={() => { trackRetrySave(t.id); }} onFile={() => { trackSaveAsFile(t.id); }} />
          ))}
        </Group>
      </div>
    ));
  }
  return <Section label="Tracks">{body}</Section>;
}
