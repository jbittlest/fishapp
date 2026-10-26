/* Go-To: the card in the bottom stack while navigating, and the compact nav pill that takes
 * its place in the persistent layer when a sheet is open on a phone. Both read gotoStore;
 * every safety decision (arrival hysteresis, waypoint advance, the double-tap guard, the
 * "discard this voyage?" question) stays in engine/goto.js.
 *
 * Honesty (DESIGN §0.7): distance, bearing, ETA and the steer cue are all computed from the
 * last GPS fix. When that fix is more than a minute old, or the GPS feed has failed, they are
 * shown greyed as stale and the steer line says "GPS lost — last fix N ago" instead of
 * "On course" — never as if they were live. */
import { Button, DirectionDial, Icon, Num, useStoreValue } from '../../ui';
import { gotoArrive, gotoCancel, gotoStore } from '../../engine/goto.js';
import { GPS_STALE_MS, gpsStore } from '../../engine/gps.js';
import { closeCard, closePanels } from '../../services/ui';
import { ageText, durWords, useNow } from './useNow';
import './nav.css';

function cap(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function useGoto() {
  return {
    active: useStoreValue(gotoStore, (s) => s.active),
    arriving: useStoreValue(gotoStore, (s) => s.arriving),
    ending: useStoreValue(gotoStore, (s) => s.ending),
    name: useStoreValue(gotoStore, (s) => s.name),
    isRoute: useStoreValue(gotoStore, (s) => s.isRoute),
    wpIndex: useStoreValue(gotoStore, (s) => s.wpIndex),
    wpCount: useStoreValue(gotoStore, (s) => s.wpCount),
    hasFix: useStoreValue(gotoStore, (s) => s.hasFix),
    distNm: useStoreValue(gotoStore, (s) => s.distNm),
    legText: useStoreValue(gotoStore, (s) => s.legText),
    brgDeg: useStoreValue(gotoStore, (s) => s.brgDeg),
    brgCompass: useStoreValue(gotoStore, (s) => s.brgCompass),
    steerDeg: useStoreValue(gotoStore, (s) => s.steerDeg),
    steerText: useStoreValue(gotoStore, (s) => s.steerText),
    etaClock: useStoreValue(gotoStore, (s) => s.etaClock),
    ttgText: useStoreValue(gotoStore, (s) => s.ttgText),
    ttgSec: useStoreValue(gotoStore, (s) => s.ttgSec),
    etaPlanned: useStoreValue(gotoStore, (s) => s.etaPlanned),
    etaSpeedKn: useStoreValue(gotoStore, (s) => s.etaSpeedKn),
  };
}

/** Is the position the Go-To numbers were computed from still live? Ticks while navigating so
 *  "lost" appears without waiting for a fix that may never come. */
function useGpsLive(active: boolean) {
  const status = useStoreValue(gpsStore, (s) => s.status);
  const fixAt = useStoreValue(gpsStore, (s) => s.fixAt);
  const now = useNow(active ? 1000 : 0);
  const age = fixAt > 0 ? Math.max(0, now - fixAt) : null;
  const lost = status === 'lost' || status === 'denied' || age == null || age > GPS_STALE_MS;
  return { lost, age, denied: status === 'denied' };
}

function lostText(age: number | null) {
  return age != null ? 'GPS lost — last fix ' + ageText(age) + ' ago' : 'GPS lost';
}

function distDigits(nm: number | null) { return nm != null && nm >= 100 ? 1 : 2; }

/* Compact card (≈150 px on a phone, DESIGN §0.1): a header row — steer badge, destination and the
   ETA line — over one row of instruments (distance · bearing · steer words), then Arrived / Stop.
   Solid surface: the chart must never show through the numbers. */
export function GoToCard() {
  const g = useGoto();
  const gps = useGpsLive(g.active);
  if (!g.active) return null;

  const stale = g.hasFix && gps.lost;
  /* The ETA line under the name. Planned-speed ETAs say so (honesty: an estimate, not live SOG). */
  const etaLine = g.etaClock
    ? <><span className="nav-goto__eta">ETA <b>{g.etaClock}</b></span>{' · '}<span className="nav-goto__nb">{durWords(g.ttgSec, g.ttgText)}</span>{g.etaPlanned && g.etaSpeedKn ? <>{' · '}<span className="nav-goto__nb">{Math.round(g.etaSpeedKn) + ' kn planned'}</span></> : null}</>
    : <>ETA — set a cruise speed in Nav tools</>;
  const sub = !g.hasFix
    ? <span className="is-muted">{gps.denied ? 'GPS off — allow location access to navigate' : 'Waiting for GPS'}</span>
    : stale ? <span className="is-alert">{lostText(gps.age)}</span>
    : g.arriving ? <><span className="nav-goto__arriving">Arriving</span> — tap Arrived to log it</>
    : etaLine;
  const steer = !g.hasFix ? { text: 'No fix', muted: true }
    : stale ? { text: 'from last fix', muted: true }
    : g.steerText ? { text: cap(g.steerText), muted: false }
    : { text: 'No heading', muted: true };
  const label = `Navigating to ${g.name}. ` +
    (stale ? lostText(gps.age) + '; the figures below are from that last fix. ' : '') +
    (g.distNm != null ? `${g.distNm.toFixed(2)} nautical miles, bearing ${Math.round(g.brgDeg ?? 0)} degrees true. ` : 'Waiting for GPS. ') +
    (g.steerText && !stale ? cap(g.steerText) + '. ' : '') + (g.etaClock ? `ETA ${g.etaClock}.` : '');

  return (
    <section className={'nav-goto' + (g.isRoute ? ' is-route' : '') + (g.arriving ? ' is-arriving' : '') + (stale ? ' is-stale' : '')} aria-label={label}>
      <div className="nav-goto__head">
        <span className={'nav-goto__badge' + (stale ? ' is-alert' : '')} role={stale ? 'status' : undefined}>
          {stale
            ? <Icon name="alert" size={22} />
            : <DirectionDial towardDeg={g.steerDeg} size={34} label={g.steerText || 'steer cue unavailable'} />}
        </span>
        <div className="nav-goto__titles">
          <div className="nav-goto__name">
            {g.name}
            {g.isRoute && g.legText && <span className="nav-goto__leg"> · {g.legText}</span>}
          </div>
          <div className="nav-goto__sub">{sub}</div>
        </div>
      </div>

      <div className="nav-goto__stats">
        <div className="nav-goto__stat">
          <Num value={g.distNm} digits={distDigits(g.distNm)} unit="nm" size="s" stale={stale} />
          {g.isRoute && <span className="nav-goto__qual">total</span>}
        </div>
        <div className="nav-goto__stat">
          <Num value={g.brgDeg} digits={0} deg="°T" size="s" stale={stale} />
          {g.brgCompass && <span className={'nav-goto__compass' + (stale ? ' is-stale' : '')}>{g.brgCompass}</span>}
        </div>
        <div className={'nav-goto__stat nav-goto__steer' + (steer.muted ? ' is-muted' : '')}>{steer.text}</div>
      </div>

      {/* Arrived always lives in the same place — it only gains emphasis while arriving, so it
          never jumps under a wet thumb as the arrival state changes. Stop is outlined, Arrived
          filled: different shapes as well as words, 12 px apart. */}
      <div className="nav-goto__actions">
        <Button icon="check" variant={g.arriving ? 'primary' : 'secondary'}
          className={'nav-goto__arrive' + (g.arriving ? ' is-arriving keep-motion' : '')}
          onClick={() => { gotoArrive(); }} disabled={g.ending} aria-label="Arrived — save this voyage">Arrived</Button>
        <Button icon="x" variant="ghost" onClick={() => { gotoCancel(); }} disabled={g.ending} aria-label="Stop navigating">Stop</Button>
      </div>
    </section>
  );
}

/** Persistent-layer stand-in for the card while a sheet covers the bottom of a phone screen.
 *  Glanceable only — no Stop here, so a stray tap can't end a voyage; tapping it closes the
 *  sheet to bring the full card back. */
export function NavPill() {
  const g = useGoto();
  const gps = useGpsLive(g.active);
  if (!g.active) return null;
  const stale = g.hasFix && gps.lost;
  const label = `Navigating to ${g.name}` + (stale ? `, ${lostText(gps.age)}` : '') +
    (g.distNm != null ? `, ${g.distNm.toFixed(2)} nautical miles` + (stale ? ' at the last fix' : '') : ', waiting for GPS') +
    (g.steerText && !stale ? `, ${g.steerText}` : '') + '. Tap to show the Go-To card.';
  return (
    <button type="button" className={'nav-pill' + (g.arriving ? ' is-arriving keep-motion' : '') + (stale ? ' is-stale' : '')} onClick={() => { closePanels(); closeCard(); }} aria-label={label}>
      <Icon name="navigation" size={18} filled />
      <span className="nav-pill__name">{stale ? 'GPS lost · ' + g.name : g.arriving ? 'Arriving · ' + g.name : g.name}</span>
      <span className="nav-pill__dist">
        <Num value={g.distNm} digits={distDigits(g.distNm)} unit="nm" size="row" stale={stale} />
        {g.isRoute && <span className="nav-goto__qual">total</span>}
      </span>
      <Num value={g.brgDeg} digits={0} deg="°T" size="row" stale={stale} />
      {stale
        ? <span className="nav-pill__alert"><Icon name="alert" size={20} /></span>
        : <DirectionDial towardDeg={g.steerDeg} size={24} label={g.steerText || 'steer cue unavailable'} />}
    </button>
  );
}
