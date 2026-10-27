# App Store Optimization research for launch

Research for the App Store and Google Play listing. Everything here is a recommendation. It does not change
`APP_STORE.md`, `src/site.config.json` or any code.

* **Data date:** all store data was pulled on **2026-10-26** from the US storefront. Store results change daily, so re-check
  before you submit.
* **Sources:**
  * the public iTunes Search API (`itunes.apple.com/search?entity=software&country=us`): 106 queries, plus one
    Japan-store check;
  * the subtitle shown on each app's public `apps.apple.com` page (the API does not return subtitles);
  * web searches;
  * `nslookup` and plain HTTPS GETs for domains. The raw JSON was kept out of the repo. The tables in the appendix hold every
  number used below.
* **Limits:** the Search API is close to App Store search but is not the same ranking (no personalisation, no ads, no
  "did you mean"). Rating counts stand in for difficulty: an app with tens of thousands of ratings has the downloads
  and history that rank, and a new app has neither. The trademark notes flag risk. They are **not legal advice**, and
  no USPTO search was run. The DNS checks are rough: NXDOMAIN only means "probably not registered".

---

## 0. Recommendation in one screen

**Top pick: launch as "Saltmate".**

| Field | Text | Count |
|---|---|---:|
| App Store name | `Saltmate: SoCal Fishing & GPS` | 29/30 |
| Subtitle | `Offline Sea Charts, Tides & AI` | 30/30 |
| Keyword field | `nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,bite,times` | 99/100 |
| Promotional text | `Charts, GPS, tides and an AI first mate that keep working with zero signal. An anchor alarm that works with the phone locked. Every California MPA built in. No account.` | 168/170 |
| Google Play title | `Saltmate: SoCal Fishing & GPS` | 29/30 |
| Google Play short description | `Offline sea charts, tides, anchor alarm & AI for SoCal anglers. No account.` | 75/80 |

Why Saltmate:

1. **It wins its own name.** On 2026-10-26, a US search for `saltmate` or `salt mate` turned up no app with that name.
   The top results were sodium trackers and unrelated games, so an app called Saltmate should come up first when
   people search for it.
   `fishapp` fails this test. Its top five results are Fishbrain (76,207 ratings), Fishbox (38,632), FishAngler
   (13,921), Fish AI (27,224) and Fishing Spots (10,986). The one app actually named "…FishApp" (CLS FishApp) sits at
   #9. Recommendations heard on a dock become searches, so a brand that loses its own name loses those installs.
2. **It works when you shout it.** It is two everyday words, and you can spell it from hearing it. That rules out Bight
   (people would type "bite") and Chovy (could be chovy, chovie or chovey).
3. **It fits the product.** Anglers call the ocean "the salt", and a "mate" is crew. That matches the AI assistant and
   the safety-companion idea, and it still works when the app grows past SoCal, where Garibaldi would not.
4. **No fishing or marine conflict turned up.** Other uses were in different industries: two US trademark filings for
   culinary salt, a Japan-only salt-calculator app called "SaltMate", and Saltmate pool-chlorinator cells. Details and
   caveats are in section 1.4.

**Alternatives:**

* **B: keep FishApp.** No rebrand cost, and the metadata above still works: `FishApp: SoCal Fishing & GPS` (28). Its
  own-name search is weak, and the name is descriptive and hard to protect.
* **C: Garibaldi.** The most SoCal-specific option, and the fish's orange is close to the app's amber signal colour.
  The only other apps using the name are restaurants. But it is 4 syllables, it means little outside SoCal, and the
  fish is protected, so no one in California may take or keep one. There is also a Garibaldi Charters fishing charter in Garibaldi, Oregon.

**Not as the store name: "First Mate".** Seven marine apps already use it (one as the publisher name), including Mercury Marine's "1st-Mate" and
Furuno's "TZ First Mate". `First Mate: Fishing & Marine GPS` is also 32 characters, over the 30 limit.

---

## 1. Name research

### 1.1 Method

Each name was searched three ways:

* The iTunes Search API, 50 results per term. I recorded every app whose name or seller contains the candidate (table
  A3).
* A web search for boating or fishing companies, products and trademark filings that use the name.
* For the finalists, `nslookup -type=NS` on the `.com` and `.app` domains plus fallbacks, and an HTTPS GET to see what
  any live site is.

Bar for a candidate: short, can be said over an outboard, sounds like SoCal saltwater or navigation, not generic, and
not a competitor's mark.

### 1.2 FishApp / Fish App

| Check | Finding (2026-10-26) |
|---|---|
| `fishapp` search | 47 results. #1-#5: Fishbrain - Fishing App (76,207 ratings), Fishbox (38,632), FishAngler (13,921), Fish AI (27,224), Fishing Spots: Find & Fish App (10,986). The exact-token **CLS FishApp** (Collecte Localisation Satellites, a fisheries-monitoring company) is at **#9**. |
| `fish app` search | 45 results. The top 10 includes eight apps with 5,000+ ratings (Fishbrain, Fishbox, Fish AI, Fishing Points, BassForecast, FishAngler, Fishing Spots, Catchr). A word-of-mouth search for "fish app" puts a new app below all of them. |
| Same or near names | CLS FishApp (Business), FISHAPP.CZ (APPKEE s.r.o., Reference), Fish App - Fresh (Food & Drink). A Smithsonian Ocean article describes a catch-recording tool called "The Fish App". |
| Trademark | "FishApp" describes what the app is. Descriptive marks are hard to register and enforce. Flag only. |
| Domains | `fishapp.com` is registered with nameservers at Afternic, a domain marketplace, so it is probably for sale. `fishapp.app`, `fishapp.io` and `getfishapp.com` returned NXDOMAIN. |
| Verdict | It works and costs nothing to keep, but it is the weakest brand here. |

### 1.3 First Mate and variants

Every "First Mate" app on the US store is a **boating** app:

| App | Seller | Subtitle | Category / ratings |
|---|---|---|---|
| 1st-Mate | Mercury Marine LLC (Brunswick) | — | Navigation, 10. Companion to Mercury's 1st Mate MOB/anti-theft system (CES 2021 honoree). |
| First Mate | First Mate Pty Ltd | Boat Maintenance & Logbook | Productivity, 0, updated 2026-10-23 |
| TZ First Mate | FURUNO SOFTECH CO.,LTD. | The TimeZero Gateway | Navigation, 3. Logs catches to Furuno TZtouch chartplotters. |
| First Mate | Matthew Ricciardo | — | Utilities, $19.99, boat fuel/range calculator. Also on Google Play as `com.firstmate`. |
| First Mate by Sea Strong | Ravenna LLC | Your boat's second-in-command | Utilities, 0 |
| myDockLink | Firstmate, Inc | Control your Boat Lifts | Lifestyle, 18 |
| First Mate Log | Brock Hamm | Overnight sailing trip planner | Travel, 0 |

* `firstmate.com`, `firstmate.app` and `firstmatefishing.com` are all registered.
* `First Mate: Fishing & Marine GPS` is **32 characters**, 2 over Apple's 30.
* **Verdict:** do not use it as the store name or as a store keyword. Two major marine-electronics makers, Mercury and
  Furuno, ship marine apps under that name. Keeping "First Mate" as the in-app assistant's name is lower risk but not
  zero. Owner decision (section 6). With Saltmate, the assistant could just be **"Mate"**.

### 1.4 Brandable candidates

**Finalists:**

| Candidate | Why it is evocative | App Store collisions (US) | Web / trademark flags | Domains (rough) | Verdict |
|---|---|---|---|---|---|
| **Saltmate** | "the salt" = the ocean to anglers. "mate" = crew, which ties to the assistant. | None. `saltmate`: 36 results, `salt mate`: 41, no app with the name. | USPTO applications SALT MATE (90806128, pink salt / salt lamps / animal licks) and URSLAT UR SALTMATE (98556864, cooking salt). **"SaltMate" app on the Japan store** (So Nomiyama, Food & Drink), so the bare name is taken there and the store name must be compound, which `Saltmate: …` is. Saltmate-branded pool-chlorinator cells sold online. `saltmate.co` redirects to a password-protected `saltmate.eu` whose owner is unknown. Nearby fishing brands use "Salt" (Salt Strong, Salt Life, the "Saltline" app), and marine apps use "-mate" (MarineMate NZ, Mercury 1st Mate). | `.com`, `.app` and `.co` are registered to others. `getsaltmate.com`, `saltmateapp.com`, `saltmate.io` and `saltmate.fish` returned NXDOMAIN. | **Recommended** |
| **Garibaldi** | California's state marine fish, found only in SoCal and Baja kelp. Bright orange. | 25 results, 20 matches. All are restaurants, schools or people; none in fishing or marine. The top match, Garibaldi's (Food & Drink), has 205 ratings. | Garibaldi Charters (fishing charters in Garibaldi, Oregon, itself a fishing town). Porto Garibaldi marina, Italy. Common surname. | `.com` and `.app` are registered. `garibaldiapp.com`, `getgaribaldi.com` and `garibaldi.fish` returned NXDOMAIN. | Alternative C |
| **Longfin** | Longfin tuna (albacore), a SoCal offshore staple | None (6 results) | **The Longfin**, a fishing tackle shop in Orange, CA: same customers, same region | `longfin.com` registered, `longfin.app` NXDOMAIN | Runner-up. The local confusion risk is real. |
| **Chovy** | SoCal slang for live anchovy bait | None (14 results) | P-Line "Chovy" jig, a fishing-lure product name. Hard to spell from hearing it. | `.com` and `.app` registered | Runner-up |

**Rejected:**

| Candidate | Why rejected |
|---|---|
| **Kelpline** | **Taken in the exact niche.** `kelpline.app` is live as "Kelpline: reeling in the best content", with the tagline "Fishing clips, tips and tricks. Connect across SoCal." `kelpline.com` is Kelp Line Adventures, a fishing and ocean lodge. The App Store showed nothing yet. |
| **Seamark** | Nothing on the App Store, but `seamark.app` is a live sailing-logbook web app called "Seamark". Andren SeaMarks is a waypoint manager for fishermen. |
| **Tidemark** | Tide Mark Fishing Logbook ("Private saltwater logbook") and Tidemark: NOAA Tide Widget are both on the US store. |
| **Driftline** | Driftline: Rip Current & Tides, Driftline Fly Fishing Trainer, and **Driftline Co. L.L.C.**, publisher of "Baseline: Hunting & Fishing" (Navigation, 84 ratings). |
| **Deckhand** | Deckhand! ("Predictive Boat Maintenance" for Navico displays), Deckhand: Boat Wash & Detail, and the Deckhand commercial-fishing logbook (NOAA-approved eVTR). |
| **Saltline** | "Saltline" (Saltline LLC, Sports, "Read the water, not the crowd") |
| **Skiff** | SKIFF – Boat Rentals, plus 8 other "Skiff" apps |
| **Tidewise** | TideWise: NOAA Tides & Charts; Tidewise Fishing ("Offline tides for fishing") |
| **Bight** | Southern California Bight, and it sounds like "bite". But people who hear it will type "bite", the App Store search pulled Bright/Brigit for it, and Bight, LLC already has a video app. |
| **Shoal** | Shoal & Stem: Fish Tank Log; Shoal: Aquarium & Fish Care; Shoal of fish (game, 18,369 ratings). USPTO application SHOAL by Shoal Outdoors LLC covers fishing gear and apparel (published for opposition 2026-07-28). |
| **Gaff** | 19 name matches (trivia game, giffgaff, a social app). It also sounds like "gaffe". |
| Bluewater, Lodestar, Livewell, Leeway, Calico, Bowline | Crowded with unrelated apps (34, 27, 13, 15, 17 and 2 name matches), and several lean to another meaning (health, cats, bowling). |
| Saltmark, Swellmate, Foamer, Kelpwise, Ballyhoo | No conflicts found, but each is weak: unclear meaning, surf-coded, insider jargon, an overused "-wise" suffix, or Atlantic bait. |

### 1.5 Ranking

| | Saltmate | FishApp | Garibaldi |
|---|---|---|---|
| Wins own-name search | Yes, no app uses the name | No, #9 behind giants | Probably, after some downloads (only restaurants use it) |
| Spellable from hearing it | Yes | Yes, but people type "fish app" | Mostly |
| Signals saltwater / SoCal | Saltwater: yes. SoCal: via the descriptor | No | SoCal: strongly. Navigation: no |
| Works beyond SoCal | Yes | Yes | Weakly |
| Conflicts found | Unrelated industries only | Similar names in fisheries software | Oregon fishing charter |
| Rebrand cost | Medium. `SITE.brandName` centralises it in the web app, but the iOS display name, site URL path and assets change. | None | Medium |

---

## 2. Keyword research

### 2.1 Method

The 68 queries cover the brief's list plus beachhead long-tails: species, SoCal place names, anchor, offline and safety
terms. For each query I saved the top 25 results with ratings, average and price, and scraped subtitles for the top 5.

The difficulty proxy is the number of top-10 apps with 10k or more ratings, and the median rating count of the top 10.
The verdict also asks whether those big apps are **relevant**. When games rank for "socal fishing", that means Apple has
no good match, which is an opening, not a wall. Full numbers are in appendix A1, and the top 5 per query with
subtitles are in A2.

### 2.2 What the data says

* **Head terms are closed to a new app:** fishing app, fishing spots, fishing forecast, fish finder, fishing map,
  tides, tide chart, kayak fishing, saltwater fishing, marine weather. Each has 5-9 top-10 apps with 10k+ ratings, and
  medians of 11k-27k. Put these words in the name and subtitle so they combine into longer queries, but do not expect
  to rank for the bare head term.
* **Contested boating terms** have a median around 8.4k, with the same 8 apps rotating through the top 10: Navionics,
  Aqua Map, iNavX, i-Boating, Savvy Navvy, Wavve, Argo, PRO CHARTS. That covers nautical charts, marine gps, boat gps,
  boating gps, chartplotter, marine navigation and depth chart. Worth noting: **Navionics® Boating shows 2,354 ratings at
  2.9★**. The best-known chart brand is poorly rated, so "reliable, free, offline" is a real gap to position into.
  Navionics is a trademark, so it never goes in metadata.
* **Long tails a new app can win:**
  * **anchor alarm / anchor watch / anchor drag alarm:** top-10 medians of 177, 177 and 67 ratings. #1 is Anchor Pro
    (3,598); the rest are mostly under 1,000.
  * **california fishing:** top results are CDFW License (98 ratings, 2.8★), FishLegal (127), TroutFinder (0) and Fish
    Rules (199).
  * **socal fishing:** #1 is Catalysst SoCal (1 rating), then Fishbrain and games.
  * **fishing log / catch log:** medians of 25 and 10.
  * **sst / sea surface temperature / water temp:** sst returns staffing apps plus FishTrack and RipCharts; the others
    have medians of 491 and 171.
  * **marine protected areas:** median 619, led by FishLegal and Fish Rules.
  * **bite times:** #1 is BiteTime with 1 rating.
  * **offline nautical charts:** only 12 results.
  * **kayak fishing gps:** a 0-rating app at #5.
* **Untouched species queries:** `yellowtail`, `bluefin tuna`, `calico bass` and `halibut` return stickers, tournament
  apps, bass guitars and restaurants, with no fishing app in the top 10. `spearfishing` returns games. Search volume is
  unknown and probably small, but anyone searching these is exactly the beachhead. They are good overflow keywords
  (section 3.6).
* **Ambiguous on their own:**
  * `mpa`: Mobile Passport Control and Google Maps.
  * `kayak`: KAYAK travel, 498,749 ratings.
  * `noaa`: weather-radar apps with up to 1M ratings.
  * `offline`: games.

  Each still earns a keyword slot as a cheap **modifier** that pairs with words in the name and subtitle: "california
  mpa", "kayak fishing gps", "noaa charts", "offline charts".

### 2.3 Beachhead competitive set (SoCal saltwater)

| App | Seller | Subtitle | Ratings | Notes |
|---|---|---|---:|---|
| Fishdope Fishing App | Bloodydecks LLC | Fishing Reports, Spots, SSTs | 561 @ 4.7 | San Diego's Bloodydecks community. Reports and SST. |
| SatFish Fishing App | Bloodydecks LLC | Offshore Fishing SST & Maps | 366 @ 4.6 | |
| FishTrack - Charts & Forecasts | Surfline/Wavetrak | SST, tides, currents, & maps | 6,265 @ 4.6 | Last update 2024-10-09 |
| RipCharts | RipCharts, LLC. | — | 491 @ 4.8 | Last update 2023-12-08 |
| BigBlue Offshore Fishing | GeoPelagic LLC | Sea temperature & clarity maps | 55 @ 4.7 | |
| Catalysst SoCal | Chasing Pelagics LLC | SoCal Fishing Intelligence | 1 @ 5 | New. Ranks #1 for "socal fishing". |
| FishLegal | FISHLEGAL | Offline Maps - CA Fishing Laws | 127 @ 4.4 | Closest overlap on offline CA rules and MPAs. Last update 2024-06-15. |
| Fish Rules | Fish Rules, LLC. | License Regulations & Limits | 199 @ 3.9 | |
| Salty Offshore | Ryan Coughlin | Advanced Fishing Charts | 13 @ 5 | |

None of them combines a chartplotter, an anchor alarm, offline MPAs, an offline AI assistant and no account. The local
apps are paid or report-driven and focused on SST. The national chart apps do not cover California MPAs or local
fishing. That combination is the pitch.

---

## 3. Recommended metadata

### 3.1 Rules applied

* **Apple:** name ≤30, subtitle ≤30 and keyword field ≤100 characters. Apple indexes words from the name, subtitle and
  keyword field and combines them across fields. So no keyword repeats a word from the name or subtitle, no plural
  duplicates (`chart` vs `Charts`), commas only with no spaces, and no `app`, `free`, competitor trademarks or category
  padding.
* **Not indexed:** promotional text (≤170) is not used for search. It can be changed at any time without review, so use
  it for conversion and seasonal hooks. The description is not indexed on iOS either.
* **Versions:** the name, subtitle and keywords change only with a new app version.
* **Google Play:** title ≤30, short description ≤80. The full description **is** indexed. No "free/best/#1"-style
  wording in the title.
* **Pricing words:** Apple guideline 2.3.7 warns against pricing information in metadata. So "free" stays out of the
  name, subtitle, keywords and promo text, and "No account." carries the low-friction message instead.
* **Where the words go:** the descriptor `SoCal Fishing & GPS` and the subtitle `Offline Sea Charts, Tides & AI` are the
  same for every brand, so the keyword strategy does not depend on the brand decision.
  * The name carries the regional plus core words: socal, fishing, gps.
  * The subtitle carries the differentiator plus core words: offline, charts, tides, ai. (`sea` mainly makes the phrase
    read well.)
  * The keyword field carries the long tail.

### 3.2 Option A: Saltmate (recommended)

| Field | Text | Chars |
|---|---|---:|
| App Store name | `Saltmate: SoCal Fishing & GPS` | 29 |
| Subtitle | `Offline Sea Charts, Tides & AI` | 30 |
| Keywords | `nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,bite,times` | 99 |
| Promotional text | `Charts, GPS, tides and an AI first mate that keep working with zero signal. An anchor alarm that works with the phone locked. Every California MPA built in. No account.` | 168 |
| Google Play title | `Saltmate: SoCal Fishing & GPS` | 29 |
| Google Play short description | `Offline sea charts, tides, anchor alarm & AI for SoCal anglers. No account.` | 75 |

### 3.3 Option B: keep FishApp

| Field | Text | Chars |
|---|---|---:|
| App Store name | `FishApp: SoCal Fishing & GPS` | 28 |
| Subtitle | `Offline Sea Charts, Tides & AI` | 30 |
| Keywords | `nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,bite,fish` | 98 |
| Promotional text | same as A | 168 |
| Google Play title | `FishApp: SoCal Fishing & GPS` | 28 |
| Google Play short description | same as A | 75 |

The only change from A is in the keyword field: `fish` replaces `times`. Apple probably indexes "FishApp" as one token,
so it may not match the two-word search "fish app", which is what people type after hearing the name. `fish` plus the
brand gives the listing a chance at that search. The trade-off is losing "bite/tide/fishing times".

If you would rather keep the planned name `FishApp: Charts & Fishing GPS` (29), use the subtitle
`Offline Tides, Boat Maps & AI` (29) so "charts" is not repeated, and put `socal` in place of `bite` in the keywords:
`nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,socal,fish` (99, checked with
node, with no repeats).

### 3.4 Option C: Garibaldi

| Field | Text | Chars |
|---|---|---:|
| App Store name | `Garibaldi: SoCal Fishing & GPS` | 30 |
| Subtitle | `Offline Sea Charts, Tides & AI` | 30 |
| Keywords | same as A | 99 |
| Promotional text | same as A | 168 |
| Google Play title | `Garibaldi: SoCal Fishing & GPS` | 30 |
| Google Play short description | same as A | 75 |

### 3.5 Why each keyword earns its slot (Options A and C)

| Keyword | Chars | Queries it unlocks with the name/subtitle | Evidence (2026-10-26) |
|---|---:|---|---|
| `nautical` | 8 | nautical charts, offline nautical charts | Core boating query. Contested, median 8.4k, but highly relevant. |
| `marine` | 6 | marine gps, marine charts, marine navigation (partial) | The most common boating modifier. Contested. |
| `kayak` | 5 | kayak fishing, kayak gps, kayak fishing gps | **Beachhead.** Bare "kayak" is travel noise, but "kayak fishing gps" has a 0-rating app at #5. |
| `saltwater` | 9 | saltwater fishing, saltwater fishing gps | What the audience calls itself. Head-ish (5 strong), but Fish Rules ranks #3 with 199 ratings. |
| `california` | 10 | california fishing, california mpa, california tides | **Winnable:** top results have 0-199 ratings. Covers people who don't type "socal". |
| `anchor` | 6 | anchor alarm, anchor drag alarm | **Weakest competition tested** (medians 177 and 67), and a headline differentiator. |
| `alarm` | 5 | (with anchor) | Stored as separate words so both match on their own. |
| `sst` | 3 | sst charts, sst fishing | The term SoCal offshore anglers actually type. FishTrack and RipCharts rank for it among staffing apps. 3 chars. |
| `solunar` | 7 | solunar, solunar fishing, solunar tides | Specific intent. Contested (median 3.6k), but the feature exists. |
| `mpa` | 3 | california mpa, mpa fishing, mpa charts | Alone it means Mobile Passport, but as a modifier it is the 3-character key to the most California-specific feature. |
| `log` | 3 | fishing log | Median 25. The catch log is a retention feature. |
| `noaa` | 4 | noaa charts, noaa tides | Honest: the charts and tides are NOAA data. "noaa charts" #1 has 8 ratings. A government agency, not a competitor mark, but don't imply endorsement. |
| `boating` | 7 | boating gps, boating charts | Six of the eight nav leaders carry "Boating" or "Boat" in their names. Contested. |
| `bite` | 4 | bite times, fishing bite | "bite times" #1 has 1 rating. |
| `times` | 5 | bite times, fishing times, tide times | Covers three queries for 5 characters. "tide times" relies on Apple matching "tide" to "Tides". |

**Left out on purpose:**

* Already indexed from the name and subtitle: `fishing`, `gps`, `socal`, `charts`, `tides`, `offline`, `ai`.
* Banned by the brief: `app`, `free`.
* `navigation`: a head term, already partly covered by gps.
* `fish`: everywhere except Option B.
* `map`, `spots`, `forecast`: owned by giants.
* `bathymetry` (10): low volume.
* `reef`, `kelp`: aquarium and seaweed noise.
* `offshore` (8): good, but next in line.
* `san,diego` (10): its results are city apps.
* Species and `spearfishing`: overflow, see 3.6.

### 3.6 Later and optional

* **National variant, after the SoCal beachhead works:**
  * Name: `Saltmate: Fishing Charts & GPS` (30)
  * Subtitle: `Offline Tides, Boat Maps & AI` (29)
  * Keywords: `nautical,marine,kayak,saltwater,anchor,alarm,sst,solunar,log,noaa,boating,bite,times,offshore,watch` (99)
* **Spanish (Mexico) listing as overflow (owner decision):**
  * ASO vendors widely report that the US storefront also indexes the es-MX localization's name, subtitle and keywords.
    Apple does not document this.
  * A real Spanish listing helps SoCal's many Spanish-speaking anglers anyway. Its keyword field can also hold beachhead
    terms that did not fit. Example (98 chars):
    `pesca,mareas,ancla,alarma,san,diego,catch,spearfishing,yellowtail,bluefin,tuna,calico,halibut,kelp`
  * Putting English words in the es-MX field is a grey area. Keep the Spanish name and subtitle honest translations.
* **Custom product pages:** Apple announced in 2025 that custom product pages can be tied to keywords in organic
  search. Check App Store Connect for this before relying on it. Two obvious pages: "Kayak", which leads with the
  anchor alarm and kayak-scale GPS, and "MPA / spearfishing", which leads with MPA boundaries.
* **Google Play long description:** this one is indexed. Use the phrases naturally once or twice each: kayak fishing,
  anchor alarm, California MPA, sea surface temperature (SST), solunar, tide times, catch log, San Diego, Orange
  County, Los Angeles, Channel Islands. Do not stuff them; Google penalises repetition.

### 3.7 Character counts (node)

Measured with `node` (`String.length` and `Buffer.byteLength`):

```
current.name        29 chars  29 bytes  FishApp: Charts & Fishing GPS
current.subtitle    30 chars  30 bytes  Offline sea charts, tides & AI
current.keywords    98 chars  98 bytes  fishing,marine,nautical,chart,navigation,boat,gps,tides,anchor alarm,offshore,saltwater,bathymetry
current.promo      119 chars 119 bytes  Offline NOAA charts, live GPS, anchor alarm, tides, bite times and a free AI first mate that works even with no signal.
firstmate.variant   32 chars  32 bytes  First Mate: Fishing & Marine GPS
A.name              29 chars  29 bytes  Saltmate: SoCal Fishing & GPS
B.name              28 chars  28 bytes  FishApp: SoCal Fishing & GPS
C.name              30 chars  30 bytes  Garibaldi: SoCal Fishing & GPS
all.subtitle        30 chars  30 bytes  Offline Sea Charts, Tides & AI
AC.keywords         99 chars  99 bytes  nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,bite,times
B.keywords          98 chars  98 bytes  nautical,marine,kayak,saltwater,california,anchor,alarm,sst,solunar,mpa,log,noaa,boating,bite,fish
all.promo          168 chars 168 bytes  Charts, GPS, tides and an AI first mate that keep working with zero signal. An anchor alarm that works with the phone locked. Every California MPA built in. No account.
A.play.title        29 chars  29 bytes  Saltmate: SoCal Fishing & GPS
B.play.title        28 chars  28 bytes  FishApp: SoCal Fishing & GPS
C.play.title        30 chars  30 bytes  Garibaldi: SoCal Fishing & GPS
all.play.short      75 chars  75 bytes  Offline sea charts, tides, anchor alarm & AI for SoCal anglers. No account.
esMX.keywords       98 chars  98 bytes  pesca,mareas,ancla,alarma,san,diego,catch,spearfishing,yellowtail,bluefin,tuna,calico,halibut,kelp
X.name              30 chars  30 bytes  Saltmate: Fishing Charts & GPS
X.subtitle          29 chars  29 bytes  Offline Tides, Boat Maps & AI
X.keywords          99 chars  99 bytes  nautical,marine,kayak,saltwater,anchor,alarm,sst,solunar,log,noaa,boating,bite,times,offshore,watch

current.keywords: 12 terms, 98/100; "fishing" repeats name/subtitle; "chart" is a plural/singular of a name/subtitle word; "gps" repeats name/subtitle; "tides" repeats name/subtitle; space in "anchor alarm"
AC.keywords: 15 terms, 99/100; no repeats, no spaces
B.keywords: 15 terms, 98/100; no repeats, no spaces
X.keywords: 15 terms, 99/100; no repeats, no spaces
```

---

## 4. Problems in the current planned metadata (APP_STORE.md section 3)

1. **A quarter of the keyword field is wasted.** `fishing` and `gps` repeat the name, `tides` repeats the subtitle, and
   `chart` is the singular of `Charts`, which is in both. That is 20 letters plus 4 commas: **24 of 98 characters**
   that add nothing.
2. **The subtitle repeats the name.** "Charts" is in both, so about 7 subtitle characters buy no new search coverage.
3. **None of the beachhead words appear:** no kayak, california or socal, mpa, sst, solunar or log. Nothing tells Apple,
   or a SoCal angler scanning results, that this is the SoCal saltwater app, and those are the queries a new app can win.
4. **Slots go to terms that can't pay back.**
   * `navigation` (10 chars) is a head term ruled by Navionics, Aqua Map and iNavX.
   * `bathymetry` (10) is accurate but few people search it.
   * `boat` is fine, but `boating` is the word four of the eight nav leaders (Navionics, Aqua Map, Wavve, i-Boating)
     put in their names.
5. **`anchor alarm` contains a space.** It costs the same as a comma, so this is cosmetic, but comma-separated
   `anchor,alarm` lets each word combine with other fields.
6. **The brand fails its own search.** See 1.2: for `fishapp`, the exact-token app sits at #9, behind seven large fishing
   apps. Similar names
   also exist (CLS FishApp, FISHAPP.CZ, Fish App - Fresh).
7. **The promotional text undersells the app.**
   * It uses 119 of 170 characters.
   * It contains "free", which is pricing language under guideline 2.3.7.
   * It omits the three strongest hooks: no account, the anchor alarm working with the phone locked, and California
     MPAs.
   * It says "AI first mate", which is fine generically, but don't capitalise it into a brand while Mercury and Furuno
     ship "1st Mate" / "First Mate" marine apps.
8. **The first three screenshots don't show what makes the app different.** The current set is Go-To, tap-to-inspect,
   10-day weather, tides, First Mate and night mode. There is **no MPA screenshot and no anchor-alarm screenshot**, so
   the two most distinctive features are invisible in search results. See section 5.
9. **Category (minor):** keep Navigation as primary. Its top charts are less crowded than Sports, where every big
   fishing app sits. Sports suits the secondary slot better than Weather for fishing intent, but the secondary category
   has little effect.

---

## 5. Screenshot captions

The App Store search results show the first three portrait screenshots, so slots 1-3 must sell in about a second. ASO
vendors (Appfigures, mid-2025) also report that Apple now reads screenshot caption text for search ranking. Apple has
not confirmed it, but it means captions that use the target words do double duty. Use the app's own type (Barlow, ink
background, one amber accent, no emoji) so the captions match the product.

Ranked strongest first. Slots 1-3 go in the first three screenshots.

| Rank | Headline (≤5 words) | Pair with screen | Why |
|---:|---|---|---|
| 1 | **Works with zero signal** | Chart + GPS + depth, airplane-mode indicator visible | The core promise, and true of charts, GPS, tides and the AI. Answers the biggest fear offshore. Pairs with the subtitle's "Offline". |
| 2 | **Every California MPA, offline** | MPA overlay off La Jolla or Point Loma | Locally decisive, since anglers fear MPA tickets. No national chart app shows this. |
| 3 | **Anchor alarm, even when locked** | Anchor watch circle + alarm state | Safety, and something a phone app usually can't do. Also signals "real native app" to App Review. |
| 4 | **AI answers with zero signal** | First Mate chat answering a tide or regs question | A differentiator, but needs a beat of explanation, so it goes after the core three. |
| 5 | **Find the warm-water break** | SST layer with a visible temperature break | What offshore anglers want, and the words SoCal anglers already use. |
| 6 | **No account. Just fish.** | Home chart, nothing to sign in to | Removes friction. Works best as the last frame or as a banner on frame 1. |

Next in line: "SOS with your exact position", "Tides and bite times, offline", "Your catch log, auto-filled".

The existing `AppStoreScreenshots/` set needs an MPA frame and an anchor-alarm frame added, and the order changed.
Regenerate with `tests/visual/appstore.spec.ts` once the brand is decided.

---

## 6. Decisions the owner must make

1. **Brand.**
   * The options are Saltmate (recommended), FishApp (status quo) or Garibaldi.
   * If you choose a new brand:
     * Have a trademark attorney run a clearance search in classes 9 and 42. The flags are listed in 1.4.
     * Register a domain. `getsaltmate.com`, `saltmateapp.com`, `saltmate.io` and `saltmate.fish` looked unregistered;
       confirm at a registrar.
     * Create the App Store Connect app record early, which reserves the name.
   * The web app reads the brand from `src/site.config.json` (`SITE.brandName`). The iOS display name, bundle ID,
     privacy and support URLs (`…/fishapp/…`) and the screenshots would need separate changes.
2. **Assistant name.** Keep "First Mate" inside the app, or rename it, for example "Mate" under Saltmate. Seven marine
   apps already use the name.
3. **"SoCal" in the name at launch.** It sharpens local relevance and conversion. Switch to the national variant (3.6)
   when you expand; the name changes with any new version.
4. **Spanish (Mexico) listing as keyword overflow:** yes or no (3.6).
5. **Wording risk:** whether to use "free" anywhere in store copy (recommendation: description only), and whether to
   say "AI first mate" or a neutral "AI assistant".
6. **Screenshots:** approve the caption order in section 5 and the two new frames.

---

## Appendix: raw tables (US storefront, 2026-10-26)

### A1. Keyword difficulty summary (US store, top 10 per query)

| Query | Results | Top 10 with >=10k ratings | 1k-10k | <100 | Median ratings, top 10 | Verdict |
|---|---:|---:|---:|---:|---:|---|
| kayak fishing | 24 | 6 | 4 | 0 | 13,921 | Head term: giants own it |
| fishing app | 23 | 9 | 1 | 0 | 27,224 | Head term: giants own it |
| fishing spots | 24 | 8 | 1 | 0 | 19,761 | Head term: giants own it |
| marine navigation | 25 | 3 | 5 | 1 | 8,379 | Contested: support via name/subtitle words |
| nautical charts | 24 | 3 | 5 | 2 | 8,379 | Contested: support via name/subtitle words |
| boating gps | 25 | 4 | 6 | 0 | 8,517 | Contested: support via name/subtitle words |
| tides | 21 | 6 | 2 | 2 | 17,551 | Head term: giants own it |
| tide chart | 22 | 6 | 3 | 1 | 17,551 | Head term: giants own it |
| anchor alarm | 24 | 1 | 1 | 5 | 177 | Long tail: winnable |
| solunar | 25 | 3 | 3 | 3 | 3,567 | Contested: support via name/subtitle words |
| mpa | 23 | 2 | 0 | 8 | 3 | Noise: term means something else |
| california fishing | 20 | 2 | 3 | 2 | 1,294 | Long tail: winnable |
| saltwater fishing | 23 | 5 | 2 | 0 | 10,986 | Head term: giants own it |
| sea surface temperature | 23 | 1 | 3 | 4 | 491 | Long tail: winnable |
| fishing log | 24 | 1 | 1 | 6 | 25 | Long tail: winnable |
| offline charts | 11 | 0 | 7 | 2 | 2,429 | Contested: support via name/subtitle words |
| fishing gps | 24 | 3 | 3 | 4 | 2,354 | Contested: support via name/subtitle words |
| boat navigation | 24 | 3 | 6 | 1 | 8,379 | Contested: support via name/subtitle words |
| socal fishing | 24 | 4 | 3 | 1 | 5,508 | Long tail: winnable |
| san diego fishing | 24 | 5 | 5 | 0 | 10,676 | Contested: support via name/subtitle words |
| marine protected areas | 19 | 2 | 2 | 3 | 619 | Long tail: winnable |
| artificial reef | 19 | 1 | 5 | 4 | 1,787 | Noise: term means something else |
| anchor watch | 25 | 1 | 1 | 5 | 177 | Long tail: winnable |
| chartplotter | 25 | 3 | 6 | 1 | 8,379 | Contested: support via name/subtitle words |
| offshore fishing | 24 | 4 | 3 | 1 | 6,265 | Contested: support via name/subtitle words |
| fishing ai | 23 | 4 | 2 | 4 | 6,859 | Contested: support via name/subtitle words |
| bite times | 24 | 4 | 2 | 3 | 3,932 | Contested: support via name/subtitle words |
| fishing forecast | 24 | 8 | 1 | 0 | 19,761 | Head term: giants own it |
| catch log | 23 | 0 | 1 | 8 | 10 | Long tail: winnable |
| sst | 23 | 0 | 1 | 7 | 31 | Long tail: winnable |
| bathymetry | 20 | 2 | 2 | 3 | 654 | Long tail: winnable |
| kayak | 19 | 7 | 2 | 0 | 502,049 | Noise: term means something else |
| nautical | 24 | 4 | 4 | 2 | 8,379 | Contested: support via name/subtitle words |
| water temperature | 24 | 1 | 1 | 7 | 15 | Long tail: winnable |
| fishing regulations california | 23 | 2 | 4 | 0 | 2,803 | Long tail: winnable |
| noaa charts | 22 | 3 | 3 | 4 | 5,046 | Contested: support via name/subtitle words |
| boat sos | 25 | 5 | 4 | 1 | 13,683 | Noise: term means something else |
| kelp | 19 | 1 | 0 | 9 | 7 | Noise: term means something else |
| yellowtail | 7 | 0 | 0 | 7 | 0 | Long tail: winnable |
| fishing knots | 23 | 4 | 0 | 5 | 390 | Contested: support via name/subtitle words |
| anchor drag alarm | 24 | 0 | 1 | 6 | 67 | Long tail: winnable |
| offline nautical charts | 12 | 2 | 5 | 1 | 3,793 | Contested: support via name/subtitle words |
| kayak gps | 23 | 3 | 5 | 1 | 8,379 | Contested: support via name/subtitle words |
| boat gps | 25 | 4 | 5 | 0 | 8,379 | Contested: support via name/subtitle words |
| marine weather | 23 | 6 | 2 | 2 | 16,436 | Head term: giants own it |
| fishing map | 24 | 5 | 4 | 1 | 10,986 | Head term: giants own it |
| fish finder | 22 | 7 | 0 | 1 | 19,761 | Head term: giants own it |
| waypoint | 24 | 1 | 1 | 8 | 10 | Noise: term means something else |
| kayak fishing gps | 25 | 1 | 7 | 2 | 5,221 | Contested: support via name/subtitle words |
| spearfishing | 24 | 0 | 0 | 8 | 61 | Long tail: winnable |
| noaa | 25 | 7 | 1 | 0 | 76,007 | Noise: term means something else |
| bluefin tuna | 19 | 0 | 0 | 10 | 3 | Long tail: winnable |
| calico bass | 17 | 0 | 3 | 7 | 37 | Long tail: winnable |
| rockfish | 22 | 4 | 1 | 3 | 3,562 | Noise: term means something else |
| halibut | 21 | 0 | 0 | 9 | 2 | Long tail: winnable |
| kelp paddy | 20 | 0 | 0 | 10 | 4 | Noise: term means something else |
| offline | 25 | 8 | 0 | 0 | 378,735 | Noise: term means something else |
| no signal | 25 | 3 | 1 | 6 | 4 | Noise: term means something else |
| fishing assistant | 23 | 4 | 2 | 4 | 5,508 | Contested: support via name/subtitle words |
| marine gps | 25 | 3 | 5 | 2 | 8,379 | Contested: support via name/subtitle words |
| chart plotter | 25 | 3 | 6 | 1 | 8,379 | Contested: support via name/subtitle words |
| depth chart | 23 | 3 | 5 | 2 | 8,379 | Contested: support via name/subtitle words |
| san diego | 23 | 2 | 2 | 2 | 724 | Noise: term means something else |
| southern california | 17 | 1 | 2 | 5 | 371 | Noise: term means something else |
| fish limits | 22 | 3 | 5 | 0 | 5,669 | Noise: term means something else |
| water temp | 24 | 1 | 2 | 5 | 171 | Long tail: winnable |
| moon phase fishing | 21 | 7 | 2 | 1 | 22,564 | Head term: giants own it |
| man overboard | 18 | 3 | 1 | 6 | 8 | Long tail: winnable |

### A2. Top 5 results per keyword query

Subtitle columns (A2 and A3): scraped from each app's public apps.apple.com page; "—" means the app has no subtitle; "n/s" means not scraped (in A3 only marine/fishing-relevant collisions were looked up).

**kayak fishing** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | BUBBA Fishing | The Ultimate Fishing App | American Outdoor Brands, Inc. | 3,132 | 4.8 | Free |
| 2 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 3 | FishAngler: Fishing App | Fish AI, Maps, Spots & Tides | FishAngler, LLC | 13,921 | 4.8 | Free |
| 4 | Paddle Ways - Lets Go Paddling | River & Lake Maps & Conditions | onwater llc | 1,442 | 4.4 | Free |
| 5 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |

**fishing app** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 2 | Fishbox - Smart Fishing App | Spots Map, Lures, Baits, Knots | MEMS Group, Inc. | 38,632 | 4.6 | Free |
| 3 | FishAngler: Fishing App | Fish AI, Maps, Spots & Tides | FishAngler, LLC | 13,921 | 4.8 | Free |
| 4 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 5 | BassForecast: Bass Fishing App | Best days, lures, spots, times | BassForecast, LLC | 19,761 | 4.6 | Free |

**fishing spots** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 2 | Fishing Spots: Find & Fish App | Fish Finder, Tides & Weather | FishAngler, LLC | 10,986 | 4.7 | Free |
| 3 | Fishbox - Smart Fishing App | Spots Map, Lures, Baits, Knots | MEMS Group, Inc. | 38,632 | 4.6 | Free |
| 4 | FishAngler: Fishing App | Fish AI, Maps, Spots & Tides | FishAngler, LLC | 13,921 | 4.8 | Free |
| 5 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |

**marine navigation** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | iNavX: Marine Navigation | Sailing & Boating Chartplotter | NavX Studios LLC | 21,804 | 4.8 | Free |
| 3 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 4 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 5 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |

**nautical charts** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 3 | iNavX: Marine Navigation | Sailing & Boating Chartplotter | NavX Studios LLC | 21,804 | 4.8 | Free |
| 4 | Nautical Charts & Maps | Nautical Charts & Marine Maps | LW Brands, LLC | 3,793 | 4.6 | $8.99 |
| 5 | PRO CHARTS - Marine Navigation | — | MiraTrex, Inc | 8,517 | 4.5 | Free |

**boating gps** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 2 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |
| 3 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 4 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 5 | Argo Navigation: Boat GPS, Map | Marine Charts, Weather & Tides | ARGO TECHNOLOGIES, LLC | 6,204 | 4.9 | Free |

**tides** (21 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Tide Charts | Tides, Weather & Radar Near Me | 7th Gear | 114,244 | 4.8 | Free |
| 2 | Tides Near Me | Tide Charts, Currents & Depth | Shelter Island Mapping Company, LLC | 163,421 | 4.8 | Free |
| 3 | Tide Alert (NOAA) - Tide Chart | NOAA Fishing, Boating, Sailing | Rivolu LLC | 44,730 | 4.8 | Free |
| 4 | Tide Guide: Charts & Tables | NOAA Tides, Weather & Alerts | Condor Digital LLC | 10,249 | 4.7 | Free |
| 5 | Tides - high and low tide info | — | Andy Lin | 2 | 5 | Free |

**tide chart** (22 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Tide Charts | Tides, Weather & Radar Near Me | 7th Gear | 114,244 | 4.8 | Free |
| 2 | Tides Near Me | Tide Charts, Currents & Depth | Shelter Island Mapping Company, LLC | 163,421 | 4.8 | Free |
| 3 | Tide Alert (NOAA) - Tide Chart | NOAA Fishing, Boating, Sailing | Rivolu LLC | 44,730 | 4.8 | Free |
| 4 | Tide Guide: Charts & Tables | NOAA Tides, Weather & Alerts | Condor Digital LLC | 10,249 | 4.7 | Free |
| 5 | Tide Chart USA | — | Yasunori Kuroki | 8,197 | 4.8 | Free |

**anchor alarm** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Anchor Pro | Best anchoring companion | IdeaBoys GmbH | 3,598 | 4.8 | Free |
| 2 | Anchor Alarm / Watch | The anchor watch for your boat | w&h GmbH | 814 | 4.7 | Free |
| 3 | Anchor Alarm Pro | GPS drag watch for sailors | Bastad Makerspace | 3 | 5 | Free |
| 4 | Anchor Alarm with Late Set | Anchorages, FindMyBoat, Remote | B2N LTD | 402 | 4.6 | Free |
| 5 | Hooked: Anchor Alarm & Remote | GPS Anchor Watch & Drift Alert | Kylee Davis | 67 | 4.8 | Free |

**solunar** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing & Hunting Solunar Time | Best Fishing & Hunting Times | Anton Nikitin | 15,736 | 4.7 | Free |
| 2 | Solunar Best Hunting Times | Feeding and Hunt Time Calendar | Fascinating Projects Pty Ltd | 5,764 | 4.7 | Free |
| 3 | Solunar Time: Hunt & Fish | Best Fishing & Hunting Times | zeynep karabulut | 139 | 4.3 | Free |
| 4 | iSolunar™ Hunt & Fish Times | Best Hunting & Fishing Times | RedSnake Enterprises, LLC | 3,567 | 4.7 | $5.99 |
| 5 | Solunar Best Fishing Time | Fish Forecast & Calendar | Fascinating Projects Pty Ltd | 1,084 | 4.6 | Free |

**mpa** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Mobile Passport Control | Streamline your U.S. arrival | US Customs and Border Protection | 647,869 | 4.9 | Free |
| 2 | Google Maps | Places, navigation & traffic | Google LLC | 7,426,725 | 4.7 | Free |
| 3 | MPA | — | ESCO ELECTRONIC COMMERCIAL SERVICE COMPANY LIMITED | 0 | 0 | Free |
| 4 | MPA Golf | Live scoring for golf | Wanamaker Corporation | 0 | 0 | Free |
| 5 | Motor Pitch Analyzer | Motor RPM monitoring | Shiho Masuda | 1 | 1 | Free |

**california fishing** (20 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | CDFW License | CDFW License Application | RA Outdoors, LLC | 98 | 2.8 | Free |
| 2 | FishLegal | Offline Maps - CA Fishing Laws | FISHLEGAL | 127 | 4.4 | Free |
| 3 | TroutFinder California Edition | Latest Trout Stocking Data | Fred Pearl | 0 | 0 | Free |
| 4 | Fish Rules: Local Fishing Laws | License Regulations & Limits | Fish Rules, LLC. | 199 | 3.9 | Free |
| 5 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |

**saltwater fishing** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 2 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 3 | Fish Rules: Local Fishing Laws | License Regulations & Limits | Fish Rules, LLC. | 199 | 3.9 | Free |
| 4 | Fishing App - Pro Angler | Fish Identifier, Spots & Maps | Open Ocean Apps Inc. | 6,235 | 4.6 | Free |
| 5 | i Fishing Saltwater Lite | — | Chris Egerter | 1,722 | 4.6 | Free |

**sea surface temperature** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | BigBlue Offshore Fishing | Sea temperature & clarity maps | GeoPelagic LLC | 55 | 4.7 | Free |
| 2 | Sea Temperature & Waves | Water Temp, Surf & Tides | Iuliana Kriuchyna | 8 | 5 | Free |
| 3 | Sea Water Temperature | — | Georgiy Gorokhov | 74 | 4.8 | Free |
| 4 | FishTrack - Charts & Forecasts | SST, tides, currents, & maps | Surfline/Wavetrak | 6,265 | 4.6 | Free |
| 5 | RipCharts | — | RipCharts, LLC. | 491 | 4.8 | Free |

**fishing log** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Anglers' Log - Fishing Journal | Catch Log, Map & Fish Tracker | Cohen Adair | 304 | 4.7 | Free |
| 2 | CatchJournal: Fishing Log | Log catches, track species | Michael Glazebrook | 1 | 4 | Free |
| 3 | MyCatch Fishing App | By Angler's Atlas | Goldstream Publishing Inc. | 251 | 4.8 | Free |
| 4 | Hooked: Fishing Log | Private, offline, no account | Diego Abad Garcia | 0 | 0 | Free |
| 5 | Fishing Log & Journal - LogIT | Anglers Fish & Catch Tracker | Gniechwitz & Walterbusch GbR | 25 | 4.7 | Free |

**offline charts** (11 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Chartune: Music Charts Offline | Offline player, listen stats | 远志 刘 | 1 | 5 | Free |
| 2 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 3 | Simrad: Companion for Boaters | Great nautical charts | Navico Norway AS | 2,672 | 4.6 | Free |
| 4 | Offline Music ® | Listen to Music Offline | Plane Cubes | 3,482 | 4.5 | Free |
| 5 | PewPee: Music Player Offline | Play, stream & discover songs | Daniil Taiakin | 1,434 | 4.4 | Free |

**fishing gps** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 2 | Fishing GPS – Spot Share & Log | Log with GPS. Share with crew. | SANDALS BOTA, LIMITED LIABILITY COMPANY | 0 | 0 | Free |
| 3 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 4 | Lowrance: app for anglers | Great fishing charts | Navico Norway AS | 2,859 | 4.6 | Free |
| 5 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |

**boat navigation** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 3 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 4 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |
| 5 | Argo Navigation: Boat GPS, Map | Marine Charts, Weather & Tides | ARGO TECHNOLOGIES, LLC | 6,204 | 4.9 | Free |

**socal fishing** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Catalysst SoCal | SoCal Fishing Intelligence | Chasing Pelagics LLC | 1 | 5 | Free |
| 2 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 3 | Fishing Planet | Fishing Simulator | Fishing Planet LLC | 21,726 | 4.8 | Free |
| 4 | Fishing Superstars | Superb Rod Action! | Com2uS Holdings Corporation | 178 | 4.6 | Free |
| 5 | Fishing Frenzy:Idle Hooked Inc | Fishing Tycoon Game | CYBERJOY LIMITED | 10,676 | 4.8 | Free |

**san diego fishing** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 2 | Monster Fishing 2026 | Super realistic fishing game | Nexelon inc. | 2,829 | 4.5 | Free |
| 3 | Fishing Planet | Fishing Simulator | Fishing Planet LLC | 21,726 | 4.8 | Free |
| 4 | Fish Washington | Sport Fishing Regulations | Washington Department of Fish & Wildlife | 6,962 | 4.3 | Free |
| 5 | Ace Fishing: Wild Catch | Let's play 3D Fish Game 2020 | Com2uS Corp. | 4,861 | 4.6 | Free |

**marine protected areas** (19 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing License & Regs: Creel | CDFW License: Seasons & Limits | Elias Garcia | 0 | 0 | Free |
| 2 | FishLegal | Offline Maps - CA Fishing Laws | FISHLEGAL | 127 | 4.4 | Free |
| 3 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 4 | Fish Rules: Local Fishing Laws | License Regulations & Limits | Fish Rules, LLC. | 199 | 3.9 | Free |
| 5 | Marine Sanctuary Explorer | — | National Marine Sanctuary Foundation | 8 | 3.4 | Free |

**artificial reef** (19 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Bulk Reef Supply | Saltwater Aquarium Supplies | Aquatic Sales Solutions, Inc. | 3,065 | 4.9 | Free |
| 2 | ReefBeat | — | Red Sea Aquatics Development LTD | 1,800 | 2.6 | Free |
| 3 | Rescue Reef | — | MindJolt | 1,050 | 4.1 | Free |
| 4 | Lionfish Reef Heroes | Hunt lionfish, save the reef | AQUATICXR LLC | 9 | 5 | Free |
| 5 | Reef Expert: Fish & Coral | AI Reef Expert Coach | Yihong Lim | 49 | 4.6 | Free |

**anchor watch** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Anchor Watch - Anchor Alarm | A better anchor alarm | High Hill Bits AS | 30 | 4.8 | Free |
| 2 | Anchor Pro | Best anchoring companion | IdeaBoys GmbH | 3,598 | 4.8 | Free |
| 3 | Anchor Alarm / Watch | The anchor watch for your boat | w&h GmbH | 814 | 4.7 | Free |
| 4 | Boat Knot Meter: Anchor Watch | Marine GPS speed, drift alarm | lapnito.cz s.r.o. | 2 | 5 | Free |
| 5 | Anchor Alarm: ZENKOU PRO | Boat Monitor Onboard & Ashore | UNITIO PLUS SL | 177 | 4.5 | Free |

**chartplotter** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | iNavX: Marine Navigation | Sailing & Boating Chartplotter | NavX Studios LLC | 21,804 | 4.8 | Free |
| 3 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 4 | ActiveCaptain® | Connect to Your GPS Plotter | Garmin International | 5,221 | 4 | Free |
| 5 | Argo Navigation: Boat GPS, Map | Marine Charts, Weather & Tides | ARGO TECHNOLOGIES, LLC | 6,204 | 4.9 | Free |

**offshore fishing** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 2 | Marine Weather Forecast Pro | NOAA Marine Weather Forecast | LW Brands, LLC | 16,436 | 4.7 | Free |
| 3 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 4 | FishWeather: Marine Forecasts | Fish, Wind, Waves, and Tides | WeatherFlow | 5,211 | 4.7 | Free |
| 5 | Offshore Fishing | Build your sportfishing fleet | BINARYFUEL, LLC | 1 | 5 | Free |

**fishing ai** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing AI App | AI Lure Picker & Catch Log | Christopher Alonso | 1,542 | 4.8 | Free |
| 2 | Fish AI - AI Fishing App | Spots, Forecast & Fish Log | Liftoff Labs Inc. | 27,224 | 4.7 | Free |
| 3 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 4 | FishAngler: Fishing App | Fish AI, Maps, Spots & Tides | FishAngler, LLC | 13,921 | 4.8 | Free |
| 5 | askafish.ai | Makes fishing easier  with AI. | kayanti kootz | 2 | 5 | Free |

**bite times** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | BiteTime – Best Fishing Times | Fish bite forecast & spot map | Spruzzo Labs Inc. | 1 | 5 | Free |
| 2 | Fishing Times Calendar | know when to fish | Mark Totzke | 3,932 | 4.7 | Free |
| 3 | Fishing Calendar & Tide Times | Weather Forecast & Spots | TOP APP d.o.o. | 12,137 | 4.4 | Free |
| 4 | Fishing & Hunting Solunar Time | Best Fishing & Hunting Times | Anton Nikitin | 15,736 | 4.7 | Free |
| 5 | BiteRadar: Fishing Forecast | Fish Activity & Best Times | Jeremiasz Grodzicki | 8 | 4.8 | Free |

**fishing forecast** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing forecast | perfect for fishermen | Maksym Buradchuk | 440 | 4.7 | Free |
| 2 | Fishing & Hunting Solunar Time | Best Fishing & Hunting Times | Anton Nikitin | 15,736 | 4.7 | Free |
| 3 | BassForecast: Bass Fishing App | Best days, lures, spots, times | BassForecast, LLC | 19,761 | 4.6 | Free |
| 4 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 5 | Fishing Forecast - TipTop App | Fish weather, spots, log | Konstantin Breysler | 1,353 | 4.7 | Free |

**catch log** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing Tracker: Fish Log | GPS Spots, Trips & Journal | Fenuku Kekeli | 0 | 0 | Free |
| 2 | Catch Log: Fishing Journal | Log catches with GPS & photos | Blas Prieto | 0 | 0 | Free |
| 3 | Anglers' Log - Fishing Journal | Catch Log, Map & Fish Tracker | Cohen Adair | 304 | 4.7 | Free |
| 4 | Catchr: Fish Identifier | Identify fish & log catches | Smolworks Inc | 5,013 | 4.7 | Free |
| 5 | Catch - Fish Log for Anglers | — | Technomagination, LLC | 19 | 4.2 | Free |

**sst** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Training Connect | Validate your NYC DOB TC Card | Community Compliance Management Technologies Inc | 49 | 3.5 | Free |
| 2 | SST Staffing | SST Staffing | Serveture, LLC | 130 | 4.8 | Free |
| 3 | SST Card Tracker | NYC SST card management | Lergent Corp. | 31 | 4.2 | Free |
| 4 | SST System | Management Software System | Mahmoud elsayed | 3 | 3.7 | Free |
| 5 | SST-IQ | — | Salina-Spavinaw Telephone Company, Inc. | 16 | 4.8 | Free |

**bathymetry** (20 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Sea Depth | Offshore Bathymetry Charts | Seadepth Charts, LLC | 16 | 4.2 | Free |
| 2 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 3 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 4 | Fish Deeper - Fishing App | Lake Depth Maps to Catch More | Deeper UAB | 654 | 4.5 | Free |
| 5 | RipCharts | — | RipCharts, LLC. | 491 | 4.8 | Free |

**kayak** (19 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | KAYAK: Flights, Hotels & Cars | Plan vacations & book trips | Kayak Software Corp | 498,749 | 4.8 | Free |
| 2 | Hopper: Flights, Hotels & Cars | Spend Less, Travel Better. | Hopper Inc. | 1,229,239 | 4.8 | Free |
| 3 | Expedia: Hotels, Flights, Cars | Trip planner & travel deals | Expedia, Inc. | 5,986,675 | 4.8 | Free |
| 4 | Booking.com: Hotels & Travel | Hotels, flights & car rentals | Booking.com B.V. | 2,206,374 | 4.8 | Free |
| 5 | Skyscanner Flights & Travel | Cheap Flight Tickets & Booking | Skyscanner Limited | 502,049 | 4.8 | Free |

**nautical** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | Nautical Rules | Master the Rules of the Road | Joseph Kim | 12 | 5 | Free |
| 3 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 4 | Nautical Charts & Maps | Nautical Charts & Marine Maps | LW Brands, LLC | 3,793 | 4.6 | $8.99 |
| 5 | MarineTraffic - Ship Tracking | #1 Vessel Tracking App! | MARINETRAFFIC APPLICATIONS LTD | 65,000 | 4.7 | Free |

**water temperature** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Marine Weather Forecast Pro | NOAA Marine Weather Forecast | LW Brands, LLC | 16,436 | 4.7 | Free |
| 2 | Water Temperatures | Sea and lake temperatures | Blaz Smolnikar | 15 | 2.5 | Free |
| 3 | NOAA Buoy Reports & Ship Data | Marine Wind, Wave & Sea Temps | Juggernaut Technology, Inc. | 2,459 | 4.7 | Free |
| 4 | Water Temperature | Real water thermometer | Aaron Satterfield | 6 | 3.8 | $2.99 |
| 5 | Sea Water Temperature | — | Georgiy Gorokhov | 74 | 4.8 | Free |

**fishing regulations california** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fish Rules: Local Fishing Laws | License Regulations & Limits | Fish Rules, LLC. | 199 | 3.9 | Free |
| 2 | FishVerify: ID & Regulations | #1 Fish Identification App | FishVerify LLC | 2,229 | 4.6 | Free |
| 3 | Fish Washington | Sport Fishing Regulations | Washington Department of Fish & Wildlife | 6,962 | 4.3 | Free |
| 4 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 5 | FishLegal | Offline Maps - CA Fishing Laws | FISHLEGAL | 127 | 4.4 | Free |

**noaa charts** (22 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Hip Charts | NOAA ENC Charts | Tyler Elko | 8 | 3.5 | Free |
| 2 | Nautical Charts & Maps | Nautical Charts & Marine Maps | LW Brands, LLC | 3,793 | 4.6 | $8.99 |
| 3 | iNavX: Marine Navigation | Sailing & Boating Chartplotter | NavX Studios LLC | 21,804 | 4.8 | Free |
| 4 | PRO CHARTS - Marine Navigation | — | MiraTrex, Inc | 8,517 | 4.5 | Free |
| 5 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |

**boat sos** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Boatsetter - Boat Rentals | Boat Rentals & Yacht Charters | Collaborative Boating, Inc. | 19,213 | 4.8 | Free |
| 2 | BoatUS - Boat Weather & Tides | 24/7 Boat Towing & Insurance | Boat America Corporation | 58,325 | 4.8 | Free |
| 3 | Nebo - Boat Logging Made Easy. | Auto Boat Log, Connect & Share | NEBO GLOBAL PTY LTD | 37 | 4.2 | Free |
| 4 | Getmyboat | Boat Rentals & Yacht Charters | Getmyboat, Inc | 13,683 | 4.9 | Free |
| 5 | Boat Trader: Boats for Sale | Buy & Sell New & Used Boats | Boats Group LLC | 175,009 | 4.8 | Free |

**kelp** (19 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Kelp Sushi | — | Kelp Sushi Joint LLC | 82 | 4.9 | Free |
| 2 | Kelp | Decentralized Personal Finance | Kelp Finance Labs Inc. | 29 | 3.8 | Free |
| 3 | KELP Radio | — | Broadcast Radio Ltd | 3 | 4.3 | Free |
| 4 | My Kelp | Track growth & climate impacts | GreenWave Organization Corp. | 0 | 0 | Free |
| 5 | The Kelp Forest ebook | A Young Explorer's Guide | Monterey Bay Aquarium | 7 | 4.4 | Free |

**yellowtail** (7 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | yellowtail anime sticker | animated sticker for msg app | kupaberu | 0 | 0 | $0.99 |
| 2 | Fishing License & Regs: Creel | CDFW License: Seasons & Limits | Elias Garcia | 0 | 0 | Free |
| 3 | Fish City: Real Fish Counts | Real catches. Real conditions. | Cerity Farms LLC | 14 | 4.7 | Free |
| 4 | Eleven Cannabis Co | — | YellowTail Ventures Inc | 16 | 5 | Free |
| 5 | Dally's White River Fly Fisher | — | Dallys Ozark Fly Fisher Inc | 11 | 4.6 | Free |

**fishing knots** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing Knots FishPlanet | Encyclopedia of knots | Eldar Sadykhov | 19,709 | 4.7 | Free |
| 2 | Fishing Knots & Rigs | Learn how to tie... | Phillip Steffensen | 390 | 4.8 | Free |
| 3 | Fishing Knots how to tie knots | — | kitaek kim | 13 | 3.7 | Free |
| 4 | Fishing Knots: Tie & Rig Guide | Step-by-Step Line & Hook Tying | Vladislav Zhirnov | 47 | 4 | Free |
| 5 | TackleKept: Fishing Knots | Rigs, species & bite times | Salman Khakwani | 0 | 0 | Free |

**anchor drag alarm** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Anchor Pro | Best anchoring companion | IdeaBoys GmbH | 3,598 | 4.8 | Free |
| 2 | Anchory - Anchor Drag Alarm | Fast and simple anchor alarm. | ESIRION AG | 0 | 0 | Free |
| 3 | Anchor Alarm with Late Set | Anchorages, FindMyBoat, Remote | B2N LTD | 402 | 4.6 | Free |
| 4 | Anchor Alarm / Watch | The anchor watch for your boat | w&h GmbH | 814 | 4.7 | Free |
| 5 | Anchor Alarm: ZENKOU PRO | Boat Monitor Onboard & Ashore | UNITIO PLUS SL | 177 | 4.5 | Free |

**offline nautical charts** (12 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Nautical Charts & Maps | Nautical Charts & Marine Maps | LW Brands, LLC | 3,793 | 4.6 | $8.99 |
| 2 | Simrad: Companion for Boaters | Great nautical charts | Navico Norway AS | 2,672 | 4.6 | Free |
| 3 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 4 | iSailGPS : NOAA USA RNC Charts | Marine Nautical Chart Plotter | James Associates Inc. | 72 | 3.9 | $7.99 |
| 5 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |

**kayak gps** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Paddle Logger: SUP & Kayaking | Paddling Logbook & GPS Tracker | Paddle Logger Ltd. | 6,432 | 4.7 | Free |
| 2 | Paddle Ways - Lets Go Paddling | River & Lake Maps & Conditions | onwater llc | 1,442 | 4.4 | Free |
| 3 | Paddle Guide: Kayak Canoe SUP | Launch Points, Trails & GPS | Paddle Guide LLC | 10 | 5 | Free |
| 4 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 5 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |

**boat gps** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 2 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 3 | Argo Navigation: Boat GPS, Map | Marine Charts, Weather & Tides | ARGO TECHNOLOGIES, LLC | 6,204 | 4.9 | Free |
| 4 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 5 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |

**marine weather** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Marine Weather Forecast Pro | NOAA Marine Weather Forecast | LW Brands, LLC | 16,436 | 4.7 | Free |
| 2 | NOAA Marine Weather & Forecast | Predict wind, swell, and waves | Zipo Apps Ltd. | 5,046 | 4.5 | Free |
| 3 | Marine Weather and Tides | Waves, Tides, Wind Forecast | Anton Nikitin | 55 | 4.4 | Free |
| 4 | BoatUS - Boat Weather & Tides | 24/7 Boat Towing & Insurance | Boat America Corporation | 58,325 | 4.8 | Free |
| 5 | Windy.app — Wind, Tides, Radar | #1 Fishing, boating & sailing | Windy Weather World Inc | 73,189 | 4.7 | Free |

**fishing map** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 2 | Fishing Spots: Find & Fish App | Fish Finder, Tides & Weather | FishAngler, LLC | 10,986 | 4.7 | Free |
| 3 | Fishbox - Smart Fishing App | Spots Map, Lures, Baits, Knots | MEMS Group, Inc. | 38,632 | 4.6 | Free |
| 4 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 5 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |

**fish finder** (22 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 2 | Fishing Spots - Fish Finder | Fish AI Identifier Forecast | Reworld Inc | 318 | 4.7 | Free |
| 3 | Fishbox - Smart Fishing App | Spots Map, Lures, Baits, Knots | MEMS Group, Inc. | 38,632 | 4.6 | Free |
| 4 | Fish AI - AI Fishing App | Spots, Forecast & Fish Log | Liftoff Labs Inc. | 27,224 | 4.7 | Free |
| 5 | FishFinder | — | SUNGCHANCE INTERNATIONAL GROUP LIMITED | 4 | 3 | Free |

**waypoint** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Waypoint — Live Flight Map | Live map for Infinite Flight | Julian Klaus Hoke | 10 | 5 | Free |
| 2 | Waypoint Protect | Vehicle and Family Protection | Spectrum Automotive Holdings Corp | 25 | 4.4 | Free |
| 3 | Waypoint: Outdoor Navigation | Find Your Way Back Offline | Christopher Pyers | 3 | 5 | Free |
| 4 | Waypoint® Parents App | — | School Bus Manager, Inc. | 14 | 2.1 | Free |
| 5 | WPA | — | Waypoint Analytical, Inc. | 5 | 4.2 | Free |

**kayak fishing gps** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 2 | Omnia Fishing: Spots & Maps | Fishing App: Maps & Reports | Omnia Fishing, Inc. | 3,784 | 4.6 | Free |
| 3 | Lowrance: app for anglers | Great fishing charts | Navico Norway AS | 2,859 | 4.6 | Free |
| 4 | Savvy Navvy: Boat Navigation | GPS, Nautical Charts, Boating | SAVVY NAVVY LTD | 8,379 | 4.7 | Free |
| 5 | Fishing GPS – Spot Share & Log | Log with GPS. Share with crew. | SANDALS BOTA, LIMITED LIABILITY COMPANY | 0 | 0 | Free |

**spearfishing** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | DiveHunter | Spear Fishing Simulator | Giovanni Ferraro | 71 | 2.2 | Free |
| 2 | Spearfishing Simulator | Realistic Spearfishing Game | Hakan Nehir | 96 | 3.8 | Free |
| 3 | Fishing Hunting : Shooter Game | Action | Shooting Puzzle Game Limited | 200 | 4.7 | Free |
| 4 | Spearo: Spearfishing Forecast | Visibility Forecast & Tides | Diana Dryn | 7 | 2.6 | Free |
| 5 | Hunter underwater spearfishing 3D | Action | Sandalov Oleg, IE | 17 | 2.5 | Free |

**noaa** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Clime: NOAA Weather Radar Live | Tornado, Rain & Storm Alerts | Mosaic S.r.l. | 1,056,107 | 4.5 | Free |
| 2 | NOAA Radar & Weather Forecast | Storm, Snow & Hurricane Radar | Position Mobile Ltd SEZC | 76,007 | 4.4 | Free |
| 3 | NOAA Weather Radar Live Map | Tornado & Hurricane Tracker | BEE LAB JOINT STOCK COMPANY | 13,110 | 4.5 | Free |
| 4 | The Weather Channel - Radar | Live Radar: Snow, Storm Alerts | The Weather Channel | 6,098,423 | 4.8 | Free |
| 5 | NOAA Weather Radar Live Map . | Weather Tides Currents Marine | TERMUX LIMITED LIABILITY COMPANY | 107 | 4.2 | Free |

**bluefin tuna** (19 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Beach Haven Marlin & Tuna Club | Fishing Tournaments | Reel Time Apps Inc. | 1 | 5 | Free |
| 2 | Hot Tuna | — | Bay Cafe, Inc. | 30 | 4.7 | Free |
| 3 | Boothbay Harbor Tuna Challenge | Fishing Tournament | Reel Time Apps Inc. | 5 | 5 | Free |
| 4 | Virginia Beach Tuna Tournament | Fishing Tournament | Reel Time Apps Inc. | 0 | 0 | Free |
| 5 | BlueFronts: Offshore Fishing | Offshore Fishing Intel | BlueFronts LLC | 3 | 5 | Free |

**calico bass** (17 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Real Bass electric bass guitar | Learn how to play bass riffs | KOLB SISTEMAS - EIRELI | 3,822 | 4.5 | Free |
| 2 | Bass Booster - Audio Equalizer | Amplifi Beats With Headphone.s | Pretty View LLC | 4,756 | 4.3 | Free |
| 3 | Master Bass Angler: Fishing | Bass Fishing Games Simulator | Gold Helm Games, LLC | 3,586 | 4.7 | Free |
| 4 | Bass Trainer | Learn the notes of the bass | Green Skin | 61 | 4.3 | Free |
| 5 | Bass Bassic | Learn Bass Chords & Scales | Yu-Sheng Wong | 4 | 4.8 | Free |

**rockfish** (22 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | RockFish Church | — | RAEFORD CHRISTIAN FELLOWSHIP INC | 12 | 4.7 | Free |
| 2 | Fish Identifier - FishSnap | AI Fish Scanner for Fishing | Thies Dieckmann | 0 | 0 | Free |
| 3 | Fishdom | Match 3 & Fish Puzzle Game | PLR Worldwide Sales Limited | 1,151,388 | 4.6 | Free |
| 4 | Tap Tap Fish - AbyssRium | My healing aquarium | SangHeon Kim | 24,171 | 4.5 | Free |
| 5 | Paradise - Fish Aquarium | Relaxing Ocean Aquarium | ORCA STUDIOS PTY. LTD. | 3,562 | 4.6 | Free |

**halibut** (21 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Halibuts | All London's Live Music | Halibuts Dot Com Limited | 0 | 0 | Free |
| 2 | JSG Guide | Conner Martinis | Justin Ellis | 4 | 3.3 | Free |
| 3 | Fish City: Real Fish Counts | Real catches. Real conditions. | Cerity Farms LLC | 14 | 4.7 | Free |
| 4 | FishLine® Local Seafood Finder | If it's Fresh, it's FishLine! | Phondini Partners | 145 | 4.4 | Free |
| 5 | Dishy Delishy | Meal tracking and planning | TF Halibut Ltd | 0 | 0 | Free |

**kelp paddy** (20 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | The Kelp Forest ebook | A Young Explorer's Guide | Monterey Bay Aquarium | 7 | 4.4 | Free |
| 2 | Kelpulator | Kelp Paddy Drift for Anglers | Alan DaCosta | 0 | 0 | Free |
| 3 | Mahmood Rice | — | ALTUNKAYA INSAAT NAKLIYAT GIDA TICARET ANONIM SIRKETI | 15 | 3.3 | Free |
| 4 | RICE: Asian Food Delivery | Delivering best Asian food | RICE Commerce Spain, S.L. | 42 | 4.6 | Free |
| 5 | Seaweed Sorter | Pacific Northwest edition | Patrick Martone | 7 | 5 | $3.99 |

**offline** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Offline: Files, Browser, VPN | Private Browsing & Save Videos | SAEED ABDULLAH ALHAJRI | 137,843 | 4.6 | Free |
| 2 | Offline Games - No Wifi Games | Classic brain train minigames | Jindoblu Limited | 378,735 | 4.8 | Free |
| 3 | Offline: Music, Video, Browser | Offline Player & Videos, Songs | 春萍 肖 | 537 | 4.4 | Free |
| 4 | Subway Surfers | Join the endless running fun! | Sybo Games ApS | 3,863,841 | 4.6 | Free |
| 5 | Offline Games: No WiFi - FunOn | Relax & Play Without internet | 720 Media, LLC | 98,721 | 4.7 | Free |

**no signal** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Signal - Private Messenger | Say “hello” to privacy. | Signal Messenger, LLC | 1,104,984 | 4.7 | Free |
| 2 | Nosignalauto | — | ODOIN LTD | 1 | 1 | Free |
| 3 | No Signal NYC | Dark, grimy DJ sets | Terrible Solutions LLC | 4 | 5 | Free |
| 4 | NoSignal App | — | CLOUD CRAFT S.R.L. | 0 | 0 | Free |
| 5 | Offline Games - No Wifi Games | Classic brain train minigames | Jindoblu Limited | 378,735 | 4.8 | Free |

**fishing assistant** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | tackle - AI Fishing Assistant | Fish Smarter, Catch More | Ernest Cosio | 3 | 5 | Free |
| 2 | Ripple: AI Fishing Assistant | — | Kai Li | 7 | 2.1 | Free |
| 3 | Fishbrain - Fishing App | Fish Spots, Maps & Forecast | FishBrain AB | 76,207 | 4.7 | Free |
| 4 | Lake Labs | Your smarter fishing assistant | Aurora L Whittet | 5 | 5 | Free |
| 5 | Fish AI - AI Fishing App | Spots, Forecast & Fish Log | Liftoff Labs Inc. | 27,224 | 4.7 | Free |

**marine gps** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 3 | Argo Navigation: Boat GPS, Map | Marine Charts, Weather & Tides | ARGO TECHNOLOGIES, LLC | 6,204 | 4.9 | Free |
| 4 | Aqua Map Boating | Marine navigation and fishing | GEC s.r.l. | 13,819 | 4.7 | Free |
| 5 | PRO CHARTS - Marine Navigation | — | MiraTrex, Inc | 8,517 | 4.5 | Free |

**chart plotter** (25 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 2 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 3 | iNavX: Marine Navigation | Sailing & Boating Chartplotter | NavX Studios LLC | 21,804 | 4.8 | Free |
| 4 | ActiveCaptain® | Connect to Your GPS Plotter | Garmin International | 5,221 | 4 | Free |
| 5 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |

**depth chart** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | i-Boating: Marine Charts & Gps | Lake Depth Map,Sailing Plotter | Bist LLC | 14,951 | 4.5 | Free |
| 2 | Navionics® Boating | Nautical and fishing charts | Garmin International | 2,354 | 2.9 | Free |
| 3 | Fishing Points: Map & Forecast | Fish Spots, Tides & Best Times | Fishing Points d.o.o. | 31,020 | 4.7 | Free |
| 4 | Wavve Boating: GPS, Map, Chart | Marine Navigation, Depth, Tide | Wavve Boating Inc | 6,623 | 4.7 | Free |
| 5 | PRO CHARTS - Marine Navigation | — | MiraTrex, Inc | 8,517 | 4.5 | Free |

**san diego** (23 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | San Diego Zoo - Travel Guide | Park map & walking directions | San Diego Zoo | 14,260 | 4.9 | Free |
| 2 | Pronto - San Diego | North County Transit District | San Diego Metropolitan Transit System | 37,662 | 4.7 | Free |
| 3 | Get It Done San Diego | — | City of San Diego | 167 | 2.8 | Free |
| 4 | Balboa Park Official App | — | Balboa Park Online Collaborative | 185 | 4.5 | Free |
| 5 | San Diego Travel Guide . | San Diego City Guide and Maps | Travel Experiences Apps LTD | 260 | 4.7 | Free |

**southern california** (17 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | CU SoCal Mobile Banking | — | Credit Union of Southern California | 36,189 | 4.9 | Free |
| 2 | MySCE | — | SOUTHERN CALIFORNIA EDISON COMPANY | 1,516 | 1.9 | Free |
| 3 | South California Wildflowers | — | Wildflower Search | 7 | 4.4 | Free |
| 4 | KTLA 5 News Los Angeles | — | TRIBUNE BROADCASTING COMPANY INC | 6,217 | 4.5 | Free |
| 5 | Homes in Southern California | — | Anne marie Radel | 0 | 0 | Free |

**fish limits** (22 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fish Rules: Local Fishing Laws | License Regulations & Limits | Fish Rules, LLC. | 199 | 3.9 | Free |
| 2 | Picture Fish - Fish Identifier | Fish ID Verify by Picture | Next Vision Limited | 5,413 | 4.5 | Free |
| 3 | Happy Fish + | Leisure fish farming | Eureka Creation Limited | 1,029 | 4.5 | Free |
| 4 | Fish Tales ™ | Simulation | WISE WAVE CORPORATION LIMITED | 538 | 4.2 | Free |
| 5 | Fishing Master | Hooked on Real Motion Fishing! | Ark Game Limited | 23,815 | 4.8 | Free |

**water temp** (24 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Marine Weather Forecast Pro | NOAA Marine Weather Forecast | LW Brands, LLC | 16,436 | 4.7 | Free |
| 2 | Water Temperatures | Sea and lake temperatures | Blaz Smolnikar | 15 | 2.5 | Free |
| 3 | Water Temperature | Real water thermometer | Aaron Satterfield | 6 | 3.8 | $2.99 |
| 4 | Water Temp Forecast | Live river & lake temperatures | Advanced Field Technologies LLC | 1 | 5 | Free |
| 5 | Sea Water Temperature | — | Georgiy Gorokhov | 74 | 4.8 | Free |

**moon phase fishing** (21 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Fishing & Hunting Solunar Time | Best Fishing & Hunting Times | Anton Nikitin | 15,736 | 4.7 | Free |
| 2 | Solunar Best Fishing Time | Fish Forecast & Calendar | Fascinating Projects Pty Ltd | 1,084 | 4.6 | Free |
| 3 | Moon Phases and Lunar Calendar | Full Moon Phase | Business City s.r.o. | 37,793 | 4.9 | Free |
| 4 | Fishing Times Calendar | know when to fish | Mark Totzke | 3,932 | 4.7 | Free |
| 5 | MOON - Current Moon Phase | Full Lunar Calendar & Tracker | MOON CALENDAR LTD | 29,819 | 4.8 | Free |

**man overboard** (18 results)

| # | App (trackName) | Subtitle | Seller | Ratings | Avg | Price |
|---:|---|---|---|---:|---:|---|
| 1 | Man Overboard for iOS | Crew Safety. Instant Alerts. | PredictWind Limited | 0 | 0 | Free |
| 2 | easy2-MOB | Man-over-board device | Weatherdock AG | 0 | 0 | Free |
| 3 | Man Overboard by PredictWind | Crew Safety. Instant Alerts. | PredictWind Limited | 0 | 0 | Free |
| 4 | ACR OLAS: Marine Alert System | Man Overboard Alert System | Ultimate Sports Engineering Ltd | 8 | 1.9 | Free |
| 5 | MOB – Man Overboard | MOB button on your wrist | Gleb Semerenko | 1 | 5 | $1.99 |

### A3. Name queries: every result whose name or seller contains the candidate

**"fishapp"**: 47 results, 4 name/seller matches. Top 3 overall: Fishbrain - Fishing App (76,207); Fishbox - Smart Fishing App (38,632); FishAngler: Fishing App (13,921)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 5 | Fishing Spots: Find & Fish App | Fish Finder, Tides & Weather | FishAngler, LLC | Sports | 10,986 | Free | 2026-10-17 |
| 6 | Fish App - Fresh | n/s | SEAS APP SERVICES BROKER | Food & Drink | 0 | Free | 2026-03-14 |
| 9 | CLS FishApp | n/s | Collecte Localisation Satellites | Business | 0 | Free | 2026-07-25 |
| 15 | FISHAPP.CZ | n/s | APPKEE s.r.o. | Reference | 0 | Free | 2024-07-01 |

**"fish app"**: 45 results, 2 name/seller matches. Top 3 overall: Fish Verify－Identifier, Finder (7); Fishbrain - Fishing App (76,207); Fishbox - Smart Fishing App (38,632)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 8 | Fishing Spots: Find & Fish App | Fish Finder, Tides & Weather | FishAngler, LLC | Sports | 10,986 | Free | 2026-10-17 |
| 15 | Fish App - Fresh | n/s | SEAS APP SERVICES BROKER | Food & Drink | 0 | Free | 2026-03-14 |

**"first mate"**: 44 results, 7 name/seller matches. Top 3 overall: 1st-Mate (10); First Mate (0); TZ First Mate (3)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | 1st-Mate | — | Mercury Marine LLC | Navigation | 10 | Free | 2024-12-13 |
| 2 | First Mate | Boat Maintenance & Logbook | First Mate Pty Ltd | Productivity | 0 | Free | 2026-10-23 |
| 3 | TZ First Mate | The TimeZero Gateway | FURUNO SOFTECH CO.,LTD. | Navigation | 3 | Free | 2020-10-09 |
| 4 | First Mate | — | Matthew Ricciardo | Utilities | 0 | $19.99 | 2025-11-17 |
| 5 | First Mate by Sea Strong | Your boat's second-in-command | Ravenna LLC | Utilities | 0 | Free | 2026-08-19 |
| 6 | myDockLink | Control your Boat Lifts | Firstmate, Inc | Lifestyle | 18 | Free | 2026-06-03 |
| 15 | First Mate Log | Overnight sailing trip planner | Brock Hamm | Travel | 0 | Free | 2026-09-12 |

**"firstmate"**: 9 results, 5 name/seller matches. Top 3 overall: First Mate (0); Adult Friend Dating: xMatch (2,927); myDockLink (18)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | First Mate | Boat Maintenance & Logbook | First Mate Pty Ltd | Productivity | 0 | Free | 2026-10-23 |
| 3 | myDockLink | Control your Boat Lifts | Firstmate, Inc | Lifestyle | 18 | Free | 2026-06-03 |
| 4 | First Mate | — | Matthew Ricciardo | Utilities | 0 | $19.99 | 2025-11-17 |
| 5 | First Mate by Sea Strong | Your boat's second-in-command | Ravenna LLC | Utilities | 0 | Free | 2026-08-19 |
| 6 | First Mate Log | Overnight sailing trip planner | Brock Hamm | Travel | 0 | Free | 2026-09-12 |

**"first mate fishing"**: 42 results, 0 name/seller matches. Top 3 overall: Fishbrain - Fishing App (76,207); Fishing Superstars (178); Fish AI - AI Fishing App (27,224)

**"first mate marine"**: 38 results, 0 name/seller matches. Top 3 overall: 1st-Mate (10); USMC Squad Bay (99); West Marine Pro (888)

**"first mate boating"**: 43 results, 0 name/seller matches. Top 3 overall: First Mate (0); First Mate (0); Waterway Guide (2,921)

**"kelpline"**: 17 results, 0 name/seller matches. Top 3 overall: The Kelp Forest ebook (7); The Kelp Forest: My Aquarium (9); BlueFronts: Offshore Fishing (3)

**"kelp line"**: 12 results, 0 name/seller matches. Top 3 overall: The Kelp Forest ebook (7); Kelp Sushi (82); The Kelp Forest: My Aquarium (9)

**"saltmate"**: 36 results, 0 name/seller matches. Top 3 overall: EZsalt (15); Sodium Tracker (41); SALATA (23)

**"bight"**: 44 results, 1 name/seller matches. Top 3 overall: Brigit: Cash Advance & Credit (581,379); Bright: Loans & Credit Builder (283,869); Bright - English for beginners (27,008)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 18 | Bight: Video | Share ideas fast across teams | Bight, LLC | Business | 4 | Free | 2024-08-20 |

**"tidemark"**: 34 results, 5 name/seller matches. Top 3 overall: Tidemark FCU Mobile (778); Tide Mark Fishing Logbook (2); Tidemark: Hydration Guide (1)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Tidemark FCU Mobile | n/s | Tidemark Federal Credit Union | Finance | 778 | Free | 2026-10-15 |
| 2 | Tide Mark Fishing Logbook | Private saltwater logbook | JOHN DAVID HEARD | Sports | 2 | Free | 2026-10-14 |
| 3 | Tidemark: Hydration Guide | n/s | Sukhleen Kaur | Health & Fitness | 1 | Free | 2026-07-11 |
| 5 | Tidemark: NOAA Tide Widget | Lock Screen & Home Tide Times | Zhenyi Tong | Weather | 0 | $3.99 | 2026-09-28 |
| 11 | Tidemark | n/s | IGOR MAREK BARKOWSK | Productivity | 0 | $2.99 | 2026-03-18 |

**"deckhand"**: 47 results, 4 name/seller matches. Top 3 overall: Deckhand: Boat Wash & Detail (1); DeckHand Pool Service (1); Cotton Crew JOBS - Yacht Jobs (29)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Deckhand: Boat Wash & Detail | Boat cleaning, made easy | Deckhand LLC | Productivity | 1 | Free | 2026-10-20 |
| 2 | DeckHand Pool Service | n/s | Patrick Cadorette | Productivity | 1 | Free | 2026-10-23 |
| 5 | Deckhand! | Predictive Boat Maintenance | Elias Alamat | Utilities | 4 | Free | 2026-07-26 |
| 18 | Deckhand: Tabletop Games | n/s | Caratozzolo Development LLC | Games | 0 | Free | 2026-10-07 |

**"gaff"**: 42 results, 19 name/seller matches. Top 3 overall: GAFF: Daily Trivia & Puzzles (5); giffgaff (1,034); Gaff – talk with friends daily (7)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | GAFF: Daily Trivia & Puzzles | n/s | Serafin Vazquez | Games | 5 | Free | 2026-09-29 |
| 2 | giffgaff | n/s | giffgaff ltd | Utilities | 1,034 | Free | 2026-09-10 |
| 3 | Gaff – talk with friends daily | n/s | Youth Group AB | Social Networking | 7 | Free | 2024-11-22 |
| 4 | Gaff | n/s | CAFER VOLKAN SIMSEK | Lifestyle | 1 | Free | 2026-09-21 |
| 5 | The Gaff Ellon | n/s | Hungrrr Dev Ltd | Food & Drink | 0 | Free | 2022-06-06 |
| 7 | Gaffe: Political Soundboard | n/s | App Factorial LLC | Entertainment | 24 | $1.99 | 2025-11-02 |
| 10 | Gaffa XI - Soccer Draft | n/s | Daniel Rasmussen | Games | 0 | Free | 2026-10-26 |
| 12 | Gaffer: Soccer Tactics Board | n/s | Frederik Gjørup Nielsen | Sports | 0 | Free | 2026-10-26 |
| 18 | mimeze: AI Art Prints & Gifts | n/s | Muhamed Gaff | Photo & Video | 0 | Free | 2026-08-19 |
| 21 | Occasions: Gift Planner | n/s | MICHAEL SHAWN GAFF | Lifestyle | 0 | Free | 2026-06-18 |
| 23 | The Nice List | n/s | MICHAEL SHAWN GAFF | Lifestyle | 1 | $0.99 | 2026-05-29 |
| 25 | Lomar AI: Ads & Creatives | n/s | Muhamed Gaff | Graphics & Design | 0 | Free | 2026-10-04 |
| | … 7 more | | | | | | |

**"skiff"**: 20 results, 9 name/seller matches. Top 3 overall: SKIFF – Boat Rentals (11); Skiif : Ski & Snowboard GPS (4); Encrypted Email - Proton Mail (49,678)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | SKIFF – Boat Rentals | Boat Rentals Made Simple | Skiff LLC | Travel | 11 | Free | 2026-10-13 |
| 6 | Skiff: AI Coding Agents | n/s | Beijing Entropy Bridge Technology Co., Ltd | Developer Tools | 0 | Free | 2026-10-07 |
| 7 | SkiffPlan | n/s | ShenZhen Shidaimi Technology Co.,Ltd | Productivity | 1 | Free | 2024-11-13 |
| 8 | River Mender Skiff | n/s | 珺瑞 王 | Games | 0 | Free | 2026-10-23 |
| 9 | Skiff | n/s | GYEONGWOON JEONG | Social Networking | 0 | Free | 2026-08-23 |
| 10 | JobSkiff | n/s | Alierbot Industries Ltd. | Business | 0 | Free | 2026-09-29 |
| 11 | Abyss Skiff | n/s | SANGSU PARK | Games | 0 | Free | 2026-03-18 |
| 16 | pillGOAT | n/s | Skiff Labs LLC | Medical | 0 | Free | 2026-08-26 |
| 19 | Skiffy | n/s | Gavin Vickery | Music | 0 | Free | 2026-10-05 |

**"seamark"**: 11 results, 0 name/seller matches. Top 3 overall: Azimuth - Orientation table (0); Piri Reis: Marine Charts GPS (0); NAVLITE (0)

**"driftline"**: 46 results, 9 name/seller matches. Top 3 overall: Driftline: Rip Current & Tides (0); Baseline: Hunting & Fishing (84); Hajwala Line (731)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Driftline: Rip Current & Tides | Beach safety & conditions. | James Jordan | Weather | 0 | Free | 2026-07-28 |
| 2 | Baseline: Hunting & Fishing | Maps, GPS, Hunt, Fish, Weather | Driftline Co. L.L.C. | Navigation | 84 | Free | 2026-10-26 |
| 4 | Driftline: Horizon | n/s | Horizons Interactive LLC | Games | 0 | $0.99 | 2026-05-29 |
| 5 | DriftLine: Urban Rush Car Game | n/s | Sami ur Rehman | Games | 0 | Free | 2026-10-14 |
| 9 | Driftline: Metal Detector | n/s | MAKEEN TECHNOLOGY | Games | 0 | Free | 2026-09-04 |
| 16 | Driftline Fly Fishing Trainer | Train your cast anywhere | Shaun McCarren | Sports | 1 | $6.99 | 2026-06-17 |
| 18 | Driftline: Calm Daily Puzzle | n/s | Maryam Shakir | Games | 0 | Free | 2026-10-23 |
| 22 | Driftline: Neon Trail | n/s | Jacob van den Wassenberg | Games | 0 | Free | 2026-10-19 |
| 29 | Neon Driftline | n/s | Ibrahim SAHIN | Games | 0 | Free | 2026-09-10 |

**"saltline"**: 38 results, 1 name/seller matches. Top 3 overall: Saltline (8); Salt Strong: Smart Spots (958); Salt Life Food Shack (1)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Saltline | Read the water, not the crowd | Saltline LLC | Sports | 8 | Free | 2026-07-13 |

**"kelp"**: 37 results, 13 name/seller matches. Top 3 overall: Kelp Sushi (82); Kelp (29); KELP Radio (3)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Kelp Sushi | — | Kelp Sushi Joint LLC | Food & Drink | 82 | Free | 2026-04-20 |
| 2 | Kelp | Decentralized Personal Finance | Kelp Finance Labs Inc. | Finance | 29 | Free | 2024-06-04 |
| 3 | KELP Radio | — | Broadcast Radio Ltd | Music | 3 | Free | 2025-10-08 |
| 4 | The Kelp Forest ebook | A Young Explorer's Guide | Monterey Bay Aquarium | Education | 7 | Free | 2018-07-24 |
| 5 | My Kelp | Track growth & climate impacts | GreenWave Organization Corp. | Business | 0 | Free | 2026-07-07 |
| 6 | The Kelp Forest: My Aquarium | n/s | Monterey Bay Aquarium | Games | 9 | Free | 2018-07-15 |
| 8 | AI Skin Scanner App: Kelp | n/s | Vivero s.r.o | Health & Fitness | 0 | Free | 2026-08-24 |
| 9 | Kelpulator | Kelp Paddy Drift for Anglers | Alan DaCosta | Sports | 0 | Free | 2026-09-30 |
| 12 | Kelp Pilates | n/s | Kelp Pilates Studio, LLC | Health & Fitness | 0 | Free | 2026-09-18 |
| 14 | IRPG App (2025) | n/s | Twisted Kelp, LLC | Reference | 32 | Free | 2025-04-30 |
| 15 | Freddi Fish 1: Kelp Seeds | n/s | Tommo Inc. | Games | 51 | $4.99 | 2024-09-03 |
| 24 | Kelper | n/s | OTTERLY SPACE | Productivity | 0 | Free | 2026-01-25 |
| | … 1 more | | | | | | |

**"paddy hopper"**: 2 results, 0 name/seller matches. Top 3 overall: Sky Hop Saga - Endless Arcade Hopper (4); Hopper Hop (3)

**"bluewater"**: 48 results, 34 name/seller matches. Top 3 overall: Blue Water Rewards (5); Blue Water Health Connect (3); Bluewater Yachting (2)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Blue Water Rewards | n/s | Blue Water Stores LLC | Food & Drink | 5 | Free | 2026-06-21 |
| 2 | Blue Water Health Connect | n/s | Zakipoint Health Inc. | Health & Fitness | 3 | Free | 2026-07-16 |
| 3 | Bluewater Yachting | n/s | BLUEWATER INTERNATIONAL LLP | Lifestyle | 2 | Free | 2026-10-26 |
| 4 | Bluewater Serve | n/s | Bluewater AB | Food & Drink | 0 | Free | 2026-09-22 |
| 5 | Blue Waters Network | n/s | TEAM DRINKWATER, INC. | Shopping | 2,867 | Free | 2026-04-25 |
| 6 | Bluewater Bliss | n/s | PROMARK STRATEGIES (MALAYSIA) SDN. BHD | Lifestyle | 0 | Free | 2026-03-06 |
| 8 | Blue Water App | n/s | Blue Water App B.V. | Travel | 0 | Free | 2024-09-05 |
| 12 | Blue Water FCU | n/s | Blue Water Federal Credit Union | Finance | 11 | Free | 2026-09-10 |
| 13 | Bluewater Intel | n/s | Bluewater Intel LLC | Sports | 11 | Free | 2026-10-05 |
| 14 | Flat Earth Sun, Moon & Zodiac | n/s | Blue Water Bay | Utilities | 2,223 | $5.99 | 2026-09-12 |
| 16 | YMCA of the Blue Water Area | n/s | Daxko LLC | Health & Fitness | 1 | Free | 2017-11-16 |
| 17 | Bluewater Leisure Centre | n/s | Perfect Gym Solutions Sp. z o.o. | Health & Fitness | 0 | Free | 2026-10-22 |
| | … 22 more | | | | | | |

**"tidewise"**: 41 results, 3 name/seller matches. Top 3 overall: TideWise: NOAA Tides & Charts (8); Tidewise Fishing (0); Tidewise: Women's Dive Log (0)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | TideWise: NOAA Tides & Charts | Marine Weather & Tide Charts | Trevor Daniel | Weather | 8 | Free | 2026-10-17 |
| 2 | Tidewise Fishing | Offline tides for fishing | Jerry Tao | Weather | 0 | Free | 2026-10-05 |
| 3 | Tidewise: Women's Dive Log | n/s | Sarah Tatro | Health & Fitness | 0 | Free | 2026-08-27 |

**"bowline"**: 50 results, 2 name/seller matches. Top 3 overall: Bowline App (0); Unlimited Bowling (19,294); Bowling Crew — 3D Sport Game (98,326)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Bowline App | n/s | Ulugbek Bakhadirovich Ergashev | Lifestyle | 0 | Free | 2026-05-31 |
| 9 | Bowline Sync | n/s | hima aramona | Photo & Video | 2 | Free | 2026-07-14 |

**"longfin"**: 6 results, 0 name/seller matches. Top 3 overall: Types of Fish (3); DeepFin (2); Florida Saltwater Fish (1)

**"garibaldi"**: 25 results, 20 name/seller matches. Top 3 overall: Garibaldi's (205); Garibaldi’s Pizza (82); Garibaldi Mexican Restaurant (0)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Garibaldi's | n/s | Incentivio, Inc. | Food & Drink | 205 | Free | 2026-02-11 |
| 2 | Garibaldi’s Pizza | n/s | GARIBALDIS PIZZA, NO. 1, INC. | Food & Drink | 82 | Free | 2025-07-31 |
| 3 | Garibaldi Mexican Restaurant | n/s | Garibaldi Mexican Restaurant LLC | Food & Drink | 0 | Free | 2026-10-16 |
| 4 | Casa Garibaldi | n/s | STARAPP SISTEMAS LTDA ME | Lifestyle | 0 | Free | 2026-07-23 |
| 5 | Plaza Garibaldi Mezcaleria | n/s | PLAZA GARIBALDI, INC. | Food & Drink | 0 | Free | 2026-10-17 |
| 6 | Loco Garibaldi Taqueria | n/s | Loco Garibaldi Inc. | Food & Drink | 1 | Free | 2026-03-16 |
| 7 | IC Garibaldi Pipitone | n/s | 3D Solution srl | Reference | 0 | Free | 2025-04-08 |
| 8 | La Serenata de Garibaldi To Go | n/s | La Serenata De Garibaldi, Inc. | Food & Drink | 0 | Free | 2026-10-17 |
| 9 | Garibaldi Cafè | n/s | Fabrizio Gianni Troilo | Food & Drink | 0 | Free | 2024-07-08 |
| 10 | Atos Guetho Garibaldi | n/s | Lucas Tres Arena de Souza | Health & Fitness | 0 | Free | 2024-02-16 |
| 11 | Radio Nova Garibaldi | n/s | Vanderson Rosseti | Music | 0 | Free | 2024-04-10 |
| 12 | Frida Cantina | n/s | PLAZA GARIBALDI, INC. | Food & Drink | 3 | Free | 2026-10-17 |
| | … 8 more | | | | | | |

**"calico"**: 37 results, 17 name/seller matches. Top 3 overall: CALECO CleanMobile (4,981); Quilts and Cats of Calico (37); Tsuki's Odyssey (9,526)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 2 | Quilts and Cats of Calico | n/s | Monster Couch sp. z o.o. | Games | 37 | $9.99 | 2026-02-09 |
| 5 | Black Cat and Calico Cat | n/s | Sayaka Sugiyama | Stickers | 148 | Free | 2017-09-27 |
| 6 | Calico Petcare | n/s | Arshid Diyan | Health & Fitness | 0 | Free | 2026-09-24 |
| 7 | Radio Calico | n/s | Sundog Software LLC | Music | 8 | Free | 2025-08-19 |
| 10 | Calico: How cats are made | n/s | JINWOO HONG | Games | 0 | $0.99 | 2025-06-06 |
| 11 | CALICO: Calisthenics Coaches | n/s | Luis Tena | Health & Fitness | 0 | Free | 2026-10-21 |
| 12 | Calico: AI Nutrition Tracker | n/s | Salt & light strategies LLC | Health & Fitness | 2 | Free | 2026-08-19 |
| 13 | Mighty Calico | n/s | Cocoplay Limited | Games | 9 | Free | 2024-09-18 |
| 15 | Calico Cats Sewing Center | n/s | Multiple Applications LLC | Shopping | 0 | Free | 2026-09-04 |
| 17 | Lisa the Calico Cat Stickers | n/s | Anna Filobok | Stickers | 0 | $1.99 | 2024-06-25 |
| 18 | CALICO Studio mobile | n/s | tvone limited | Utilities | 0 | Free | 2025-05-14 |
| 19 | black cat and calico cat Stick | n/s | Sebaaoui Sanaa | Stickers | 0 | $1.99 | 2025-03-21 |
| | … 5 more | | | | | | |

**"chovy"**: 14 results, 0 name/seller matches. Top 3 overall: LCK Plus - LOL Fans widget (0); Choví Up (0); Chovi Chicken & Pizza (0)

**"shoal"**: 43 results, 25 name/seller matches. Top 3 overall: Shoal of fish (18,369); Seashine (4,919); Shoal & Stem: Fish Tank Log (9)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Shoal of fish | n/s | Cocoplay Limited | Games | 18,369 | Free | 2025-12-17 |
| 3 | Shoal & Stem: Fish Tank Log | n/s | Shoal and Stem LLC | Lifestyle | 9 | Free | 2026-10-19 |
| 4 | Shoal | n/s | Algbra FS UK Limited | Finance | 1 | Free | 2026-09-24 |
| 5 | Shoal: Aquarium & Fish Care | n/s | Szymon Dziedzic | Lifestyle | 0 | Free | 2026-08-20 |
| 6 | Shoal Creek | n/s | SHOAL CREEK COMMINITY CHURCH | Lifestyle | 5 | Free | 2026-09-21 |
| 7 | Shoals Christian School Family | n/s | Christian Shoals School | Education | 5 | Free | 2026-04-10 |
| 10 | Fork Shoals Baptist Church | n/s | Fork Shoals Baptist Church | Education | 2 | Free | 2026-10-15 |
| 11 | Shoal Creek Club | n/s | Shoal Creek | Lifestyle | 0 | Free | 2026-10-13 |
| 13 | The Club at Shoal Creek | n/s | Chronogolf Inc. | Sports | 17 | Free | 2025-12-13 |
| 15 | Shoals Club at BHI | n/s | The Shoals Club on Bald Head Island LLC | Lifestyle | 0 | Free | 2026-06-18 |
| 17 | YMCA of Shoals | n/s | Young Men's Christian Association of the Shoals, Inc. | Health & Fitness | 2 | Free | 2026-07-10 |
| 18 | Hey Shoals | n/s | eric yun | Travel | 1 | Free | 2025-11-11 |
| | … 13 more | | | | | | |

**"ballyhoo"**: 18 results, 3 name/seller matches. Top 3 overall: Ballyhoo Boutique (3); Ballyhoo (0); Ballyhoo: Portland Events (0)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Ballyhoo Boutique | n/s | Ballyhoo Gifts, Inc | Shopping | 3 | Free | 2025-10-18 |
| 2 | Ballyhoo | n/s | Ballyhoo Ltd. | Shopping | 0 | Free | 2026-06-26 |
| 3 | Ballyhoo: Portland Events | n/s | Ryan Gurnick | Entertainment | 0 | Free | 2026-10-24 |

**"livewell"**: 34 results, 13 name/seller matches. Top 3 overall: LiveWell with Advocate Aurora (165,048); MyChart (733,293); LiveWell App (6)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | LiveWell with Advocate Aurora | n/s | Advocate Health Care | Medical | 165,048 | Free | 2026-03-30 |
| 3 | LiveWell App | n/s | LiveWell Behavioral Health Corp | Health & Fitness | 6 | Free | 2025-10-07 |
| 5 | LiveWell Athletic Club | n/s | JSGS LLC | Health & Fitness | 0 | Free | 2023-10-10 |
| 6 | FBISD LiveWell | n/s | Fort Bend Independent School District | Business | 25 | Free | 2026-10-09 |
| 7 | LiveWell Connect | n/s | SHOOTING STAR | Business | 1 | Free | 2024-08-30 |
| 8 | Live Well Center | n/s | ENGLEWOOD HOSPITAL AND MEDICAL CENTER FOUNDATION INC. | Health & Fitness | 1 | Free | 2024-08-21 |
| 9 | LiveWell Fitness | n/s | Pana Community Hospital Association | Health & Fitness | 89 | Free | 2026-08-21 |
| 10 | GNC LiveWell | n/s | General Nutrition Corporation | Shopping | 10,056 | Free | 2026-10-12 |
| 11 | LiveWell PHR | n/s | LiveWell, LLC | Medical | 1 | Free | 2025-11-06 |
| 12 | Live Well | n/s | Yo Quiero Ser Mejor.com S.A. de C.V. | Health & Fitness | 1 | Free | 2020-07-03 |
| 14 | LiveWell MNL | n/s | TouchPoint Loyalty Limited | Food & Drink | 0 | Free | 2026-10-07 |
| 24 | Livewell XP | n/s | PT LIVEWELL INDONESIA SEHAT | Health & Fitness | 0 | Free | 2026-07-07 |
| | … 1 more | | | | | | |

**"saltmark"**: 38 results, 0 name/seller matches. Top 3 overall: Watermark (3,624); iStamp+ - Batch Watermark Photos (83); PHOENIX CONTACT MARKING system (1)

**"salt mate"**: 41 results, 0 name/seller matches. Top 3 overall: DunkMax: Vertical Jump Trainer (693); Flappy Dunk (775,991); Sodium Tracker: Sodio (1,627)

**"swellmate"**: 15 results, 0 name/seller matches. Top 3 overall: SwellTell (3); Swell Studio VB (167); Swell Intel (11)

**"leeway"**: 25 results, 15 name/seller matches. Top 3 overall: SunPass (2,837); Leeway (0); Leeway: Time Blocking Planner (0)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 2 | Leeway | n/s | HASSIF ABDULAHI MUSTAFA | Finance | 0 | Free | 2026-03-10 |
| 3 | Leeway: Time Blocking Planner | n/s | Innovatism LLC | Productivity | 0 | Free | 2026-10-18 |
| 4 | LEEWAY_CRM | n/s | Leeway Soft-tech Private Limited | Productivity | 0 | Free | 2026-06-11 |
| 5 | Leeway-Fuel & Mileage Tracker | n/s | Ajay Sivan | Productivity | 0 | Free | 2026-10-05 |
| 6 | LeewayShuffleSelect | n/s | Lee casuto | Music | 1 | Free | 2026-07-29 |
| 7 | Leeway: Reactive Dog Walk App | n/s | Joseph Ngwu | Health & Fitness | 0 | Free | 2026-09-02 |
| 10 | EI Expo | n/s | Leeway Soft-tech Private Limited | Productivity | 0 | Free | 2026-04-16 |
| 11 | LeewaySol | n/s | Lee casuto | Entertainment | 0 | Free | 2025-01-10 |
| 13 | Leeway - Your AI Usage Tracker | n/s | Ian Gabriel Agujitas | Productivity | 0 | Free | 2026-09-01 |
| 14 | Vaat | n/s | Leeway Soft-tech Private Limited | Productivity | 0 | Free | 2025-12-10 |
| 18 | V_CARE | n/s | Leeway Soft-tech Private Limited | Health & Fitness | 0 | Free | 2024-03-29 |
| 20 | Vibrant Bhavnagar 2030 | n/s | Leeway Soft-tech Private Limited | Productivity | 0 | Free | 2025-01-02 |
| | … 3 more | | | | | | |

**"lodestar"**: 33 results, 27 name/seller matches. Top 3 overall: Lodestar Provider (18); Ludo STAR (104,677); Lodestar Tech (4)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | Lodestar Provider | n/s | hand in Hand Family Services ltd | Business | 18 | Free | 2026-10-26 |
| 3 | Lodestar Tech | n/s | lodestar technology inc | Utilities | 4 | Free | 2026-10-22 |
| 5 | Lodestar - Goal & Life Tracker | n/s | TYLER JAMES CHRISTIAN | Productivity | 6 | Free | 2026-07-15 |
| 6 | Lodestar | n/s | ANTRAKS, OOO | Utilities | 1 | Free | 2026-10-16 |
| 8 | Lodestar: Stoic Reflection | n/s | Psyton Industries LLC | Health & Fitness | 1 | Free | 2026-10-23 |
| 9 | Lodestar - The Movie Universe | n/s | Clement Malindi | Entertainment | 0 | Free | 2026-10-01 |
| 10 | Lodestar LMS | n/s | Renz Martin Santos | Education | 0 | Free | 2026-01-09 |
| 11 | Lodestar Ba Zi | n/s | Bohdan Honcharuk | Productivity | 0 | Free | 2026-10-21 |
| 12 | Lodestar Capital | n/s | Fatih Karaismail | Finance | 0 | Free | 2026-10-16 |
| 13 | Hallie: Beauty & Community | n/s | Lodestar Procurement Advisory LLC | Shopping | 1 | Free | 2026-10-25 |
| 14 | Beacon Lodestar | n/s | Beacon Services, Inc | Utilities | 4 | Free | 2026-08-15 |
| 15 | Lodestar: Goals & Vision Board | n/s | Kongera group s.r.o. | Productivity | 0 | Free | 2026-07-14 |
| | … 15 more | | | | | | |

**"foamer"**: 12 results, 0 name/seller matches. Top 3 overall: TrainTracker App (16); Profoam Corporation (7); Railfan Copilot (7)

**"kelpwise"**: 35 results, 0 name/seller matches. Top 3 overall: The Kelp Forest ebook (7); Freddi Fish 1: Kelp Seeds (51); The Kelp Forest: My Aquarium (9)

**"1st mate"**: 42 results, 3 name/seller matches. Top 3 overall: 1st-Mate (10); First Mate (0); Math Problems 1st - 12th Grade (12,920)

| # | App | Subtitle | Seller | Category | Ratings | Price | Last update |
|---:|---|---|---|---|---:|---|---|
| 1 | 1st-Mate | — | Mercury Marine LLC | Navigation | 10 | Free | 2024-12-13 |
| 2 | First Mate | Boat Maintenance & Logbook | First Mate Pty Ltd | Productivity | 0 | Free | 2026-10-23 |
| 21 | TZ First Mate | The TimeZero Gateway | FURUNO SOFTECH CO.,LTD. | Navigation | 3 | Free | 2020-10-09 |

