# Requests from the data-spots-offline port

Group: spots / reefs + MPAs / offline downloads / area data packs (`src/engine/spots.js`,
`reefs.js`, `download.js`, `areadata.js`, `src/features/spots/*`). Nothing here blocks the port;
each item has a local workaround in place.

## 1. src/ui — a `life-buoy` icon (owner: design system)

The "Ramp / dock" spot type was a ring-buoy emoji in the legacy app. `ICON_NAMES` has no life ring,
so `features/spots/SpotGlyph.tsx` draws Lucide's `LifeBuoy` geometry locally (same 24 grid, 1.75
stroke). Please add `'life-buoy': LifeBuoy` to `LUCIDE` in `src/ui/Icon.tsx`; the local component
can then become `<Icon name="life-buoy" />`.

## 2. Shell — map symbology for spots, reefs and MPAs (owner: shell)

Spot markers (ink disc + white type glyph + `.map-chip` name), reef markers (rounded-square ink
tile, shape-coded apart from spots for night mode) and the MPA polygon night dimming are drawn by the
engine from boot, so their CSS cannot live in the lazy feature chunk.

**Workaround now:** `src/features/spots/spots-map.css`, imported by `engine/spots.js` (so it lands in
the main CSS bundle). Classes: `.spot-mk*`, `.spot-reefmk*`, `.spot-mpa`. If you would rather keep
all map symbology in `shell.css`, move that file's rules there and drop the import.

## 3. layers.js — export the "what the chart shows" layer list (owner: shell / layers)

The download planner must fetch exactly the layers the chart displays. `download.js activeLayerIds()`
now mirrors `setBase()`: labels ride with `gmrt` / `bluetint` / `sat`, and `gmrt → reliefhi`,
`bluetint → blueshade` (the legacy list dropped BlueTopo's labels and hillshade). That pairing is
private to layers.js (`RELIEF_DETAIL`, `needsLabels`). Please export a `chartLayerIds(state?)` from
layers.js so the two can never drift; download.js will call it instead of its mirror.

## 4. navigation — reload hooks after a backup import (owner: navigation)

`importData` re-syncs every store in a `finally`. It calls, by name, whichever exists:
tracks → `tracksReload()` else `tracksInit()` (contract: loads saved tracks into `tracksStore`);
voyages → `tripsReload()` / `voyagesReload()` / `loadTrips()` / `renderTripsList()`. Today that
resolves to `tracksInit()` and `loadTrips()`. Please keep one of those names exported and safe to call
repeatedly (re-read IndexedDB, republish, no duplicate map layers).

## 5. tides-bite-catch — `catchesReload()` (owner: catch)

Done on our side: `importData` now `await catchesReload()` (imported from catch.js, typeof-guarded),
with the old manual rebuild kept only as a fallback.

## 6. assistant — spot and layer actions (owner: assistant)

- `createSpot({lat, lng, name, type, notes})` is exported from spots.js: writes (resolves after
  commit), adds the marker and republishes. `asstCreateSpot` can delegate to it instead of pushing into
  `Spots.all` + `addSpotMarker` + `renderSpotsList` (all still exported and safe; `addSpotMarker` is now
  idempotent and `spotsChanged()` reconciles markers with `Spots.all`).
- `deleteSpot(id)` stays confirm-free on purpose (delete_waypoint acts on an explicit request); the
  UI's confirm lives in `confirmDeleteSpot(spot)`.
- `areaFcstIndex(fc, whenMs, maxGapMs?)` now returns **-1** when the pack has no sample within 90 min
  of `whenMs` (an expired pack used to report its last hour as "now"). Every current caller already
  falls back to cached live weather on -1, so go/no-go never reads week-old wind as current.
- `areaDailyForecast()` uses the LOCAL date as "today" (it used the UTC date).
- `reefs.js` and the Layers panel toggle reefs/MPAs through `setDataOverlay('reefs'|'mpa', on)`;
  the legacy `#ovl-reefs` / `#ovl-mpa` checkboxes no longer exist.

## 7. inspect.js / weather.js — names the reef card relies on (owners: weather-overlays)

`ReefCard` gets its live conditions from `queryPointData(ll, results, onUpdate)` (mutates `results`
with `'loading'|'offline'|'nodata'|'error'|value`, calls `onUpdate` after each source) and the
constants `M_TO_FT`, `M_TO_FATHOM`; `reefLiveView()` uses `compass(deg)` from weather.js. Please keep
those signatures; the HTML formatters (`windText` & co.) are no longer used by this group.

## 8. nav.js — `navHandleClick(ll)` on marker taps

Spot and reef markers and MPA polygons now pass their tap to `navHandleClick` first, so the route
planner / measure tool can use a spot or reef as a point (snapped to its exact position) instead of
the legacy behaviour where an MPA swallowed every route tap inside it. Please keep it returning
`true` when the tap was consumed.

## 9. iOS shell (FishApp-iOS) — file import

The Spots panel's Import uses a standard `<input type="file" accept="application/json,.json">`.
On iOS, WKWebView presents the system document picker for it with no native code. Please check on a
device that a `.json` backup saved through the share sheet ("Save to Files") is selectable there.
Export already goes through `saveOrShareFile`.

## 10. src/ui: a 44 px hit area for `.ui-btn--compact` (owner: design system)

`.ui-btn--compact` is 40 px tall with no invisible hit extension, which is below the 44 × 44 minimum
in DESIGN §3 and is likely to come up in an App Store accessibility review. Primitives use it too:
`StateBox`'s Retry button (shown in the Spots and Offline charts error states) and the Emergency
panel's "Copy coordinates" and "Set emergency contact". Suggested change in `ui.css`:
`.ui-btn--compact { position: relative } .ui-btn--compact::before { content: ''; position: absolute; inset: -2px 0 }`.

**Workaround now:** the spots feature uses the default 48 px Button for row actions (Show on chart,
Edit, Delete, Export, Import, download Cancel, Retry live conditions). The compact buttons it keeps
for layout ("Mark here" in the section header, "Show all") get the same hit extension through a
local `.spot-hit` class. Once the primitive has it, `.spot-hit` can be removed.

## 11. services/native + FishApp-iOS: report the share sheet's result (owners: shell, iOS)

In the shell, `saveOrShareFile()` posts `shareFile` and returns `'shared'` straight away, before the
share sheet is up. It never learns whether the user saved the file or cancelled. Please have
NativeBridge answer with the `UIActivityViewController` `completionWithItemsHandler` result
(`completed`, `activityType`) and make `saveOrShareFile` await it, resolving `'shared'` only when
completed and `'cancelled'` when dismissed.

**Workaround now:** `exportData()` checks `isNativeShell()` and says "Backup ready — choose where to
save it (N spots, …)" instead of "Backup exported". It will report the real outcome once the bridge
answers.

## 12. assistant.js: list only the pack sections that hold data (owner: assistant)

The context line ("Downloaded area pack … covers this location: 7-day wind/wave forecast, depth grid,
…") tests sections for truthiness (`if (d.depthGrid)`, `if (d.sstGrid)`, `if (d.forecast)`). Packs
saved by the old builder can hold `depthGrid: []`, `sstGrid: []` or a tide section with no turns, and
those are advertised as data. Please list only the sections that pass
`AREA_PACK_SECTIONS.filter((s) => !d[s.err] && s.has(d[s.key]))` (exported from areadata.js;
`areaPackHealth(d)` gives the level).

Changes already made on our side:
- `areaPackFor` now skips packs where nothing usable was captured (level `'none'`), so an older pack
  with real data is used instead.
- `buildAreaPack` now flags an empty or error-body answer as `*Error` for every section, so new packs
  never store an empty section.

## 13. Layers panel: name the MPA line patterns (owner: shell, optional)

MPA polygons now show the zone kind by line pattern as well as colour: solid for no take, dashed for
limited take, dotted for special closure. At night all three use red-safe tokens, so the pattern is
the only difference. The MPA card's swatch shows the same pattern. The Map Layers toggle detail ("No-take and
limited fishing zones") could name the patterns so they can be found without opening a card.

## 14. gps.js: export the "fresh fix" threshold (owner: shell / gps, optional)

The spot and reef cards and lists dim distances once the fix is no longer live. They use the HUD's
10 s rule so that the cards and the instruments agree. That number is a literal in `Hud.tsx`
(`fixAge > 10_000`) and is repeated as `FIX_FRESH_MS` in `features/spots/useFix.ts`. If gps.js
exported `GPS_FRESH_MS = 10_000`, both could import it.
