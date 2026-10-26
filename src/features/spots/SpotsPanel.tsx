/* Spots & tracks — saved spots nearest-first, the nearest artificial reefs, then the voyage and
 * track archives (features/nav/Sections). Export / import of the whole backup sits on top,
 * where it was in the legacy panel. */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button, Group, Hint, Icon, IconButton, ListRow, LoadingRow, Num, Section, Sheet, StateBox, useStoreValue } from '../../ui';
import {
  confirmDeleteSpot, exportData, flyToSpot, importData, navigateToSpot, openSpotModal, spotsChanged, spotsReload,
  spotsStore, spotTypeLabel, type SpotRow,
} from '../../engine/spots.js';
import { flyToReef, reefsRefreshNearest, reefsRetry, reefsStore, type ReefRow } from '../../engine/reefs.js';
import { markHere } from '../../engine/app.js';
import { closePanels } from '../../services/ui';
import { VoyagesSection, TracksSection } from '../nav/Sections';
import { SpotDisc } from './SpotGlyph';
import { fixAgeText, useFix } from './useFix';
import './spots.css';

const SPOTS_SHOWN = 8;
const REEFS_SHOWN = 6;

/* Distances in the lists are worked out from the last fix the engine saw. Once the fix is no
   longer live they are dimmed (and the section says how old the fix is) — never shown as live. */
function SpotLine({ s, stale }: { s: SpotRow; stale: boolean }) {
  const date = new Date(s.ts).toLocaleDateString();
  return (
    <span className="spot-meta">
      {s.distNm != null && s.brgDeg != null && (
        <><Num value={s.distNm} digits={2} unit="nm" size="row" stale={stale} /> · <Num value={s.brgDeg} deg="°T" size="row" stale={stale} /> · </>
      )}
      {spotTypeLabel(s.type)} · {date}
    </span>
  );
}

/* Go from the list: once the Go-To has actually started (gotoStart may ask first and the user
   can back out), get the sheet out of the way so the chart and the Go-To card are visible. */
async function goTo(s: SpotRow) {
  if (await navigateToSpot(s)) closePanels();
}

function SpotItem({ s, open, stale, onToggle }: { s: SpotRow; open: boolean; stale: boolean; onToggle: () => void }) {
  return (
    <div className={'spot-row' + (open ? ' is-open' : '')}>
      <div className="ui-row spot-row__line">
        <button type="button" className="spot-row__main" onClick={() => flyToSpot(s)} aria-label={`${s.name} — show on the chart`}>
          <span className="ui-row__lead"><SpotDisc type={s.type} /></span>
          <span className="ui-row__main">
            <span className="ui-row__title">{s.name}</span>
            <span className="ui-row__sub"><SpotLine s={s} stale={stale} /></span>
          </span>
        </button>
        <span className="ui-row__trail">
          <IconButton icon="navigation" tone="signal" label={`Go to ${s.name}`} onClick={() => { void goTo(s); }} />
          <IconButton icon="more" label={open ? `Hide actions for ${s.name}` : `More actions for ${s.name}`} active={open}
            aria-expanded={open} onClick={onToggle} />
        </span>
      </div>
      {open && (
        <div className="spot-row__more">
          {s.notes && <p className="spot-row__notes">{s.notes}</p>}
          <div className="spot-row__actions">
            <Button icon="crosshair" onClick={() => flyToSpot(s)}>Show on chart</Button>
            <Button icon="pencil" onClick={() => openSpotModal(s)}>Edit</Button>
            <Button variant="ghost" icon="trash" onClick={() => { void confirmDeleteSpot(s); }}>Delete</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SpotsSection() {
  const status = useStoreValue(spotsStore, (s) => s.status);
  const error = useStoreValue(spotsStore, (s) => s.error);
  const items = useStoreValue(spotsStore, (s) => s.items);
  const hasFix = useStoreValue(spotsStore, (s) => s.hasFix);
  const fix = useFix();
  const stale = hasFix && !fix.live;
  const [openId, setOpenId] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SPOTS_SHOWN);

  let body;
  if (status === 'loading' && !items.length) body = <LoadingRow>Loading spots…</LoadingRow>;
  else if (status === 'error') body = (
    <StateBox icon="alert" tone="alert" onRetry={() => { void spotsReload(); }}>
      Saved spots could not be read from this device's storage{error ? ` (${error})` : ''}.
    </StateBox>
  );
  else if (!items.length) body = <StateBox icon="pin">No spots yet. Tap Mark or long-press the map.</StateBox>;
  else body = (
    <>
      <Group>
        {shown.map((s) => (
          <SpotItem key={s.id} s={s} open={openId === s.id} stale={stale} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
        ))}
      </Group>
      {items.length > SPOTS_SHOWN && (
        <div className="spot-more">
          <Button variant="ghost" compact className="spot-hit" icon={all ? 'chevron-up' : 'chevron-down'} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${items.length} spots`}
          </Button>
        </div>
      )}
      {!hasFix && <Hint>Newest first — distances appear once GPS has a fix.</Hint>}
      {stale && <Hint>Distances are from your last GPS fix{fix.ageMs < Infinity ? `, ${fixAgeText(fix.ageMs)} ago` : ''} — not live.</Hint>}
    </>
  );

  return (
    <Section label={items.length ? `Spots · ${items.length}` : 'Spots'}
      action={<Button variant="ghost" compact className="spot-hit" icon="pin-plus" onClick={markHere}>Mark here</Button>}>
      {body}
    </Section>
  );
}

function ReefLine({ r, stale }: { r: ReefRow; stale: boolean }) {
  return (
    <span className="spot-meta">
      <Num value={r.distNm} digits={1} unit="nm" size="row" stale={stale} /> · <Num value={r.brgDeg} deg="°T" size="row" stale={stale} />
      {r.reef.d ? <> · <Num value={r.reef.d} unit="ft" size="row" /> deep</> : null}
    </span>
  );
}

function ReefsSection() {
  const status = useStoreValue(reefsStore, (s) => s.status);
  const items = useStoreValue(reefsStore, (s) => s.items);
  const from = useStoreValue(reefsStore, (s) => s.from);
  const error = useStoreValue(reefsStore, (s) => s.error);
  const fix = useFix();
  const stale = from === 'gps' && !fix.live;
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, REEFS_SHOWN);

  let body;
  if (status === 'loading') body = <LoadingRow>Loading reefs…</LoadingRow>;
  else if (status === 'error') body = (
    <StateBox icon="alert" onRetry={() => { void reefsRetry(); }}>
      The bundled reef data could not be loaded{error ? ` (${error})` : ''}.
    </StateBox>
  );
  else if (!items.length) body = <StateBox icon="reef">No reef data loaded.</StateBox>;
  else body = (
    <>
      <Group>
        {shown.map((r) => (
          <ListRow key={r.key} lead={<span className="spot-reefdisc"><Icon name="reef" size={18} /></span>}
            title={r.reef.n} subtitle={<ReefLine r={r} stale={stale} />} chevron onPress={() => flyToReef(r.reef)} />
        ))}
      </Group>
      {items.length > REEFS_SHOWN && (
        <div className="spot-more">
          <Button variant="ghost" compact className="spot-hit" icon={all ? 'chevron-up' : 'chevron-down'} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${items.length} nearest`}
          </Button>
        </div>
      )}
      {from === 'map' && <Hint>Distances are from the chart centre — no GPS fix yet.</Hint>}
      {stale && <Hint>Distances are from your last GPS fix{fix.ageMs < Infinity ? `, ${fixAgeText(fix.ageMs)} ago` : ''} — not live.</Hint>}
    </>
  );
  return <Section label="Nearest artificial reefs">{body}</Section>;
}

export default function SpotsPanel() {
  const exporting = useStoreValue(spotsStore, (s) => s.exporting);
  const importing = useStoreValue(spotsStore, (s) => s.importing);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fresh distances when the panel opens (the GPS loop only re-publishes while it is open).
  useEffect(() => { spotsChanged(); reefsRefreshNearest(); }, []);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) void importData(f);
    e.target.value = '';   // picking the same file again must fire change again
  };

  return (
    <Sheet title="Spots & tracks">
      <div className="spot-backup">
        <Button icon="share" busy={exporting} onClick={() => { void exportData(); }}>Export backup</Button>
        <Button icon="download" busy={importing} onClick={() => fileRef.current?.click()}>Import</Button>
        <input ref={fileRef} className="spot-file" type="file" accept="application/json,.json" tabIndex={-1} aria-hidden onChange={onFile} />
      </div>
      <Hint>A backup holds your spots, tracks, catches and voyages. Offline charts are not in it — download them again on a new device.</Hint>

      <SpotsSection />
      <ReefsSection />
      <VoyagesSection />
      <TracksSection />
    </Sheet>
  );
}
