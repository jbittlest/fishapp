# Requests from the tides-bite-catch port

Shared changes this group needs but may not make itself. Each has a local workaround in place.

## 1. Shell — catch marker symbology in `src/shell/shell.css` (owner: shell)

Catch markers are drawn by `engine/catch.js` (`catchMarkerHtml`) as DESIGN.md §5 asks: an ink disc with a
line fish glyph, the species on a `.map-chip`. The marker exists whether or not any tides component has
mounted, so its CSS can't live in the lazy `features/tides/tides.css` chunk.

**Workaround now:** inline styles that read tokens (`var(--chart-ink)`, `var(--text-1)`, `var(--e1)`).

Geometry (changed after review): the Leaflet icon box is ONLY the 26 px disc (`iconSize [26,26]`,
anchored on its centre) with a transparent 44 px hit extension, like `.spot-mk::before`; the species
chip hangs below the box with `pointer-events: none`, so chart taps next to a catch reach inspect /
the route planner / measure. (The old 140×50 box swallowed every tap within ~70 px.)

**Request:** add to the map-symbology block of `shell.css` (then the inline styles can be dropped):

```css
.catch-pin { background: none; border: 0; }
.catch-pin__wrap { position: relative; width: 26px; height: 26px; }
.catch-pin__hit { position: absolute; inset: -9px; border-radius: 50%; }            /* 44px hit area */
.catch-pin__disc { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center;
  background: var(--chart-ink); color: var(--text-1); box-shadow: var(--e1); }
.catch-pin__label { position: absolute; top: 29px; left: 50%; transform: translateX(-50%);
  max-width: 140px; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
```

## 2. spots.js backup import — call `catchesReload()` (owner: spots) — RESOLVED

`resyncAfterImport` in `engine/spots.js` now calls `catchesReload()` first (the hand-rolled path is only a
fallback). Original request kept below for context.

`engine/catch.js` now exports `catchesReload()`: re-reads IndexedDB, clears and rebuilds every catch
marker, and republishes `catchStore` (list, stats, open card). `importData` currently does this by hand
(`Catch.all = await idb.getAll('catches')`, `Catch.layer.clearLayers()`, `Catch.all.forEach(addCatchMarker)`,
`renderCatchList()`). That still works (all four names are kept), but please replace it with
`await catchesReload()` so the two can't drift.

Note: `importData` writes catch records with no coordinate checks. `addCatchMarker` now skips a record
whose lat/lng isn't a finite in-range number (returns `false`) instead of letting `L.marker` throw
"Invalid LatLng" mid-loop, and `catchesReload()` / `catchInit()` add markers per record inside a
try/catch and always publish the list — so a bad record lists (without Navigate) and can be deleted.

## 3. assistant.js — moon phase names no longer carry emoji (owner: assistant)

`Astro.moonPhaseName()` now returns plain names (`'Full Moon'`, not the emoji-prefixed legacy string), per
DESIGN.md §0.6 — good for First Mate's spoken answers. `assistant.js` line ~427 still prefixes its own moon
emoji in front of `a.phaseName`; please drop it. New catch records store the plain name in `cond.moon`; old
records keep the emoji form — use `cleanMoonName()` from `engine/catch.js` if you display `cond.moon`.

## 4. goto.js — `gotoStart({lat, lng}, name)` (owner: nav)

The catch list and catch card offer "Navigate" and call `await gotoStart({ lat, lng }, species)`, treating
a `false` result as "the user backed out". Please keep accepting a plain `{lat, lng}` object (the legacy
code read only `.lat`/`.lng`) and resolve `false` on cancel, as the contract table says.

## 5. Weather panel — open on the 10-day tab (owner: weather) — RESOLVED

`engine/weather.js loadWeatherPanel` already honours `{ tab: '10day' }`. The Tides sheet's "no forecast"
button now calls `openPanel('weather', { tab: '10day' })`. Nothing more needed — please keep accepting
that payload.

## 6. iOS shell — camera / photo-library usage strings (owner: FishApp-iOS)

The Log-a-catch modal has `<input type="file" accept="image/*" capture="environment">` (Take photo) and a
plain `accept="image/*"` input (Choose photo). In WKWebView these need **`NSCameraUsageDescription`** (and,
for some iOS versions, `NSPhotoLibraryUsageDescription`) in `Info.plist`, or the app crashes / App Review
rejects it. Suggested text: "FishApp uses the camera to add a photo to a catch you log." Also please confirm
the `shareFile` bridge command handles `image/png` (the catch card).

## 7. `StateBox` Retry target size (owner: ui)

`StateBox` renders its Retry as a `compact` button (40 px tall), under the 44 px minimum in DESIGN.md §3.
Either drop `compact` there or give `.ui-btn--compact` an invisible hit extension like `.ui-ibtn--sm::before`.

**Workaround now:** this group no longer passes `onRetry` to `StateBox`. `features/tides/RetryState.tsx`
renders the message with `StateBox` and a full-size (48 px) `Button` Retry under it — used by the Tides
sheet's no-stations / offline / error states and the catch log's load error. Once `StateBox` is fixed,
RetryState can go back to `<StateBox onRetry>`.

## 8. Toast — an alert tone for safety warnings (owner: ui / services)

The conditions watch (`engine/bite.js watchCheck`) toasts "wind is building … worth thinking about heading
in" / "swell is building …" warnings. Legacy led them with a warning emoji, so they never looked like
"Catch logged". `toast()` has no tone, `ToastHost` is always `role="status" aria-live="polite"`, and it is
one slot, so a later plain toast replaces the warning.

**Request:** add `tone?: 'alert'` to `toast()` opts / `ToastState`. For `tone: 'alert'`, `ToastHost`
renders `<Icon name="alert">` before the message with `--alert` / `--alert-text` styling (DESIGN.md §0.3:
red is for safety), uses `role="alert"`, and a plain toast arriving while an alert toast is still within
its `ms` should not replace it (queue it, or drop it).

**Workaround now:** `watchCheck` already calls `toast('Warning: ' + msg, { ms: 9000, tone: 'alert' })` —
the word "Warning:" is the signifier (DESIGN.md §0.4, glyph and/or words) and `tone` is ignored until the
toast service reads it. Spoken warnings (hands-free) are unchanged and carry no prefix.
