/* Map legends — the SST colour legend and the rain / wind loop scrubbers.
 *
 * Positioned by the shell's measured geometry: bottom-left, just above the bottom stack
 * (--chrome-bottom covers the zoom keys, the Go-To card and the tab bar, so nothing here can
 * sit on top of them), shifted right of the side panel on desktop. Each piece only renders
 * while its overlay is on. All timers and layers live in the engine (sst.js, rain.js,
 * weather.js); these controls only call into it. */
import { useState, type ReactNode } from 'react';
import { Button, Icon, IconButton, Num, Select, Spinner, useIsDesktop, useStoreValue, type IconName } from '../../ui';
import { useUi } from '../../services/ui';
import { SST_PALETTES, SST_PALETTE_BAR, SST_PALETTE_LABELS, sstSetPalette, sstStore, sstTogglePlay } from '../../engine/sst.js';
import { rainScrub, rainStore, rainTogglePlay } from '../../engine/rain.js';
import { WIND_LOOP_HOURS, windLoopToggle, windScrub, wxStore } from '../../engine/weather.js';
import './weather.css';

export function MapLegends() {
  const sstOn = useStoreValue(sstStore, (s) => s.on);
  const rainOn = useStoreValue(rainStore, (s) => s.on);
  const windOn = useStoreValue(wxStore, (s) => s.wind.on);
  const sheetOpen = useUi((s) => !!s.panel);
  const desktop = useIsDesktop();
  if (!sstOn && !rainOn && !windOn) return null;
  /* Same rule as the bottom stack (App.tsx hides the Go-To card): on a phone an open sheet owns
     the bottom of the screen. The legends sit above the bottom stack, which shrinks when the
     sheet opens, so a tall stack (SST + rain + wind) stuck out above a medium sheet on short
     phones as a clipped sliver. They come back as soon as the sheet closes (hidden, not
     unmounted, so a legend the user collapsed stays collapsed). */
  const hidden = sheetOpen && !desktop;
  return (
    <div className={'wx-legends' + (hidden ? ' is-hidden' : '')}>
      {sstOn && <SstLegend />}
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

function SstLegend() {
  const palette = useStoreValue(sstStore, (s) => s.palette);
  const shownPalette = useStoreValue(sstStore, (s) => s.shownPalette);
  const rangeF = useStoreValue(sstStore, (s) => s.rangeF);
  const date = useStoreValue(sstStore, (s) => s.date);
  const loading = useStoreValue(sstStore, (s) => s.loading);
  const playing = useStoreValue(sstStore, (s) => s.playing);
  const loadingLoop = useStoreValue(sstStore, (s) => s.loadingLoop);
  const online = useUi((s) => s.online);
  const [collapsed, setCollapsed] = useState(false);
  // The gradient is DATA: it must match the palette baked into the image on screen.
  const bar = SST_PALETTE_BAR[shownPalette as keyof typeof SST_PALETTE_BAR] || SST_PALETTE_BAR.Rainbow;

  if (collapsed) {
    return (
      <button type="button" className="wx-sst__chip" onClick={() => setCollapsed(false)}
        aria-label={'Water temperature legend' + (rangeF ? `, ${rangeF[0]} to ${rangeF[1]} degrees` : '') + '. Tap to expand.'}>
        <span className="wx-sst__chipbar" style={{ background: bar }} aria-hidden />
        {rangeF ? <><Num size="row" value={rangeF[0]} deg="°" />–<Num size="row" value={rangeF[1]} deg="°F" /></> : 'Water temp'}
        <Icon name="chevron-up" size={16} />
      </button>
    );
  }

  const label = loadingLoop ? 'Loading loop…' : playing ? 'Pause' : 'Play 5-day loop';
  return (
    <section className="wx-sst" aria-label="Water temperature legend">
      <div className="wx-sst__head">
        <div className="wx-sst__titles">
          <span className="ui-label">Water temp</span>
          <span className="wx-sst__date">{date ? sstDateText(date) : loading ? 'Loading…' : ''}</span>
        </div>
        {loading && <Spinner size="sm" label="Loading water temperature" />}
        <IconButton icon="chevron-down" label="Collapse the legend" size="sm" tone="plain" onClick={() => setCollapsed(true)} />
      </div>
      <div className="wx-sst__bar" style={{ background: bar }} aria-hidden />
      <div className="wx-sst__ends">
        {rangeF
          ? <><Num size="row" value={rangeF[0]} deg="°F" /><Num size="row" value={rangeF[1]} deg="°F" /></>
          : <><span className="wx-sst__ends-words">cooler</span><span className="wx-sst__ends-words">warmer</span></>}
      </div>
      <Select value={palette} aria-label="Colour scale" onChange={(e) => sstSetPalette(e.target.value)}>
        {SST_PALETTES.map((p) => <option key={p} value={p}>{SST_PALETTE_LABELS[p as keyof typeof SST_PALETTE_LABELS]}</option>)}
      </Select>
      {/* Tappable while the first image loads too: the engine queues the loop until the colour
          range is known (sstPlay), and the button says "Loading loop…" meanwhile. */}
      <Button compact block className="wx-hit44" icon={loadingLoop ? undefined : playing ? 'pause' : 'play'}
        disabled={!online && !playing} onClick={sstTogglePlay}
        aria-label={loadingLoop ? 'Loading the 5-day loop — tap to stop' : undefined}>
        {loadingLoop ? <><Spinner size="sm" /> {label}</> : label}
      </Button>
      <p className="wx-sst__note">{online ? 'Tap anywhere for exact °F' : 'Needs internet — tap anywhere for exact °F once online'}</p>
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
  return (
    <div className="wx-loop" role="group" aria-label={name + ' timeline'}>
      <span className="wx-loop__icon" aria-hidden><Icon name={icon} size={18} /></span>
      <IconButton icon={playing ? 'pause' : 'play'} size="sm" label={(playing ? 'Pause the ' : 'Play the ') + name.toLowerCase() + ' loop'}
        disabled={!playing && !canPlay} onClick={onToggle} />
      <input type="range" className="wx-loop__scrub" min={0} max={Math.max(0, max)} step={1} value={Math.min(value, Math.max(0, max))}
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
      <div className="wx-loop" role="status">
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
