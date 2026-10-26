# Requests from the spots / motor visual polish

Group: `src/features/spots/*`, `src/features/motor/*`. Nothing here blocks; each item has a local
workaround in place. Screens: `tools/out/shots/spots/` (spec `tests/visual/spots.spec.ts`).

## 1. src/ui/Icon.tsx — a filled stop mark (owner: design system)

The shared `stop` glyph is Lucide's outline `Square`. On a STOP button it read as an empty checkbox
("[ ] STOP"). Workaround: `.motor-stopglyph .ui-icon { fill: currentColor; }` in `motor.css`, applied
to the three STOP buttons (deadman row, command grid, MotorBand). Suggest the icon set grow a
`stop-filled` (or make `<Button>` forward `filled` to its icon) so every STOP in the app matches.

## 2. src/ui — `StateBox` empty states (owner: design system)

* `.ui-state__msg` would read better with `text-wrap: balance` everywhere (orphans such as "map." and
  "one." on their own line). Applied locally, scoped to this feature's sheets (`.spot-sheet`).
* The spots feature puts empty / error states in a quiet outlined well
  (`.spot-sheet .ui-section > .ui-state`). That rule also covers the Voyages and Tracks sections that
  `SpotsPanel` composes from `features/nav/Sections.tsx`, so the whole sheet is consistent. If the
  design system adopts a well for `StateBox` itself, drop the rule in `spots.css`.

## 3. shell.css — `.map-chip` keyline (owner: shell)

Spot name chips now carry a faint keyline (`outline: 1px solid color-mix(text-1 22%)`), which keeps
the ink chip's edge visible over dark water (satellite, night chart). The destination chip that
`goto.js` draws uses the same `.map-chip` and would benefit from the same line; it lives in
`shell.css`, so it was not changed here.

## 4. Dev server — stale `src/ui/Icon.tsx` (owner: whoever runs the 5181 server)

During this pass the dev server served an older transform of `src/ui/Icon.tsx` without `life-buoy`
(the Ramp / dock glyph fell back to a plain circle) until the module was re-transformed. The source is
correct; if a screenshot shows a plain circle for "Ramp / dock", restart or touch the module.
