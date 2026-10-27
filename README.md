# FishApp

Offline marine charts, GPS navigation and fishing tools — for the boat, built to keep working when
you lose signal offshore. Runs in any browser (install it from Safari: Share → Add to Home Screen) and
as a native iPhone app (`FishApp-iOS`, see its `APP_STORE.md`).

**Live:** https://jbittlest.github.io/fishapp/ · **Privacy:** [privacy.html](https://jbittlest.github.io/fishapp/privacy.html) ·
**Support:** [support.html](https://jbittlest.github.io/fishapp/support.html) · Previous version: [/classic/](https://jbittlest.github.io/fishapp/classic/)

> FishApp is a navigation aid, not a substitute for official charts, a depth sounder, a VHF radio or a
> proper lookout.

## Features

- **Charts** — NOAA nautical charts, NOAA BlueTopo US survey bathymetry, global GEBCO/GMRT seafloor relief,
  satellite and street maps, seamarks. Download an area for offline use: charts plus a 7-day wind, wave,
  tide and water-temperature pack so First Mate can answer about it with no signal.
- **Instruments** — GPS fix, SOG, COG (°T), coordinates in DDM to the thousandth of a minute, satellite
  water temperature; values dim when stale and blank when the fix is lost.
- **Navigation** — Go-To any point or follow a planned route (ETA, distance, bearing, steer cue), voyage
  archive, track recording, trip stats, measure tool.
- **Anchor watch** — drag and lost-GPS alarms that keep working with the screen locked in the iPhone app.
- **Weather** — now & 24 h, 10-day with 3-hourly detail, area forecasts, wind arrows with a 24 h loop,
  rain radar loop, sea-surface temperature breaks.
- **Fishing** — tides and solunar periods, bite windows learned from your own catch log, catch log with
  photos and auto-captured conditions, California artificial reefs and Marine Protected Areas (offline),
  recent fish sightings, knot guides, fish ID and limits.
- **First Mate** — an assistant that answers from your boat data offline and, with your permission, uses
  a free cloud AI (or Claude with your own key) when you have signal. Hands-free "Hey Fish" voice where
  the platform supports speech recognition.
- **Safety** — SOS screen with your position, a pre-filled "text my location" message, VHF/911 and a
  MAYDAY script with your live position. Day, high-glare Sun and red-safe Night display modes.

## Source and builds

The app is React 19 + TypeScript + Vite over a plain-JS engine (`src/engine/`, ported from the original
vanilla app) and Leaflet. The source lives on branch **`ui-src`**; branch `main` holds the built site
that GitHub Pages serves.

```
src/engine/    app logic (GPS, charts, navigation, weather, tides, assistant…) — never touches the DOM
src/services/  UI state (panels, cards, dialogs, toasts), theme, iOS-shell bridge
src/ui/        design-system primitives            docs/DESIGN.md
src/shell/     app shell: HUD, SOS, map controls, tab bar/rail, sheet/card/modal hosts, core panels
src/features/  one folder per feature              docs/ARCHITECTURE.md
legacy/        the original vanilla app (deployed as /classic/)
```

```bash
npm install
npm run dev            # http://127.0.0.1:5181
npm test               # unit tests (Vitest)
npm run lint           # ESLint over the engine (tsc covers the TypeScript)
npm run build          # typecheck + production build into dist/ (also generates the service worker)
npx playwright test    # end-to-end checks against the production build (installed Chrome)
node tools/deploy.mjs --dry   # prove the deploy: builds the web pages into a temp copy, lists every copy
node tools/deploy.mjs --ios   # copy dist/ into the Pages checkout (+ the iOS app's bundled Web/)
```

Brand name, site URL and store links live in `src/site.config.json` (read through `src/services/site.ts`
and `tools/web/lib.mjs`); nothing else should hard-code them. Every third-party data source, its terms
and its credit line: `docs/launch/data-sources.md`.

### What a deploy writes

`tools/deploy.mjs` mirrors the build into the Pages checkout (branch `main`) and touches only the paths it
owns: the app (`index.html`, `sw.js`, `assets/`, `data/`, `icons/`, `manifest.webmanifest`,
`privacy.html`, `support.html`), the public web pages generated into the build by
`tools/make-web-pages.mjs` (`get/` — the smart get-the-app link, `places/` — a page per California MPA and
artificial reef, `site/`, `sitemap.xml`, `robots.txt`, plus the social tags in `index.html`), the
link-preview image `og.png`, `/classic/` (the old vanilla app, rebuilt from `legacy/`), and a copy of
`README.md`, `MOTOR.md` and `proxy/`. `--ios` also refreshes `FishApp-iOS/FishApp/Web` with the app only
(no service worker, web pages or `og.png`). `privacy.html` and `support.html` are rendered from
`src/legal/privacy.js` by `node tools/make-legal-pages.mjs`; rerun it after editing the policy.
`og.png` has the brand and URL drawn into it: after a rename or a URL change run
`node tools/web/render-og.mjs`, or the deploy refuses the stale image.

### App Store screenshots

```bash
npm run build
npx playwright test -c playwright.shots.config.ts tests/visual/appstore.spec.ts   # raw screens → tools/out/storeshots/raw
node tools/storeshots/render.mjs --out ../OneDrive/Desktop/Projects/FishApp-iOS/AppStoreScreenshots [--clean]
```

Set `STORESHOTS_RAW=<dir>` on the capture (and `--raw <dir>` on the render) to keep the raw screens
elsewhere. The render frames each raw screen under its caption (`tools/storeshots/captions.json`) at
1320×2868 (iPhone 6.9") and 2064×2752 (iPad 13"), RGB with no alpha, and refuses raw screens older than
`src/`, `public/` or `index.html` (recapture after any app change).

The service worker is generated at build time from everything the build emits; its cache name is the
build id plus a content hash, so there is no version number to bump by hand. Installed copies pick up a
new build on their next launch (never in the middle of a voyage, track, anchor watch or hands-free
session).

`MOTOR.md` documents the experimental trolling-motor link (web only). `proxy/first-mate-worker.js` is the
Cloudflare Worker behind First Mate's free AI; deploying it, its daily limits and what it keeps are in
`proxy/README.md` (`cd proxy && npx wrangler@4 deploy`, configured by `proxy/wrangler.toml`).
