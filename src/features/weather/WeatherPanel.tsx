/* Weather & waves — current conditions, the next 24 hours and a 10-day outlook (Open-Meteo).
 *
 * The engine (engine/weather.js) does every fetch, cache and safety rule; this sheet renders
 * wxStore. Honesty rules carried over from the legacy panel: a missing value is a dash, never 0;
 * a saved forecast says how old it is; rain is always a "chance"; days 7+ are marked "~" as
 * trends; a tapped area's forecast is labelled as such and never replaces the boat's own. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button, DirectionDial, Disclosure, Group, Hint, Icon, IconButton, KeyValues, LoadingRow, Notice, Num,
  Section, Segmented, Sheet, Spinner, StatStrip, StatTile, StateBox, useStoreValue, type IconName,
} from '../../ui';
import { openPanel, useUi } from '../../services/ui';
import {
  ROUGH_WIND_KN, compass, loadForecast10, loadNow24, loadWeatherPanel, longRangeNote, setWeatherTab, wxAgeLabel, wxIsStale,
  wxOnReconnect, wxStore,
} from '../../engine/weather.js';
import type { WxCurrent, WxDay, WxHour } from '../../engine/weather.js';
import { OpenMeteoCredit } from './DataCredit';
import './weather.css';

type Tab = 'now' | '10day';

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Meteorological direction is where the wind/sea comes FROM; dials and arrows point where it GOES. */
function toward(fromDeg: number | null | undefined): number | null {
  return fromDeg == null || !Number.isFinite(fromDeg) ? null : (fromDeg + 180) % 360;
}

export default function WeatherPanel() {
  const panelData = useUi((s) => s.panelData);
  const online = useUi((s) => s.online);
  const tab = useStoreValue(wxStore, (s) => s.tab) as Tab;
  const refreshing = useStoreValue(wxStore, (s) => (s.tab === '10day' ? s.fc10.refreshing : s.now.refreshing));

  // Every open (and every change of target — e.g. "10-day forecast for this area") starts here.
  useEffect(() => { void loadWeatherPanel(panelData); }, [panelData]);
  // Back online with a saved copy on screen: refresh it now instead of waiting for the 10-minute tick.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) wxOnReconnect();
    wasOnline.current = online;
  }, [online]);

  const refresh = () => { if (tab === '10day') void loadForecast10(); else void loadNow24(); };
  const action = refreshing
    ? <span className="wx-busy"><Spinner size="sm" label="Refreshing forecast" /></span>
    : <IconButton icon="refresh" label="Refresh forecast" size="sm" disabled={!online} onClick={refresh} />;

  return (
    <Sheet title="Weather & waves" actions={action}>
      <Segmented<Tab> className="wx-tabs" label="Forecast range" value={tab} onChange={setWeatherTab}
        options={[{ value: 'now', label: 'Now & 24h' }, { value: '10day', label: '10-Day' }]} />
      {tab === 'now' ? <NowTab /> : <TenDayTab />}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- shared bits */
function LocLine({ text, area }: { text: string; area?: boolean }) {
  if (!text) return null;
  return (
    <p className={'wx-loc' + (area ? ' wx-loc--area' : '')}>
      <Icon name={area ? 'pin' : 'locate'} size={14} />
      <span className="wx-loc__text">{text}</span>
    </p>
  );
}

/** A saved copy older than 10 minutes is not live: its numbers are shown dimmed (DESIGN §0.7).
 *  Re-evaluated every 30 s, so a copy goes stale on screen without a reload. */
function useStale(ts: number): boolean {
  useNow(30_000);
  return ts > 0 && wxIsStale(ts);
}

/** "Forecast updated just now", or the stale badge with its age. Rendered right under the
 *  location line — above the numbers — so it is visible at the medium detent. (The source is
 *  credited, linked, under the data: OpenMeteoCredit.) */
function AgeNote({ ts, fresh, failed, refreshing, onRetry }: { ts: number; fresh: string; failed: boolean; refreshing: boolean; onRetry: () => void }) {
  const online = useUi((s) => s.online);
  const stale = useStale(ts);
  if (!ts) return null;
  return (
    <div className={'wx-age' + (stale ? ' is-stale' : '')} role={stale ? 'status' : undefined}>
      {stale && <Icon name="alert" size={14} />}
      <span>{wxAgeLabel(ts, fresh, failed, refreshing)}</span>
      {stale && online && !refreshing && <Button variant="ghost" compact icon="refresh" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/** A wind or gust figure at/over the rough-day threshold: the triangle + heavier figures (no colour). */
function Strong({ on, size = 12, children }: { on: boolean; size?: number; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <span className="wx-strong">
      {children}
      <Icon name="alert" size={size} className="wx-strong__icon" title={`Rough: ${ROUGH_WIND_KN} kn or more`} />
    </span>
  );
}

function WindArrow({ fromDeg }: { fromDeg: number | null }) {
  const t = toward(fromDeg);
  if (t == null) return null;
  return <Icon name="arrow-up" size={13} className="wx-arrow" style={{ transform: `rotate(${Math.round(t)}deg)` }} />;
}

function hourSummary(h: WxHour): string {
  const p: string[] = [h.label];
  p.push(h.windKn != null ? `wind ${h.windKn} knots${h.windFromDeg != null ? ' from ' + compass(h.windFromDeg) : ''}${h.windRough ? ', rough' : ''}` : 'wind unknown');
  if (h.gustKn != null) p.push(`gusts ${h.gustKn}${h.gustRough ? ', rough' : ''}`);
  if (h.waveFt != null) p.push(`waves ${h.waveFt.toFixed(1)} feet`);
  if (h.rainPct != null) p.push(`${h.rainPct}% chance of rain`);
  if (h.tempF != null) p.push(`${h.tempF} degrees`);
  return p.join(', ');
}

/** Hours across, readings down: wind (with a direction arrow), gust, waves, rain chance, air.
 *  Wind and gust at/over the rough threshold carry the triangle + weight (legacy coloured them). */
function HourStrip({ hours, label, stale }: { hours: WxHour[]; label: string; stale?: boolean }) {
  if (!hours.length) return null;
  return (
    <div className="wx-hstrip">
      <div className="wx-hstrip__labels" aria-hidden>
        <span className="wx-hstrip__lab" />
        <span className="wx-hstrip__lab">Wind<small>kn</small></span>
        <span className="wx-hstrip__lab">Gust<small>kn</small></span>
        <span className="wx-hstrip__lab">Waves<small>ft</small></span>
        <span className="wx-hstrip__lab">Rain<small>chance</small></span>
        <span className="wx-hstrip__lab">Air<small>°F</small></span>
      </div>
      <div className="wx-hstrip__scroll" role="list" aria-label={label}>
        {hours.map((h) => (
          <div className="wx-hstrip__col" role="listitem" key={h.key} aria-label={hourSummary(h)}>
            <span className="wx-hstrip__t" aria-hidden>{h.label}</span>
            <span className="wx-hstrip__c" aria-hidden>
              <WindArrow fromDeg={h.windFromDeg} /><Strong on={h.windRough} size={11}><Num size="row" value={h.windKn} stale={stale} /></Strong>
            </span>
            <span className="wx-hstrip__c" aria-hidden><Strong on={h.gustRough} size={11}><Num size="row" value={h.gustKn} stale={stale} /></Strong></span>
            <span className="wx-hstrip__c" aria-hidden><Num size="row" value={h.waveFt} digits={1} stale={stale} /></span>
            <span className="wx-hstrip__c" aria-hidden><Num size="row" value={h.rainPct} unit="%" className="wx-pct" stale={stale} /></span>
            <span className="wx-hstrip__c" aria-hidden><Num size="row" value={h.tempF} deg="°" stale={stale} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Now & 24h */
function NowTab() {
  const now = useStoreValue(wxStore, (s) => s.now);
  const stale = useStale(now.ts);
  const retry = () => { void loadNow24(); };
  let body: ReactNode;
  if (now.status === 'offline') {
    body = <StateBox icon="wifi-off" onRetry={retry}>No internet and no saved forecast yet. Open this panel once while online.</StateBox>;
  } else if (now.status === 'error') {
    body = <StateBox icon="alert" tone="alert" onRetry={retry}>Couldn’t load the forecast. Check your connection and retry.</StateBox>;
  } else if (now.status === 'ready' && now.current) {
    body = (
      <>
        <CurrentTiles c={now.current} stale={stale} />
        <Section label="Next 24 hours">
          {now.hours.length
            ? <HourStrip hours={now.hours} label="Next 24 hours, hour by hour" stale={stale} />
            : <StateBox icon="clock">No hourly forecast left in this saved copy. It refreshes as soon as you’re online.</StateBox>}
        </Section>
      </>
    );
  } else {
    body = <LoadingRow>Loading forecast…</LoadingRow>;
  }
  return (
    <>
      <LocLine text={now.locLabel} />
      <AgeNote ts={now.ts} fresh="Forecast updated just now" failed={now.refreshFailed} refreshing={now.refreshing} onRetry={retry} />
      {body}
      {now.status === 'ready' && now.current && <OpenMeteoCredit />}
    </>
  );
}

function CurrentTiles({ c, stale }: { c: WxCurrent; stale: boolean }) {
  const windDetail = c.windFromDeg != null ? `from ${compass(c.windFromDeg)}` : 'direction unknown';
  const waveDetail = c.waveFt == null
    ? (c.hasMarine ? 'no wave data' : 'no marine data here')
    : [c.wavePerS != null ? `@ ${c.wavePerS}s` : '', c.waveFromDeg != null ? `from ${compass(c.waveFromDeg)}` : ''].filter(Boolean).join(' ') || undefined;
  const swell = c.swellFt == null ? <Num size="s" value={null} /> : (
    <>
      <Num size="s" value={c.swellFt} digits={1} unit="ft" stale={stale} />
      {c.swellPerS != null && <span className="wx-detail-sep">@ {c.swellPerS}s</span>}
    </>
  );
  // Instrument read-out like the HUD: caps label, big value, one detail line — no per-tile glyphs.
  return (
    <>
      <div className="wx-tiles">
        <StatTile label="Wind" detail={windDetail}
          dial={<DirectionDial towardDeg={toward(c.windFromDeg)} label={c.windFromDeg != null ? `Wind from ${compass(c.windFromDeg)}` : undefined} />}>
          <Strong on={c.windRough} size={16}><Num value={c.windKn} unit="kn" stale={stale} /></Strong>
        </StatTile>
        <StatTile label="Gusts" detail={c.maxGust24 != null ? `up to ${c.maxGust24} kn in 24 h` : undefined}>
          <Strong on={c.gustRough} size={16}><Num value={c.gustKn} unit="kn" stale={stale} /></Strong>
        </StatTile>
        <StatTile label="Waves" detail={waveDetail}
          dial={c.waveFromDeg != null ? <DirectionDial towardDeg={toward(c.waveFromDeg)} label={`Waves from ${compass(c.waveFromDeg)}`} /> : undefined}>
          <Num value={c.waveFt} digits={1} unit="ft" stale={stale} />
        </StatTile>
        <StatTile label="Air">
          <Num value={c.tempF} deg="°F" stale={stale} />
        </StatTile>
      </div>
      <StatStrip className="wx-strip-now" cells={[
        { key: 'swell', label: 'Swell', value: swell },
        { key: 'rain', label: 'Rain chance', value: <Num size="s" value={c.rainPctNow} unit="%" className="wx-pct" stale={stale} /> },
        {
          key: 'max', label: 'Max wind 24 h',
          value: <Strong on={c.maxWind24 != null && c.maxWind24 >= ROUGH_WIND_KN}><Num size="s" value={c.maxWind24} unit="kn" stale={stale} /></Strong>,
        },
      ]} />
    </>
  );
}

/* ------------------------------------------------------------------ 10-Day */
function TenDayTab() {
  const fc = useStoreValue(wxStore, (s) => s.fc10);
  const stale = useStale(fc.ts);
  // Which days are expanded lives here, so the 10-minute auto refresh (a re-render) never
  // collapses a day you're reading.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const retry = () => { void loadForecast10(); };

  let body: ReactNode;
  if (fc.status === 'offline') {
    body = <StateBox icon="wifi-off" onRetry={retry}>No internet and no saved 10-day forecast yet. Open this tab once while online.</StateBox>;
  } else if (fc.status === 'error') {
    body = <StateBox icon="alert" tone="alert" onRetry={retry}>Couldn’t load the 10-day forecast. Check your connection and retry.</StateBox>;
  } else if (fc.status === 'ready') {
    body = fc.days.length ? (
      <>
        <Group className="wx-days">
          {fc.days.map((d) => (
            <Disclosure key={d.key} open={!!open[d.key]} onToggle={(o) => setOpen((p) => ({ ...p, [d.key]: o }))}
              summary={<DaySummary d={d} stale={stale} />}>
              <DayDetail d={d} stale={stale} />
            </Disclosure>
          ))}
        </Group>
        {/* the "~" on a day name, spelled out once under the list */}
        {fc.days.some((d) => d.longRange) && <p className="wx-days__key"><span aria-hidden>~</span> long-range model, low confidence</p>}
      </>
    ) : <StateBox icon="clock" onRetry={retry}>Every day in this saved forecast has passed. Connect to the internet to refresh it.</StateBox>;
  } else {
    body = <LoadingRow>Loading 10-day forecast…</LoadingRow>;
  }

  return (
    <>
      {fc.forArea ? <AreaBar label={fc.locLabel} hereAtBoat={fc.hereAtBoat} /> : <LocLine text={fc.locLabel} />}
      <AgeNote ts={fc.ts} fresh="Updated just now" failed={fc.refreshFailed} refreshing={fc.refreshing} onRetry={retry} />
      {fc.status === 'ready' && fc.days.length > 0 && <Hint className="wx-legendhint">Tap a day for its 3-hourly breakdown.</Hint>}
      {body}
      {fc.status === 'ready' && fc.days.length > 0 && <OpenMeteoCredit />}
    </>
  );
}

/** A tapped area's forecast is a different place from the boat: say so in a bar of its own,
 *  with the way back on the same line. */
function AreaBar({ label, hereAtBoat }: { label: string; hereAtBoat: boolean }) {
  const cut = label.indexOf(' — ');
  const title = cut > 0 ? label.slice(0, cut) : label || 'For this area';
  const where = cut > 0 ? label.slice(cut + 3) : '';
  const back = hereAtBoat ? 'Back to my position' : 'Back to map centre';
  return (
    <div className="wx-areabar">
      <Icon name="pin" size={18} className="wx-areabar__ic" />
      <div className="wx-areabar__text">
        <span className="wx-areabar__title">{title}</span>
        {where && <span className="wx-areabar__where">{where}</span>}
      </div>
      {/* Same source as the engine's "here": the boat's last fix, kept after the fix is lost. */}
      <Button compact icon="locate" aria-label={back} onClick={() => openPanel('weather', { tab: '10day' })}>
        {hereAtBoat ? 'My position' : 'Map centre'}
      </Button>
    </div>
  );
}

function daySummaryLabel(d: WxDay): string {
  const p = [`${d.wd} ${d.md2}`];
  if (d.longRange) p.push(`${d.dayOut} days out, long-range model, low confidence`);
  if (d.rough) p.push('rough');
  p.push(d.desc);
  if (d.hi != null || d.lo != null) p.push(`high ${d.hi ?? 'unknown'}, low ${d.lo ?? 'unknown'}`);
  p.push(d.windMax != null ? `wind to ${d.windMax} knots${d.wdir !== '—' ? ' from ' + d.wdir : ''}` : 'wind unknown');
  p.push(d.waveFt != null ? `waves ${d.waveFt.toFixed(1)} feet` : 'waves unknown');
  if (d.pop != null) p.push(`${d.pop}% chance of rain`);
  return p.join(', ');
}

function DaySummary({ d, stale }: { d: WxDay; stale: boolean }) {
  return (
    <span className={'wx-day' + (d.rough ? ' wx-day--rough' : '')} aria-label={daySummaryLabel(d)}>
      <span className="wx-day__when" aria-hidden>
        <span className="wx-day__wd">
          {d.wd}
          {d.longRange && <span className="wx-day__lr" title={`${d.dayOut} days out — long-range model, low confidence`}>~</span>}
          {d.rough && <Icon name="alert" size={14} className="wx-day__rough" />}
        </span>
        <span className="wx-day__md">{d.md2}</span>
      </span>
      <span aria-hidden><Icon name={d.icon as IconName} size={22} className="wx-day__sky" /></span>
      <span className="wx-day__temp" aria-hidden>
        <Num size="row" value={d.hi} deg="°" stale={stale} />
        <span className="wx-day__slash">/</span>
        <span className="wx-day__lo"><Num size="row" value={d.lo} deg="°" stale={stale} /></span>
      </span>
      <span className="wx-day__stack wx-day__wind" aria-hidden>
        <Num size="row" value={d.windMax} unit="kn" stale={stale} />
        <span className="wx-day__cap">{d.wdir !== '—' ? d.wdir : ' '}</span>
      </span>
      <span className="wx-day__stack wx-day__wave" aria-hidden>
        <Num size="row" value={d.waveFt} digits={1} unit="ft" stale={stale} />
        <span className="wx-day__cap">waves</span>
      </span>
      <span className="wx-day__stack" aria-hidden>
        <Num size="row" value={d.pop} unit="%" className="wx-pct" stale={stale} />
        <span className="wx-day__cap">chance</span>
      </span>
    </span>
  );
}

function DayDetail({ d, stale }: { d: WxDay; stale: boolean }) {
  const items: Array<{ k: ReactNode; v: ReactNode; key: string }> = [
    { key: 'sky', k: 'Sky', v: <>{d.desc}{d.uv != null && <> · UV <Num size="row" value={d.uv} /></>}</> },
    { key: 'sun', k: 'Sunrise / sunset', v: d.sunrise && d.sunset ? `${d.sunrise} – ${d.sunset}` : '—' },
    {
      key: 'wind', k: 'Wind',
      v: <>to <Num size="row" value={d.windMax} unit="kn" />, gusts <Num size="row" value={d.gust} unit="kn" />{d.wdir !== '—' && <>, from {d.wdir}</>}</>,
    },
    {
      key: 'waves', k: 'Waves',
      v: d.waveFt == null ? '—' : <><Num size="row" value={d.waveFt} digits={1} unit="ft" />{d.wavePer != null && <> @ {d.wavePer}s</>}{d.waveDir && <> {d.waveDir}</>}</>,
    },
  ];
  if (d.swellFt != null) {
    items.push({ key: 'swell', k: 'Swell', v: <><Num size="row" value={d.swellFt} digits={1} unit="ft" />{d.swellPer != null && <> @ {d.swellPer}s</>}</> });
  }
  items.push({
    key: 'rain', k: 'Rain',
    v: d.pop == null ? '—' : <><Num size="row" value={d.pop} unit="%" className="wx-pct" /> chance{d.rainSum ? <> · <Num size="row" value={d.rainSum} digits={2} unit="in" /></> : null}</>,
  });
  if (d.sst != null) items.push({ key: 'water', k: 'Water', v: <Num size="row" value={d.sst} deg="°F" /> });

  return (
    <div className="wx-daydet">
      <KeyValues items={items} />
      {d.longRange && <Notice icon="info">{longRangeNote(d.dayOut)}</Notice>}
      {d.strip.length > 0 && (
        <Section label="Every 3 hours" className="wx-daydet__strip">
          <HourStrip hours={d.strip} label={`${d.wd} ${d.md2}, every 3 hours`} stale={stale} />
        </Section>
      )}
    </div>
  );
}
