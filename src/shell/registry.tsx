/* Fixed registries: the shell imports feature components by these paths (docs/ARCHITECTURE.md).
 * Panels and cards are lazy so each feature is its own chunk and one broken feature can't take
 * the shell down (each is wrapped in an error boundary by its host). */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { CardState, PanelId } from '../services/ui';

type Lazy<P = object> = LazyExoticComponent<ComponentType<P>>;

export const PANELS: Record<PanelId, Lazy> = {
  weather: lazy(() => import('../features/weather/WeatherPanel')),
  tides: lazy(() => import('../features/tides/TidesPanel')),
  spots: lazy(() => import('../features/spots/SpotsPanel')),
  download: lazy(() => import('../features/spots/DownloadPanel')),
  tools: lazy(() => import('../features/nav/ToolsPanel')),
  guides: lazy(() => import('../features/guides/GuidesPanel')),
  assistant: lazy(() => import('../features/assistant/AssistantPanel')),
  motor: lazy(() => import('../features/motor/MotorPanel')),
  more: lazy(() => import('./panels/MorePanel')),
  layers: lazy(() => import('./panels/LayersPanel')),
  emergency: lazy(() => import('./panels/EmergencyPanel')),
  about: lazy(() => import('./panels/AboutPanel')),
};

export const PANEL_TITLES: Record<string, string> = {
  weather: 'Weather & waves', tides: 'Tides & bite times', spots: 'Spots & tracks', download: 'Offline charts',
  tools: 'Nav tools & catch log', guides: 'Guides', assistant: 'First Mate', motor: 'Trolling motor',
  more: 'More', layers: 'Map layers', emergency: 'Emergency', about: 'About FishApp',
};

export interface CardProps { data: any; card: CardState }
export const CARDS: Record<string, Lazy<CardProps>> = {
  inspect: lazy(() => import('../features/weather/InspectCard')),
  fish: lazy(() => import('../features/weather/FishCard')),
  spot: lazy(() => import('../features/spots/SpotCard')),
  'shared-spot': lazy(() => import('../features/spots/SharedSpotCard')),
  reef: lazy(() => import('../features/spots/ReefCard')),
  mpa: lazy(() => import('../features/spots/MpaCard')),
  catch: lazy(() => import('../features/tides/CatchCard')),
  history: lazy(() => import('../features/nav/HistoryCard')),
};

export interface ModalProps2 { data: any }
export const MODALS: Record<string, Lazy<ModalProps2>> = {
  spot: lazy(() => import('../features/spots/SpotModal')),
  catch: lazy(() => import('../features/tides/CatchModal')),
};
