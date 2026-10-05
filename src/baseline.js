// Parity baseline: the ORIGINAL markup + CSS driven by the ES-module engine (src/engine/*).
// Proves the mechanical module conversion before the React UI replaces the DOM layer.
// Dev-only entry (baseline.html); never shipped.
import 'leaflet/dist/leaflet.css';
import * as m0 from './engine/db.js';
import * as m1 from './engine/tiles.js';
import * as m2 from './engine/gps.js';
import * as m3 from './engine/spots.js';
import * as m4 from './engine/tracks.js';
import * as m5 from './engine/weather.js';
import * as m6 from './engine/inspect.js';
import * as m7 from './engine/reefs.js';
import * as m8 from './engine/sst.js';
import * as m9 from './engine/fish.js';
import * as m10 from './engine/rain.js';
import * as m11 from './engine/astro.js';
import * as m12 from './engine/tides.js';
import * as m13 from './engine/catch.js';
import * as m14 from './engine/awake.js';
import * as m15 from './engine/nav.js';
import * as m16 from './engine/goto.js';
import * as m17 from './engine/knot-diagrams.js';
import * as m18 from './engine/knots.js';
import * as m19 from './engine/fish-id.js';
import * as m20 from './engine/fish-tips.js';
import * as m21 from './engine/areadata.js';
import * as m22 from './engine/bite.js';
import * as m23 from './engine/assistant.js';
import * as m24 from './engine/voice.js';
import * as m25 from './engine/motor.js';
import * as m26 from './engine/helm.js';
import * as m27 from './engine/download.js';
import * as app from './engine/app.js';

// The legacy HTML strings carry inline onclick="someGlobal()" handlers.
for (const m of [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, app]) {
  for (const [k, v] of Object.entries(m)) if (!(k in window)) window[k] = v;
}
window.L = (await import('leaflet')).default;
app.boot();
