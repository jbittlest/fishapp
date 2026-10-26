# Requests from the navigation port (nav.js, goto.js, awake.js, tracks.js, features/nav)

Shared changes this group needs but does not own. A local workaround is in place for each.

## Owners: app shell (engine/app.js)

1. **Never reload into a pending update while a track or voyage exists only in memory.**
   `updateWouldInterrupt()` should also return true when `tracksHaveUnsaved()` (engine/tracks.js) or
   `gotoHasUnsaved()` (engine/goto.js) is true — or simply when `navUnsavedInMemory()` (engine/goto.js,
   checks both lists) is true. Those records are kept in memory when their IndexedDB write fails
   (quota, private mode). Every `applyPendingUpdate()` call in goto.js / tracks.js now goes through
   `gotoApplyUpdateIfSafe()`, which checks BOTH lists (a voyage end no longer reloads away an unsaved
   track, nor the reverse), but the `visibilitychange` and `controllerchange` paths in app.js still
   reload and lose them. Once app.js checks it, the navigation modules can call `applyPendingUpdate()`
   directly again.

## Owners: design system (src/styles/tokens.css, src/ui/Icon.tsx)

2. **Token `--on-alarm`** (still needed — the only colour literal left in `features/nav/nav.css`):
   text/glyph colour on the alarm red, white in *every* theme (the anchor alarm overrides night mode;
   `--text-1` is red at night and would vanish on the flashing red). Workaround: `var(--on-alarm, #fff)`
   in `.nav-alarm` and `.nav-alarm__silence`; drop the fallback once the token exists. (`ui.css`
   `.ui-btn--destructive` / `.ui-badge--alert` and `shell.css` use `#fff` on red for the same reason
   and could use it too.) The `rgba(0,0,0,…)` shadows in nav.css are gone: map markers use the ring
   only (like the spot markers) and the Silence button uses `var(--e1)`.
3. **Icons `eye` / `eye-off`** for "show / hide on the map" (Voyages, Tracks). Workaround: a text
   `PillButton` ("Show" / "Hide").
4. Optional: **`corner-up-left` / `corner-up-right`** turn glyphs. The Go-To card currently uses the
   existing `DirectionDial` (arrow relative to the bow) beside the words "turn 12° right".

## Owners: voice (engine/voice.js)

5. `voiceCall('routeStart' | 'gotoCancel' | 'anchorRaise')` resolves functions through `window[fnName]`,
   which no longer exist as globals — the commands answer "I can't do that right now." Import
   `routeStart`, `anchorRaise` (engine/nav.js) and `gotoCancel` (engine/goto.js) directly. Note:
   `routeStart()` and `gotoCancel()` now return Promises (they may show an in-app confirm), so reply
   after awaiting them — `gotoCancel()` can be declined.

## Owners: assistant (engine/assistant.js)

6. Lines ~732, 735 and 762 read `document.getElementById('route-speed' | 'route-gph')`. Use
   `getRouteSpeedKn()` / `getRouteGph()` from engine/nav.js instead (persisted engine state; `0` means
   "not set", exactly like the old empty input). The Tools panel inputs no longer exist in the DOM.

## Owners: spots / weather (engine/spots.js, engine/inspect.js)

7. `gotoStart(ll, name)` now returns `Promise<boolean>` (it may ask "discard the voyage in progress?").
   Await it; it closes the open map card itself once the run starts (`closeCard()`), so callers should
   not close or half-apply anything when it resolves `false`.
8. The backup import may keep calling `renderTracksList()` / `renderTripsList()`; they still exist and
   now reload `tracksStore` / `tripsStore`.

## Owners: tides (features/tides/CatchLogSection.tsx)

9. `ToolsPanel` renders `<CatchLogSection />` first with no wrapper — please render your own
   `<Section label="Catch log">` inside it.

## Owners: shell (src/shell/panels/LayersPanel.tsx)

10. `awakeStore.keepAliveKind` is now `'off' | 'on' | 'running' | 'warn' | 'native'` (`warn` = a watch or
    recording is armed but the keep-alive audio is not playing, e.g. a restored anchor watch before the
    first tap). The Device section could show a hint for `warn`, like it does for the wake lock.
    **App Store:** in the iPhone app the silent keep-alive loop is never played any more (Guideline
    2.5.4; the review notes say "no silent or continuous audio is played"), so `keepAliveKind` is
    `'native'` and `keepAliveText` explains it. The "Keep running in the background during a watch"
    toggle then controls nothing — please hide it (or render it disabled with the text) when
    `isNativeShell()` / `keepAliveKind === 'native'`, so the iPhone app shows no dead control.
11. `awakeStore.bgLocation` is true while the iPhone app has background GPS switched on.

## Owners: shell (src/shell/App.tsx)

14. **Keep the Go-To guidance on screen while a card is open.** `App.tsx` renders `<GoToCard />` only
    when no card is open (`gotoActive && !card`), so tapping the map mid-voyage (inspect card, a spot
    card…) hides distance, bearing, ETA and the steer cue until the card is closed. Showing a saved
    voyage / track no longer opens a card during a Go-To (engine fix), but every other card still
    does this. Suggest: `showPill = gotoActive && ((sheetOpen && !desktop) || !!card)` so the
    glanceable `<NavPill />` (tapping it calls `closePanels()`; it could also `closeCard()`) stays in
    the persistent layer whenever the card is covered.

## Owners: iOS shell (FishApp-iOS, outside this repo) — verify before submission

15. The web app now arms the native anchor monitor (`nativeAnchorWatch` on drop / restore / radius
    change, `{on:false}` on raise and at boot when no watch is restored, `nativeAnchorSilence` on
    Silence), so the APP_STORE.md review test "drop anchor, lock the phone, move away → notification +
    alarm tone" can now pass. Please run it on a device.
16. With the silent keep-alive gone from the iPhone app, check APP_STORE.md:113 ("start a track, lock
    the phone for a few minutes, unlock: the track continued"). Background location keeps the app
    process alive, but WebKit may still suspend the WKWebView's web-content process; if the track has
    a gap, NativeBridge.swift should buffer the CoreLocation fixes it receives while backgrounded and
    replay them to the page (in order, with their timestamps) when it becomes active.

## Owners: docs (docs/ARCHITECTURE.md)

12. The card registry uses one kind, `history`, with `data: { type: 'trip' | 'track', id }` (not
    separate `trip` / `track` kinds). Contract additions worth listing: `tripsStore`, `navStore`
    fields (incl. `anchorOutside`), `gotoStore` steer/ETA fields, `tracksHaveUnsaved()`,
    `gotoHasUnsaved()`, `navUnsavedInMemory()`, `navUnderWay()`, `anchorSyncNative()`,
    `awakeKeepAliveWanted()` / `awakeKeepAliveOk()`. A successful `tripRetrySave` / `trackRetrySave`
    re-points an open `history` card at the new storage key via `updateCard(id, { id: newKey })`.

## Owners: gps (engine/gps.js) — optional, belt and braces

13. `trackOnFix` is now guarded internally (nothing escapes it), so a throw can no longer skip the
    anchor evaluation that follows it. Wrapping the call site in gps.js in its own `try` as well
    would make that independent of tracks.js.
