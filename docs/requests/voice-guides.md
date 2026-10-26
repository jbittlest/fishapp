# Shared requests from the voice-guides port

Group: voice-guides (src/engine/voice.js, knots.js, knot-diagrams.js, fish-id.js,
src/features/voice/*, src/features/guides/*). Nothing here blocks the port; each item says what
voice.js relies on or what would make the feature better.

## 1. iOS shell: usage strings for Hey Fish (FishApp-iOS owner) — App Store

If the WKWebView exposes `webkitSpeechRecognition`, starting it touches the microphone and Apple's
speech service. App Review rejects (and iOS terminates) an app that does this without:

- `NSMicrophoneUsageDescription` — e.g. "FishApp listens for “Hey Fish” so you can control the app hands-free."
- `NSSpeechRecognitionUsageDescription` — e.g. "Your spoken commands are turned into text to run them."

voice.js handles the rest in-app: a `not-allowed` / `service-not-allowed` error inside the iPhone
app (`window.FishNative` present) stops listening, remembers "off", toasts
"Microphone or speech recognition is off for FishApp — allow both in iOS Settings to use Hey Fish",
and sets `voiceStore.supported = false` for the session so the tab bar swaps Hey Fish for First
Mate. If the web view has no SpeechRecognition at all, `supported` is false from the start.
If the shell would rather never offer Hey Fish, it can simply not expose SpeechRecognition.

## 2. navigation (nav.js / goto.js / tracks.js): state voice.js reads after each action

Voice now reports what actually happened instead of assuming success, so it reads these after
awaiting the action. Please keep them (names from the legacy modules):

- `Nav.route.pts` (array), `Nav.anchor.watching`, `Nav.anchor.radiusFt`, `Nav.anchor.ll`
- `Goto.active`, `Goto.route` (a new array per started route), `Goto.startTs`
- `Tracks.recording`, `Tracks.points` (array); `trackStart()` / `trackStop()` exported (voice no
  longer uses `trackToggle`, which was a blind toggle). The "fewer than 2 points is not saved" rule
  in `trackStop` is mirrored in the spoken reply.
- `routeStart()`, `gotoCancel()`, `anchorDrop()`, `anchorRaise()` may return a Promise; voice awaits
  them. When one shows a `confirmDialog`, voice notices the open dialog (via `uiStore.dialogs`) and
  says "Check the screen…" so a hands-free user isn't left in silence.
- `Tracks.unsaved` (array; `trackKeepUnsaved` unshifts a new object on a failed storage write).
  "Stop track" compares it (by identity) before and after `trackStop()`, so a failed write is
  spoken as "The track could not be saved…" instead of "Track saved.". Please keep the name and
  the "new object per failure" behaviour.
- Voice relies on `routeStart()` taking the planner down once a route starts (`Nav.route.pts`
  empty while `Goto.active && Goto.route`): "follow the route" then answers "You are already
  following the route.".
- (Resolved by navigation: `routeStart()` no longer calls `routeClear()` when the user kept the
  voyage in progress.)

## 3. assistant (assistant.js): what voice.js relies on

- `ASST.speak`, `ASST.streaming`, `asstSpeak(text)` (must keep reading `ASST.speak`
  synchronously), `asstSend(text)`, `asstCreateSpot({lat,lng,name,type})`, `asstUpdateSpeakBtn()`.
- `voiceSay` now forces speech for its own utterance (set `ASST.speak = true`, call `asstSpeak`,
  restore) — before, every hands-free reply and every bite.js weather warning spoken while
  `Voice.on` was silent whenever First Mate read-aloud was off (the default). Cloud voice still
  goes through your consent check. If you prefer, voice can call `asstSpeakNow` instead — say so.
- Optional: replace the direct `Voice._muteUntil` writes in `asstSpeakDevice` / `asstSpeakCloud`
  with `voiceExtendMuteUntil(ts)` (max) and `voiceSetMuteUntil(ts)` (exact), now exported from
  voice.js. The direct writes keep working.
- `FISH_ID[i].emoji` is now `''` (kept only so an old `f.emoji + ' '` prefix can't print
  "undefined"); your `asstFormatSpecies` already dropped it.
- First Mate can open the fish tab directly: `openPanel('guides', { tab: 'fish' })`
  (or `{ tab: 'knots' }`).

## 4. Icon (src/ui owner, nice to have)

A `lightbulb` glyph (lucide `Lightbulb`) for knot tips and species notes. Workaround: `info` for
tips and `alert` for notes that carry a legal caution.

## 5. services/native.ts `openExternal` navigates the app away on the web (shell owner) — HIGH

On the web and in the installed PWA, `openExternal(url)` runs
`window.open(url, '_blank', 'noopener,noreferrer')`. Per the HTML spec `window.open` ALWAYS
returns null when `noopener` (or `noreferrer`) is in the features, so the
`if (!w) window.location.href = url` fallback runs on every call: the link opens in a new tab
AND the FishApp page itself is navigated to the external site. That unloads the anchor-watch
alarm loop, the Go-To voyage, track recording and the hands-free mic; an installed iOS PWA has no
back button, and offshore with no signal the app is replaced by a browser error page.

Suggested fix (all callers benefit; the shell's own Emergency/About links use it too):

```ts
export function openExternal(url: string): void {
  if (post('openURL', { url })) return;
  if (/^(tel|sms|mailto):/i.test(url)) { window.location.href = url; return; }
  let w: Window | null = null;
  try { w = window.open(url, '_blank'); } catch { w = null; }
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } return; }
  // Never assign location.href for http(s): the app may be running an alarm, a voyage, a track.
  // Fall back to clicking a temporary <a target=_blank rel="noopener noreferrer">, or tell the user.
}
```

Also: inside the iOS app, if `FishNative.post` throws, `post()` returns false and the same
web fallback runs, which would navigate the WKWebView itself away from the app.

Workaround in the Guides panel meanwhile (features/guides/GuidesPanel.tsx): in the iOS app both
CDFW controls call `openExternal` (the native `openURL` path, unaffected). On the web the inline
link is a real `<a target=_blank rel="noopener noreferrer">` and the button calls
`window.open(url, '_blank')` and cuts `opener`, with no `location.href` fallback (a toast names
the site if no tab could open). Switch both back to `openExternal` once it is fixed.

## 6. bite.js: pass the toast time to `voiceSay` (tides-bite-catch owner)

`watchCheck()` routes a weather safety alert to `voiceSay(alert.msg)` while hands-free is on and
to `toast(alert.msg, { ms: 9000 })` otherwise. On a device with no speech engine, `voiceSay`
shows the text instead (it now never replaces a toast that has an action button, and sizes the
time by length: 4 to 9 s). Please call `voiceSay(alert.msg, { ms: 9000 })` so a short swell
warning also stays up the full 9 s it gets as a toast. `voiceSay(text, opts)` is backwards
compatible.
