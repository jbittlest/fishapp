/* Instrument HUD — top of the persistent layer, never covered by a sheet.
 *
 * Row 1: GPS fix state (shape-coded so it survives night mode and colour blindness), DMM
 *        coordinates (thousandths of a minute — the number you read to the Coast Guard), the
 *        OFFLINE marker and the chart-loading spinner.
 * Row 2: SOG · COG °T · WATER — big condensed tabular numerals.
 *
 * Honesty rules: a value older than 10 s dims and the age is shown; with no fix for 60 s the GPS
 * state turns red and the values blank (a frozen number looks exactly like "not moving"); COG
 * is dimmed below 0.5 kn where GPS course is mostly noise; water temp is satellite SST, so it
 * only shows near the boat and while fresh. */
import { useEffect, useState } from 'react';
import { Num, Spinner, useStoreValue } from '../ui';
import { gpsStore, formatCoord, GPS_STALE_MS } from '../engine/gps.js';
import { conditionsStore } from '../engine/weather.js';
import { layersStore } from '../engine/layers.js';
import { useUi } from '../services/ui';

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function age(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.round(m / 60) + ' h';
}

function distNm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3440.065, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function Hud({ compact }: { compact?: boolean }) {
  const now = useNow(1000);
  const status = useStoreValue(gpsStore, (s) => s.status);
  const quality = useStoreValue(gpsStore, (s) => s.quality);
  const accM = useStoreValue(gpsStore, (s) => s.accM);
  const sog = useStoreValue(gpsStore, (s) => s.sogKn);
  const cog = useStoreValue(gpsStore, (s) => s.cogDeg);
  const lat = useStoreValue(gpsStore, (s) => s.lat);
  const lng = useStoreValue(gpsStore, (s) => s.lng);
  const fixAt = useStoreValue(gpsStore, (s) => s.fixAt);
  const waterF = useStoreValue(conditionsStore, (s) => s.waterF);
  const waterAt = useStoreValue(conditionsStore, (s) => s.at);
  const wLat = useStoreValue(conditionsStore, (s) => s.lat);
  const wLng = useStoreValue(conditionsStore, (s) => s.lng);
  const online = useUi((s) => s.online);
  const tileBusy = useStoreValue(layersStore, (s) => s.tileBusy);

  const fixAge = fixAt ? now - fixAt : Infinity;
  const hasFix = status === 'fix' && fixAt > 0;
  const lost = hasFix && fixAge > GPS_STALE_MS;
  const stale = hasFix && fixAge > 10_000;
  const live = hasFix && !lost;

  let gpsText: string, gpsShape: 'ok' | 'weak' | 'none' | 'alert';
  if (status === 'denied') { gpsText = 'GPS off'; gpsShape = 'alert'; }
  else if (status === 'lost') { gpsText = 'No GPS'; gpsShape = 'alert'; }
  else if (!hasFix) { gpsText = 'GPS searching'; gpsShape = 'none'; }
  else if (lost) { gpsText = 'No fix · ' + age(fixAge); gpsShape = 'alert'; }
  else {
    gpsText = 'GPS ' + (accM != null ? '±' + Math.round(accM) + ' m' : '±?') + (stale ? ' · ' + age(fixAge) : '');
    gpsShape = quality === 'ok' && !stale ? 'ok' : 'weak';
  }

  // Water: satellite SST — only near the boat (≤10 nm) and fresher than 6 h; otherwise a dash.
  const waterOk = waterF != null && waterAt > 0 && now - waterAt < 6 * 3600_000 &&
    (lat == null || wLat == null || wLng == null || distNm(lat, lng!, wLat, wLng) <= 10);

  const sogShown = live ? sog : null;
  const cogShown = live ? cog : null;
  const cogNoisy = sogShown != null && sogShown < 0.5;
  const label = `${gpsText}. Speed ${sogShown != null ? sogShown.toFixed(1) + ' knots' : 'unknown'}. Course ${cogShown != null ? Math.round(cogShown) + ' degrees true' : 'unknown'}.` +
    (waterOk ? ` Water ${Math.round(waterF!)} degrees.` : '');

  return (
    <div className={'shell-hud' + (compact ? ' is-compact' : '')} role="group" aria-label={label}>
      <div className="shell-hud__top">
        <span className={'shell-hud__fix is-' + gpsShape}>
          <span className="shell-hud__dot" aria-hidden />
          <span className="shell-hud__fixtext">{gpsText}</span>
        </span>
        <span className="shell-hud__right">
          {tileBusy && <Spinner size="sm" label="Loading chart tiles" />}
          {!online && <span className="shell-hud__offline">Offline</span>}
          {hasFix && lat != null && lng != null && !compact && (
            <span className={'shell-hud__coords' + (stale ? ' is-stale' : '')}>{formatCoord(lat, 'lat')} {formatCoord(lng, 'lon')}</span>
          )}
        </span>
      </div>
      <div className="shell-hud__cells">
        <div className="shell-hud__cell">
          <span className="ui-label">SOG</span>
          <Num value={sogShown} digits={1} unit="kn" stale={stale} />
        </div>
        <div className="shell-hud__cell">
          <span className="ui-label">COG</span>
          <Num value={cogShown} digits={0} deg="°T" stale={stale || cogNoisy} />
        </div>
        <div className="shell-hud__cell">
          <span className="ui-label">Water</span>
          <Num value={waterOk ? waterF : null} digits={0} deg="°F" />
        </div>
      </div>
    </div>
  );
}
