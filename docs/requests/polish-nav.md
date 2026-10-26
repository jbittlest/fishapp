# Requests from the nav polish pass (src/features/nav)

Found while shooting `tests/visual/nav.spec.ts` (iPhone 15 + 375 px + desktop, day / sun / night).
None block the nav screens; each has a local workaround or is cosmetic.

## Owners: design system (src/ui/ui.css)

1. **Disabled buttons at night.** `.ui-btn--primary:disabled` / `.ui-btn--destructive:disabled` signal
   "disabled" by switching to `--text-3`, and the ghost/secondary ones keep `--text-1`. At night
   `--text-3` is the same red as `--text-2`, so a disabled primary reads exactly like an enabled
   secondary button (seen in the Tools panel: "Start route" before two points exist). Suggest adding
   `opacity: .5` to every `.ui-btn:disabled` (or at least under `:root[data-theme="night"]`).
   Workaround: `.nav-tools-grid > .ui-btn:disabled { opacity: .5 }` in nav.css.
2. **`--on-alarm` exists now** (tokens.css), so request #2 in `docs/requests/navigation.md` is done;
   nav.css no longer uses the `#fff` fallback. `ui.css` `.ui-btn--destructive` / `.ui-badge--alert`
   could use it too.

## Owners: navigation engine (src/engine/tracks.js, src/engine/nav.js)

3. **Default track names wrap.** A new track is named `Track 10/25/2026, 5:53:57 PM`, which wraps to
   two lines in the Tracks list on a phone and repeats the date the row's subtitle already shows.
   Suggest `Track · Oct 25, 5:53 PM` (no seconds, short month). Copy only — no behaviour change.
4. **Measure toast duplicates the panel hint.** Entering Measure mode toasts "Tap two points to
   measure" while the Tools sheet already shows the same instruction under the button; on a phone the
   toast lands on top of the result strip (Distance / Statute / Bearing) for ~3 s. Suggest skipping
   that toast when the Tools panel is open (`isPanelOpen('tools')`). Same for "Point N added — keep
   tapping…", which covers the speed/fuel fields while adding points.
