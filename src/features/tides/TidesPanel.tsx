/* Tides & bite times — personal bite windows, today's solunar periods, sun & moon, and the
 * nearest NOAA station's tide curve + highs/lows.
 *
 * All data comes from engine stores (bite.js biteStore, tides.js tidesStore); this file only
 * draws. Loads are triggered on mount (the shell no longer calls loadTidesTimes /
 * renderBiteWindows on open); the 10-minute online refresh stays in engine/app.js. A 30-second
 * clock tick re-derives the offline astronomy so the solunar NOW highlight and the tide
 * now-line keep moving with no signal and the panel left open. Copy for the bite-engine
 * honesty states is the legacy wording, minus emoji. */
import { useEffect, useMemo } from 'react';
import {
  Badge, Button, Group, Hint, Icon, IconButton, KeyValues, ListRow, LoadingRow, Num, ProgressBar, Section, Sheet, Spinner,
  StatStrip, useStoreValue, type IconName,
} from '../../ui';
import { RetryState } from './RetryState';
import {
  tidesStore, loadTidesTimes, tidesClockTick, buildTideCurve, selectHiLoRows, solunarRows, tideNow, fmtTime,
  type NoaaHiLo,
} from '../../engine/tides.js';
import { biteStore, renderBiteWindows, type BiteWindowView } from '../../engine/bite.js';
import { catchStore, openCatchModal } from '../../engine/catch.js';
import { openPanel, useUi } from '../../services/ui';
import './tides.css';

const DAY_MS = 86400000;

function startOfDay(ms: number) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function nextDay(dayStart: number) { const d = new Date(dayStart); d.setDate(d.getDate() + 1); return d.getTime(); }  // DST-safe

/** "Today" / "Tomorrow" / "Yesterday" / "Tuesday" for a day group. */
function dayLabel(dayStart: number, now: number): string {
  const d0 = startOfDay(now);
  if (dayStart === d0) return 'Today';
  if (dayStart === nextDay(d0)) return 'Tomorrow';
  if (dayStart < d0 && dayStart >= d0 - DAY_MS - 3600000) return 'Yesterday';
  return new Date(dayStart).toLocaleDateString([], { weekday: 'long' });
}

function refreshAll() { void loadTidesTimes(); void renderBiteWindows(); }

export default function TidesPanel() {
  const catchTotal = useStoreValue(catchStore, (s) => s.total);
  const online = useUi((s) => s.online);
  const now = useStoreValue(tidesStore, (s) => s.astro?.at ?? 0);

  // Loads on open (StrictMode double-mounts are harmless: the tide loader de-dupes and the
  // bite refresh is request-tokened).
  useEffect(() => { void loadTidesTimes(); }, []);
  // Bite windows re-rank when the catch log changes (a catch logged with the panel open).
  useEffect(() => { void renderBiteWindows(); }, [catchTotal]);
  // Offline clock: solunar NOW/past, sun & moon at midnight, the tide now-line.
  useEffect(() => {
    const t = setInterval(() => tidesClockTick(), 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') tidesClockTick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  // Signal came back while the tide section is showing "offline" / "couldn't load": try again.
  useEffect(() => {
    if (!online) return;
    const st = tidesStore.getState().status;
    if (st === 'offline' || st === 'error') void loadTidesTimes();
  }, [online]);

  const subtitle = now ? new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : undefined;

  return (
    <Sheet title="Tides & bite times" subtitle={subtitle}
      actions={<IconButton icon="refresh" label="Refresh tides and bite windows" size="sm" onClick={refreshAll} />}>
      {/* The tide leads (the tab's namesake, and what most people open it for); then the
          personal bite windows, then today's astronomy. */}
      <TideSection />
      <BiteSection />
      <SolunarSection />
      <SunMoonSection />
    </Sheet>
  );
}

/* ------------------------------------------------------------- bite windows */
function BiteSection() {
  const status = useStoreValue(biteStore, (s) => s.status);
  const n = useStoreValue(biteStore, (s) => s.n);
  const need = useStoreValue(biteStore, (s) => s.need);
  const confidence = useStoreValue(biteStore, (s) => s.confidence);
  const windows = useStoreValue(biteStore, (s) => s.windows);
  const now = useStoreValue(tidesStore, (s) => s.astro?.at ?? 0) || Date.now();

  let body;
  if (status === 'idle' || status === 'loading') {
    body = <LoadingRow>Reading your catch history…</LoadingRow>;
  } else if (status === 'too-few') {
    const have = Math.min(n, need);
    body = (
      <div className="tide-bite__card">
        <div className="tide-bite__meter">
          <span className="ui-label">Catches logged</span>
          <span className="tide-bite__count"><Num value={have} size="s" /><span className="tide-bite__of">of {need}</span></span>
        </div>
        <ProgressBar value={need > 0 ? (have / need) * 100 : 0} label={`${n} of ${need} catches logged`} />
        <Hint>Log <b>{need}</b> or more catches and I&apos;ll learn the conditions that work for you, then rank the next week against them. You have <b>{n}</b> so far.</Hint>
        <Button icon="fish" block className="tide-bite__cta" onClick={openCatchModal}>Log a catch</Button>
      </div>
    );
  } else if (status === 'no-forecast') {
    body = (
      <div className="tide-bite__card">
        <Hint>Open the 10-day tab once with signal — I need a forecast to score against.</Hint>
        <Button icon="cloud-sun" block className="tide-bite__cta" onClick={() => openPanel('weather', { tab: '10day' })}>Open the 10-day forecast</Button>
      </div>
    );
  } else if (status === 'nothing') {
    body = <div className="tide-bite__card"><Hint>Nothing in the next week closely matches your logged catches.</Hint></div>;
  } else {
    body = (
      <>
        {/* The confidence caveat comes BEFORE the numbers — with a handful of catches these
            rankings are suggestive at best. */}
        <Hint className="tide-bite__caveat">Ranked against <b>{n}</b> logged catches · {confidence?.label}</Hint>
        <ol className="tide-bw">
          {windows.map((w, i) => <BiteWindow key={w.startMs} w={w} top={i === 0} now={now} />)}
        </ol>
      </>
    );
  }
  return <Section label="When to go — from your own catches">{body}</Section>;
}

function BiteWindow({ w, top, now }: { w: BiteWindowView; top: boolean; now: number }) {
  const live = now >= w.startMs && now < w.endMs;
  return (
    <li className={'tide-bw__item' + (top ? ' is-top' : '')}>
      <div className="tide-bw__head">
        <span className="tide-bw__when">{w.label}</span>
        <span className="tide-bw__score" aria-label={w.pct + '% match'}>
          <Num value={w.pct} size="s" proportional /><span className="tide-bw__pct">% match</span>
        </span>
      </div>
      {/* the match as a meter, so the ranking reads at a glance */}
      <span className="tide-bw__meter" aria-hidden="true"><span style={{ width: Math.max(0, Math.min(100, w.pct)) + '%' }} /></span>
      {(top || live) && (
        <div className="tide-bw__tags">
          {live && <Badge tone="signal">Now</Badge>}
          {top && <Badge icon="star">Best match</Badge>}
        </div>
      )}
      {w.reasons.length > 0 && <div className="tide-bw__why">{w.reasons.join(' · ')}</div>}
    </li>
  );
}

/* ------------------------------------------------------------------ solunar */
function SolunarSection() {
  const astro = useStoreValue(tidesStore, (s) => s.astro);
  if (!astro) return <Section label="Solunar bite periods (today)"><LoadingRow /></Section>;
  const rows = solunarRows(astro.solunar, astro.at);
  return (
    <Section label="Solunar bite periods (today)">
      <Group>
        {rows.map((r) => (
          <ListRow key={r.type + r.start}
            className={'tide-sol' + (r.active ? ' is-active' : '') + (r.past ? ' is-past' : '')}
            icon={r.type === 'major' ? 'circle-dot' : 'circle'}
            title={<>{r.type === 'major' ? 'Major' : 'Minor'}{r.active && <> <Badge tone="signal">Now</Badge></>}</>}
            subtitle={r.type === 'major' ? 'Moon overhead or underfoot' : 'Moonrise or moonset'}
            trailing={<span className="tide-time" aria-label={(r.past ? 'past, ' : '') + fmtTime(r.start) + ' to ' + fmtTime(r.end)}>{fmtTime(r.start)} – {fmtTime(r.end)}</span>}
          />
        ))}
      </Group>
      <Hint>Majors (about 2 hours) are the traditional strongest bite times; minors last about 90 minutes.</Hint>
    </Section>
  );
}

/* --------------------------------------------------------------- sun & moon */
function SunMoonSection() {
  const astro = useStoreValue(tidesStore, (s) => s.astro);
  if (!astro) return null;
  const k = (icon: IconName, text: string) => <span className="tide-kv-k"><Icon name={icon} size={16} />{text}</span>;
  const t = (ms: number | null) => (ms != null ? <span className="tide-time">{fmtTime(ms)}</span> : <Num value={null} />);
  const items = [
    { key: 'sr', k: k('sunrise', 'Sunrise'), v: t(astro.sunrise) },
    { key: 'ss', k: k('sunset', 'Sunset'), v: t(astro.sunset) },
    { key: 'mp', k: k('moon', astro.moonName), v: <><Num value={astro.moonLitPct} size="row" proportional /><span className="tide-kv-unit">% lit</span></> },
  ];
  // moonrise and moonset in the order they happen today
  const moon = [
    { key: 'mr', label: 'Moonrise', ms: astro.moonrise },
    { key: 'ms', label: 'Moonset', ms: astro.moonset },
  ].filter((m): m is { key: string; label: string; ms: number } => m.ms != null).sort((a, b) => a.ms - b.ms);
  for (const m of moon) items.push({ key: m.key, k: k('moon', m.label), v: t(m.ms) });
  return <Section label="Sun & moon"><KeyValues items={items} /></Section>;
}

/* --------------------------------------------------------------------- tide */
function TideSection() {
  const station = useStoreValue(tidesStore, (s) => s.station);
  const status = useStoreValue(tidesStore, (s) => s.status);
  const hilo = useStoreValue(tidesStore, (s) => s.hilo);
  const fromCache = useStoreValue(tidesStore, (s) => s.fromCache);
  const refreshing = useStoreValue(tidesStore, (s) => s.refreshing);
  const updatedAt = useStoreValue(tidesStore, (s) => s.updatedAt);
  const now = useStoreValue(tidesStore, (s) => s.astro?.at ?? 0) || Date.now();
  const retry = () => { void loadTidesTimes(); };

  let body;
  if (status === 'no-stations') {
    body = <RetryState icon="tide" onRetry={retry}>No tide station data available.</RetryState>;
  } else if (status === 'offline') {
    body = <RetryState icon="wifi-off" onRetry={retry}>Connect to the internet to load tide predictions.</RetryState>;
  } else if (status === 'error') {
    body = <RetryState icon="alert" onRetry={retry}>Couldn’t load tide predictions. Retry when you have signal.</RetryState>;
  } else if (status === 'idle' || status === 'loading') {
    body = <LoadingRow>Loading tides…</LoadingRow>;
  } else {
    body = (
      <>
        {status === 'no-data' ? <Hint>No tide data.</Hint> : <TideNowLine hilo={hilo} now={now} />}
        {status === 'ready' && <TideChart hilo={hilo} now={now} />}
        <HiLoList hilo={hilo} now={now} />
        {fromCache && updatedAt > 0 && (
          <Hint>Saved predictions from {new Date(updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} — tide tables don’t change, so these work offline.</Hint>
        )}
      </>
    );
  }

  return (
    <Section label="Tide">
      {station && (
        <div className="tide-station">
          <span className="tide-station__icon"><Icon name="tide" size={20} /></span>
          <div className="tide-station__text">
            <div className="tide-station__name">{station.name}</div>
            <div className="ui-caption">Nearest NOAA station · feet above MLLW</div>
          </div>
          {refreshing && <Spinner size="sm" label="Updating tide predictions" />}
        </div>
      )}
      {body}
    </Section>
  );
}

/* Now · direction · next turn, as a glanceable instrument strip. The "Now" key dot is the
   chart's now-marker, so the strip and the curve read as one. */
function TideNowLine({ hilo, now }: { hilo: NoaaHiLo[]; now: number }) {
  const tn = useMemo(() => tideNow(hilo, now), [hilo, now]);
  if (!tn) return null;
  return (
    <StatStrip className="tide-now" cells={[
      { key: 'now', label: <span className="tide-now__key">Now</span>, value: <Num value={tn.ft} digits={1} unit="ft" size="s" approx /> },
      {
        key: 'dir', label: 'Tide',
        value: <span className="tide-now__dir"><Icon name={tn.rising ? 'arrow-up' : 'arrow-down'} size={16} />{tn.rising ? 'Rising' : 'Falling'}</span>,
      },
      { key: 'next', label: tn.next.type === 'H' ? 'Next high' : 'Next low', value: <span className="tide-time">{fmtTime(tn.next.t)}</span> },
    ]} />
  );
}

/* The curve for TODAY (local midnight to midnight, clipped to the predictions on hand):
   cosine-interpolated between NOAA's highs and lows, a dashed now-line, and each high/low
   labelled with its time and height. The SVG stretches horizontally (non-scaling strokes);
   dots and labels are HTML so the type stays crisp at any width. Labels sit on a knockout of
   the card colour on two rails clear of the filled area (highs above, lows below), so the
   now-line and the hour grid pass BEHIND them and never through the type. Extremes are hollow rings, now is a solid target: they differ by shape, not only by
   colour (night mode is one hue). The axis names the now-line ("Now") and drops any hour
   label it would crowd. */
const CH_W = 320, CH_H = 140, PAD_X = 6, PAD_TOP = 36, PAD_BOTTOM = 36;

function TideChart({ hilo, now }: { hilo: NoaaHiLo[]; now: number }) {
  const minute = Math.floor(now / 60000);
  const day0 = startOfDay(now), day1 = nextDay(day0);
  const curve = useMemo(
    () => buildTideCurve(hilo, minute * 60000, { W: CH_W, H: CH_H, pad: PAD_X, padTop: PAD_TOP, padBottom: PAD_BOTTOM, from: day0, to: day1 }),
    [hilo, minute, day0, day1],
  );
  if (!curve) return null;
  const xOf = (t: number) => PAD_X + (t - curve.t0) / (curve.t1 - curve.t0) * (CH_W - 2 * PAD_X);
  const pct = (x: number) => (x / CH_W) * 100;
  const ticks = [6, 12, 18].map((h) => { const d = new Date(day0); d.setHours(h, 0, 0, 0); return d.getTime(); })
    .filter((t) => t > curve.t0 && t < curve.t1);
  const edge = (x: number) => (pct(x) < 12 ? ' is-start' : pct(x) > 88 ? ' is-end' : '');
  const nowPct = curve.nowX != null ? pct(curve.nowX) : null;
  const axisTicks = ticks.filter((t) => nowPct == null || Math.abs(pct(xOf(t)) - nowPct) > 11);
  const highs = curve.marks.filter((m) => m.type === 'H').map((m) => `high ${m.v.toFixed(1)} feet at ${fmtTime(m.t)}`);
  const lows = curve.marks.filter((m) => m.type === 'L').map((m) => `low ${m.v.toFixed(1)} feet at ${fmtTime(m.t)}`);

  return (
    <figure className="tide-chart" role="img" aria-label={'Tide curve for today: ' + [...highs, ...lows].join(', ')}>
      <div className="tide-chart__plot" style={{ height: CH_H }}>
        <svg className="tide-chart__svg" viewBox={`0 0 ${CH_W} ${CH_H}`} preserveAspectRatio="none" aria-hidden="true">
          {ticks.map((t) => (
            <line key={t} className="tide-chart__grid" x1={xOf(t)} x2={xOf(t)} y1={PAD_TOP - 10} y2={CH_H - PAD_BOTTOM + 10} />
          ))}
          <path d={curve.area} className="tide-chart__area" />
          <path d={curve.line} className="tide-chart__line" />
          {curve.nowX != null && <line className="tide-chart__now" x1={curve.nowX} x2={curve.nowX} y1={4} y2={CH_H} />}
        </svg>
        {curve.marks.map((m) => (
          <span key={'d' + m.t} className="tide-chart__dot" style={{ left: pct(m.x) + '%', top: m.y }} />
        ))}
        {/* Labels ride two rails: highs above the curve's top, lows below its floor. Off the
            filled area, their knockout hides only the now-line and the hour grid. */}
        {curve.marks.map((m) => (
          <span key={'l' + m.t} className={'tide-chart__lbl ' + (m.type === 'H' ? 'is-high' : 'is-low') + edge(m.x)}
            style={{ left: pct(m.x) + '%', top: m.type === 'H' ? PAD_TOP - 7 : CH_H - PAD_BOTTOM + 7 }}>
            <span className="tide-chart__t">{fmtTime(m.t)}</span>
            <span className="tide-chart__v">{m.v.toFixed(1)} ft</span>
          </span>
        ))}
        {curve.nowX != null && curve.nowY != null && (
          <span className="tide-chart__nowdot" style={{ left: pct(curve.nowX) + '%', top: curve.nowY }} />
        )}
      </div>
      <div className="tide-chart__axis" aria-hidden="true">
        {axisTicks.map((t) => (
          <span key={t} style={{ left: pct(xOf(t)) + '%' }}>{new Date(t).toLocaleTimeString([], { hour: 'numeric' })}</span>
        ))}
        {nowPct != null && (
          <span className={'tide-chart__axisnow' + (nowPct < 7 ? ' is-start' : nowPct > 93 ? ' is-end' : '')} style={{ left: nowPct + '%' }}>Now</span>
        )}
      </div>
    </figure>
  );
}

type HiLoRow = ReturnType<typeof selectHiLoRows>[number];

/* Upcoming highs and lows plus the one that just passed (dimmed, marked "Earlier"), grouped
   under a day label so "Tomorrow" isn't repeated on every row. */
function HiLoList({ hilo, now }: { hilo: NoaaHiLo[]; now: number }) {
  const rows = useMemo(() => selectHiLoRows(hilo, now), [hilo, now]);
  if (!rows.length) return null;
  const days: Array<{ day: number; rows: HiLoRow[] }> = [];
  for (const r of rows) {
    const d = startOfDay(r.ms);
    const last = days[days.length - 1];
    if (last && last.day === d) last.rows.push(r); else days.push({ day: d, rows: [r] });
  }
  return (
    <div className="tide-hilo">
      {days.map((g) => (
        <div key={g.day} className="tide-hilo__day">
          <h4 className="ui-label tide-hilo__daylabel">{dayLabel(g.day, now)}</h4>
          <Group>
            {g.rows.map((r) => (
              <ListRow key={r.ms} className={'tide-hilo__row' + (r.past ? ' is-past' : '')}
                icon={r.type === 'H' ? 'arrow-up' : 'arrow-down'}
                title={<>{r.type === 'H' ? 'High' : 'Low'}{r.past && <Badge>Earlier</Badge>}</>}
                trailing={<><span className="tide-time">{fmtTime(r.ms)}</span><Num value={r.ft} digits={1} unit="ft" size="row" className="tide-hilo__ft" /></>}
              />
            ))}
          </Group>
        </div>
      ))}
    </div>
  );
}
