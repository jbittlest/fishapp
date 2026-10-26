# Requests from the weather-overlays port

Shared changes this group needs but may not make itself. Each has a local workaround in place
(or none is needed for the app to work).

## 1. Shell — the map card is hidden under an open sheet on phones (owner: shell)

`inspectAt(ll)` / a fish-sighting tap call `openCard(...)`. On a phone `.shell-cardhost` sits at
`z-index: calc(var(--z-chrome) + 50)` (150) at `bottom: calc(var(--chrome-bottom) + 10px)`, while an
open sheet is `--z-sheet` (300) and covers the bottom half at the `medium` detent. Tapping the visible
top half of the chart with the Weather/Tides sheet open therefore opens the inspect card *behind* the
sheet — it looks like the tap did nothing. (The legacy popup was anchored to the tapped point, so it
showed in the visible half.)

**Workaround now:** none in the weather feature (closing the user's sheet from the engine would be
surprising on desktop, where card and side panel are designed to coexist).

**Request (pick one):** on phones, either lift the card host above the sheet while both are open
(`.shell.is-phone.has-sheet .shell-cardhost { z-index: calc(var(--z-sheet) + 10); bottom: … }`), or
have `openCard` drop the sheet to a closed/peek state on phones.

## 2. Tokens — wind-speed bands for map symbology (owner: design tokens)

The wind arrows keep the legacy speed-band colours (`windColor()` in `engine/weather.js`: grey =
no data, blue < 7 kn, green < 14, yellow < 21, orange < 28, red ≥ 28). These are DATA colours and the
bands are safety-relevant, so they are unchanged — but they are hex literals inside the Leaflet divIcon
HTML, so they ignore the red-safe night theme.

**Request:** tokens per theme, e.g. `--wind-unknown`, `--wind-0` … `--wind-4` (night: a luminance
ramp in the red monochrome). Then `windArrowIcon` can emit `class="wx-windarrow__fill wx-windarrow--b2"`
and `weather.css` can colour by class. The divIcon already carries `className: 'wx-windarrow'`.
The Weather panel's view model already carries the same band per reading (`windBand` / `gustBand` on
`WxCurrent` and `WxHour`, from `windBand()` in engine/weather.js); today the panel marks readings at or
over the rough threshold (20 kn) with the alert triangle + heavier figures, and could add the band
tokens as a secondary cue once they exist.

## 3. Icon — a calendar glyph (owner: ui)

The "10-day forecast for this area" action on the inspect card uses `cloud-sun` for lack of a calendar
icon. Please add `calendar` (lucide `CalendarDays`) to `Icon.tsx`; I'll switch to it.

## 4. reefs.js — inspect readings are plain text now (owner: spots/reefs) — FYI only

`windText`, `swellText`, `sstText`, `depthText` (engine/inspect.js) are still exported but return plain
text, never HTML: same legacy words (`needs internet`, `no survey data here`, `no marine data (inland?)`,
`unavailable`, `land (N ft above sea)`, `X ft (Y m · Z fa)`), with the null fixes (`gust —`, no `@ 0s`).
`windText` now reads `12 kn from NW gust 18` (the legacy arrow glyph was dropped — it has emoji forms).
New structured helper for cards: `depthInfo(v)` → `{land, aboveFt, ft, m, fathoms}`.
`queryPointData`, `M_TO_FT` and `M_TO_FATHOM` are unchanged.

## 5. bite.js / conditions watch — where the forecasts live (owner: tides-bite-catch)

`fishapp.fc10` (payload shape unchanged) now only ever holds the boat's / map-centre's 10-day. A tapped
area's forecast ("10-day forecast for this area") is cached under `fishapp.fc10area` (exported as
`FC10_AREA_KEY`), so peeking at a distant spot no longer switches the bite windows and the spoken wind
and sea alerts off for HERE.

**Request (TidesPanel.tsx, bite "no forecast" state):** the hint says "Open the 10-day tab once with
signal", but the button calls `openPanel('weather')`, which `loadWeatherPanel` resets to the Now tab
(`fishapp.fc10` is not fetched, so the bite card stays at "no forecast" unless the user also finds and
taps 10-Day). The weather panel has an entry point for exactly this — please change it to
`openPanel('weather', { tab: '10day' })`: the sheet opens on the 10-Day tab for here and loads (and
caches) `fishapp.fc10` straight away.

## 6. Shell HUD — water temperature source (owner: shell)

`conditionsStore` (`{waterF, at, lat, lng}`) is filled by `refreshBoatWater()`: Open-Meteo marine
current SST (°F) at the boat. It is sampled

* whenever the weather panel's "Now" load runs at the boat's position (the user opened Weather), and
* on GPS fixes (at most every 20 min, or after a 3 nm move, never more than once per 2 min, only while
  the page is visible) — **but only while a weather feature is in use**: the Weather panel is open, or
  the wind or SST overlay is on (`boatWaterAutoAllowed()` in engine/weather.js).

The gate is a privacy fix (see §10): the boat's position used to be sent to Open-Meteo every ~20 min
from boot even if the user never touched a weather feature. `at` is the time of the sample; the HUD's
6 h / 10 nm guard still applies.

**Consequence / request:** until the user opens Weather (or turns on wind/SST) in a session, the HUD
WATER cell shows "—". That is honest, but a bare dash can read as broken. Suggestion: make the cell
a button that opens the Weather panel (which samples the water temp at the boat), or hide the cell
while `conditionsStore.getState().at === 0`.

## 7. layers.js — an overlay refusal must not overwrite the saved choice (owner: shell)

`sstEnable` / `rainEnable` refuse offline and correct the Layers toggle with
`reportDataOverlay(id, false)`. That function calls `savePrefs()`, so when boot replays the saved
overlays through `initDataOverlays` while offline (normal once the boat has left signal), `sst` / `rain`
were written to `fishapp.layers` as `false` and never came back on the next launch with signal. Legacy
only unticked the checkbox and dispatched no change event, so its saved pref survived
(legacy/js/app.js 252-266); the inventory's `overlay:uncheck` contract says "untick the toggle (at boot,
without persisting)".

**Workaround now:** `refuseDataOverlay(id)` in engine/sst.js (used by rain.js too) calls
`reportDataOverlay(id, false)` and then puts the `fishapp.layers` string back exactly as it was. Gap
that only you can close: any later `savePrefs()` in the same session (e.g. the user changes the base map
while still offline) writes the in-memory `sst: false` / `rain: false` again.

**Request:** give `reportDataOverlay` an unpersisted mode, e.g. `reportDataOverlay(id, on, { persist: false })`
(or a separate `refused` set in `layersStore` that the toggle shows and `savePrefs()` ignores), so only a
user toggle (`setDataOverlay`) writes `fishapp.layers`. Tell me when it lands and I'll drop the
workaround (`refuseDataOverlay` becomes a one-line call).

## 8. ui — compact buttons are 40 px tall (owner: ui)

`.ui-btn--compact` is `min-height: 40px` with no hit extension, below the 44 px minimum (DESIGN §3).
Inside the weather feature I add `wx-hit44` (an `::after` with `inset: -2px 0`) to every compact button
I render (age-note Retry, "Back to my position", SST "Play 5-day loop", inspect Retry). The one I can't
reach is `<StateBox onRetry>`'s Retry, which every feature's empty/offline/error state uses.

**Request:** add the same hit extension to `.ui-btn--compact` in ui.css (like `.ui-ibtn--sm::before`),
then I'll drop `wx-hit44`.

## 9. Layers panel — show the fish-sightings status (owner: shell) — optional

Fish-sighting toasts are now rate-limited (one result summary per minute while the map follows the
boat; an offline / error toast once per outage, re-armed by a successful load), so a repeated failure is
no longer re-announced every fix. `fishStore` (`{on, status: 'idle'|'loading'|'ready'|'zoom'|'offline'|'error', count, total}`)
carries the live state; it is rendered nowhere yet. Suggestion: a subtitle on the Fish sightings row in
the Layers panel, e.g. "38 shown" / "Zoom in to load" / "Needs internet" / "Couldn't load".

## 10. Privacy — where this group sends location (owner: shell / App Store submission) — FYI

For the App Privacy answers ("Precise Location", shared with third parties, not linked to identity,
not used for tracking) and the privacy policy. Every request below follows a user action, and none
carries an identifier, account or key:

| Service | What is sent | When |
|---|---|---|
| Open-Meteo forecast API (api.open-meteo.com) | the boat's position, or the map centre / a tapped point (3 decimals) | Weather panel open (Now, 10-Day, area forecast); tap-to-inspect; wind overlay / wind loop (a grid of points covering the visible map) |
| Open-Meteo marine API (marine-api.open-meteo.com) | same positions; a grid over the visible map for the SST colour range | Weather panel; tap-to-inspect; SST overlay; HUD water temp (only while Weather is open or wind/SST is on — §6) |
| NOAA CoastWatch ERDDAP (coastwatch.pfeg.noaa.gov) | the visible map's bounding box | SST overlay on |
| iNaturalist (api.inaturalist.org) | the visible map's bounding box | Fish sightings overlay on |
| RainViewer (api / tilecache.rainviewer.com) | map tile coordinates only | Rain radar overlay on |
| NOAA NCEI DEM identify (gis.ngdc.noaa.gov) | the tapped point | tap-to-inspect (chart depth) |

Nothing in this group sends location in the background or while the app is not visible.
