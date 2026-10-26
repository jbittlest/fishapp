# Shared requests from the motor-helm port

Group: motor-helm (src/engine/motor.js, src/engine/helm.js, src/features/motor/*).
Each item has a local workaround already in place; none blocks the port.

## 1. Token: `--font-mono` (styles owner)

The recon log, UUID inputs and the `MOTOR.md` code chip need a monospace stack. Please add to
`src/styles/tokens.css` (same value in all three themes, it is not a colour):

```css
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

Workaround: `src/features/motor/motor.css` uses `var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)`.

## 2. MOTOR.md (repo root): labels and the STOP naming rule (docs owner)

- Step 6 still names the legacy emoji labels (`⏺ Record frames`, `★ Mark what I just did`,
  `⇩ Export session`, `➕ Add captured command`, "More → Trolling Motor"). The new labels are
  "Record frames", "Mark what I just did", "Export session", "Add captured command",
  "More → Trolling motor".
- STOP is now matched **exactly**: the command must be named `STOP` (any case, surrounding spaces
  ignored). The STOP button, the deadman, backgrounding the app, a manual disarm and a manual
  disconnect while armed all send that command. A label that merely contains "stop"
  (e.g. "Spot-Lock stop") is never treated as the emergency stop. Please add one line to Step 6
  ("Name your stop command exactly STOP") and to Step 7.3.
- The "can this move the boat" question now has "Yes, it can" as the emphasised (primary) button
  and "No, it cannot" as the secondary. "No" (or dismissing) leads to a second, red question
  "Save "<label>" as harmless?"; only an explicit tap on **Save as harmless** saves a command as
  harmless, and dismissing either question means it **can** move the boat (fail-safe). Step 6.4
  "Answer yes" still reads correctly.
- A command named STOP skips that question (STOP is always sent without arming or a confirm) and
  asks "Save this as the STOP command?" instead. Only one STOP can be saved.
- STOP now also works while disarmed: the panel shows the STOP button whenever the link is up
  and a STOP command exists, and tapping STOP in the Commands grid sends it at once.
- Profiles saved before the exact rule: if no command is named STOP but one contains "stop"
  (e.g. "Stop motor"), the panel shows a red notice naming it ("... is no longer sent as STOP")
  with a confirmed one-tap **Use "<label>" as STOP**, which saves a copy named STOP. The
  MotorBand says the same while armed. Worth a line in MOTOR.md's upgrade notes.

## 6. Three-outcome confirm dialog (ui / services owner)

`motorAddFrame` needs a question with three distinct outcomes: "Yes, it can" (primary, safe),
"No, it cannot" (explicit, risky) and dismiss (= Yes). `confirmDialog` returns a boolean, so a
dismissal cannot be told apart from the secondary button; the motor port works around it with a
second confirm. Suggested API in `src/services/ui.ts` + `DialogView`:

```ts
choiceDialog(opts: { title: string; message?: string;
  choices: { id: string; label: string; variant?: 'primary' | 'secondary' | 'destructive' }[];
  dismissId: string }): Promise<string>
```

With that, the add-command flow becomes one dialog again.

## 3. MOTOR.md is not reachable from inside the app (owner decision)

The panel copy (kept verbatim) says "See MOTOR.md for how to get them", but nothing in the app
links to it and the service worker does not precache it. If you want a link, decide on a hosted
URL (e.g. the GitHub page of MOTOR.md) and it can be opened with `openExternal()`; the panel shows
it as an inline code chip for now.

## 4. Primitives (ui owner) — FYI

- `Button compact` is `min-height: 40px`, below the 44 px target in DESIGN.md §3. The motor panel
  avoids `compact` for that reason.
- `.ui-btn--destructive` uses a `#fff` literal and has no night-mode override (`.shell-sos` switches
  to black text at night). The motor ARMED button, STOP and the MotorBand STOP use the destructive
  variant. A `--alert-ink` token would fix both.

## 5. Notes for the shell

- The More sheet hides the motor tile with `!isNativeShell()`; `motorSupported()` now returns the same
  answer in the iOS shell (`motorSupport().reason === 'native'` is checked first). On a web
  browser without Web Bluetooth the tile still shows and the panel explains why (intended: the
  explanation is the useful part there).
- `MotorBand` returns `null` unless the link is ARMED; it carries its own `.keep-motion` pulse.
