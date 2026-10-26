# Requests from the weather polish pass

Changes the weather group needs in files it does not own. Each has a local workaround (or none is
needed for the screens to be correct). Shots: `tools/out/shots/weather/` (spec:
`tests/visual/weather.spec.ts`).

## 1. Shell — toasts sit on top of the map legends and the map card (owner: shell)

`.ui-toast` is fixed at `bottom: calc(var(--chrome-bottom) + 12px)`, z 600. That is exactly where
the legend column (rain / wind loop scrubbers) and a phone map card sit, so "Loading wind forecast…",
"Could not load wind forecast" or "100 of 671 fish records shown" cover the wind scrubber or the
card's action row for the toast's lifetime (seen in `iphone-*-17/18-legends-*.png` and a fish card).

**Request:** while a map card is open on a phone, lift the toast above the card (the card host
could publish its top edge as `--card-top`), and while `.wx-legends` is showing, either lift it above
the legend column or drop it to the top under the persistent layer. Workaround: none (transient).

## 2. Tokens — wind-speed bands at night (owner: design tokens) — follow-up to weather-overlays §2

The wind arrows' speed bands are hex literals in the divIcon HTML (`windColor()` in
engine/weather.js), so at night they were blue / green / yellow on the red-safe chart.
**Workaround now (weather.css, night only):** attribute selectors on the six legacy fills map them to a
red luminance ramp built from tokens (calm darkest → stay-home brightest, order preserved) and the
white speed figures to `--text-1`. Please add `--wind-unknown`, `--wind-0` … `--wind-4` per theme and
have `windArrowIcon` emit a band class; I'll swap the attribute selectors for the classes.

## 3. sst.js — a night-safe palette (owner: weather-overlays engine)

At night the SST image and its legend bar are drawn through one red-monochrome filter
(weather.css), so the legend still matches the picture and no blue/green light reaches the helm.
Brightness-ordered palettes (Reds = `BlackRedWhite`, Blues = `Ocean`) keep their meaning through it;
hue palettes (Blue to red, Rainbow) do not — both ends come out dark. The legend now says so at night
("Reds or Blues read best at night."). **Suggestion:** when the theme is night, request
`BlackRedWhite` from ERDDAP without overwriting the user's saved palette (and switch back by day),
or give the SST image overlay a `className` (`wx-sst-img`) so the night filter can target it
precisely (today it targets `.leaflet-overlay-pane img.leaflet-image-layer`, which is only SST).

## 4. Shell — short phones: the inspect card body scrolls (owner: shell) — FYI

On 393×659 (iPhone in Safari) and 393×852 the inspect card now fits with no inner scrolling. On a
375×548 viewport (iPhone SE in Safari: compact HUD, tab bar, zoom keys) the card host only has
~275 px, so the card body scrolls by about one row. If the shell ever hides the zoom keys while a
map card is open on short phones (they are not needed while reading a card), it would fit there too.

## 5. ui — compact buttons (owner: ui) — done, thanks

`.ui-btn--compact` now carries the 44 px hit extension, so the weather feature dropped its own
`wx-hit44` helper (weather-overlays §8 is closed).
