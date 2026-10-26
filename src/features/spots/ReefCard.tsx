/* Map card for an artificial reef (replaces the Leaflet popup): name, reef depth and make-up from
 * the bundled CDFW data, then live wind / swell / water / seabed fetched for the reef's position
 * (engine openReefCard → inspect.js queryPointData, results pushed into this card's data). */
import { Button, DirectionDial, KeyValues, Num, Spinner, StatTile, type IconName } from '../../ui';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { useUi } from '../../services/ui';
import { navigateToReef, openReefCard, reefDistBrg, reefLiveView, saveReefAsSpot, type LiveCell, type Reef } from '../../engine/reefs.js';
import { fromText, useFix } from './useFix';
import './spots.css';

function CellValue({ c, render }: { c: LiveCell; render: () => React.ReactNode }) {
  if (c.state === 'loading') return <Spinner size="sm" label="Loading" />;
  if (c.state !== 'ok') return <span className="spot-live__msg">{c.msg}</span>;
  return <>{render()}</>;
}

function LiveTile({ icon, label, c, value, detail, dial }: { icon: IconName; label: string; c: LiveCell; value: () => React.ReactNode; detail?: string; dial?: React.ReactNode }) {
  return (
    <StatTile icon={icon} label={label} dial={c.state === 'ok' ? dial : undefined} detail={c.state === 'ok' ? detail : undefined}>
      <CellValue c={c} render={value} />
    </StatTile>
  );
}

export default function ReefCard({ data }: CardProps) {
  const r = data?.reef as Reef | undefined;
  const fix = useFix();
  const online = useUi((s) => s.online);
  if (!r) return null;

  const live = reefLiveView(data?.live);
  const { wind, swell, water, seabed } = live;
  const { distNm, brgDeg } = reefDistBrg(fix.here, r);
  const canRetry = online && [wind, swell, water, seabed].some((c) => c.state === 'error' || c.state === 'offline');

  const subtitle = distNm != null && brgDeg != null ? (
    <span className="spot-meta">
      <Num value={distNm} digits={2} unit="nm" size="row" stale={!fix.live} /> · <Num value={brgDeg} deg="°T" size="row" stale={!fix.live} /> {fromText(fix)}
    </span>
  ) : 'No GPS fix — distance unknown';

  const facts = [] as Array<{ k: string; v: React.ReactNode; key: string }>;
  if (r.d) facts.push({ key: 'd', k: 'Reef depth', v: <Num value={r.d} unit="ft" size="row" /> });

  return (
    <MapCard eyebrow="Artificial reef" title={r.n} subtitle={subtitle}
      actions={(
        <>
          <Button variant="primary" icon="navigation" onClick={() => { void navigateToReef(r); }}>Navigate</Button>
          <Button icon="pin-plus" onClick={() => saveReefAsSpot(r)}>Save as spot</Button>
        </>
      )}>
      {facts.length > 0 && <KeyValues className="spot-facts" items={facts} />}
      {r.c && <p className="spot-card__notes">{r.c}</p>}

      <div className="spot-live">
        <LiveTile icon="wind" label="Wind" c={wind}
          value={() => <Num value={wind.kn} unit="kn" size="s" />}
          detail={wind.dir + (wind.gustKn != null ? ' · gust ' + wind.gustKn : '')}
          dial={<DirectionDial towardDeg={wind.towardDeg} size={30} label={wind.towardDeg != null ? `wind toward ${Math.round(wind.towardDeg)}°` : undefined} />} />
        <LiveTile icon="waves" label="Swell" c={swell}
          value={() => <Num value={swell.ft} digits={1} unit="ft" size="s" />}
          detail={(swell.periodS != null ? swell.periodS + ' s · ' : '') + (swell.dir ?? '')} />
        <LiveTile icon="thermo" label="Water" c={water}
          value={() => <Num value={water.f} digits={1} deg="°F" size="s" />} />
        <LiveTile icon="anchor" label="Seabed" c={seabed}
          value={() => <Num value={seabed.ft} digits={(seabed.ft ?? 0) < 100 ? 1 : 0} unit="ft" size="s" />}
          detail={seabed.m != null ? `${seabed.m.toFixed(1)} m · ${(seabed.fa ?? 0).toFixed(1)} fa` : undefined} />
      </div>
      {canRetry && (
        <Button className="spot-live__retry" icon="refresh" onClick={() => openReefCard(r)}>Retry live conditions</Button>
      )}
    </MapCard>
  );
}
