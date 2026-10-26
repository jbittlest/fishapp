# Polish requests from the shell group (2026-10-25)

Shell = `src/shell/*`, `src/ui/*` (visual only), `src/styles/*`. Screens: `tools/out/shots/shell/`.
Nothing here blocks a group; each item says what changed in the shared layer and what we'd like
the owning group to check.

## Heads-up: shared-layer changes every group will see

1. **Empty numbers are quiet.** `<Num>` now adds `is-empty` when it renders the dash, styled
   `--text-3` / weight 500. An unknown value no longer looks like a bright live reading. No API
   change. If a tile relied on a bright "—" as its headline, say so.
2. **Sheets (phone):** a hairline appears under the header once the body scrolls (`.is-scrolled`),
   and a functional scrim fades content out under the floating tab capsule (`::after`, height
   `--tab-clear + 10px`). If a panel has its own sticky footer/strip at the very bottom of the
   body, check it still reads (the `footer` prop is unaffected).
3. **Toasts** size to their text and centre with auto margins (the old `left: 50%` + translate
   capped them at half the screen, so long safety toasts wrapped into five lines). On desktop
   they centre over the chart, beside the rail and any open panel. The action button is now a
   36 px filled pill with a 44 px hit area.
4. **Switch at night:** OFF = dim knob on a dark track, ON = black knob on the signal track (OFF
   used to show a bright knob that read as "on"). Tokens `--knob` / `--knob-on`.
5. **Inputs:** the 2 px signal inset is the only focus ring (the global outline used to draw a
   second ring outside it).
6. **Spacing:** `.ui-group + .ui-hint` / `.ui-seg + .ui-hint` get 8 px top + 4 px inset;
   a `.ui-notice` after a group, hint or segmented control gets 12 px top.
7. **Night stale values** (`<Num stale>`) also dim to 62 % opacity: at night `--text-3` equals
   `--text-2`, so stale numbers looked live.
8. **HUD:** the chart-tile spinner moved onto the Map layers control (corner ring) and the
   OFFLINE marker is now a chip top-left of the chart (`.shell-left`, under the persistent layer),
   so the coordinates never truncate at 375 px. SOS is now the HUD's height (one aligned band).
9. **Desktop map card** sits at `bottom: 12px`, bottom-aligned with the side panel (it used to
   float `--chrome-bottom` above the bottom, leaving a 120 px gap). New measured variable
   `--card-clear` = px from the screen bottom to the card's top edge (0 with no card).
10. New role tokens for things that used literals: `--chart-bg`, `--chart-halo`,
    `--chart-label` (text on ink chips/discs), `--ink-text-1/2`, `--ink-control` (always-ink cards
    inside paper sheets), `--e-thumb`, `--e-knob`, `--e-chip`, `--alarm-dim`. Use them instead of
    `#fff` / `#F3F6F9` / `rgba(0,0,0,…)`.

## Dev-server note (all groups)

The running Vite dev server was serving a **stale `tokens.css`** without `--alert-ink`: every
`.ui-btn--destructive`, `.ui-badge--alert` and SOS label inherited `--text-1`, so at night
"Delete", "Text my location for help" and "SOS" were red text on a red fill. Touching tokens.css
fixed it. If a screen of yours shows a colour that disagrees with tokens.css, re-save the file
it comes from (or restart the dev server) before chasing it as a design bug.

## weather (MapLegends / weather.css)

On desktop the legends column and an open map card share the bottom-left corner, and the card
(z chrome + 50) covers the legends. Please lift the column above the card while one is open, e.g.
`.shell.is-desktop.has-card .wx-legends { bottom: calc(max(var(--chrome-bottom), var(--card-clear)) + 12px); }`
and subtract `--card-clear` in `useAvailHeight` so the SST legend folds to its chip when the
card is tall. (On a phone the legends already hide while a card is open.)

## assistant (First Mate)

"Couldn't reach the AI (network). Offline answer:" carries a red alert triangle
(`.asst-msg__icon` → `--alert-text`). Red is reserved for safety (DESIGN.md §0.3) and the user
still gets a full offline answer; a network fallback is information — a neutral `cloud-off` (or
`info`) glyph in `--text-2` would keep red meaningful for the anchor/GPS warnings.

## voice (voice.css)

The centre disc is now 34 px (was 38 px; it nearly touched the capsule edge) and its label uses
`--text-2` like its neighbours (`--signal-fg` while listening). Please re-check
`.voice-tab__resume` (top 6 px, left 50% + 11 px) still sits on the disc's rim.

## all feature groups

Error boundaries now show a next step plus the technical message as a small mono caption
(`.shell-errtext`). While a module is mid-edit the Tides panel showed
"does not provide an export named 'RetryState'" in the boundary — transient HMR state, but worth
a reload before shooting.
