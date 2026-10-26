/* Catch log — the section ToolsPanel (features/nav) renders by fixed name.
 * Stats, "Log a catch", and the log newest-first, grouped by month. "Log a catch" is a
 * secondary button: the Tools sheet's one primary action is the route planner's "Start route"
 * (DESIGN.md §4, one primary per view).
 * Tapping a catch flies the chart to it and opens its card; each row also has Navigate
 * (a Go-To back to the spot) and Delete (always confirmed — engine deleteCatch). A record with
 * no usable position (bad backup import) still lists, opens its card and can be deleted. */
import { Button, Group, Icon, IconButton, LoadingRow, StateBox, Section, useStoreValue } from '../../ui';
import { catchStore, catchesReload, deleteCatch, goToCatch, openCatchModal, type CatchView } from '../../engine/catch.js';
import { catchSubline, navigateToCatch } from './catchActions';
import { RetryState } from './RetryState';
import './tides.css';

function monthKey(ts: number) { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); }

/** Newest-first catches → month groups of at most 8 rows (DESIGN.md §4: groups ≤ 8). */
function groupByMonth(items: CatchView[]): Array<{ key: string; label: string | null; rows: CatchView[] }> {
  const out: Array<{ key: string; label: string | null; rows: CatchView[] }> = [];
  let lastMonth = -1;
  for (const c of items) {
    const m = monthKey(c.ts);
    const cur = out[out.length - 1];
    if (m !== lastMonth || !cur || cur.rows.length >= 8) {
      out.push({
        key: m + ':' + out.length,
        label: m !== lastMonth ? new Date(c.ts).toLocaleDateString([], { month: 'long', year: 'numeric' }) : null,
        rows: [],
      });
      lastMonth = m;
    }
    out[out.length - 1].rows.push(c);
  }
  return out;
}

export function CatchLogSection() {
  const loaded = useStoreValue(catchStore, (s) => s.loaded);
  const error = useStoreValue(catchStore, (s) => s.error);
  const items = useStoreValue(catchStore, (s) => s.items);
  const total = useStoreValue(catchStore, (s) => s.total);
  const top = useStoreValue(catchStore, (s) => s.top);

  let list;
  if (error) {
    list = <RetryState icon="alert" onRetry={() => { void catchesReload(); }}>{error}</RetryState>;
  } else if (!loaded && !items.length) {
    list = <LoadingRow>Loading your catches…</LoadingRow>;
  } else if (!items.length) {
    list = <StateBox icon="fish">No catches logged yet. Land one and tap Log a catch.</StateBox>;
  } else {
    list = groupByMonth(items).map((g) => (
      <div key={g.key} className="tide-catch__month">
        {g.label && <div className="ui-label tide-catch__monthlabel">{g.label}</div>}
        <Group>
          {g.rows.map((c) => <CatchRow key={c.id} c={c} />)}
        </Group>
      </div>
    ));
  }

  return (
    <Section label="Catch log">
      {total > 0 && (
        <p className="tide-catch__stats">
          <b className="tnum">{total}</b> {total === 1 ? 'catch' : 'catches'}
          {top.map((t) => <span key={t.species}> · {t.species} <span className="tnum">×{t.count}</span></span>)}
        </p>
      )}
      <Button icon="fish" block onClick={openCatchModal}>Log a catch</Button>
      <div className="tide-catch__list">{list}</div>
    </Section>
  );
}

function CatchRow({ c }: { c: CatchView }) {
  const hasPos = c.lat != null && c.lng != null;
  return (
    <div className="tide-catch__row">
      <button type="button" className="tide-catch__main" onClick={() => goToCatch(c.id)}
        aria-label={`${c.species}${c.length ? `, ${c.length} inches` : ''}. ${catchSubline(c)}. ${hasPos ? 'Show on chart' : 'No position saved. Show details'}`}>
        <span className="tide-catch__thumb" aria-hidden="true">
          {c.photo ? <img src={c.photo} alt="" loading="lazy" decoding="async" /> : <Icon name="fish" size={20} />}
        </span>
        <span className="tide-catch__text">
          <span className="tide-catch__title">{c.species}{c.length ? <span className="tnum"> {c.length}&quot;</span> : null}</span>
          <span className="tide-catch__sub tnum">{catchSubline(c)}</span>
        </span>
      </button>
      <span className="tide-catch__acts">
        {hasPos && <IconButton icon="navigation" size="sm" tone="plain" label={`Navigate to ${c.species}`} onClick={() => { void navigateToCatch(c); }} />}
        <IconButton icon="trash" size="sm" tone="plain" label={`Delete ${c.species}`} onClick={() => { void deleteCatch(c.id); }} />
      </span>
    </div>
  );
}
