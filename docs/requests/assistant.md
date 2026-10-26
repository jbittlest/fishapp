# Shared requests from the assistant (First Mate) port

Group: assistant (src/engine/assistant.js, src/engine/fish-tips.js, proxy/first-mate-worker.js,
src/features/assistant/*). Nothing here blocks the port; each item says what First Mate relies on.

## 1. Owner, before App Store submission: redeploy the First Mate Worker

`proxy/first-mate-worker.js` now also accepts the iPhone app's origin, `fishapp://app` (the
registered custom scheme in FishApp-iOS WebAppView.swift); every other browser origin is still
refused. The literal `null` origin is deliberately NOT accepted — every sandboxed iframe, data: URL
and file:// page sends it, so allowing it would open the free chat and voice to any website.
Before deploying, confirm the real header from an iOS build (Safari ▸ Develop ▸ the app ▸ Network,
the request to the Worker, `Origin`). If it ever turns out to be `null`, don't just add it back:
gate on something else as well (an app header plus rate limiting).

The /tts route no longer calls OpenAI: the OPENAI_KEY path was removed because the privacy policy
and the consent question name only Cloudflare (and Anthropic with the user's own key). A leftover
OPENAI_KEY secret on the Worker is ignored; delete it in the dashboard to be tidy.

The file is edited but NOT deployed. Until it is pasted into the Cloudflare dashboard
(Workers & Pages → first-mate → Edit code → Deploy), the iOS app's free AI chat and natural cloud
voice get HTTP 403 — and the deployed web Worker keeps sending voice text to OpenAI if that secret
is set. The app copes with a 403 — the first question shows "Couldn't reach the AI (the free AI
relay refused this app)" with the offline answer, then First Mate drops to "Data mode — AI relay
unavailable" for the session — but a reviewer would see it. Smoke test after deploying: in the iOS
app, First Mate → "Tides today" with signal and cloud AI allowed.

## 2. legal (src/legal/privacy.js) + owner: the disclosure must match what is sent

With the user's consent (asked in-app before the first cloud call, guideline 5.1.2(i), switch
"Allow cloud AI" in First Mate settings), a cloud brain receives more than the old wording said.
`ASST_CLOUD_DATA` in src/engine/assistant.js is now the single source for the consent question and
the settings hint:

> your question and the recent conversation, plus the boat data needed to answer it: your position,
> speed and heading, local conditions, nearby reefs, your saved spots (names, positions and notes),
> your catch log (species, sizes, baits and dates), and trip and anchor-watch status

(The live snapshot carries speed/heading, the catch-log summary and trip/anchor state; Claude's
`list_waypoints` tool hands over every saved spot with coordinates and notes.)

Please change privacy.js, "First Mate, the AI assistant", second bullet, from "(your position,
local conditions, and the names of nearby spots and reefs)" to the list above, e.g.:

> If you allow cloud AI, your question, the recent conversation and the boat data needed to answer
> it (your position, speed and heading, local conditions, nearby reefs, your saved spots with their
> names, positions and notes, your catch log entries, and trip and anchor-watch status) are sent to
> the FishApp AI relay, which runs on Cloudflare Workers AI. It is processed to produce the reply
> and is not stored by FishApp.

The natural cloud voice bullet can stay, with "only if you allow cloud AI" made explicit — the app
now enforces it (the cloud voice needs consent 'yes'; a never-asked user keeps the device voice).
Processors stay Cloudflare Workers AI and Anthropic; OpenAI is NOT a processor any more (see 1).

App Store Connect "App Privacy" answers: Precise Location, User Content (Other — saved spots and
their notes, catch log) used for App Functionality, not linked to identity, not used for tracking.

## 2b. src/ui Overlays (DialogView): let a confirm dialog tell "dismissed" from "declined"

A tap on the dialog backdrop resolves `confirmDialog` as `false`, the same as the Cancel button, so a
stray tap on First Mate's "Use cloud AI?" question stores a permanent "Don't allow". Request: an
option such as `confirmDialog({ …, dismissible: false })` (backdrop does nothing), or resolve a
backdrop dismissal as `null`. `asstAskCloudConsent` already treats anything other than true/false
as "no decision" and saves nothing, so either change works without touching assistant.js beyond
passing the option. Meanwhile the question times out after 60 s (taken down, nothing saved), and a
hands-free question with First Mate closed is answered on the phone and asked about on the next open.

## 3. iOS shell (FishApp-iOS): microphone / speech usage strings

Same strings the voice-guides request asks for (`NSMicrophoneUsageDescription`,
`NSSpeechRecognitionUsageDescription`). First Mate's mic button uses SpeechRecognition only when the
web view exposes it; without it the button is hidden, and a `not-allowed` error hides it for the
session with a toast that says how to turn it on.

## 4. layers.js: refusals should be synchronous (or the tool reports them late)

The Claude `toggle_layer` tool calls `setDataOverlay(id, on)` and then reads `layersStore` to report
what actually happened. If SST/rain refuse offline by calling `reportDataOverlay(id, false)`
synchronously inside their enabler, the AI tells the user the layer stayed off. An async refusal
still works in the UI, but the AI will have said "on".

## 5. spots.js: contract First Mate uses

`Spots.all` (array, mutated in place by `asstCreateSpot`), `addSpotMarker(spot)`, `spotsChanged()`
(refresh the Spots list/store after First Mate or voice adds a spot), `deleteSpot(id)` → Promise.
If `deleteSpot` ever gains its own confirm, the AI's `delete_waypoint` tool already checks
`Spots.all` afterwards and reports "the user kept it" instead of claiming it was deleted.

## 6. Nice to have (src/ui): an eye / eye-off icon

For a show/hide toggle on the Anthropic API key field. Not needed for the port.

## 7. Nice to have (src/ui): a 44px hit area for `.ui-btn--compact`

`.ui-btn--compact` is 40px tall with no hit extension (DESIGN.md asks 44×44). First Mate now uses
the regular 48px Button for "Try again", "This is how I sound" and "Use the FishApp relay"; a
`::before` extension like `.ui-ibtn--sm` / `.ui-pill` have would fix every other compact button too.
