/* Entry: styles (Leaflet first — several overrides only win on source order), the React shell,
 * then the engine boot. The map lives in #map outside React so it can never be unmounted or
 * double-initialised; React draws the chrome over it in #root. */
import 'leaflet/dist/leaflet.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './ui/ui.css';
import './ui/sheet.css';
import './shell/shell.css';
import './shell/panels/panels.css';
/* Feature styles are imported by each feature's own components (lazy chunks carry their CSS). */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './shell/App';
import { boot } from './engine/app.js';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
boot();
