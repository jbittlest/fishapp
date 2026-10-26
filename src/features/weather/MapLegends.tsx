/* Map legends — the SST colour legend and the rain / wind loop scrubbers.
 *
 * One column of equal-width cards, bottom-left, just above the bottom stack (--chrome-bottom
 * covers the zoom keys, the Go-To card and the tab bar, so nothing here can sit on top of them),
 * shifted right of the side panel on desktop. On a phone the column also keeps clear of the
 * right-hand control column (layers / follow / zoom), and when the full stack would reach up
 * under the HUD (a Go-To card in the bottom stack, a short screen) the SST legend folds to its
 * chip on its own. Each piece only renders while its overlay is on. All timers and layers live
 * in the engine (sst.js, rain.js, weather.js); these controls only call into it. */
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Icon, IconButton, Num, Select, Spinner, useIsDesktop, useStoreValue, type IconName } from '../../ui';
import { useUi } from '../../services/ui';
import { useTheme } from '../../services/theme';
import { SST_PALETTES, SST_PALETTE_BAR, SST_PALETTE_LABELS, sstSetPalette, sstStore, sstTogglePlay } from '../../engine/sst.js';
import { rainScrub, rainStore, rainTogglePlay } from '../../engine/rain.js';
import { WIND_LOOP_HOURS, windLoopToggle, windScrub, wxStore } from '../../engine/weather.js';
import './weather.css';

/* Clearances (px) the column keeps: above the bottom stack (the attribution line sits there) and
   below the persistent layer (HUD / nav pill / watch bands). Mirrors weather.css. */
const GAP_BOTTOM = 22;
const GAP_TOP = 10;

/** Height the legend column may use: between the persistent layer and the bottom stack. The shell
 *  publishes both edges as CSS variables on <html> (App.tsx useLayoutVars) — follow them live. */
function useAvailHeight(): number {
  const [avail, setAvail] = useState(Infinity);
  useLayoutEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const top = parseFloat(cs.getPropertyValue('--persist-bottom')) || 0;
      const chrome = parseFloat(cs.getPropertyValue('--chrome-bottom')) || 0;
      const card = parseFloat(cs.getPropertyValue('--card-clear')) || 0;   // desktop: legends sit above an open map card
      const bottom = Math.max(chrome, card);
      setAvail(Math.round(window.innerHeight - top - bottom - GAP_BOTTOM - GAP_TOP));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', read);
    return () => { mo.disconnect(); window.removeEventListener('resize', read); };
  }, []);
  return avail;
}

type SstMode = 'auto' | 'open' | 'closed';

export function MapLegends() {
  const sstOn = useStoreValue(sstStore, (s) => s.on);
  const rainOn = useStoreValue(rainStore, (s) => s.on);
  const windOn = useStoreValue(wxStore, (s) => s.wind.on);
  const sheetOpen = useUi((s) => !!s.panel);
  const cardOpen = useUi((s) => !!s.card);
  const desktop = useIsDesktop();
  const avail = useAvailHeight();
  const ref = useRef<HTMLDivElement>(null);
  // 'auto' folds the SST legend to its chip only when the column is short of room; a tap on the
  // chevron / chip is the user's own choice and sticks (hidden, not unmounted, so it survives).
  const [sstMode, setSstMode] = useState<SstMode>('auto');
  const [tight, setTight] = useState(false);
  const sstFullH = useRef(0);

  /* What the column would need with the SST legend open: its current height, minus the SST piece
     as drawn now, plus the open legend's last measured height (an estimate until it has been
     drawn open once). Re-measured whenever the column resizes or the room changes. */
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || !el.offsetHeight) return;
    const sst = el.querySelector<HTMLElement>('[data-sst]');
    const cur = sst?.offsetHeight ?? 0;
    if (sst?.dataset.sst === 'open') sstFullH.current = cur;
    const need = sst ? el.offsetHeight - cur + (sstFullH.current || 150) : el.offsetHeight;
    setTight(need > avail);
  }, [avail]);
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, sstOn, rainOn, windOn]);

  if (!sstOn && !rainOn && !windOn) return null;
  /* Same rule as the bottom stack (App.tsx hides the Go-To card): on a phone an open sheet owns
     the bottom of the screen, and so does a map card (it docks right where the column sits).
     The legends come back as soon as it closes (hidden, not unmounted). */
  const hidden = !desktop && (sheetOpen || cardOpen);
  const sstChip = sstMode === 'closed' || (sstMode === 'auto' && tight);
  return (
    <div ref={ref} className={'wx-legends' + (hidden ? ' is-hidden' : '')}>
      {sstOn && <SstLegend chip={sstChip} onCollapse={() => setSstMode('closed')} onExpand={() => setSstMode('open')} />}
      {rainOn && <RainBar />}
      {windOn && <WindBar />}
    </div>
  );
}

/* ------------------------------------------------------------------- SST */
/** ERDDAP day "2026-10-23" → "Oct 23 · 2 days old" (MUR runs ~2 days behind; say so). */
function sstDateText(date: string): string {
  if (!date) return '';
  const t = Date.parse(date + 'T12:00:00Z');
  if (!Number.isFinite(t)) return date;
  const md = new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const days = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  return md + ' · ' + (days === 0 ? 'today' : days === 1 ? '1 day old' : days + ' days old');
}

function SstLegend({ chip, onCollapse, onExpand }: { chip: boolean; onCollapse: () => void; onExpand: () => void }) {
  const palette = useStoreValue(sstStore, (s) => s.palette);
  const shownPalette = useStoreValue(sstStore, (s) => s.shownPalette);
  const rangeF = useStoreValue(sstStore, (s) => s.rangeF);
  const date = useStoreValue(sstStore, (s) => s.date);
  const loading = useStoreValue(sstStore, (s) => s.loading);
  const playing = useStoreValue(sstStore, (s) => s.playing);
  const loadingLoop = useStoreValue(sstStore, (s) => s.loadingLoop);
  const online = useUi((s) => s.online);
  const night = useTheme().theme === 'night';
  // The gradient is DATA: it must match the palette baked into the image on screen.
  const bar = SST_PALETTE_BAR[shownPalette as keyof typeof SST_PALETTE_BAR] || SST_PALETTE_BAR.Rainbow;

  if (chip) {
    return (
      <button type="button" className="wx-sst__chip" data-sst="chip" onClick={onExpand}
        aria-label={'Water temperature legend' + (rangeF ? `, ${rangeF[0]} to ${rangeF[1]} degrees` : '') + '. Tap to expand.'}>
        <span className="wx-sst__chipbar wx-sstbar" style={{ background: bar }} aria-hidden />
        {rangeF
          ? <span className="wx-sst__chiprange"><Num size="row" value={rangeF[0]} deg="°" /><span className="wx-sst__dash">–</span><Num size="row" value={rangeF[1]} deg="°F" /></span>
          : <span>Water temp</span>}
        {playing && <Icon name="play" size={14} className="wx-sst__chipplay" />}
        <Icon name="chevron-up" size={16} className="wx-sst__chipchev" />
      </button>
    );
  }

  const label = loadingLoop ? 'Loading loop…' : playing ? 'Pause' : 'Play 5-day loop';
  return (
    <section className="wx-legend wx-sst" data-sst="open" aria-label="Water temperature legend">
      <div className="wx-sst__head">
        <div className="wx-sst__titles">
          <span className="ui-label">Water temp</span>
          <span className="wx-sst__date">{date ? sstDateText(date) : loading ? 'Loading…' : ''}</span>
        </div>
        {loading && <Spinner size="sm" label="Loading water temperature" />}
        <IconButton icon="chevron-down" label="Collapse the legend" size="sm" tone="plain" onClick={onCollapse} />
      </div>
      <div className="wx-sst__scale">
        {rangeF ? <Num size="row" value={rangeF[0]} deg="°F" /> : <span className="wx-sst__ends-words">cooler</span>}
        <span className="wx-sst__bar wx-sstbar" style={{ background: bar }} aria-hidden />
        {rangeF ? <Num size="row" value={rangeF[1]} deg="°F" /> : <span className="wx-sst__ends-words">warmer</span>}
      </div>
      <div className="wx-sst__foot">
        <span className="wx-sst__pal">
          <Select value={palette} aria-label="Colour scale" onChange={(e) => sstSetPalette(e.target.value)}>
            {SST_PALETTES.map((p) => <option key={p} value={p}>{SST_PALETTE_LABELS[p as keyof typeof SST_PALETTE_LABELS]}</option>)}
          </Select>
        </span>
        {/* Tappable while the first image loads too: the engine queues the loop until the colour
            range is known (sstPlay), and the button says "Loading loop…" meanwhile. */}
        <Button compact className="wx-sst__play" icon={loadingLoop ? undefined : playing ? 'pause' : 'play'}
          disabled={!online && !playing} onClick={sstTogglePlay}
          aria-label={loadingLoop ? 'Loading the 5-day loop — tap to stop' : undefined}>
          {loadingLoop ? <><Spinner size="sm" /> {label}</> : label}
        </Button>
      </div>
      <p className="wx-sst__note">
        {/* Night draws the overlay in red light only, by brightness — a hue scale (blue to red,
            rainbow) loses its order there, a brightness scale (Reds, Blues) keeps it. */}
        {night && (shownPalette === 'BlueWhiteRed' || shownPalette === 'Rainbow') && <>Reds or Blues read best at night. </>}
        {online ? 'Tap anywhere for exact °F' : 'Needs internet — tap anywhere for exact °F once online'}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ loop scrubbers */
interface LoopBarProps {
  icon: IconName;
  name: string;
  playing: boolean;
  canPlay: boolean;
  onToggle: () => void;
  max: number;
  value: number;
  onScrub: (v: string) => void;
  time: ReactNode;
  valueText: string;
  busy?: boolean;
}

function LoopBar({ icon, name, playing, canPlay, onToggle, max, value, onScrub, time, valueText, busy }: LoopBarProps) {
  const top = Math.max(0, max);
  const v = Math.min(value, top);
  const pct = top > 0 ? (v / top) * 100 : 0;
  return (
    <div className={'wx-legend wx-loop' + (playing ? ' is-playing' : '')} role="group" aria-label={name + ' timeline'}>
      <span className="wx-loop__icon" aria-hidden><Icon name={icon} size={18} /></span>
      <IconButton icon={playing ? 'pause' : 'play'} size="sm" tone={playing ? 'signal' : 'default'}
        label={(playing ? 'Pause the ' : 'Play the ') + name.toLowerCase() + ' loop'}
        disabled={!playing && !canPlay} onClick={onToggle} />
      <input type="range" className="wx-loop__scrub" min={0} max={top} step={1} value={v}
        style={{ '--pct': pct.toFixed(1) + '%' } as CSSProperties}
        disabled={max <= 0} aria-label={name + ' time'} aria-valuetext={valueText}
        onChange={(e) => onScrub(e.target.value)} />
      <span className="wx-loop__time" aria-live="off">{busy ? <Spinner size="sm" label={'Loading ' + name.toLowerCase()} /> : time}</span>
    </div>
  );
}

function RainBar() {
  const loading = useStoreValue(rainStore, (s) => s.loading);
  const frameCount = useStoreValue(rainStore, (s) => s.frameCount);
  const idx = useStoreValue(rainStore, (s) => s.idx);
  const playing = useStoreValue(rainStore, (s) => s.playing);
  const timeLabel = useStoreValue(rainStore, (s) => s.timeLabel);
  const isForecast = useStoreValue(rainStore, (s) => s.isForecast);
  const online = useUi((s) => s.online);

  if (loading || frameCount === 0) {
    return (
      <div className="wx-legend wx-loop" role="status">
        <span className="wx-loop__icon" aria-hidden><Icon name="cloud-rain" size={18} /></span>
        {loading
          ? <><Spinner size="sm" /><span className="wx-loop__note">Loading rain radar…</span></>
          : <span className="wx-loop__note">No radar frames available right now</span>}
      </div>
    );
  }
  // Nowcast frames are a forecast, not observed radar — say so ("fcst" in the legacy label).
  const clock = timeLabel.replace(/^fcst /, '');
  return (
    <LoopBar icon="cloud-rain" name="Rain radar" playing={playing} canPlay={online && frameCount >= 2}
      onToggle={rainTogglePlay} max={frameCount - 1} value={idx} onScrub={rainScrub}
      valueText={(isForecast ? 'forecast ' : 'radar ') + clock}
      time={<>{isForecast && <span className="wx-loop__fcst">Fcst</span>}{clock}</>} />
  );
}

function WindBar() {
  const playing = useStoreValue(wxStore, (s) => s.wind.playing);
  const loading = useStoreValue(wxStore, (s) => s.wind.loading);
  const hour = useStoreValue(wxStore, (s) => s.wind.hour);
  const timeLabel = useStoreValue(wxStore, (s) => s.wind.timeLabel);
  const online = useUi((s) => s.online);
  const text = timeLabel || (online ? 'Now' : 'Offline');
  return (
    <LoopBar icon="wind" name="Wind forecast" playing={playing} canPlay={online} busy={loading}
      onToggle={() => { void windLoopToggle(); }} max={WIND_LOOP_HOURS - 1} value={hour}
      onScrub={(v) => { void windScrub(v); }} valueText={timeLabel || 'now'} time={text} />
  );
}
