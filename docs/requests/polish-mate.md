# Requests from the "mate" polish pass (First Mate, Guides, Hey Fish tab)

Group: mate (src/features/assistant/*, src/features/guides/*, src/features/voice/*). Each item is
outside those files; each says what was seen in the shots (tools/out/shots/mate/) and what was
done locally in the meantime. Nothing here blocks shipping.

## 1. shell.css — the Hey Fish disc ran into its own label (shell owner)

`.shell-tab--voice .shell-tab__disc` is 38 px with `margin: -7px 0`, so the disc's bottom edge sat
on the "Hey Fish" / "Listening" label (no gap, ring animation touching the text).
Worked around in features/voice/voice.css with a more specific rule:
`.shell-tab.shell-tab--voice.voice-tab .shell-tab__disc { width: 34px; height: 34px; margin: -7px 0 -3px; }`.
Please fold that size into shell.css and the override can go.

## 2. Inputs draw two focus rings (ui.css / base.css owner)

`base.css` gives every element `:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px }`,
and `.ui-input:focus` already draws an inset signal ring — a keyboard-focused input shows both
(a doubled amber/red ring). Suggest in ui.css: `.ui-input:focus-visible { outline: none; }`.
Worked around for the First Mate composer and settings fields in asst.css.

## 3. First Mate offline tides answer ignores the Tides panel's data (assistant engine owner)

`asstAnsTides()` only reads a downloaded area pack. With signal, after the Tides panel has loaded
today's predictions, declining cloud AI and asking "What are the tides today?" still answers
"I don't have tide predictions offline for here … or open the Tides panel with signal." — which the
user just did. Suggest falling back to the Tides panel's loaded predictions (tidesStore) before
the "don't have" answer. Behaviour change, so not touched here.

## 4. Consent dialog copy block (ui Overlays / sheet.css owner) — optional

`Use cloud AI?` is one 15 px block of ~110 words; on a phone it fills the screen edge to edge.
Readable and complete, but it would scan faster with `text-wrap: pretty` on `.ui-modal__msg` and a
little more space between its two paragraphs (the message already contains the blank line).
The words are App Store 5.1.2 consent copy — do not shorten them.
