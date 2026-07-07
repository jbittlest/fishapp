# FishApp 🐟

Personal marine navigation PWA — Garmin Navionics style. Offline nautical charts,
live GPS, saved fishing spots, and track recording. Installs on iPhone straight
from Safari (no App Store).

## Features

- **Charts**: NOAA ENC nautical charts (US waters — depths, buoys, hazards),
  OpenSeaMap seamarks (worldwide), Esri ocean/satellite/street base maps
- **Seafloor relief**: GMRT shaded-relief bathymetry base layer — see the actual
  shape of the bottom. Rendered fresh at every zoom (never CSS-stretched) and at
  2x pixel density for retina-crisp display. In US coastal waters, NOAA NCEI's
  hi-res coastal DEM (down to ~1-3 m) auto-overlays for sandbar/channel-level
  detail. Cities/islands get a transparent label overlay automatically (also on
  satellite). NOTE: over open ocean the survey grid is inherently coarse, so at
  extreme zoom the bottom is smooth by data, not by blur — for pin-sharp bottom
  detail at any zoom, turn on the NOAA chart overlay (vector contours + soundings).
  Picking the relief base auto-enables the NOAA chart so you get sharp vector
  contours over the bottom shape (turn it back off and the choice persists).
- **Weather** (🌤, Open-Meteo, no API key): current wind/gusts/waves/temp cards +
  24 h hourly forecast; Windy-style wind-arrow overlay colored by speed. Last
  forecast is saved so it's still readable offline (with an age warning)
- **Offline areas**: position the map over your fishing grounds, tap ⇩, pick a
  detail level, download. Everything you browse online is also auto-cached.
- **GPS**: live position, speed (knots), heading, accuracy — works with zero
  cell signal (GPS is satellite-based). Screen stays awake while navigating.
- **California reefs & MPAs** (bundled, fully offline): 142 artificial reefs
  (name, depth, composition — e.g. sunken Liberty Ships) as tappable 🪸 markers,
  plus 157 Marine Protected Areas shaded by restriction (red = no-take, orange =
  limited). Reef popups have "Save as spot"; Spots panel lists nearest reefs by
  distance. Data: NOAA Artificial Reefs + CDFW MPAs, refreshable via the fetch
  URLs in `data/`. (Static datasets — bundled so they work with no signal.)
  Tapping a reef also fetches live wind / swell / seabed depth for that spot.
- **Sea surface temp (SST)**: toggle a color SST overlay (NASA GIBS / GHRSST MUR,
  ~1 km, daily with ~2-day lag) to see temperature breaks — the edges tuna/dorado
  hold on. Legend + date shown bottom-left. Online-only (date-specific tiles).
  Exact water temp for any point shows in the tap-to-inspect and reef popups.
- **Tap to inspect**: single-tap anywhere → popup with **depth** (ft / m / fathoms,
  from NOAA NCEI DEM), **wind** (kn + direction + gust) and **swell** (height /
  period / direction) at that exact point. "Save as spot" button in the popup.
- **Spots**: mark waypoints (📌 button or long-press the map) with type, notes;
  list sorted by distance from you with bearing.
- **Tracks**: ⏺ records a breadcrumb trail of where you drove; saved with distance.
- **Backup**: export/import all spots & tracks as a JSON file.

## Run locally

```
python -m http.server 8123 --directory .
```
Open http://localhost:8123

## Install on iPhone

The app must be served over **HTTPS** for GPS + offline to work (any static
host: GitHub Pages, Netlify, Cloudflare Pages — all free). Then on the phone:

1. Open the URL in Safari
2. Share → **Add to Home Screen**
3. Open it once, allow Location access
4. While on WiFi, download your fishing areas (⇩ button)

## Updating the app

`sw.js` caches the app shell. After changing any code, bump the version string
(`fishapp-v2` → `fishapp-v3`) in `sw.js` so installed phones pick up the update.

## Architecture

No build step, no dependencies except bundled Leaflet 1.9.4.

| File | Purpose |
|---|---|
| `js/tiles.js` | Layer definitions + offline-first tile layer (IndexedDB → network → blank) |
| `js/db.js` | IndexedDB: tiles, spots, tracks, downloaded areas |
| `js/gps.js` | Geolocation watch, boat marker, follow mode, wake lock |
| `js/spots.js` | Waypoint CRUD, list panel, export/import |
| `js/tracks.js` | Track recording + saved-track management |
| `js/download.js` | Bulk area downloads with progress, storage management |
| `js/weather.js` | Open-Meteo forecast panel + wind-arrow map overlay |
| `js/inspect.js` | Tap-to-inspect popup: point depth + wind + swell |
| `js/reefs.js` | CA artificial reefs + MPA polygons (bundled offline data) |
| `js/sst.js` | Sea surface temp overlay (NASA GIBS MUR) + legend |
| `data/reefs-ca.json` | 142 CA artificial reefs (NOAA Hosted/ArtificialReefs) |
| `data/mpa-ca.json` | 157 CA Marine Protected Areas (CDFW ds582 polygons) |
| `js/app.js` | Bootstrap, layer switching, UI wiring |
| `sw.js` | Service worker — caches the app shell for offline launch |
