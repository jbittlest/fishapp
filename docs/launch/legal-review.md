# FishApp: legal-exposure review before the App Store launch

**Prepared 2026-10-27 by Claude (an AI model), for QuadSight Imaging LLC.**

> **I am not a lawyer, and this is not legal advice.** This memo is an issue-spotting review written the way product
> counsel might write one. It is meant to help the owner prioritise work and brief a licensed California attorney.
> It is not a substitute for that attorney. Statements about laws, regulations and third-party terms reflect my
> understanding as of my training data and the files in this repository. Where I am unsure, I say so. Fishing
> limits in particular **must** be checked against the current California Code of Regulations, Title 14, and
> CDFW's site before anyone relies on them.

**Scope.** The React app in `C:\Users\jbitt\fishapp-ui` (`src/`, `public/`, `tools/web/`,
`tools/storeshots/captions.json`, `proxy/`) and the iOS wrapper in
`C:\Users\jbitt\OneDrive\Desktop\Projects\FishApp-iOS` (`Info.plist`, `PrivacyInfo.xcprivacy`, Swift sources,
`APP_STORE.md`, screenshots `03-anchor`, `02-mpa` and `07-first-mate`, and the app icon). The two earlier audits,
`docs/launch/data-sources.md` and `docs/launch/aso.md`, were checked against the current code rather than taken on
trust. Facts: owner QuadSight Imaging LLC (California); the app is free, with no ads and no accounts; the audience is
Southern California anglers and boaters.

**Not done.** No USPTO or state trademark search. No web plagiarism search of the text (only a stylistic spot-check).
No live check of third-party terms pages: licensing statements rely on `data-sources.md` (policies read on
2026-10-26) and my own knowledge. No on-device testing.

---

## 0. Summary: the top issues

| # | Rank | Issue | Fix in one line |
|---|---|---|---|
| H1 | **High** | **No Terms of Use anywhere.** Nothing users accept limits liability, disclaims fitness for navigation, records assumption of risk or covers the AI. Apple's standard EULA covers only the App Store copy (it does not reach the web app) and says nothing marine- or AI-specific. | Have an attorney finalise `docs/launch/terms-draft.md`. Get assent in the first-run sheet and link it from About and the store listing. |
| H2 | **High** | **Fishing-limit numbers presented as facts look wrong or stale for several species** (yellowtail and bonito "No minimum", barracuda "3 per day", sheephead 13"/2, among others). They appear in Guides and in First Mate's answers, both offline and in the AI prompt. | Verify every row against Title 14 and CDFW now, stamp an "as of" date, or remove the numbers and link to CDFW. |
| H3 | **High** | **First Mate is told to be "confident" and "NEVER" to refer users elsewhere, except about size and bag limits.** Its area "game plans" name spots inside or next to MPAs (Point Vicente, La Jolla, Catalina's front side, the Channel Islands) with no MPA caveat. The AI can steer someone into a reserve or offshore in bad weather. | Carve MPAs and closures, weather go/no-go, navigation and medical questions out of the "never punt" rule. Add MPA caveats to `AREA_TIPS`. |
| H4 | **High** | **The Esri World Ocean Base is still the default map** (live only now) with no ArcGIS subscription, which is against Esri's terms per `data-sources.md`. The App Review notes also call Esri and OSM "public sources" (now corrected). | Make GEBCO or BlueTopo the default and drop the Esri bases, or buy ArcGIS Location Platform. |
| M1 | Medium | Open-Meteo's free tier is "non-commercial", and a free app published by an LLC is ambiguous. | Get written OK from Open-Meteo or buy a plan (owner decision 1 in data-sources.md). |
| M2 | Medium | **No open-source licence notices ship in the app** (MIT, ISC, BSD-2 and OFL all require them). | Add About > Open-source licences plus a bundled notices file. |
| M3 | Medium | Store and marketing overclaims: "Every California MPA built in" (aso.md promo), "Know where the lines are", "free AI first mate that works even with no signal", and the anchor caption "wakes you / the moment you drag" (fixed in the caption source; images need re-rendering). | Wording changes listed in section 6. |
| M4 | Medium | The privacy policy names no operator (QuadSight is not mentioned), and its only contact is a public GitHub issues page. The App Store seller name may not match. | Name QuadSight Imaging LLC and give a private email. Enrol in the developer program as an organization. |
| M5 | Medium | The trolling-motor feature (web only) controls a Minn Kota motor over a reverse-engineered Bluetooth protocol. This creates serious product-liability exposure if the boat moves unexpectedly, plus trademark and warranty issues. Its code also ships, unreachable, inside the iOS bundle. | Keep it out of iOS (strip it from the bundle). Have an attorney review it before it goes further on the web. |
| M6 | Medium | The "First Mate" assistant name is close to Mercury "1st-Mate" and Furuno "TZ First Mate", and it appears as a heading in the store description. | Clearance search, or rename (for example "Mate"). |

Edits I made are in section 9. The owner and attorney action list is in section 10.

---

## 1. Navigation and safety liability

### What exists (verified)
- **First-run notice** (`src/shell/Onboarding.tsx`): a modal titled "Before you head out" with three plain-language
  points (navigation aid only; data can be wrong; privacy basics) and an "I understand" button. Acceptance is stored
  as `fishapp.ack = v1` in localStorage. This is good, conspicuous and blocks the UI. Gaps: it does not mention any
  Terms; the "Read the privacy policy" link also records acceptance (line 50); and nothing re-asks after a material
  change unless `VERSION` is bumped by hand.
- **About** (`src/shell/panels/AboutPanel.tsx`) shows a "Not for navigation" notice with `NOT_FOR_NAVIGATION`
  (`src/legal/privacy.js`). The same text is at the top of `public/support.html`. The store description ends with the
  same disclaimer (`APP_STORE.md`).
- **Inspect card**: depth is labelled "Chart depth", but it is an NCEI DEM elevation-model value (`inspect.js`,
  `tiles.js` `ncei`), not a charted sounding. DEMs are usually referenced to NAVD88 or MSL, not to the MLLW chart
  datum, and are often interpolated. The old footnote said "from survey data, not your sounder". **Edited** to say it
  is an estimate, not an official chart, and can be wrong (section 9). The label "Chart depth" (and the caption subline
  "Chart depth, wind, swell and water temp") still overstates it. Rename it "Depth (est.)" (`InspectCard.tsx`
  lines 47-52, `captions.json`).
- **Anchor alarm** (`src/features/nav/ToolsPanel.tsx` 186-190): the native hint correctly says to keep the volume up
  and not to swipe the app away, and the web hint says a background alarm isn't possible. Good. Missing: that alarms
  depend on GPS accuracy (the alarm fires after two fixes outside the circle; see the APP_STORE review notes),
  battery, Focus/Do Not Disturb (the Time Sensitive capability is only "optional" in APP_STORE.md step 3), and the
  ring/silent switch. Add one sentence: "Not a substitute for a person on anchor watch."
- **Go/no-go answer** (`src/engine/assistant.js` `asstAnsGoNoGo`, about lines 792-821): thresholds give verdicts such
  as "Looks calm and fishable." Each verdict carries a bold "Rough read only — always get an official marine forecast"
  caveat (seen in screenshot 07). Acceptable, but "Looks calm and fishable" is affirmative safety advice built from
  model or cached data that can be days old. Prefer descriptive wording ("Model shows light wind and seas") and add
  "check for Small Craft Advisories".
- **Collision avoidance**: no AIS or collision feature found, so no claim to address. The description calls the app a
  "chartplotter", which implies navigation equipment. That is acceptable only because the disclaimer follows. Keep the
  disclaimer in the description.

### SOS screen (`src/shell/panels/EmergencyPanel.tsx`)
- It does **not** claim to contact the Coast Guard. "Text my location" opens Messages pre-filled, and the hint says
  "you just hit send". "Coast Guard / 911" with "Tap to call 911" dials 911. Fine, but the row title can read as
  though the app reaches the Coast Guard. Suggest the subtitle "Calls 911, which can relay to the Coast Guard (needs
  cell signal)", and add one line at the top: "This app does not contact anyone for you."
- **MAYDAY script**: it follows the USCG pattern (MAYDAY ×3; vessel name ×3; position; nature; people on board; Over),
  and it correctly gives PAN-PAN for urgency. Missing from standard USCG guidance: "VHF **Channel 16**, high power"
  next to the script; a short vessel description (length, type, colour); "everyone put on life jackets"; and, most
  important, **DSC**: "If your VHF has DSC and is connected to GPS, lift the red DISTRESS cover and hold the button 5
  seconds. It sends your position and MMSI automatically." Owner should add these. I did not edit them because they
  are new safety content, not a wording fix.
- **Satellite claims**: "on iPhone 14+, texts can go via satellite" and "can call for help with no cell service" were
  unqualified. Messages via satellite needs iOS 18 and Apple's service in the region. Emergency SOS via satellite
  depends on coverage and a clear sky. **Edited** to add "may work where Apple offers it" and "where Apple's satellite
  service is available".
- The emergency contact is stored only in WebKit localStorage (`fishapp.emgcontact`), which matches the policy.

### AI answers about weather, safety, regulations and medical matters
- Both cloud system prompts (`assistant.js` `asstSystemPrompt` about line 1150 and `asstProxySystem` about line 1236)
  include good safety lines ("Safety first ... VHF Ch 16 ... SOS"; "Never give false confidence about weather";
  regulations are a general reference). They also contain directives that cut against those lines:
  - "NEVER tell the user to ask a local, hire a guide, google it ... **The only thing to defer is confirming legal
    size/bag limits with CDFW**." Read literally, the model should not defer on MPA boundaries, seasons, depth
    closures, licences or Mexican permits.
  - The proxy prompt says "NEVER tell the user to open the Weather/Tides panel, check a buoy, or look it up themselves."
    That is fine for convenience, but combined with "confident" it discourages the official-forecast check the app's
    own disclaimer asks for.
  - There is no medical rule. A boater asking about a hook in an eye, hypothermia or a stingray sting should get first
    aid basics plus "call 911 / VHF 16". The model should not play doctor.
- **Fix** (owner or engineer; not edited here because the prompts are tested engine code): add one line to both
  prompts: "Exceptions to 'never punt': for MPA and closure boundaries, seasons and licences, defer to CDFW; for
  go/no-go and bar crossings, tell them to check the NWS marine forecast and advisories; for medical or emergency
  situations, give basic first aid only and tell them to call 911 or VHF 16." Change "The only thing to defer is
  size/bag" to "Always defer on regulations".
- **AREA_TIPS** (`src/engine/fish-tips.js` 161-176) recommends fishing at "Palos Verdes ... close to the beach" (keys
  include *point vicente*, which is a no-take SMCA), "La Jolla" (Matlahuayl SMR and the South La Jolla SMR/SMCA),
  Catalina's "Front side (Avalon→isthmus)" (Lover's Cove, Casino Point, Blue Cavern and Long Point SMCAs) and the
  Channel Islands (many reserves). Add to each: "Several MPAs here; check the MPA layer and CDFW." The confident
  deckhand persona makes this more important. A citation for fishing in an SMR is a misdemeanour under Fish & Game
  Code section 12000, and a user could blame the app.
- AI-labelling is good. The composer shows "AI answers can be wrong; never rely on them for safety." (screenshot 07),
  and the consent text repeats it.

### Terms, EULA and disclaimers
- **No Terms of Use exist** (searched `src/`, `public/`, `docs/`; About has privacy and credits only). **High.**
- **What Apple's standard Licensed Application EULA does**, if no custom EULA is uploaded: it grants a licence limited
  to Apple devices; disclaims warranties ("AS IS"); excludes consequential damages and caps total liability at
  US$50; chooses California law (for most users); and covers export and government use. **What it does not do:** it
  covers only App Store copies (not the GitHub Pages web app or the relay); it has no navigation or fitness
  disclaimer and no assumption of marine risk; it has no AI-output terms, acceptable use or relay limits; it has no
  regulation disclaimer, no indemnity and no arbitration; and it lists no QuadSight contact details. Its generic
  wording is also less likely to persuade a court that a boater knowingly accepted marine risk.
- **Assent**: a disclaimer only helps if it was conspicuous and accepted. The first-run sheet is a good clickwrap
  surface. Once Terms exist, change the button to "I agree", link Terms and Privacy, and bump `VERSION` to `v2`.
- **Attorney questions**: (1) Under California law, pre-injury releases cannot cover gross negligence (*City of Santa
  Barbara v. Superior Court*, 2007) or matters within Civil Code section 1668. How far does a liability cap protect a
  free app? (2) Would general maritime law govern an on-water injury claim against a software publisher, and does it
  treat exculpatory clauses more favourably? (3) Is a free app a "product" for strict liability? California courts are
  unsettled on software. The usual exposure is negligence, negligent misrepresentation (wrong regulations or depths)
  and failure to warn. (4) Product-liability insurance for the LLC: check whether the LLC's general liability policy
  excludes software and E&O. If it does, consider a tech E&O policy.

## 2. Fishing regulations and MPA information

### Size and bag table (`src/engine/fish-id.js`, `FISH_ID`)
Shown in Guides > Fish & limits and in First Mate's offline answers (`asstFormatSpecies`). It is also embedded in every
cloud-AI prompt (`asstRegsTable`), so the AI repeats it as fact. The UI disclaimer (`FISH_REG_WARN`, pinned first,
with a CDFW link) and the "verify with CDFW" suffix on every answer are good. The numbers still need to be right,
because people will act on them. **Rows I believe are wrong or out of date** (my understanding of Title 14 section
27/28; **verify each**):

| Species | App says | My understanding (verify) |
|---|---|---|
| California yellowtail | "No minimum", 10 per day | Minimum 24 in fork length, **but up to 5 fish under 24 in may be taken**; 10 per day. "No minimum" is wrong. |
| Pacific bonito | "No minimum", "Check current limits" | Minimum 24 in fork length or 5 lb, with 5 fish under that allowed; 10 per day. |
| Pacific barracuda | 28 in total length, **3 per day** | 28 in total length (or 17 in alternate length); I believe the limit is **10**. |
| California sheephead | **13 in, 2 per day**, "recently reduced" | I understand 12 in total length and 5 per day, unless a recent change I don't know about applies. The app's own note hedges. |
| Rockfish (RCG) | 10 per day combined | The RCG limit, sub-bag limits, depth limits and seasons have changed several times recently, and some species have been 0 (for example quillback, in some areas). Keep only "seasonal depth closures; check CDFW". |
| Ocean whitefish, Bocaccio, Corbina, Dorado, Bluefin | various | Bluefin's federal limit changes by rule. Mention the 20-fish general aggregate. |

**Fix (High):** have the owner check each row against CDFW's current Ocean Sport Fishing Regulations booklet and the
online "Summary of Recreational Groundfish Regulations". Add a visible `REGS_AS_OF` date to the table and the AI
prompt. Or, safest, replace the numbers with "see CDFW" and a deep link per species. Re-verify every season. Note in
the code who checked each row and when.

### MPAs (`public/data/mpa-ca.json`, `src/engine/reefs.js`, `src/features/spots/MpaCard.tsx`)
- 157 features with unique names: SMR 49, SMCA 61, SMCA (No-Take) 10, SMRMA 5, SMP 7, FMR 8, FMCA 1, Special Closure
  16. The total looks plausible for the state network plus the Channel Islands federal zones, but **I could not verify
  completeness or currency**. No source file, download date or version is recorded in the repo (`privacy.js` credits
  "California Dept. of Fish and Wildlife" in general). Coordinates are rounded to four decimals (about 11 m) and appear
  simplified.
- The in-app MPA card had no "approximate" warning. The generated web pages already say "Boundaries shown are
  approximate" (`tools/web/places.mjs` 204, 227). **Edited** the card to match (section 9).
- The card's take wording is reasonable. "No take — no fishing allowed" for SMRs and no-take SMCAs is right in
  substance; limited SMCAs say "check rules".
- **Claims to avoid**: "Every California MPA built in" (aso.md promo, not yet in APP_STORE.md) promises completeness
  you can't prove. Use "California MPAs built in". The caption "Know where the lines are" implies exact boundaries
  next to a screenshot of a real MPA. Prefer "See MPAs before you drop" or similar.
- **Fix:** record the CDFW dataset name, download URL and date next to `mpa-ca.json` (for example in a `README` in
  `public/data`), and add a check-every-season reminder.

### Duty to point to CDFW
This is done well throughout: Guides (`FISH_REG_WARN`), the MPA card button, offline answers, AI prompts and web
pages. Keep it. Also mention the Mexican permit for the Coronados (already in `AREA_TIPS`). Consider a short "You
need a California fishing licence and, offshore, possibly report cards" line in Guides.

## 3. Privacy

### Which laws apply
- **CalOPPA** (Bus. & Prof. Code sections 22575-22579) applies to an operator of a commercial website or online service
  that collects personally identifiable information (PII) from California residents. QuadSight probably qualifies,
  because the app collects precise location and transmits it to third parties, and the emergency contact (name and
  phone) is PII even though it stays on the device. Required: a conspicuously posted policy (in About, at
  `privacy.html` and in the store listing ✓), the categories of PII and third parties ✓, how users are told about
  changes ✓, an effective date ✓, **how it responds to Do Not Track signals ✗ (fixed: section 9)**, and whether third
  parties may track across sites ✓ (now explicit). It should also identify the operator (✗, see M4).
- **CCPA/CPRA**: it most likely **does not apply**. QuadSight is under the revenue threshold (about US$26.6M,
  inflation-adjusted), does not buy, sell or share personal information of 100,000+ consumers ("share" means
  cross-context behavioural advertising, and there is none), and earns no revenue from selling data. Re-check if ads,
  analytics or paid tiers are added. Writing the policy in plain CCPA-style categories anyway is good practice.
- **COPPA**: the policy says the app is "not directed to children under 13" (`privacy.js`), and the content (boating
  and fishing) supports that. APP_STORE.md plans a **4+** rating. A 4+ rating does not by itself make an app
  "directed to children", but with an open-ended AI chat a higher rating is safer and more consistent. Recommend
  answering the age-rating questionnaire honestly about the AI assistant and accepting 13+ (or whatever Apple
  computes). If the app ever has actual knowledge of a child user's data, COPPA obligations would begin. Today almost
  nothing is collected server-side, so the risk is low.
- **New state app-store and age laws**: Utah's and Texas's "App Store Accountability" acts and California's AB 1043
  (Digital Age Assurance Act, operative 2027, as I understand it) put age-signal duties on developers. Their status
  and any injunctions were changing as of my training data. **Attorney to confirm** what, if anything, a free app with
  no accounts must do.
- **California SB 243 (companion chatbots, 2026)** covers AI built to sustain a relationship or meet social needs. A
  task-focused fishing assistant is very likely outside it, but the "Ahoy! I'm First Mate" persona is worth a
  one-line attorney check.
- **Apple 5.1.1 / 5.1.2**: the policy is in the app and linked ✓. Consent before sending data to third-party AI ✓
  (`asstAskCloudConsent`; the text names the recipients and the data sent).

### Does the policy match the code? (verified)
| Data flow (code) | Policy says | Status |
|---|---|---|
| Coordinates of the asked-about point → Open-Meteo, NOAA (CO-OPS, NCEI, ERDDAP, nowCOAST), iNaturalist (`weather.js`, `inspect.js`, `tides.js`, `fish.js`, `areadata.js`) | "Location" section | ✓ |
| Tile requests reveal the viewed map area (bbox) to Esri, GEBCO/ArcGIS, NOAA, GMRT, OSM, OpenSeaMap | Implied ("services listed below") | ✓ acceptable. Could add "map tiles you view are fetched from the providers listed". |
| **Place names typed to First Mate → Open-Meteo geocoding** (`assistant.js` `asstGeocode`) | Not mentioned | **Fixed**: one sentence added |
| Cloud AI: question, history, position, spots with notes, catch log → Cloudflare relay → Workers AI (Llama 3.3), or → Anthropic with the user's key | Detailed ✓ | ✓ matches `ASST_CLOUD_DATA` |
| Relay IP handling (`proxy/first-mate-worker.js` `clientKey`, Durable Object salted SHA-256, `invocation_logs = false` in `wrangler.toml`) | Detailed ✓ | Minor: "deletes it after midnight UTC" is really "at the first request after midnight UTC" (`store.deleteAll()` runs lazily). "Cloudflare processes it only briefly" is a promise about Cloudflare's own platform logging, which QuadSight doesn't control. Suggest "We do not log or store it; Cloudflare handles it under its own privacy policy." (A unit test pins the current wording, so change both together.) |
| TTS: answer text → relay `/tts` (MeloTTS), only with consent | ✓ | ✓ |
| Speech: iOS `SFSpeech`, or browser `SpeechRecognition` (Google in Chrome) | ✓ | ✓ |
| Web app hosting: GitHub Pages receives visitors' IP addresses and user agents (GitHub's logs) | Not mentioned ("browsers do not send [the #fragment] to our web server" is true) | Low: add "The website is hosted on GitHub Pages, which receives your IP address under GitHub's privacy statement." |
| Anthropic API key stored in localStorage | ✓ "stored only on your device" | ✓ |
| Analytics, ads, crash reporting | "none" | ✓ none found (no Sentry, analytics or beacon code) |

### App Privacy label (APP_STORE.md section 4) and privacy manifest
- The label answers (Precise Location and Other User Content; App Functionality; not linked; no tracking) **match**
  `FishApp/PrivacyInfo.xcprivacy` and the code. Declaring location as "collected" is conservative and fine.
  Geocoded place names and TTS text both fall under Other User Content ✓.
- **Required-reason APIs**: I checked all four Swift files (`ContentView`, `FishAppApp`, `NativeBridge`,
  `WebAppView`). There is no `UserDefaults`, no file-timestamp, disk-space, system-uptime or active-keyboard API, so
  the empty `NSPrivacyAccessedAPITypes` is correct. **Keep it that way.** Adding `UserDefaults` (for example for
  a review-prompt counter) would require declaring `CA92.1`. WebKit's own storage is Apple's code and needs no entry.
  `AppStore.requestReview` needs no entry.
- `Info.plist` permission strings are specific and accurate ✓.

## 4. Intellectual property

### Map tiles and data (data-sources.md checked against the current code)
| Item | data-sources.md said | Code now | Remaining exposure |
|---|---|---|---|
| CARTO labels | Remove | Retired (`tiles.js` 133-143: `retired: true`, never added; sweep deletes stored tiles) | None ✓ |
| RainViewer | Replace with nowCOAST | Replaced (`rain.js` uses nowCOAST MRMS, linked credit) | None ✓ |
| Esri World Ocean Base / Imagery | Drop or license; no offline | `offline: false` ✓, but **`ocean` is still the DEFAULT base** (`layers.js` line 24 `DEFAULTS.base = 'ocean'`; fallback lines 30 and 119) | **High.** Esri's terms (as summarised in data-sources.md) require an ArcGIS subscription even for live use, and bar commercial use of Living Atlas content. A free app by an LLC is plausibly commercial. Apple 5.2.2 requires authorization for third-party content. Make `gmrt` or `bluetint` the default and remove `ocean` and `sat`, or open an ArcGIS Location Platform account. |
| OSM tiles | No offline; set UA | `offline: false` ✓; linked attribution ✓; iOS UA set (`WebAppView.swift` line 21 `applicationNameForUserAgent`) ✓ | Low |
| OpenSeaMap | Live only | `offline: false` ✓ (on by default) | Low |
| iNaturalist photos | Add licence filter | `photo_license=` filter in `datasources.js` line 29 ✓; photographer credit in `FishCard.tsx` ✓ | **Medium**: most allowed photos are CC BY-NC(-ND/-SA). Whether a free app by an LLC is "non-commercial" is arguable. If any monetisation appears, restrict the filter to `cc0, cc-by, cc-by-sa`. Showing ND photos resized is generally fine, but cropping could be argued to create an adaptation. Display them uncropped (object-fit: contain) to be safe. |
| Open-Meteo | Commercial status unclear; add linked credit | Linked credit in the weather panel, inspect card and SST legend ✓ (`DataCredit.tsx`, `datasources.js`) | **Medium**: the owner decision is still open, as far as the repo shows. |
| GEBCO, GMRT, NOAA (ENC, BlueTopo, NCEI, CO-OPS, ERDDAP, nowCOAST), USGS | Keep, with credits | Credits in `privacy.js` `SOURCES` ✓ | Low |
| Bundled reefs/MPA/tide stations (`public/data`) | Not audited | Credited to NOAA and CDFW | Low, but record each dataset's source URL, date and licence (see section 2) |

The App Review note said "Charts and data come from public sources (NOAA, GEBCO, Esri, OpenStreetMap ...)". Esri and
OSM are not "public sources" in the public-domain sense. **Edited** to "public and third-party sources ... under their
published terms" (section 9), so Apple isn't told something inaccurate.

### Fonts, icons, art and text
- **Barlow and Barlow Semi Condensed** (`@fontsource`, OFL-1.1): embedding in an app is allowed, but OFL requires
  the copyright notice and licence to accompany the font software. **Not present** in the bundle → add to the
  licences screen and file (M2).
- **lucide-react** (ISC; parts derive from Feather, MIT): the notice is required → same fix. Custom marine glyphs
  (`src/ui/Icon.tsx`, "drawn here in the same style") are original.
- **App icon** (`AppIcon-1024.png`, generated from `tools/icon/icon.html`): an original boat-and-rings design. No
  issue seen.
- **Knot diagrams** (`src/engine/knot-diagrams.js`) are generated procedurally from code (paths and coils), so they
  are original. **Knot steps** (`knots.js`) describe standard methods in plain wording. Methods aren't copyrightable,
  and the wording read as original in my spot-check. **Fish tips** (`fish-tips.js`) read as original synthesis in a
  consistent house voice. Brand names of lures (MC, Big Hammer, Keitech, Tady, Salas) are nominative use, which is
  fine with no logos and no implied endorsement. I did not run a web plagiarism check. If any of this text came from
  a magazine, forum or charter site, rewrite it.
- **Screenshots**: they show the app's own UI over NOAA ENC (public domain) and app-styled maps. I could not tell
  from the images which base map `03-anchor` uses (light-blue ocean with contours). If it is the Esri base and Esri
  is dropped, re-shoot it.

### Names and trademarks
- **"FishApp"**: descriptive, so hard to register or enforce, and it conflicts in feel with CLS FishApp (a
  fisheries-monitoring company) and FISHAPP.CZ (aso.md 1.2). Infringement risk to us is low-moderate (different
  services, descriptive term). The bigger risk is the weak brand.
- **"Saltmate"** (the aso.md recommendation): there are prior USPTO filings for SALT MATE in salt or food goods and a
  Japanese app. Different goods lowers the risk, but **get a clearance search in classes 9 and 42** (and 41/44 if
  content services are added) before investing in the name.
- **"First Mate"**: Mercury Marine (Brunswick) sells "1st Mate", a man-overboard and anti-theft system, with a
  companion app in Navigation, and Furuno ships "TZ First Mate". Both are marine electronics, the same channel and
  customers, which creates likelihood-of-confusion risk for an in-app feature name. The store description uses
  **"FIRST MATE"** as a section heading (APP_STORE.md). `captions.json` already holds the name back. **Medium**: get a
  search, or rename it ("Mate" or "Deckhand AI") before 1.0 metadata is locked. The name changes only with a new
  version.
- **Third-party marks in metadata**: none in the keywords. "NOAA" is a government agency, so don't imply endorsement.
  "Navionics" appears only in a code comment (`layers.js` line 150, "NAVIONICS-STYLE"), not user-facing. "Claude" and
  "Anthropic" in the model picker and policy are nominative use. "Minn Kota" appears in the web-only motor UI (see
  section 6, M5).
- **Meta Llama 3.3 licence**: the relay runs `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Llama's community licence
  asks products that "make available" Llama-based services to display "Built with Llama" and to follow Meta's
  Acceptable Use Policy. Whether this applies when the model is hosted by Cloudflare is debatable. Adding "Built with
  Llama" to the Cloudflare entry in `SOURCES` costs nothing. **Low.**

## 5. Open-source licence compliance

Production dependency tree (read from `node_modules/*/package.json`):

| Package | Version | Licence | Notice required in distributed app? |
|---|---|---|---|
| react, react-dom, scheduler | 19.3.0 / 0.28.0 | MIT | Yes: copyright and permission notice in "all copies or substantial portions" |
| zustand | 5.0.15 | MIT | Yes |
| leaflet | 1.9.4 | BSD-2-Clause | Yes: binary redistribution must reproduce the notice in documentation or other materials |
| lucide-react | 1.52.0 | ISC (plus Feather MIT) | Yes |
| @fontsource/barlow, @fontsource/barlow-semi-condensed | 5.3.0 | OFL-1.1 | Yes: the copyright notice and licence must accompany the fonts |

The development-only tree (Vite, Vitest, Playwright, ESLint, TypeScript, jsdom) holds MIT, Apache-2.0, BSD,
ISC, MPL-2.0 (2 packages), BlueOak, CC0 and MIT-0 licences. These are not shipped, so no notice obligation follows.
MPL-2.0 is weak copyleft at file level and only matters if MPL files are distributed; it is dev-only here. Four
packages report no licence field (dev tree). Worth a look if they are ever bundled.

**Finding (Medium):** the iOS bundle (`FishApp-iOS/FishApp/Web/assets`) contains **no** `@license` comments or
notices file. Vite strips them, and About has no licences screen. **Fix:** generate `THIRD_PARTY_NOTICES.txt` at build
time (for example with `rollup-plugin-license` or a small script that reads each production dependency's `LICENSE`).
Ship it in `public/`, and add About > "Open-source licences" that shows it offline.

## 6. Consumer protection and store-review risks

California's UCL/FAL (Bus. & Prof. Code sections 17200 and 17500), the FTC Act section 5 and Apple 2.3/2.3.1 all
require claims to be true and substantiated. "Free" is lawful for a truly free app, but Apple 2.3.7 discourages price
words in metadata.

| Claim (where) | Problem | Recommendation |
|---|---|---|
| "Anchor alarm that wakes you" / "Sounds the moment you drag past your circle" (`captions.json`, rendered in `03-anchor.png`) | A safety-performance guarantee. The alarm fires after two GPS fixes outside the circle, and can be silenced by the OS, Focus or volume, or by the app being killed. | **Edited** the caption source to "Anchor alarm, even when locked" / "Alerts when GPS puts you past your circle". **Re-render the screenshots** (`node tools/storeshots/render.mjs ...`) before upload; the PNGs still show the old text. |
| "Know where the lines are" / "California MPAs and no-take zones, built in" (`02-mpa`) | Implies exact boundaries; the data is approximate | Owner: soften the headline (for example "See MPAs before you drop"). The subline is fine. |
| "Works with zero bars" / "Saved charts, GPS and the assistant, no signal" (`01-offline`) | Mostly true: saved charts, GPS and the offline (non-AI) assistant work. Live layers and cloud AI don't. | Acceptable; "Saved" carries it. Keep. |
| Promo: "...a **free AI first mate that works even with no signal**" (APP_STORE.md section 3) | Offline answers are rule-based, not AI. "Free" is pricing language (2.3.7). "First Mate" is the name issue. | Use the aso.md promo **minus "Every"**: "...Charts, GPS, tides and an AI assistant that keep working with zero signal..." Even that is only true for the offline answers; say "answers offline". |
| aso.md promo: "**Every** California MPA built in" | Completeness not provable (section 2) | "California MPAs built in" |
| Description "Knot guides and fish ID with limits" | Implies authoritative limits | **Edited** to "with a general size and bag-limit reference (always confirm with CDFW)" |
| Description "sounds an alarm if you drag" | Same as the caption | **Edited** to "when GPS shows you outside your circle" |
| Description: "uses a free cloud AI" | True today, but it depends on the relay budget (about 70 questions/day on the free tier, then 503 for everyone; data-sources.md) | Keep, but say in-app when the daily limit is hit (it does). Consider "when available". |
| AI disclosure | Labelled in the composer and the consent dialog ✓ | Keep. |
| Review notes say there is no hidden feature, but the motor code ships in the bundle (`FishApp/Web/assets/MotorPanel-*.js`) | 2.3.1 forbids "hidden, dormant or undocumented features". It is disclosed in the notes and unreachable. | Low for review. Better: exclude it from the iOS build. |

## 7. The AI assistant (First Mate)

- **Disclaimers and consent** ✓: the consent dialog names the recipients and the data sent, has a 60-second timeout,
  remembers only an explicit choice and can be withdrawn in settings (`assistant.js` 2145-2210). This matches Apple
  5.1.2(i) as amended for third-party AI.
- **Content passed to third parties**: the user's question, history, position, saved spot names and notes, and catch
  log. Spot notes can contain other people's names or secret spots. The policy discloses this ✓.
- **Cloudflare**: Workers AI on the owner's account, under the Cloudflare Self-Serve Subscription Agreement, the
  Service-Specific Terms for Workers AI and the model licences. As I understand it, Cloudflare states it does not use
  customer content to train models. The relay's invocation logs are off ✓. Risks: (a) budget exhaustion turns the
  feature off for everyone (cost control, not legal); (b) the soft Origin check lets non-browser clients in, so
  abuse could generate content QuadSight is accountable for. Per-IP limits and daily budgets exist ✓.
- **Llama licence and AUP**: see section 4.
- **Anthropic (bring your own key)**: the user's own contract with Anthropic applies. An individual needs an Anthropic
  Console account; Anthropic's terms require adult users and forbid sharing keys. The app stores the key only in
  localStorage and sends it only to api.anthropic.com ✓. The model picker lists "Claude Opus 5.5" and others, which is
  nominative use ✓. QuadSight is not reselling Anthropic access, which is the right structure.
- **Prompt risks**: see section 1 (the "never punt" rule, MPAs, weather, medical). Also: the keyed Claude brain can
  **delete waypoints with no confirmation** (`assistant.js` about line 1817, "preserved knowingly"). That is a
  data-loss and consumer-expectation issue, not a major legal one. The draft Terms section 6(e) covers it. Consider a
  confirmation step anyway.
- **Hallucinated regulations**: the AI gets the regulations table in its prompt and will restate it with confidence.
  Fixing H2 fixes most of this.

## 8. Other observations

- **M5, trolling motor (web app only)**: `src/engine/motor.js` and `helm.js` brute-force or "capture" a Minn Kota
  remote protocol to steer and stop a trolling motor from a browser. The panel's "Best-effort only" warning
  (`MotorPanel.tsx` 172-176) is commendable. Still, software that can start or steer a propulsion unit carries
  serious **bodily-injury** exposure, for example to a swimmer or diver near the boat, or from a runaway at speed. It
  also raises questions of manufacturer warranty, Johnson Outdoors' trademark (nominative use in UI text is probably
  fine, but no logos), DMCA section 1201 (the interoperability exemption 1201(f) probably helps if no access control
  is bypassed) and the BLE device terms. It is hidden on iOS (`MorePanel.tsx` line 44) ✓. **Recommendation:** keep it
  out of iOS (and strip it from the iOS bundle). For the web, put it behind an explicit "experimental, at your own
  risk" acceptance that records assent. An attorney should review it before promoting it.
- **Seller identity**: if the Apple Developer account is enrolled as an individual, the App Store shows the
  individual's legal name as seller and the LLC's liability shield is muddied: the individual is the contracting
  party with Apple and the publisher. **Enrol as an organization (QuadSight Imaging LLC, D-U-N-S number)** before
  launch. Bundle ID `com.quadsightimaging.fishapp` is consistent with that. The privacy and support URLs live under a
  personal GitHub (`jbittlest.github.io`). That is fine legally, but consider a QuadSight domain.
- **LLC formalities**: keep the app's accounts (Apple, Cloudflare, GitHub, domains) in the LLC's name and pay from LLC
  funds, which supports limited liability. Confirm good standing with the CA Secretary of State and the US$800 FTB
  minimum tax.
- **Export**: `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only) ✓. France may still need a declaration if
  distributed there, though exempt-encryption apps usually do not. Low.

## 9. Edits made in this review (all user-facing copy; no engine logic)

1. `src/features/spots/MpaCard.tsx`, the card's legal line: "Always confirm current CA DFW regulations before
   fishing." → "**Boundaries shown are approximate.** Always confirm current CA DFW regulations **and boundaries**
   before fishing."
2. `src/features/weather/InspectCard.tsx`, the footnote: "Chart depth is from survey data, not your sounder." →
   "Depth is an estimate from NOAA survey and elevation-model data, not your sounder or an official chart, and can be
   wrong."
3. `src/shell/panels/EmergencyPanel.tsx`: "Needs any cell signal (on iPhone 14+, texts can go via satellite)." →
   "Needs cell signal (on iPhone 14 or newer, Messages via satellite may work where Apple offers it)." Also "can call
   for help with no cell service:" → "... no cell service, where Apple's satellite service is available:"
4. `src/legal/privacy.js`: added a Do Not Track statement (CalOPPA) to "The short version"; added the Open-Meteo
   place-name geocoding disclosure to "Location"; bumped `POLICY_UPDATED` to October 27, 2026.
   `tests/unit/legal/privacy-copy.test.tsx`: updated the date assertion and added a test for both new lines.
   `public/privacy.html` and `public/support.html` were regenerated with `node tools/make-legal-pages.mjs`.
5. `tools/storeshots/captions.json`, the anchor caption: "Anchor alarm that wakes you" / "Sounds the moment you drag
   past your circle" → "Anchor alarm, even when locked" / "Alerts when GPS puts you past your circle". **The PNGs in
   `FishApp-iOS/AppStoreScreenshots/` were not re-rendered.** Run the render step before upload.
6. `FishApp-iOS/APP_STORE.md`: description "fish ID with limits" → "...with a general size and bag-limit reference
   (always confirm with CDFW)"; "sounds an alarm if you drag" → "...when GPS shows you outside your circle"; review
   note "public sources" → "public and third-party sources ... under their published terms".

Unit tests run afterwards (`tests/unit/legal`, `storeshots`, `weather-overlays`, `data-spots-offline`): 22 files,
417 tests, all pass. Nothing was built, deployed or committed, and no git command that changes the tree was run.

## 10. Action list

### Owner (before submitting)
1. **Fix the regulations table** (H2): verify each `FISH_ID` row against current CDFW and Title 14, add an "as of"
   date, or remove the numbers. (`src/engine/fish-id.js`)
2. **AI prompt carve-outs and MPA caveats** (H3): edit `asstSystemPrompt` and `asstProxySystem`, and add MPA notes to
   `AREA_TIPS`. (`src/engine/assistant.js`, `src/engine/fish-tips.js`)
3. **Change the default base map from Esri `ocean`** to `gmrt` or `bluetint`, and drop or license the Esri layers
   (H4). (`src/engine/layers.js`, `tiles.js`) Re-shoot any screenshot that shows an Esri base.
4. **Open-Meteo**: email for written permission or subscribe (M1).
5. **Open-source licences screen and notices file** (M2).
6. **Privacy policy**: name QuadSight Imaging LLC and its mailing address, and add a private contact email (M4). Add
   the GitHub Pages hosting line, and tidy the "Cloudflare processes it only briefly" and "after midnight" wording
   (update the tests with it). Add "Built with Llama" to the Cloudflare credit.
7. **Store text**: drop "free" and "First Mate" from the promo text; avoid "Every California MPA"; soften "Know where
   the lines are"; **re-render the screenshots** after the caption change.
8. **SOS screen**: add DSC distress-button instructions, "Channel 16, high power", the vessel description line, and
   "This app does not contact anyone for you".
9. **Anchor hint**: one sentence on GPS, Focus and volume dependence, and "not a substitute for a person on watch".
   Consider enabling the Time Sensitive notifications capability by default.
10. Rename the "Chart depth" label to "Depth (est.)" (InspectCard plus the caption subline).
11. Enrol in the Apple Developer Program **as an organization**. Put the Apple, Cloudflare, GitHub and domain accounts
    in the LLC's name.
12. Record the provenance (URL, date, licence) of the bundled `public/data/*.json` datasets.
13. Strip the motor code from the iOS bundle. Gate the web motor feature behind an explicit risk acceptance.
14. After the Terms are final: show the Terms link and "I agree" in the first-run sheet, bump `fishapp.ack` to `v2`,
    and add a Terms entry in About and in the store description, or upload the Terms as a custom EULA.

### Needs a licensed California attorney
1. **Finalise the Terms of Use** from `docs/launch/terms-draft.md`: limitation of liability and its enforceability
   for personal injury (Civil Code section 1668; *Tunkl*; *City of Santa Barbara*), maritime-law interaction,
   arbitration and class waiver versus courts, indemnity, and whether to use a custom Apple EULA.
2. **Trademark clearance** for the final app name (Saltmate or FishApp) and the assistant name (First Mate versus
   Mercury's and Furuno's marks), with a filing strategy.
3. **Third-party data terms**: Esri (if kept), Open-Meteo's commercial definition, iNaturalist NC licences for an
   LLC's free app, and the Llama licence when the model is accessed through Cloudflare.
4. **Product liability and insurance**: the exposure from navigation, anchor alarm, depth, regulations and AI
   outputs; whether the LLC's insurance covers software or tech E&O; the trolling-motor feature.
5. **Privacy and minors**: confirm CCPA non-applicability; age rating versus COPPA; current status of the Utah, Texas
   and California (AB 1043) app-store age laws and SB 243.
6. Review any regulation-content strategy (summarising CDFW rules at all, versus linking only).
