# FishApp design system — "Glass Helm"

Dark-first chrome modelled on premium marine electronics: ink-navy surfaces, white type, one amber
signal colour and instrument-grade numerals, floating over a chart that stays the hero. At night the
whole UI collapses to a low-luminance red monochrome. In direct sun, reading surfaces switch to paper.

Chosen 2026-10-05 from three judged concepts (A "Glass helm" won 2/3 judges; grafts from C "Field
instrument" and B "iOS native" are folded in below). Tokens: `src/styles/tokens.css`. Primitives:
`src/ui/` (use them — never hand-roll a button, row, switch or number).

## 0. Principles (these decide every tie)

1. **The chart is the hero.** Chrome floats on the chart as compact cards. Nothing spans the full width
   except sheets. At rest, chrome covers no more than ~30% of a phone screen.
2. **Instruments and SOS are never covered.** The HUD, the nav pill / watch bands and SOS live on the
   *persistent layer* (z 400) above every sheet. A sheet's tallest detent stops below them
   (`--persist-bottom`, measured live by the shell).
3. **One signal colour.** Amber (`--signal`) means "live / selected / you / where you're going / press
   here". Red (`--alert`) is reserved for safety: SOS, alarms, destructive actions, a degraded watch.
   There is no yellow caution tier.
4. **Never colour alone.** Every status carries a glyph and/or words (GPS dot + "±4 m", rough-day
   triangle + bold, "chance" spelled out, alarm text). At night status is carried by SHAPE.
5. **Glanceable over decorative.** Labels are 11 px caps, values big and semi-condensed with tabular
   figures, units small and secondary. Readable in a half-second look at the helm.
6. **No decoration that isn't information.** No emoji anywhere in chrome or copy (use `<Icon>`), no
   gradients (except functional scrims), no glows, no coloured left-border cards, no sparkle icons for AI.
7. **Honesty is a feature.** Never show a stale value as live, never show `0` for "unknown" (use `<Num>`,
   which renders "—"), always label estimates ("~"), chance-of-rain is "chance", chart depth is
   "chart depth", satellite water temp says how old it is. Safety, honesty and legal copy from the
   legacy app is kept word-for-word (emoji removed).

## 1. Themes

`<html data-theme="day|sun|night">`, chosen in Map Layers → Display (Auto / Day / Sun / Night; Auto = Day
between sunrise and sunset at the boat, Night otherwise). The chart LUT follows (`data-lume`).

* **day** — ink chrome and ink sheets.
* **sun** — high glare: HUD, SOS, tab bar and map controls stay ink; sheets, modals and cards switch to
  paper. Any reading surface opts in with the `surface-paper` class (`<Sheet>`, `<Modal>`, map cards do
  this already); tokens remap inside it, so components need no theme code.
* **night** — red-safe: two text levels, signal is red-orange, everything ≤ ~0.32 luminance. The anchor
  alarm deliberately overrides night mode.

Never hard-code a colour. If a token is missing, add it to `tokens.css` for all three themes.

## 2. Type

* `--font-ui` Barlow (400/500/600/700) — UI text. `--font-inst` Barlow Semi Condensed (500/600/700) —
  every instrument value and number-dense UI. Both bundled (offline).
* Live values and aligned columns: tabular figures (`<Num>` does it). Static heroes may pass `proportional`.
* Classes: `.ui-title-1` (22/28 600, sheet titles), `.ui-title-2` (17/22 600), `.ui-body` (16/23),
  `.ui-sub` (13/18 500 secondary), `.ui-caption` (12/16), `.ui-label` (11/14 600 caps +0.07em),
  `.ui-hint` (13.5/19 explanatory copy). Inputs are always ≥ 16 px (iOS focus zoom).
* Degrees hug the number (`64°F` → `<Num deg="°F">`); other units follow after a thin gap
  (`<Num unit="kn">`).

## 3. Layout

* 4-pt grid (`--sp-*`), gutter 16 (phone) / 24 (desktop). Touch targets ≥ 44×44 (visual elements
  smaller than that get an invisible hit extension). ≥ 8 px between adjacent actions; ≥ 12 px between
  two actions a wet thumb could confuse (Go-To ✓ / ✕).
* Safe areas: every fixed edge adds `env(safe-area-inset-*)` (`--safe-*` tokens). `viewport-fit=cover`.
* **Phone**: HUD top; SOS top-right under it; nav pill / watch bands under the HUD; map controls right
  column; zoom + Go-To card above the floating tab capsule; sheets rise from the bottom with two
  detents (`medium` ≈ half, `full` = just under the persistent layer); the tab capsule floats over the
  sheet's bottom edge so navigation stays tappable.
* **Desktop / iPad landscape (≥ 900 px)**: the tab capsule becomes a 76 px left rail; sheets become a
  400 px non-modal side panel beside it; the chart stays interactive.
* **Z scale** (tokens): chart 0 · overlays 10 · scrim 20 · chrome 100 · backdrop 200 · sheet 300 ·
  tab bar 350 · persistent 400 · modal 500 · toast 600 · alarm 900 · boot 1000.

## 4. Components (all in `src/ui`)

| Need | Use |
|---|---|
| any number | `<Num value digits unit deg size approx stale>` |
| buttons | `<Button variant="primary|secondary|ghost|destructive" icon block compact busy>`; `<IconButton icon label>` (label required); `<PillButton on>` |
| panels | `<Sheet title subtitle actions footer>` — one per panel; header actions ≤ 3, close is automatic |
| groups of rows | `<Group>` + `<ListRow icon title subtitle trailing chevron onPress>`; `<Section label action>` for labelled blocks |
| settings | `<ToggleRow>`, `<RadioRow>`, `<Segmented>` |
| facts | `<StatTile icon label dial detail>` (+ `<DirectionDial towardDeg>`), `<StatStrip cells>`, `<KeyValues items>` |
| forms | `<Field label hint>` + `<TextInput>`, `<TextArea>`, `<Select>` |
| chips | `<ChipRow>` + `<Chip>` |
| status | `<Badge tone>`, `<Notice tone icon title>` (honesty/safety copy), `<Hint>` |
| async | `<LoadingRow>`, `<StateBox icon onRetry>` (empty / offline / error), `<Spinner>`, `<ProgressBar>` |
| expand | `<Disclosure summary>` |
| tiny charts | `<MiniBarChart values labels nowIndex>` |
| modals | `<Modal title primaryLabel onPrimary onCancel>`; quick questions: `confirmDialog` / `promptDialog` / `alertDialog` from `services/ui` |
| icons | `<Icon name>` — see `ICON_NAMES`; add glyphs to `Icon.tsx` in the same style (24 grid, 1.75 stroke) |

Rules: one primary button per view; destructive actions confirm with `confirmDialog({destructive:true})`;
long lists group into `<Group>`s of ≤ 8 rows with section labels; empty states say what to do next.

## 5. Map symbology (drawn in Leaflet, styled by CSS classes that read tokens)

* **Own-ship**: hull silhouette rotated to course (`engine/gps.js` boatIcon), signal fill on an ink keyline.
  Never a generic arrow (it read backwards once a route touched its tip). Disc when heading unknown.
* **Active route / Go-To leg**: ink casing (7.5 px) under a signal core (3.5 px), round caps; the leg starts
  ahead of the bow, not at the hull.
* **Recorded track**: ink 55%, 2.5 px, dotted.
* **Destination**: ink disc, signal ring, white centre; name chip beside it.
* **Saved spots**: ink disc with a white type glyph; name on an ink chip (never bare text with a halo).
* Chart labels on the map: 12/600 on an ink chip at ≥ 86% opacity.
* SVG `fill`/`stroke` attributes do not resolve `var()`; give elements a class and set colours in CSS.

## 6. Motion

`--t-fast` 120 ms (press), `--t-base` 220 ms (thumbs, chips, banners), `--t-sheet` 380 ms. Instruments never
animate their numbers. Map moves use Leaflet's own animation; chrome never moves with the map.
`prefers-reduced-motion` turns everything off EXCEPT elements marked `.keep-motion` (anchor alarm flash,
motor ARMED pulse, Go-To arriving pulse) — safety signals animate for everyone.

## 7. Copy

* Sentence case. Verbs on buttons ("Drop anchor", "Log catch", "Download this area").
* No emoji in strings (the toast service strips them as a backstop, but write clean copy).
* Units: kn, nm, ft, °F, °T (course/bearing are true). Times local, 12-hour ("2:40 PM").
* Keep every safety, honesty and legal sentence from the legacy app verbatim apart from emoji.
