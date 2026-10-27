/* Nav tools & catch log: catch log (tides feature), route planner, measure, anchor alarm,
 * trip stats. Everything here calls engine/nav.js directly and renders navStore; the anchor
 * watch itself (evaluation, alarm, keep-alive) never depends on this panel being open. */
import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Button, Field, Hint, Icon, KeyValues, Notice, Num, Section, Sheet, StatStrip, TextInput, useIsDesktop, useStoreValue,
} from '../../ui';
import { CatchLogSection } from '../tides/CatchLogSection';
import {
  anchorRadiusChanged, anchorScreenCopy, anchorStatusText, anchorToggle, fmtDur, navSetMode, navStore, routeClear,
  routeStart, routeUndo, setRouteGph, setRouteSpeedKn, tripDurationMs, tripReset, tripToggle,
} from '../../engine/nav.js';
import { setDetent } from '../../services/ui';
import { isNativeShell } from '../../services/native';
import { SITE } from '../../services/site';
import { useNow } from './useNow';
import './nav.css';

const LEGS_PER_GROUP = 8;

/* Entering a map-tap mode on a phone: drop the sheet to its half detent so the chart is
   tappable (the legacy panel had to be closed by hand first). */
function useMapMode() {
  const desktop = useIsDesktop();
  return (mode: 'route' | 'measure', wasOn: boolean) => {
    navSetMode(mode);
    if (!wasOn && !desktop) setDetent('medium');
  };
}

function numDraft(n: number) { return n > 0 ? String(n) : ''; }

function RoutePlanner() {
  const mode = useStoreValue(navStore, (s) => s.mode);
  const pts = useStoreValue(navStore, (s) => s.routePts);
  const legs = useStoreValue(navStore, (s) => s.routeLegs);
  const total = useStoreValue(navStore, (s) => s.routeTotalNm);
  const durText = useStoreValue(navStore, (s) => s.routeDurText);
  const gal = useStoreValue(navStore, (s) => s.routeGal);
  const speed = useStoreValue(navStore, (s) => s.routeSpeedKn);
  const gph = useStoreValue(navStore, (s) => s.routeGph);
  const hint = useStoreValue(navStore, (s) => s.routeHint);
  const [spdDraft, setSpdDraft] = useState(() => numDraft(speed));
  const [gphDraft, setGphDraft] = useState(() => numDraft(gph));
  const [starting, setStarting] = useState(false);
  const setMode = useMapMode();
  const adding = mode === 'route';

  const start = async () => {
    setStarting(true);
    try { await routeStart(); } finally { setStarting(false); }
  };

  const legGroups: Array<typeof legs> = [];
  for (let i = 0; i < legs.length; i += LEGS_PER_GROUP) legGroups.push(legs.slice(i, i + LEGS_PER_GROUP));

  return (
    <Section label="Route planner" className="nav-planner">
      {/* 2 x 2 so nothing truncates at 375 px: the main pair (add points → start) filled, the
          editing pair (undo / clear) outlined underneath. */}
      <div className="nav-tools-grid">
        <Button icon={adding ? 'check' : 'plus'} className={'nav-toggle' + (adding ? ' is-on' : '')} aria-pressed={adding}
          onClick={() => setMode('route', adding)}>{adding ? 'Done' : 'Add points'}</Button>
        <Button variant="primary" icon="play" disabled={pts < 2} busy={starting} onClick={start}>Start route</Button>
        <Button variant="ghost" icon="undo" className="nav-tools-edit" onClick={routeUndo} disabled={pts === 0}>Undo</Button>
        <Button variant="ghost" icon="trash" className="nav-tools-edit" onClick={routeClear} disabled={pts === 0}>Clear</Button>
      </div>

      <div className="nav-fields">
        <Field label="Cruise speed">
          <span className="nav-unit-input">
            <TextInput type="number" inputMode="decimal" min={0} step="any" value={spdDraft} placeholder="0"
              onChange={(e) => { setSpdDraft(e.target.value); setRouteSpeedKn(e.target.value); }} />
            <span className="nav-unit">kn</span>
          </span>
        </Field>
        <Field label="Fuel burn">
          <span className="nav-unit-input">
            <TextInput type="number" inputMode="decimal" min={0} step="any" value={gphDraft} placeholder="0"
              onChange={(e) => { setGphDraft(e.target.value); setRouteGph(e.target.value); }} />
            <span className="nav-unit">gal/hr</span>
          </span>
        </Field>
      </div>

      {pts >= 2 && (
        <>
          <StatStrip className="nav-block" cells={[
            { key: 'nm', label: 'Total', value: <Num value={total} digits={1} unit="nm" size="s" /> },
            { key: 't', label: speed > 0 ? `At ${speed} kn` : 'Time', value: durText || '—' },
            { key: 'gal', label: 'Fuel', value: <Num value={gal} digits={1} unit="gal" size="s" approx /> },
            { key: 'pts', label: 'Points', value: <Num value={pts} digits={0} size="s" /> },
          ]} />
          {legGroups.map((g, gi) => (
            <KeyValues key={gi} className="nav-block nav-legs" items={g.map((l) => ({
              key: String(l.from),
              k: `Leg ${l.from}→${l.to}`,
              v: <><Num value={l.nm} digits={2} unit="nm" size="row" /> · <Num value={l.brg} digits={0} deg="°T" size="row" /></>,
            }))} />
          ))}
        </>
      )}
      <Hint>{hint}</Hint>
    </Section>
  );
}

function Measure() {
  const mode = useStoreValue(navStore, (s) => s.mode);
  const result = useStoreValue(navStore, (s) => s.measure);
  const pending = useStoreValue(navStore, (s) => s.measurePending);
  const setMode = useMapMode();
  const on = mode === 'measure';
  return (
    <Section label="Measure">
      <Button block icon={on ? 'x' : 'ruler'} className={'nav-toggle' + (on ? ' is-on' : '')} aria-pressed={on}
        onClick={() => setMode('measure', on)}>{on ? 'Stop measuring' : 'Measure distance'}</Button>
      <Hint>{on ? (pending ? 'Now tap the second point.' : 'Tap two points on the map. A third tap starts over.') : 'Distance and bearing between any two points you tap on the chart.'}</Hint>
      {result && (
        <StatStrip className="nav-block" cells={[
          { key: 'nm', label: 'Distance', value: <Num value={result.nm} digits={2} unit="nm" size="s" /> },
          { key: 'mi', label: 'Statute', value: <Num value={result.mi} digits={2} unit="mi" size="s" /> },
          { key: 'brg', label: 'Bearing', value: <Num value={result.brg} digits={0} deg="°T" size="s" /> },
        ]} />
      )}
    </Section>
  );
}

function AnchorWatch() {
  const watching = useStoreValue(navStore, (s) => s.anchorWatching);
  const blind = useStoreValue(navStore, (s) => s.anchorBlind);
  const dragging = useStoreValue(navStore, (s) => s.anchorDragging);
  const outside = useStoreValue(navStore, (s) => s.anchorOutside);
  const distFt = useStoreValue(navStore, (s) => s.alarmDistFt);
  const radiusFt = useStoreValue(navStore, (s) => s.anchorRadiusFt);
  const field = useStoreValue(navStore, (s) => s.anchorField);
  const snoozeUntil = useStoreValue(navStore, (s) => s.anchorSnoozeUntil);
  const button = useStoreValue(navStore, (s) => s.anchorButton);
  const alarmText = useStoreValue(navStore, (s) => s.alarmText);
  const [draft, setDraft] = useState(field);
  const now = useNow(watching && snoozeUntil > 0 ? 15000 : 0);
  const native = isNativeShell();

  // keep the field in step when the engine changes it (restore, another surface)
  useEffect(() => { setDraft(field); }, [field]);

  /* Commit on change (blur / Enter), not per keystroke: a half-typed "1" from "150" must
     never shrink a live watch circle to one foot. */
  const commit = () => { if (draft !== field) anchorRadiusChanged(draft); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } };
  const status = anchorStatusText({ watching, blind, radiusFt, snoozeUntil }, now);
  const snoozedBlind = blind && snoozeUntil > now;
  const snoozeMin = Math.max(1, Math.ceil((snoozeUntil - now) / 60000));
  /* Silenced while the boat is still outside the circle: a real drag is in progress and only
     the sound is paused — never show that as the calm "Watching" row. */
  const snoozedOutside = !blind && !dragging && outside && snoozeUntil > now;

  return (
    <Section label="Anchor alarm" className="nav-anchor">
      <Field label="Watch radius">
        <span className="nav-unit-input">
          <TextInput type="number" inputMode="numeric" min={1} step={1} value={draft}
            onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          <span className="nav-unit">ft</span>
        </span>
      </Field>
      {/* The tap itself unlocks audio, takes the wake lock and the keep-alive — keep it synchronous. */}
      <Button block icon="anchor" variant="secondary"
        onClick={() => { commit(); anchorToggle(); }}>{button}</Button>
      {watching && (blind ? (
        <Notice tone="alert" title={status}>
          {snoozedBlind
            ? `Alarm silenced — it sounds again in ${snoozeMin} min if GPS is still gone.`
            : anchorScreenCopy(native).blind}
        </Notice>
      ) : dragging ? (
        <Notice tone="alert" title="Anchor dragging">{alarmText || status}</Notice>
      ) : snoozedOutside ? (
        <Notice tone="alert" title="Outside the watch circle — alarm silenced">
          {distFt != null
            ? <><Num value={distFt} digits={0} unit="ft" size="row" /> from anchor (limit <Num value={radiusFt} digits={0} unit="ft" size="row" />). </>
            : (alarmText ? alarmText + '. ' : '')}
          {`It sounds again in ${snoozeMin} min, or sooner if you keep drifting.`}
        </Notice>
      ) : (
        <div className="nav-status" role="status"><Icon name="circle-dot" size={16} />{status}</div>
      ))}
      {native ? (
        <Hint>In the {SITE.brandName} app the watch keeps GPS running with the screen locked, and iOS shows the location indicator while it does. If you drag while the phone is locked, it sounds an alarm tone and shows a notification. Keep the volume up and don't swipe the app away — a closed app can't sound the alarm.</Hint>
      ) : (
        <Hint>Keep the app open with the screen on — iOS pauses GPS when the phone locks, so a background alarm isn't possible in a web app.</Hint>
      )}
      <Hint>An aid only: it depends on GPS and on the phone staying on and charged. It is not a substitute for keeping an anchor watch.</Hint>
    </Section>
  );
}

function TripStats() {
  const active = useStoreValue(navStore, (s) => s.tripActive);
  const start = useStoreValue(navStore, (s) => s.tripStart);
  const segStart = useStoreValue(navStore, (s) => s.tripSegStart);
  const accMs = useStoreValue(navStore, (s) => s.tripAccMs);
  const dist = useStoreValue(navStore, (s) => s.tripDistNm);
  const maxKn = useStoreValue(navStore, (s) => s.tripMaxKn);
  const avgKn = useStoreValue(navStore, (s) => s.tripAvgKn);
  const button = useStoreValue(navStore, (s) => s.tripButton);
  const now = useNow(active ? 1000 : 0);
  const dur = tripDurationMs({ active, start, segStart, accMs }, now);
  return (
    <Section label="Trip stats">
      <div className="nav-tools-grid">
        <Button icon={active ? 'pause' : 'play'} onClick={tripToggle}>{button}</Button>
        <Button icon="undo" onClick={tripReset} disabled={!start}>Reset</Button>
      </div>
      <KeyValues items={[
        { key: 'd', k: 'Distance', v: <Num value={start ? dist : null} digits={2} unit="nm" size="row" /> },
        { key: 't', k: 'Time', v: start ? fmtDur(dur / 1000) : <Num value={null} size="row" /> },
        { key: 'max', k: 'Max speed', v: <Num value={maxKn} digits={1} unit="kn" size="row" /> },
        { key: 'avg', k: 'Avg speed', v: <Num value={avgKn} digits={1} unit="kn" size="row" /> },
      ]} />
      <Hint>{start ? '' : 'Start a trip to log distance, time and speed from here. '}Distance counts real movement only — GPS jitter while you sit on a spot is ignored.</Hint>
    </Section>
  );
}

export default function ToolsPanel() {
  return (
    <Sheet title="Nav tools & catch log">
      <CatchLogSection />
      <RoutePlanner />
      <Measure />
      <AnchorWatch />
      <TripStats />
    </Sheet>
  );
}
