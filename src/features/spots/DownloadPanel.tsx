/* Offline charts — download the visible chart area (and its 7-day data pack) for use with no
 * signal. The estimate follows the map live while this panel is open; the run itself, its
 * cancel, and every storage safeguard live in engine/download.js. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge, Button, Field, Group, Hint, IconButton, ListRow, LoadingRow, Notice, Num, ProgressBar, RadioRow, Section, Sheet,
  Spinner, StateBox, TextInput, useStoreValue,
} from '../../ui';
import {
  DETAIL_LEVELS, cancelDownload, deleteArea, dlPanelOpened, dlStore, flyToArea, refreshAreas, setDlZoom, startDownload,
  updateEstimate, type AreaRow,
} from '../../engine/download.js';
import { LAYERS } from '../../engine/tiles.js';
import { layersStore } from '../../engine/layers.js';
import { getMap } from '../../engine/app.js';
import { useUi } from '../../services/ui';
import './spots.css';

function Count({ n }: { n: number }) {
  // thousands separators with instrument figures (Num has no grouping)
  return <span className="ui-num ui-num--row"><span className="ui-num__v">{Math.round(n).toLocaleString()}</span></span>;
}

function layerNames(ids: string[]): string {
  return ids.map((id) => (LAYERS as Record<string, { name?: string }>)[id]?.name ?? id).join(', ');
}

function Estimate() {
  const est = useStoreValue(dlStore, (s) => s.estimate);
  if (est.status === 'idle' || est.status === 'nomap') return <LoadingRow>Measuring the visible area…</LoadingRow>;
  if (est.status === 'tooBig') {
    return (
      <Notice icon="alert" title="Area too large">
        Area too large ({est.count.toLocaleString()} tiles). Zoom in closer or pick a lower detail level.
      </Notice>
    );
  }
  if (est.status === 'empty') return <Hint>Nothing to download here.</Hint>;
  return (
    <div className="dl-est" aria-live="polite">
      <div className="dl-est__main">
        <span>About</span><Count n={est.count} /><span>tiles ·</span>
        <Num value={est.mb < 1 ? 1 : est.mb} approx unit="MB" size="row" />
      </div>
      <div className="dl-est__layers">Zoom {est.minZ}–{est.maxZ} · {layerNames(est.layerIds)}</div>
    </div>
  );
}

function Progress() {
  const pct = useStoreValue(dlStore, (s) => s.pct);
  const phase = useStoreValue(dlStore, (s) => s.phase);
  const statusText = useStoreValue(dlStore, (s) => s.statusText);
  const cancelling = useStoreValue(dlStore, (s) => s.cancelling);
  return (
    <div className="dl-progress" role="group" aria-label="Download progress">
      <ProgressBar value={pct} label="Download progress" />
      <div className="dl-progress__status" aria-live="polite">
        {phase !== 'tiles' && <Spinner size="sm" />}
        <span>{statusText}</span>
      </div>
      {/* Once the area record is being written the run is finished — a Cancel there would only
          say "Cancelling…" over a run that then reports "saved", so it goes away. */}
      {phase !== 'saving' && (
        <Button variant="secondary" icon="x" disabled={cancelling} onClick={cancelDownload}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    </div>
  );
}

function dataBadge(a: AreaRow): ReactNode {
  if (a.data === 'full') return <Badge tone="ok">Charts + data</Badge>;
  if (a.data === 'partial') return <Badge icon="info">Some data missing</Badge>;
  return <Badge>Charts only</Badge>;
}

function AreaItem({ a }: { a: AreaRow }) {
  const deleting = useStoreValue(dlStore, (s) => s.deleting);
  const running = useStoreValue(dlStore, (s) => s.running);
  const draining = useStoreValue(dlStore, (s) => s.draining);
  const mine = deleting && deleting.id === a.id ? deleting : null;
  const sub = mine ? (
    <span className="dl-area__deleting"><Spinner size="sm" />Removing {mine.done.toLocaleString()} / {mine.total.toLocaleString()} tiles…</span>
  ) : (
    <>
      <span className="spot-meta">
        <Count n={a.tiles} /> tiles · <Num value={a.mb < 1 && a.mb > 0 ? 1 : a.mb} unit="MB" size="row" approx={a.mb > 0 && a.mb < 1} /> · {new Date(a.ts).toLocaleDateString()}
      </span>
      <span className="dl-area__badges">
        {dataBadge(a)}
        {a.partial ? <Badge icon="alert">Cancelled — partial</Badge> : a.incomplete ? <Badge icon="alert">Incomplete</Badge> : null}
      </span>
      {a.data === 'partial' && a.dataMissing.length > 0 && <span>Missing: {a.dataMissing.join(', ')}</span>}
    </>
  );
  return (
    <ListRow icon="layers" title={a.name} subtitle={sub}
      trailing={(
        <>
          <IconButton icon="crosshair" label={`Show ${a.name} on the chart`} onClick={() => flyToArea(a)} />
          <IconButton icon="trash" label={`Delete ${a.name}`} disabled={!!deleting || running || draining} onClick={() => { void deleteArea(a.id); }} />
        </>
      )} />
  );
}

function SavedAreas() {
  const status = useStoreValue(dlStore, (s) => s.areasStatus);
  const error = useStoreValue(dlStore, (s) => s.areasError);
  const areas = useStoreValue(dlStore, (s) => s.areas);
  const draining = useStoreValue(dlStore, (s) => s.draining);
  let body;
  if (status === 'loading' && !areas.length) body = <LoadingRow>Loading saved areas…</LoadingRow>;
  else if (status === 'error') body = (
    <StateBox icon="alert" tone="alert" onRetry={() => { void refreshAreas(); }}>
      Saved areas could not be read from this device's storage{error ? ` (${error})` : ''}.
    </StateBox>
  );
  else if (!areas.length) body = <StateBox icon="download">Nothing downloaded yet.</StateBox>;
  else body = <Group>{areas.map((a) => <AreaItem key={a.id} a={a} />)}</Group>;
  return (
    <Section label="Saved areas">
      {body}
      {draining && areas.length > 0 && (
        <Hint className="dl-hint">
          <span className="dl-hint__row"><Spinner size="sm" />Finishing the cancelled download's last tiles — deleting is available in a moment.</span>
        </Hint>
      )}
    </Section>
  );
}

function StorageLine() {
  const st = useStoreValue(dlStore, (s) => s.storage);
  if (!st) return null;
  return (
    <Hint className="dl-storage">
      Storage:{' '}
      {st.usedMB != null && <><Count n={st.usedMB} /> MB used</>}
      {st.usedMB != null && st.quotaGB != null && <> of ~<Num value={st.quotaGB} digits={1} unit="GB" size="row" /> available</>}
      {st.tiles != null && <>{st.usedMB != null ? ' · ' : ''}<Count n={st.tiles} /> tiles cached</>}
    </Hint>
  );
}

export default function DownloadPanel() {
  const [name, setName] = useState('');
  const zoom = useStoreValue(dlStore, (s) => s.zoom);
  const running = useStoreValue(dlStore, (s) => s.running);
  const estStatus = useStoreValue(dlStore, (s) => s.estimate.status);
  const deleting = useStoreValue(dlStore, (s) => s.deleting != null);
  const online = useUi((s) => s.online);

  /* Estimate, saved areas and storage on open; then follow the map (every moveend, including a
     GPS pan in follow mode — the count never allocates, so this stays cheap) and the chart
     layer choices, for as long as the panel is open. */
  useEffect(() => {
    dlPanelOpened();
    const map = getMap();
    const onMove = () => { updateEstimate(); };
    if (map) map.on('moveend', onMove);
    const unsub = layersStore.subscribe((s, p) => {
      if (s.base !== p.base || s.enc !== p.enc || s.seamark !== p.seamark) updateEstimate();
    });
    return () => { if (map) map.off('moveend', onMove); unsub(); };
  }, []);

  const start = async () => {
    const r = await startDownload(name, zoom);
    if (r === 'saved') setName('');
  };

  return (
    <Sheet title="Offline charts">
      <Hint>Downloads the chart area <b>currently visible on screen</b>. Position the map over your fishing area first.</Hint>
      <Notice icon="cloud-off" title="Works with no signal">
        Also captures a 7-day wind, wave &amp; tide forecast, a water-temp grid, recent fish sightings and closures — so <b>First Mate can answer questions about this area offline</b>.
      </Notice>

      <Field label="Area name">
        <TextInput value={name} placeholder="e.g. Home bay" maxLength={60} enterKeyHint="done" disabled={running}
          onChange={(e) => setName(e.target.value)} />
      </Field>

      <Section label="Detail level">
        <Group>
          {DETAIL_LEVELS.map((d) => (
            <RadioRow key={d.z} title={d.title} detail={d.detail ?? undefined} checked={zoom === d.z} disabled={running}
              onSelect={() => setDlZoom(d.z)} />
          ))}
        </Group>
      </Section>

      <Estimate />

      {running ? <Progress /> : (
        <div className="dl-start">
          {!online && <Notice icon="wifi-off">You are offline — connect to download charts.</Notice>}
          {/* a delete in progress would remove tiles this run counts as already stored */}
          {online && deleting && <Hint className="dl-hint">Wait for the area to finish deleting before downloading.</Hint>}
          <Button variant="primary" block icon="download" disabled={!online || deleting || estStatus !== 'ok'} onClick={() => { void start(); }}>
            Download this area
          </Button>
        </div>
      )}

      <SavedAreas />
      <StorageLine />
    </Sheet>
  );
}
