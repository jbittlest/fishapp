/* Tap-to-inspect card: chart depth, wind, swell and water temperature at any tapped point,
 * each filling in independently (engine/inspect.js → inspectStore). Offline it says
 * "needs internet" straight away instead of spinning.
 *
 * Layout: the four readings sit in a 2×2 instrument grid (value, then a detail line) so the
 * whole card — readings, the honesty note and the actions — fits a phone without the body
 * scrolling; the three actions are one toolbar row (icon over label). */
import type { ReactNode } from 'react';
import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';
import { Button, DirectionDial, Num, Spinner, useStoreValue } from '../../ui';
import { useUi } from '../../services/ui';
import { formatCoord } from '../../engine/gps.js';
import { compass } from '../../engine/weather.js';
import { depthInfo, inspectAreaForecast, inspectAt, inspectNavigate, inspectSaveSpot, inspectStore } from '../../engine/inspect.js';
import { OPEN_METEO_CREDIT, OPEN_METEO_URL } from '../../engine/datasources.js';
import { CreditLink } from './DataCredit';
import './weather.css';

type Reading = unknown;

/** The shared non-value states, in the legacy wording. */
function pending(v: Reading, nodata: string): ReactNode | null {
  if (v === 'loading') return <Spinner size="sm" label="Loading" />;
  if (v === 'offline') return <span className="wx-ins__muted">needs internet</span>;
  if (v === 'nodata') return <span className="wx-ins__muted">{nodata}</span>;
  if (v === 'error' || v == null) return <span className="wx-ins__muted">unavailable</span>;
  return null;
}

/** One cell of the grid: caps label, the value (+ an optional dial), a detail line. */
function Cell({ label, children, dial, detail }: { label: string; children: ReactNode; dial?: ReactNode; detail?: ReactNode }) {
  return (
    <div className="wx-ins__cell">
      <span className="ui-label wx-ins__lbl">{label}</span>
      <span className="wx-ins__v">
        <span className="wx-ins__main">{children}</span>
        {dial}
      </span>
      {detail && <span className="wx-ins__alt">{detail}</span>}
    </div>
  );
}

function Depth({ v }: { v: Reading }) {
  const p = pending(v, 'no survey data here');
  if (p) return <Cell label="Chart depth">{p}</Cell>;
  const d = depthInfo(v as number);
  if (!d) return <Cell label="Chart depth"><span className="wx-ins__muted">unavailable</span></Cell>;
  if (d.land) return <Cell label="Chart depth"><span className="wx-ins__muted">land ({d.aboveFt} ft above sea)</span></Cell>;
  return (
    <Cell label="Chart depth" detail={<>{d.m!.toFixed(1)} m · {d.fathoms!.toFixed(1)} fathoms</>}>
      <Num size="s" value={d.ft} digits={d.ft! < 100 ? 1 : 0} unit="ft" />
    </Cell>
  );
}

function Wind({ v }: { v: Reading }) {
  const w = v as Record<string, number | null> | null;
  const p = pending(v, 'unavailable');
  if (p) return <Cell label="Wind">{p}</Cell>;
  if (!w || typeof w !== 'object' || w.wind_speed_10m == null) return <Cell label="Wind"><span className="wx-ins__muted">unavailable</span></Cell>;
  const from = w.wind_direction_10m;
  const ok = from != null && Number.isFinite(from);
  return (
    <Cell label="Wind"
      dial={ok ? <DirectionDial size={26} towardDeg={(from! + 180) % 360} label={'Wind from ' + compass(from)} /> : undefined}
      detail={<>{ok ? 'from ' + compass(from) + ' · ' : ''}gust <Num size="row" value={w.wind_gusts_10m} unit="kn" /></>}>
      <Num size="s" value={w.wind_speed_10m} unit="kn" />
    </Cell>
  );
}

function Swell({ v }: { v: Reading }) {
  const s = v as Record<string, number | null> | null;
  const p = pending(v, 'no marine data (inland?)');
  if (p) return <Cell label="Swell">{p}</Cell>;
  const h = s && typeof s === 'object' ? s.swell_wave_height : null;
  if (h == null || !Number.isFinite(h)) return <Cell label="Swell"><span className="wx-ins__muted">unavailable</span></Cell>;
  const per = s!.swell_wave_period, dir = s!.swell_wave_direction;
  const extra = [per != null && Number.isFinite(per) ? `@ ${Math.round(per)}s` : '', dir != null && Number.isFinite(dir) ? 'from ' + compass(dir) : '']
    .filter(Boolean).join(' ');
  return (
    <Cell label="Swell" detail={extra || undefined}>
      <Num size="s" value={h * 3.28084} digits={1} unit="ft" />
    </Cell>
  );
}

function Water({ v }: { v: Reading }) {
  const p = pending(v, 'no data');
  if (p) return <Cell label="Water">{p}</Cell>;
  return (
    <Cell label="Water" detail="sea surface">
      <Num size="s" value={typeof v === 'number' ? v : null} digits={1} deg="°F" />
    </Cell>
  );
}

export default function InspectCard({ data }: CardProps) {
  const reqId = useStoreValue(inspectStore, (s) => s.reqId);
  const sLat = useStoreValue(inspectStore, (s) => s.lat);
  const sLng = useStoreValue(inspectStore, (s) => s.lng);
  const distNm = useStoreValue(inspectStore, (s) => s.distNm);
  const brgDeg = useStoreValue(inspectStore, (s) => s.brgDeg);
  const r = useStoreValue(inspectStore, (s) => s.results);
  const online = useUi((s) => s.online);

  const lat: number = sLat ?? data?.lat;
  const lng: number = sLng ?? data?.lng;
  if (lat == null || lng == null) return <MapCard eyebrow="Tap to inspect" title="No point selected" />;
  const current = data?.reqId == null || data.reqId === reqId;
  const vals = Object.values(r);
  const canRetry = online && vals.some((x) => x === 'offline' || x === 'error');
  // A newer tap is still on its way: keep the grid's shape and spin every cell.
  const res = current ? r : { depth: 'loading', wind: 'loading', swell: 'loading', sst: 'loading' };

  const subtitle = distNm != null
    ? <><Num size="row" value={distNm} digits={2} unit="nm" /> · <Num size="row" value={brgDeg} deg="°T" /> from you</>
    : 'Distance from you needs a GPS fix';

  return (
    <MapCard title={formatCoord(lat, 'lat') + '  ' + formatCoord(lng, 'lon')}
      subtitle={subtitle}
      actions={
        <div className="wx-ins__acts">
          <Button icon="calendar" aria-label="10-day forecast for this area" onClick={inspectAreaForecast}>10-day forecast</Button>
          <Button icon="pin-plus" onClick={inspectSaveSpot}>Save spot</Button>
          <Button variant="primary" icon="navigation" onClick={() => { void inspectNavigate(); }}>Navigate here</Button>
        </div>
      }>
      <div className="wx-ins" aria-busy={!current || vals.includes('loading') || undefined}>
        <div className="wx-ins__grid">
          <Depth v={res.depth} />
          <Wind v={res.wind} />
          <Swell v={res.swell} />
          <Water v={res.sst} />
        </div>
        <div className="wx-ins__foot">
          <p className="wx-ins__note">
            Chart depth is from survey data, not your sounder. Conditions are model estimates.{' '}
            {/* wind, swell and water temp are Open-Meteo data: its CC BY credit, linked, right here */}
            <CreditLink href={OPEN_METEO_URL}>{OPEN_METEO_CREDIT}</CreditLink>
          </p>
          {canRetry && (
            <Button variant="ghost" compact icon="refresh" className="wx-ins__retry" onClick={() => inspectAt({ lat, lng })}>Retry</Button>
          )}
        </div>
      </div>
    </MapCard>
  );
}
