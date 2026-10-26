/* Full-screen anchor alarm (z 900). Up whenever engine/nav.js has an alarm sounding — a drag
 * alarm or the "blind" alarm when GPS has gone quiet during a watch. The beeping, vibration,
 * haptics, notification and re-arming all live in the engine; this only shows it and offers
 * Silence, which is a 5-minute snooze (never a latch). Flashes for everyone (.keep-motion)
 * and deliberately overrides night mode. */
import { useEffect, useRef } from 'react';
import { Icon, Num, useStoreValue } from '../../ui';
import { anchorDismissAlarm, navStore } from '../../engine/nav.js';
import { gpsStore } from '../../engine/gps.js';
import { ageText, useNow } from './useNow';
import './nav.css';

export function AnchorAlarm() {
  const visible = useStoreValue(navStore, (s) => s.alarmVisible);
  const blind = useStoreValue(navStore, (s) => s.anchorBlind);
  const distFt = useStoreValue(navStore, (s) => s.alarmDistFt);
  const radiusFt = useStoreValue(navStore, (s) => s.anchorRadiusFt);
  const text = useStoreValue(navStore, (s) => s.alarmText);
  const fixAt = useStoreValue(gpsStore, (s) => s.fixAt);
  const now = useNow(visible && blind ? 1000 : 0);
  const silenceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (visible) silenceRef.current?.focus({ preventScroll: true }); }, [visible]);

  if (!visible) return null;

  return (
    <div className="nav-alarm keep-motion" role="alertdialog" aria-modal="true" aria-labelledby="nav-alarm-title" aria-describedby="nav-alarm-detail">
      <div className="nav-alarm__inner">
        <Icon name="alert" size={44} />
        <h1 id="nav-alarm-title" className="nav-alarm__title">{blind ? 'ANCHOR WATCH BLIND' : 'ANCHOR DRAGGING'}</h1>
        {blind ? (
          <>
            {/* safety copy, word for word (legacy #aa-dist) */}
            <p id="nav-alarm-detail" className="nav-alarm__blind">NO GPS — the anchor watch cannot see you drift</p>
            <p className="nav-alarm__sub">{fixAt > 0 ? 'Last GPS fix ' + ageText(now - fixAt) + ' ago' : 'No GPS fix since the app opened'}</p>
          </>
        ) : (
          <>
            <Num value={distFt} digits={0} unit="ft" size="alarm" proportional />
            <p className="nav-alarm__line">from anchor (limit <Num value={radiusFt} digits={0} unit="ft" size="row" />)</p>
            <span id="nav-alarm-detail" className="sr-only">{text}</span>
          </>
        )}
        <button ref={silenceRef} type="button" className="nav-alarm__silence" onClick={anchorDismissAlarm}>Silence</button>
        <p className="nav-alarm__hint">
          {blind
            ? 'Silence snoozes for 5 minutes — it sounds again if there is still no GPS.'
            : 'Silence snoozes for 5 minutes — it re-arms automatically, or sooner if you keep drifting.'}
        </p>
      </div>
    </div>
  );
}
