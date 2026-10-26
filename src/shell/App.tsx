/* AppShell — the layers of the screen, bottom to top (z scale in tokens.css):
 *   chart (#map, outside React)  → top scrim → map chrome (controls, zoom, legends, Go-To card)
 *   → map card → sheet → tab bar / rail → PERSISTENT layer (HUD, nav pill / watch bands, SOS)
 *   → modals → dialogs → toast → alarm.
 * #root itself ignores pointer events so the chart stays draggable between pieces of chrome;
 * every interactive block opts back in (shell.css). */
import { useLayoutEffect, useRef, useState } from 'react';
import { useIsDesktop, useStoreValue, DialogHost, ToastHost } from '../ui';
import { useUi } from '../services/ui';
import { isNativeShell } from '../services/native';
import { gotoStore } from '../engine/goto.js';
import { Hud } from './Hud';
import { SosButton, MapControls, ZoomControls, TabBar } from './Chrome';
import { SheetHost, CardHost, ModalHost } from './Hosts';
import { Onboarding } from './Onboarding';
import { GoToCard, NavPill } from '../features/nav/GoToCard';
import { WatchBand } from '../features/nav/WatchBand';
import { AnchorAlarm } from '../features/nav/AnchorAlarm';
import { MotorBand } from '../features/motor/MotorBand';
import { MapLegends } from '../features/weather/MapLegends';

/** Publish live geometry as CSS variables so sheets stop under the persistent layer, toasts and
 *  attribution sit above the bottom chrome, and everything clears the on-screen keyboard. */
function useLayoutVars(persistRef: React.RefObject<HTMLDivElement | null>, bottomRef: React.RefObject<HTMLDivElement | null>, desktop: boolean) {
  const [kbOpen, setKbOpen] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const setPersist = () => { const el = persistRef.current; if (el) root.setProperty('--persist-bottom', Math.round(el.getBoundingClientRect().bottom) + 'px'); };
    const setBottom = () => {
      const el = bottomRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      root.setProperty('--chrome-bottom', Math.max(0, Math.round(window.innerHeight - top)) + 'px');
      root.setProperty('--tab-clear', desktop ? '0px' : Math.max(0, Math.round(window.innerHeight - top)) + 'px');
    };
    root.setProperty('--rail-w', desktop ? '76px' : '0px');
    const ro = new ResizeObserver(() => { setPersist(); setBottom(); });
    if (persistRef.current) ro.observe(persistRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    const vv = window.visualViewport;
    const onVV = () => {
      /* iOS keeps position:fixed elements on the layout viewport, so the keyboard simply covers
         them. Measure how much it covers and lift sheets/modals/toasts by that much. */
      const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      root.setProperty('--kb', kb + 'px');
      setKbOpen(kb > 80);
      setPersist(); setBottom();
    };
    window.addEventListener('resize', onVV);
    vv?.addEventListener('resize', onVV);
    vv?.addEventListener('scroll', onVV);
    onVV();
    return () => { ro.disconnect(); window.removeEventListener('resize', onVV); vv?.removeEventListener('resize', onVV); vv?.removeEventListener('scroll', onVV); };
  }, [persistRef, bottomRef, desktop]);
  return kbOpen;
}

export function App() {
  const desktop = useIsDesktop();
  const panel = useUi((s) => s.panel);
  const card = useUi((s) => s.card);
  const gotoActive = useStoreValue(gotoStore, (s) => !!s.active);
  const persistRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const kbOpen = useLayoutVars(persistRef, bottomRef, desktop);
  const short = typeof window !== 'undefined' && window.innerHeight < 640;
  const sheetOpen = !!panel;
  // With a sheet (phone) or a map card open, the Go-To card is covered or hidden, so the glanceable
  // nav pill keeps distance, bearing, ETA and the steer cue on screen in the persistent layer.
  const showPill = gotoActive && ((sheetOpen && !desktop) || !!card);

  return (
    <div className={'shell' + (desktop ? ' is-desktop' : ' is-phone') + (sheetOpen ? ' has-sheet' : '') + (card ? ' has-card' : '') + (isNativeShell() ? ' is-native' : '')}>
      <div className="shell-scrim" aria-hidden />

      {/* map chrome */}
      <div className="shell-right">
        <MapControls />
      </div>
      <MapLegends />

      {/* bottom stack: zoom + Go-To card + tab bar (measured for --chrome-bottom) */}
      <div className="shell-bottom" ref={bottomRef}>
        {(!sheetOpen || desktop) && (
          <div className="shell-bottom__row">
            <div className="shell-bottom__main">{gotoActive && !card && <GoToCard />}</div>
            <ZoomControls />
          </div>
        )}
        {!desktop && !kbOpen && <TabBar />}
      </div>
      {desktop && <TabBar />}

      <CardHost />
      <SheetHost />

      {/* persistent layer: never covered by a sheet */}
      <div className="shell-persist" ref={persistRef}>
        <div className="shell-persist__row">
          <Hud compact={kbOpen || short} />
          <SosButton />
        </div>
        <div className="shell-persist__bands">
          {showPill && <NavPill />}
          <WatchBand />
          <MotorBand />
        </div>
      </div>

      <ModalHost />
      <DialogHost />
      <ToastHost />
      <AnchorAlarm />
      <Onboarding />
    </div>
  );
}
