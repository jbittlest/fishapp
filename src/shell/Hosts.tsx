/* Hosts: render whichever panel / map card / modal the UI store says is open. Each lives in its
 * own error boundary, so a broken feature shows a recoverable message instead of a white app. */
import { Component, Suspense, useCallback, useEffect, useRef, type ReactNode } from 'react';
import L from 'leaflet';
import { LoadingRow, Sheet, StateBox, Modal } from '../ui';
import { modalLayerAbove } from '../ui/Overlays';
import { closeCard, closeModal, closePanels, useUi } from '../services/ui';
import { getMap } from '../engine/app.js';
import { CARDS, MODALS, PANELS, PANEL_TITLES } from './registry';
import { MapCard } from './MapCard';

class Boundary extends Component<{ fallback: (reset: () => void, err: unknown) => ReactNode; resetKey: unknown; children: ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err }; }
  componentDidCatch(err: unknown) { console.error('[ui]', err); }
  componentDidUpdate(prev: { resetKey: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? this.props.fallback(() => this.setState({ err: null }), this.state.err) : this.props.children; }
}

function errText(e: unknown) { return e instanceof Error ? e.message : String(e); }

export function SheetHost() {
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  const P = PANELS[panel];
  if (!P) return null;
  const title = PANEL_TITLES[panel] ?? '';
  return (
    <Boundary resetKey={panel} fallback={(reset, e) => (
      <Sheet title={title}>
        <StateBox icon="alert" tone="alert" onRetry={reset}>
          This section hit a problem. Tap Retry — if it keeps happening, close and reopen FishApp.
          <span className="shell-errtext">{errText(e)}</span>
        </StateBox>
      </Sheet>
    )}>
      {/* keyed per panel: switching panels drops the old sheet at once instead of React keeping it
          mounted-but-hidden while the next panel's chunk loads */}
      <Suspense key={panel} fallback={<Sheet title={title}><LoadingRow /></Sheet>}>
        <P key={panel} />
      </Suspense>
    </Boundary>
  );
}

/* A small ink-and-signal pin marks what the open card is about. */
const selIcon = L.divIcon({
  className: 'sel-pin', iconSize: [28, 28], iconAnchor: [14, 14],
  html: '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="10" class="sel-pin__ring"/><circle cx="14" cy="14" r="3.5" class="sel-pin__dot"/></svg>',
});

export function CardHost() {
  const card = useUi((s) => s.card);
  const lat = card?.latlng?.lat, lng = card?.latlng?.lng, id = card?.id;
  useEffect(() => {
    const map = getMap();
    if (!map || lat == null || lng == null) return;
    const m = L.marker([lat, lng], { icon: selIcon, interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
    return () => { m.remove(); };
  }, [id, lat, lng]);
  // Escape closes the card — unless a modal or dialog is open over it (that layer takes the key)
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !modalLayerAbove()) closeCard(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  /* Publish --card-clear (px from the bottom of the screen to the card's top edge, 0 with no card)
     so map chrome that shares the bottom-left corner on desktop (the weather legends) can sit
     above the card instead of under it. Layout only. */
  const ro = useRef<ResizeObserver | null>(null);
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    const root = document.documentElement.style;
    ro.current?.disconnect();
    ro.current = null;
    if (!el) { root.setProperty('--card-clear', '0px'); return; }
    const set = () => root.setProperty('--card-clear', Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)) + 'px');
    ro.current = new ResizeObserver(set);
    ro.current.observe(el);
    set();
  }, []);
  if (!card) return null;
  const C = CARDS[card.kind];
  if (!C) return null;
  return (
    <div className="shell-cardhost" ref={hostRef}>
      <Boundary resetKey={card.id} fallback={(_r, e) => (
        <MapCard eyebrow="Something went wrong" title="Couldn't show this" subtitle="Close this card and tap the chart again.">
          <p className="shell-errtext">{errText(e)}</p>
        </MapCard>
      )}>
        <Suspense fallback={<MapCard title="Loading…"><LoadingRow /></MapCard>}>
          <C key={card.id} data={card.data} card={card} />
        </Suspense>
      </Boundary>
    </div>
  );
}

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  const M = MODALS[modal.name];
  if (!M) return null;
  return (
    <Boundary resetKey={modal.id} fallback={(_r, e) => <Modal title="Something went wrong" onCancel={() => closeModal()}><StateBox icon="alert" tone="alert">{errText(e)}</StateBox></Modal>}>
      <Suspense fallback={null}>
        <M key={modal.id} data={modal.data} />
      </Suspense>
    </Boundary>
  );
}

/* Close any open sheet when the boat's alarm fires etc. is the engine's job; this just exports
   a helper the shell uses for Escape on the map. */
export function closeEverything() { closeCard(); closePanels(); }
