/* Fixed registries: the shell imports feature components by these paths (docs/ARCHITECTURE.md).
 * Panels and cards are lazy so each feature is its own chunk and one broken feature can't take
 * the shell down (each is wrapped in an error boundary by its host). */
import { lazy, type ComponentType } from 'react';
import type { CardState, PanelId } from '../services/ui';
import { SITE } from '../services/site';

type Lazy<P = object> = ComponentType<P>;

/* How long a feature's chunk may take before the host shows an error with Retry instead of
   "Loading…" forever. A stalled connection (marginal LTE, a dead Wi-Fi the phone still prefers)
   never rejects a fetch on its own. */
const CHUNK_TIMEOUT_MS = 15000;

/* React.lazy keeps a failed import forever, so the host's Retry (and reopening the panel) would
   show the same error until the app restarted. This swaps in a fresh lazy after a failure, so the
   next render really loads again. Not swapped until a moment after the failure: React re-renders
   once straight away when a lazy rejects, and a fresh lazy there would just suspend again — the
   error would never reach the host and the timeout would loop "Loading…" forever. */
export function lazyChunk<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): Lazy<P> {
  let failedAt = 0;
  const make = () => lazy(() => new Promise<{ default: ComponentType<P> }>((resolve, reject) => {
    const fail = (e: unknown) => {
      failedAt = Date.now();
      reject(new Error('Couldn’t load this part of the app — check your connection and tap Retry. If it keeps happening, close and reopen ' + SITE.brandName + '. (' + (e instanceof Error ? e.message : String(e)) + ')'));
    };
    const timer = setTimeout(() => fail(new Error('timed out')), CHUNK_TIMEOUT_MS);
    load().then((m) => { clearTimeout(timer); resolve(m); }, (e) => { clearTimeout(timer); fail(e); });
  }));
  let current = make();
  return function Chunk(props: P) {
    if (failedAt && Date.now() - failedAt > 500) { failedAt = 0; current = make(); }
    const C = current;
    return <C {...props} />;
  };
}

export const PANELS: Record<PanelId, Lazy> = {
  weather: lazyChunk(() => import('../features/weather/WeatherPanel')),
  tides: lazyChunk(() => import('../features/tides/TidesPanel')),
  spots: lazyChunk(() => import('../features/spots/SpotsPanel')),
  download: lazyChunk(() => import('../features/spots/DownloadPanel')),
  tools: lazyChunk(() => import('../features/nav/ToolsPanel')),
  guides: lazyChunk(() => import('../features/guides/GuidesPanel')),
  assistant: lazyChunk(() => import('../features/assistant/AssistantPanel')),
  motor: lazyChunk(() => import('../features/motor/MotorPanel')),
  more: lazyChunk(() => import('./panels/MorePanel')),
  layers: lazyChunk(() => import('./panels/LayersPanel')),
  emergency: lazyChunk(() => import('./panels/EmergencyPanel')),
  about: lazyChunk(() => import('./panels/AboutPanel')),
};

export const PANEL_TITLES: Record<string, string> = {
  weather: 'Weather & waves', tides: 'Tides & bite times', spots: 'Spots & tracks', download: 'Offline charts',
  tools: 'Nav tools & catch log', guides: 'Guides', assistant: 'First Mate', motor: 'Trolling motor',
  more: 'More', layers: 'Map layers', emergency: 'Emergency', about: `About ${SITE.brandName}`,
};

export interface CardProps { data: any; card: CardState }
export const CARDS: Record<string, Lazy<CardProps>> = {
  inspect: lazyChunk(() => import('../features/weather/InspectCard')),
  fish: lazyChunk(() => import('../features/weather/FishCard')),
  spot: lazyChunk(() => import('../features/spots/SpotCard')),
  'shared-spot': lazyChunk(() => import('../features/spots/SharedSpotCard')),
  reef: lazyChunk(() => import('../features/spots/ReefCard')),
  mpa: lazyChunk(() => import('../features/spots/MpaCard')),
  catch: lazyChunk(() => import('../features/tides/CatchCard')),
  history: lazyChunk(() => import('../features/nav/HistoryCard')),
};

export interface ModalProps2 { data: any }
export const MODALS: Record<string, Lazy<ModalProps2>> = {
  spot: lazyChunk(() => import('../features/spots/SpotModal')),
  catch: lazyChunk(() => import('../features/tides/CatchModal')),
};
