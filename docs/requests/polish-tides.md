# Requests from the tides visual-polish pass

Changes this group needs in files it does not own. Each has a local workaround (or none needed)
in `src/features/tides/*`.

## 1. Modal wrap: keyboard-aware scroll padding (owner: ui, `sheet.css`)

With the keyboard up (`--kb`), a focused field low in a modal sat half under the keyboard.
**Workaround now:** `tides.css` adds `scroll-padding-bottom: calc(var(--kb) + 20px)` to
`.ui-modal-wrap:has(.tide-form)`, and the catch modal scrolls the focused field into view
350 ms after focus. Suggest moving the `scroll-padding` onto `.ui-modal-wrap` for every modal
(then the `:has()` rule can go).

## 2. Catch card covers the catch it flew to (owner: tides-bite-catch engine, `engine/catch.js goToCatch`)

On a phone, tapping a catch in the log centres the chart on the catch and docks the card in the
upper half of the screen, so the card sits right over the marker it just flew to. Suggest
`goToCatch` pans so the catch lands in the visible strip between the card's bottom and the
bottom chrome (e.g. `map.panBy([0, -cardHeight / 2])` after `setView`, or `setView` with
`paddingTopLeft` equal to the card height). Layout-only; no workaround possible from React.

## 3. `StateBox` Retry size (owner: ui) — still open from tides-bite-catch.md #7

`RetryState` (tides) no longer wraps `StateBox`: it is now a compact one-row card (glyph,
message, full-size 48 px Retry), so at the sheet's medium detent the Retry is on screen with
the message instead of below the tab bar. If `StateBox` gets a full-size Retry and a compact
row variant, `RetryState` can be dropped.
