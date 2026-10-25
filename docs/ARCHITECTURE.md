# FishApp 2 — architecture and porting contract

Source: `C:\Users\jbitt\fishapp-ui` (branch `ui-src`, outside OneDrive so node_modules never syncs).
Build: `npm run build` → `dist/`. Deploy: `node tools/deploy.mjs` copies `dist/` into the GitHub Pages
checkout (`Desktop\Projects\FishApp`, branch `main`). The iOS shell (`Desktop\Projects\FishApp-iOS`)
bundles the same build via `sync-web.sh`.

```
index.html            Vite entry: meta, the chart LUT SVG filters, the instant boot splash, #root
src/main.tsx          styles → engine boot → <App/>
src/engine/*.js       the app's logic, ported 1:1 from legacy/js (same file and symbol names)
src/services/ui.ts    panels, cards, modals, toast, in-app dialogs (engine + React share it)
src/services/theme.ts day / sun / night + chart LUT
src/services/native.ts iOS-shell bridge (background GPS, share sheet, haptics, external links)
src/ui/*              design-system primitives (see docs/DESIGN.md)
src/shell/*           AppShell: map, HUD, SOS, controls, tab bar/rail, hosts for sheets/cards/modals
src/features/<f>/*    one folder per feature: panels, cards, modals, map legends
legacy/               the pre-React app, verbatim (reference + the /classic fallback build)
docs/inventory/*.json per-module inventory: every surface, store, safety behaviour, risk (read yours!)
```

## The one big rule: the engine never touches the DOM

Legacy modules rendered by writing `innerHTML` into elements that no longer exist. The port:

1. **Keeps all logic, state objects, constants, timers, Leaflet layers and comments** of the legacy
   module — same names, same behaviour. Safety logic is moved, never rewritten.
2. **Replaces every DOM read/write** (`getElementById`, `querySelector`, `innerHTML`, `textContent`,
   `classList`, `.value`, `.checked`, `addEventListener` on app elements) with a **view store**:
   `export const xxxStore = createStore(() => ({...}))` from `zustand/vanilla`, holding plain data
   (numbers, strings, arrays of objects — never HTML). Where legacy code wrote the DOM, compute the same
   values and `xxxStore.setState({...})`. Where it read an input, take a parameter or read engine state.
3. **React renders** from those stores (`useStoreValue(store, selector)` from `src/ui`) and calls the
   engine's functions directly on events. Components hold only ephemeral UI state (an open accordion,
   a text draft).
4. **Leaflet stays imperative.** Markers, polylines, divIcons and tile layers are still created in the
   engine. Marker HTML strings are fine (escape user text with `escapeHtml` from spots.js). But **Leaflet
   popups are replaced by map cards**: `openCard(kind, data, latlng)` (see Cards).
5. **Timers and safety loops never live in React.** Anchor evaluation, alarms, deadman, keep-alive,
   watchdogs stay in the engine, driven by GPS fixes and intervals, immune to StrictMode and unmounts.

### Replacements for legacy globals

| Legacy | Now |
|---|---|
| `toast(msg)` (app.js) | `toast(msg, {action?})` from `src/services/ui` |
| `togglePanel('panel-x')`, `closePanels()` | `togglePanel/openPanel/closePanels/isPanelOpen` from `services/ui` (ids without `panel-`; `knots` → `guides`) |
| `confirm(...)` | `await confirmDialog({title, message, confirmLabel, destructive})` — **async**: re-check any state you depend on after the await, and make the caller async too |
| `prompt(...)` | `await promptDialog({title, fields:[{name,label,value}]})` → object or null |
| `alert(...)` | `alertDialog({...})` or a toast |
| `loadingHTML / stateHTML` | `<LoadingRow>` / `<StateBox onRetry>` in React; the store carries `status: 'loading'|'ready'|'empty'|'offline'|'error'` + message |
| `escapeHtml` | React escapes for you; only marker HTML still needs `escapeHtml` |
| `window._map` | still set by boot; prefer `getMap()` from engine/app.js |
| `readJSON(key, fallback)` | engine/app.js (unchanged) |
| `window.applyPendingUpdate()` | `applyPendingUpdate()` from engine/app.js (safe no-op when nothing is pending) |
| `APP_BUILD` | `APP_BUILD` from engine/app.js |
| `#ovl-*` checkboxes + synthetic `change` events | `setDataOverlay(id, on)` from engine/layers.js (`wind|sst|rain|reefs|mpa|fish`); a module that refuses (e.g. SST offline) calls `reportDataOverlay(id, false)` |
| `input[name=base]`, `#ovl-enc`, `#ovl-seamark` | `layersStore.getState()` → `{base, enc, seamark, ...}` |
| `#route-speed`, `#route-gph` | `getRouteSpeedKn()`, `getRouteGph()` from nav.js |
| `updateEmergency()` | gone — the Emergency sheet subscribes to `gpsStore` |
| `window[fnName]` (voice.js) | direct imports |
| `<a download>` of a Blob | `saveOrShareFile({name, mime, data})` from `services/native` (share sheet in the iOS app, download on the web) |
| `window.open(url)` / external `<a target=_blank>` | `openExternal(url)` from `services/native` |

## Cross-module contract (names other modules may rely on)

Existing legacy exports keep their names and signatures unless listed here.

| Module | Export | Contract |
|---|---|---|
| gps.js (done) | `gpsStore` | `{status:'searching'|'fix'|'denied'|'lost', quality:'ok'|'warn'|'none', accM, sogKn, cogDeg, lat, lng, fixAt, follow}` |
| gps.js (done) | `wakeStore` | `{kind:'ok'|'off'|'warn'|'unsupported', text}` |
| layers.js (shell) | `layersStore`, `setBase`, `setOverlay`, `setDataOverlay`, `reportDataOverlay` | see above |
| app.js (shell) | `getMap()`, `readJSON`, `applyPendingUpdate`, `APP_BUILD`, `boot` | |
| nav.js | `navStore` | anchor, trip, route planner, measure view state |
| nav.js | `getRouteSpeedKn()`, `getRouteGph()`, `setRouteSpeedKn(n)`, `setRouteGph(n)` | planner speed / fuel (persist as before) |
| nav.js | `routeStart()` → `Promise<void>`, `anchorDrop()`, `anchorRaise()`, `anchorToggle()` | |
| goto.js | `gotoStore` | `{active, arriving, name, distNm, brgDeg, steerDeg, etaText, legText}` (+ whatever the card needs) |
| goto.js | `gotoStart(ll, name)` → `Promise<boolean>`, `gotoCancel()` → `Promise<void>`, `gotoArrive()` | async because of the confirm |
| awake.js | `awakeStore` | watch band: `{visible, warn, what, detail}` + keep-alive settings line |
| tracks.js | `tracksStore` | `{recording, startedAt, points, saved:[...]}` |
| weather.js | `wxStore`, `conditionsStore` | `conditionsStore = {waterF, at, lat, lng}` — latest water temp near the boat for the HUD |
| weather.js | `showAreaForecast(ll)` | opens the weather panel for that point |
| inspect.js | `inspectAt(ll)` | opens the `inspect` card |
| sst.js / rain.js | `sstStore`, `rainStore` | legend + loop scrubber state |
| tides.js / bite.js / catch.js | `tidesStore`, `biteStore`, `catchStore` | |
| catch.js | `openCatchModal()` | opens modal `catch` |
| assistant.js | `asstStore`, `asstSend(text)`, `asstSpeak(text)`, `asstCreateSpot(...)` | transcript lives in the store (voice uses it with the panel closed) |
| voice.js | `voiceStore` | `{supported, on, awake, listening, label, transcript}`; `voiceToggle()` must be called synchronously inside the click handler (iOS gesture unlock) |
| motor.js | `motorStore`, `motorSupported()` | `motorSupported()` = Web Bluetooth present and not the iOS shell |
| spots.js | `spotsStore`, `openSpotModal(ll|spot)`, `saveSpot(fields)`, `deleteSpot(id)` → Promise | |
| reefs.js | `reefsStore` | nearest reefs list |
| download.js | `dlStore`, `startDownload(name, zoom)`, `cancelDownload()` | |

### Functions boot (engine/app.js) calls — keep these names and signatures

`wxInit(map)`, `fishInit(map)`, `reefsInit(map)` → Promise, `spotsInit(map)` → Promise, `areaDataInit()`,
`tidesInit()`, `catchInit(map)` → Promise, `navInit(map)`, `anchorRestore()`, `tracksInit()` (NEW: load
saved tracks into `tracksStore`), `asstInit()`, `voiceInit()`, `motorInit()`, `awakeSetEnabled(on)` +
`Awake.enabled`, `WakeLock` (gps.js), `navHandleClick(ll)` → boolean, `inspectAt(ll)`,
`openSpotModal({lat,lng})`, the 10-minute refresh `loadNow24()`, `loadForecast10()`, `WX._fc10loaded`,
`loadTidesTimes()`, `watchCheck()`, and the update-deferral flags `Goto.active`, `Tracks.recording`,
`Nav.anchor.watching`, `Voice.on` / `Voice._wantOn`. Map overlay enablers called by layers.js:
`windOverlayEnable(on)`, `sstEnable(on)`, `rainEnable(on)`, `fishEnable(on)`, `reefsSetVisible('reefs'|'mpa', on)`.

The old "render on panel open" hooks (`renderSpotsList`, `renderCatchList`, `loadWeatherPanel`, …) are no
longer called by the shell: each panel component triggers its own loads in a `useEffect` on mount.

### Store typing

Stores created in plain JS infer literal types (`null` stays `null`). Annotate every store with JSDoc so
React gets real types, e.g.

```js
/** @typedef {{ status: 'idle'|'loading'|'ready'|'error', items: Array<{id:number,name:string}> }} SpotsView */
/** @type {import('zustand/vanilla').StoreApi<SpotsView>} */
export const spotsStore = createStore(() => /** @type {SpotsView} */ ({ status: 'idle', items: [] }));
```

### Styling

Use `src/ui` primitives first. Feature-specific CSS goes in `src/features/<f>/<f>.css`, imported by that
feature's components, with class names prefixed by the feature (`wx-`, `tide-`, `asst-`, `nav-`, `motor-`,
`spot-`, `dl-`, `guide-`, `voice-`). Tokens only — no colour literals (Leaflet SVG gets classes, see shell.css
`.boat-icon` / `.map-chip`). Map-card content goes inside `<MapCard>` (src/shell/MapCard).

## Registries (fixed paths — the shell imports these; features fill them in)

**Panels** (`src/shell/panels.tsx`, lazy): `weather` → features/weather/WeatherPanel · `tides` →
features/tides/TidesPanel · `spots` → features/spots/SpotsPanel · `download` →
features/spots/DownloadPanel · `tools` → features/nav/ToolsPanel · `guides` →
features/guides/GuidesPanel · `assistant` → features/assistant/AssistantPanel · `motor` →
features/motor/MotorPanel · `more`, `layers`, `emergency`, `about` → src/shell/panels/*.
Each default-exports a component that renders exactly one `<Sheet>`.

**Cards** (`src/shell/cards.tsx`, kind → component, props `{data, card}`): `inspect` (weather/InspectCard),
`fish` (weather/FishCard), `spot` (spots/SpotCard), `reef` (spots/ReefCard), `mpa` (spots/MpaCard),
`catch` (tides/CatchCard), `trip` / `track` (nav/HistoryCard). A card renders `<MapCard>` from
`src/shell/MapCard`.

**Modals** (`src/shell/modals.tsx`): `spot` (spots/SpotModal), `catch` (tides/CatchModal).

**Persistent / overlay slots** (rendered by the shell): `features/nav/GoToCard` (`GoToCard`, `NavPill`),
`features/nav/WatchBand` (`WatchBand`), `features/nav/AnchorAlarm` (`AnchorAlarm`),
`features/motor/MotorBand` (`MotorBand`), `features/weather/MapLegends` (`MapLegends`),
`features/voice/VoiceTabButton` (`VoiceTabButton`).

* `GoToCard` renders in the bottom stack above the tab bar (no sheet open, or always on desktop);
  `NavPill` renders in the persistent layer when a sheet is open on a phone. Both read `gotoStore`.
* `WatchBand` / `MotorBand` render in the persistent layer under the HUD and return `null` when idle.
* `AnchorAlarm` is the full-screen alarm (z 900, `.keep-motion`), `null` unless the alarm is up.
* `MapLegends` positions its own SST legend (bottom-left above the bottom stack) and loop scrubbers.
* `VoiceTabButton` is the centre tab item: `<button className="shell-tab shell-tab--voice [is-listening|is-awake|is-off]">`
  containing `<span className="shell-tab__disc"><Icon …/></span><span className="shell-tab__label">…</span>`.
  It must call `voiceToggle()` synchronously in `onClick`.

Composite panels import sections by fixed name: SpotsPanel uses `VoyagesSection` and `TracksSection`
(features/nav/Sections.tsx); ToolsPanel uses `CatchLogSection` (features/tides/CatchLogSection.tsx).

## Native iOS shell (App Store build)

`window.FishNative` exists only inside the iOS app (see `services/native.ts`, `isNativeShell()`):
no service worker, no Web Bluetooth (motor hidden), Web Speech may be missing (voice feature-detects
and the tab bar swaps Hey Fish for First Mate), downloads go through the share sheet, `sms:`/`tel:`/http
links open outside. Background GPS is only switched on while something needs it (anchor watch, track
recording, Go-To) via `backgroundLocation(on)`. Any cloud AI call needs the user's consent first
(`asst` consent dialog — App Store guideline 5.1.2).

## Checks before calling a port done

`npm run typecheck`, `npx eslint src/engine/<your files>` (no-undef = an unresolved old global),
`npm test`, `npm run build`, and grep your files for `document.` / `innerHTML` / `getElementById` /
`confirm(` / `prompt(` / `alert(` / emoji.
