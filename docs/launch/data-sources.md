# External data sources: launch audit

Audited 2026-10-26, before the public App Store launch. Scope: every host the app contacts at runtime, found by grepping `src/` for URLs and `fetch(` targets and then reading each call site. Policies were read on 2026-10-26, and each claim cites its source in brackets, e.g. [1]. The numbered URLs are listed at the bottom. Where a policy is silent or ambiguous, this document says so. Live behaviour was checked with one or two sample requests per host, listed under "Live probes".

Not used anywhere in `src/`: NDBC, NWS (api.weather.gov), Nominatim/OSM geocoding, Mapbox or Google Fonts. Fonts are bundled through `@fontsource`. `maps.google.com` only appears as text inside the emergency SMS body (`src/shell/panels/EmergencyPanel.tsx`). `wildlife.ca.gov`, `inaturalist.org/observations/...`, GitHub and apps.apple.com are links the user opens, not data calls.

## How data gets saved for offline use (why "offline OK?" matters)

There are two paths. Both write into IndexedDB with no expiry.

1. **Browse cache.** `OfflineTileLayer` (`src/engine/tiles.js`) stores every tile the user views (`putTileBlob`), so "every area you browse becomes offline-usable". This covers every layer in `LAYERS`.
2. **Offline charts download.** `startDownload` in `src/engine/download.js` pre-fetches every tile in the visible area for `chartLayerIds()` in `src/engine/layers.js`. That list is the base map, plus `labels` when the base is `gmrt`/`bluetint`/`sat`, plus `reliefhi`/`blueshade`, plus `enc` and `seamark` when they are on. It fetches up to z12/14/16 (capped per layer by `maxNativeZoom`), up to 30,000 tiles, with 6 parallel workers. It also builds an **area data pack** (`src/engine/areadata.js`) holding a 7-day Open-Meteo forecast and marine forecast, a 16-point Open-Meteo SST grid, a 16-point NCEI depth grid, 7 days of CO-OPS tides and an iNaturalist sightings tally.

Path 2 is the "bulk download / pre-seeding" that several tile policies forbid. Path 1 is ordinary caching, but CARTO caps it at 30 days.

App Store context: Guideline 5.2.2 says "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request." [40]. So any source below that is marked "No" is also an App Review risk, not just a legal one.

## Summary table

Risk: **HIGH** = broken today or clearly outside the terms. **MED** = ambiguous terms, or a shared or volunteer server that could block us at scale. **LOW** = public domain, or explicitly allowed.

| Source (host) | Used for (files) | Live use OK? | Offline caching OK? | Attribution required | Limits / cost | Risk | Action |
|---|---|---|---|---|---|---|---|
| **CARTO labels** (basemaps.cartocdn.com) | "Place labels" overlay, auto-added on Satellite and both Fishing-chart bases (`tiles.js` `labels`, `layers.js` `chartLayerIds`) | **No.** Keyless tiles are now an "API KEY REQUIRED" watermark (verified). The terms also bar showing the map "on a moving vehicle of any type" [11 §14.a(2)] | **No.** Device cache capped at 30 days, and bulk download is banned [11 §9.c(2)] | "© OpenStreetMap contributors, © CARTO" [12] | Free key: 1M tile requests/month for commercial use. Commercial plan US$500/month [11][12] | **HIGH (broken now)** | Remove the layer. Purge cached `labels/` tiles. Do not buy a key: the moving-vehicle clause rules it out for a boat app |
| **RainViewer** (api.rainviewer.com, tilecache.rainviewer.com) | Rain radar loop (`rain.js` `buildRainFrames`) | **No, as built.** Since 2026-01-01: max zoom 7, no nowcast, one colour scheme [29]. At the default map zoom of 9 every tile is a "Zoom Level Not Supported" image (verified). Terms: "personal, educational, and small-scale community use … not intended for high-volume commercial applications" [28] | n/a (plain `L.tileLayer`, not stored) | Mandatory: "Weather data by RainViewer" with a link [28]. The app shows unlinked "RainViewer" | 100 requests per IP per minute [29]. Loading 13 frames at once can exceed this. No SLA [28] | **HIGH (broken now)** | Replace with NOAA nowCOAST MRMS radar (public domain; sample tile verified). Stopgap: `maxNativeZoom: 7` plus a linked credit |
| **Esri World Ocean Base** (services.arcgisonline.com) | **Default** base "Ocean" (`tiles.js` `ocean`, `layers.js` DEFAULTS); offline download | **No** without an ArcGIS subscription: "If you do not have Esri software, you must purchase an ArcGIS Online subscription". Commercial use of Living Atlas content needs an Esri licence [3] | **No.** "Systematically harvest basemap tiles … other than … Esri Content Packages" is forbidden [3]. The item says "not intended to be used to export tiles for offline" [4] | "Sources: Esri, GEBCO, NOAA, Garmin, and other contributors" [4]. The app omits Garmin. Item also says "Not to be used for navigation/safety at sea" [4] | ArcGIS Location Platform: 2M tiles/month free, then US$0.15 per 1,000; still live-only [7] | **HIGH** | Make GEBCO (`gmrt`) or BlueTopo the default base. Remove the Esri bases, or limit them to live use with a paid account |
| **Esri World Imagery** (server.arcgisonline.com) | "Satellite" base (`tiles.js` `sat`); offline download | **No**, same terms as above [3][5] | **No** [3][5] | "Esri, Vantor, Earthstar Geographics, and the GIS User Community" [5]. The app still says "Maxar" | Same as above [7] | **HIGH** | Replace with USGS `USGSImageryOnly` or `USGSImageryTopo` (public domain, z0–16, US only; verified) |
| **OpenStreetMap tiles** (tile.openstreetmap.org) | "Street map" base (`tiles.js` `street`); offline download when it is the base | **Conditional.** Needs a distinct app User-Agent, a Referer on the web, visible attribution and honoured cache headers. Commercial users are warned "access may be withdrawn" [1]. The iOS WKWebView currently sends a generic UA (`WebAppView.swift` sets none) | **No.** "Offline use is not permitted on tile.openstreetmap.org", and "Bulk downloading is any pre-emptive fetching of tiles other than those a user is actively viewing" [1]. The browse cache is required (at least 7 days) [1]; serving it back while offline is a grey area | "OpenStreetMap", ideally linked to /copyright [2]. The app text is unlinked and can be cut off by the 62vw ellipsis in `base.css` | Best-effort, no SLA; blocking "without notice" [1] | **HIGH** (offline download) | Exclude `street` from downloads. Set the iOS app UA. Better: replace with `USGSTopo` (public domain, z0–16; verified) |
| **Open-Meteo** (api., marine-api., geocoding-api.open-meteo.com) | Wind overlay grid, weather panel, water-temp sampling (`weather.js`); SST colour range (`sst.js`); tap inspect (`inspect.js`); catch log (`catch.js`); First Mate tools and geocoding (`assistant.js`); area pack (`areadata.js`) | **Ambiguous.** "You may only use the free API services for non-commercial purposes". Non-commercial covers "apps that do not have subscriptions or advertising", but commercial includes "Commercial products or promotional activities" [24]. An LLC's App Store app fits neither list cleanly | **Yes.** Data is CC BY 4.0 [24][26], so storing the 7-day pack is fine with attribution | "You must include a link next to any location Open-Meteo data are displayed", e.g. "Weather data by Open-Meteo.com" [26]. The app has an unlinked credit in the weather panel and none on the wind overlay, inspect card, catch log or First Mate | Free: 600/min, 5,000/hour, 10,000/day, 300,000/month, "applied by IP addresses and application" [24][25]. Standard: 1M calls/month at US$29/month (2023 price [27]; the live page hides prices) | **HIGH** (terms) | Owner decision (below). Add the linked credit everywhere its data is shown |
| **iNaturalist** (api.inaturalist.org; photos on inaturalist-open-data.s3.amazonaws.com and static.inaturalist.org) | Fish-sightings overlay (`fish.js`); sightings tally in the area pack (`areadata.js`) | **Yes** for apps: "intended to support application development, not data scraping" [31]. **But** "Photos in the static.inaturalist.org domain do not have open licenses" [31], and 16 of 100 photos sampled near Palos Verdes were all-rights-reserved | **Yes** for the pack (species names and dates only). Photos are not stored | Photographer credit plus iNaturalist. The app shows both (`FishCard.tsx`) | Throttled at 100/min; asks for 60/min or less and under 10,000/day [31]. Unclear whether that is per client or per app | **MED** | Add a `photo_license=` filter for open licences (verified working). CC BY-NC photos are OK only while the app stays non-commercial [32] |
| **OpenSeaMap** (tiles.openseamap.org) | "Seamarks" overlay, **on by default** (`tiles.js` `seamark`); offline download z9+ | **Probably.** Tiles are CC BY-SA 2.0 [14]. No tile-server usage policy found; volunteer-run | **Unclear.** No policy on pre-seeding from their server. They publish their own offline chart downloads [14] | "© OpenSeaMap contributors" plus OpenStreetMap [14] | None published | **MED** | Leave seamarks out of offline downloads unless OpenSeaMap agrees. In US waters NOAA ENC already shows aids to navigation |
| **GMRT** (www.gmrt.org WMS) | "Seafloor relief detail" (`tiles.js` `reliefhi`, z≥11, renders 1024 px tiles on demand); offline download | **Yes.** CC BY 4.0 [21] | **Yes** under CC BY [21]. Each tile is a slow render (measured 2.9 s, 250 KB), so this is a load concern | A byline/credit/link to GMRT; cite Ryan et al. 2009. "Data should not be used for navigation purposes" [21] | None published | **MED** (load) | Linked "GMRT" credit. Optional courtesy email about expected load |
| **GEBCO basemap hosted by NOAA NCEI** (tiles.arcgis.com …/GEBCO_basemap_NCEI) | "Fishing chart — global" base (`tiles.js` `gmrt`, cached to z10) | **Yes.** The item is owned by NOAA NCEI, not Esri [9]. The GEBCO grid "is placed in the public domain" and may be commercially exploited [10] | **Likely yes.** Public-domain data, and the item has no export restriction [9]. The ArcGIS Online hosting terms are not explicit | Acknowledge GEBCO [10]. The item credits "GEBCO; NOAA NCEI" [9]. Not for navigation [10] | None published | **LOW** | Use as the new default base. Credit "GEBCO, NOAA NCEI" |
| **NOAA BlueTopo via nowCOAST** (nowcoast.noaa.gov GeoWebCache) | "Fishing chart — US survey" base plus hillshade (`bluetint`, `blueshade`); offline download | **Yes.** US Government work [17]. WMTS capabilities: Fees NONE, AccessConstraints NONE [18] | **Yes** [17][18]. Tiles are pre-cached, so the server load is light | Courtesy credit "NOAA National Bathymetric Source / BlueTopo" [20] | None published | **LOW** | Keep |
| **NOAA ENC, ECDIS display service** (gis.charttools.noaa.gov MaritimeChartService export) | "NOAA charts" overlay, **on by default** (`tiles.js` `enc`, renders 1024 px on demand); offline download to z16 | **Yes.** Public domain [17], published for "simple HTTP" use [15]. ENC Online "is not certified for navigation" [16] | **Yes** legally [17]. Each tile is a heavy render (measured 300 KB, 1.2 s). NOAA ships NCDS **MBTiles** specifically for offline use [15][41] | Courtesy "NOAA Office of Coast Survey". Keep the not-for-navigation notice | None published [15] | **LOW–MED** (load) | Keep. Long term, offer NOAA NCDS MBTiles for offline instead of scraping the export endpoint |
| **NOAA NCEI DEM identify** (gis.ngdc.noaa.gov ImageServer) | Depth at a tapped point (`inspect.js`); 16-point depth grid in the area pack. The `ncei` tile layer in `tiles.js` is defined but unused | **Yes**, US Government work [17] | **Yes** [17] | Courtesy "NOAA NCEI" | None published | **LOW** | Keep |
| **NOAA CoastWatch ERDDAP, MUR SST** (coastwatch.pfeg.noaa.gov) | Sea-temperature overlay images and the 5-day loop (`sst.js`); not stored | **Yes.** "The data may be used and redistributed for free" [22] | n/a (not stored). Allowed anyway [22] | Requested: "These data were provided by JPL under support by NASA MEaSUREs program." [22]. Not shown in the app today | None published on the ERDDAP legal page [22] | **LOW** | Add the acknowledgement to the SST legend and to About |
| **NOAA CO-OPS tides** (api.tidesandcurrents.noaa.gov) | Tide panel (`tides.js`), bite score (`bite.js`), catch log (`catch.js`), First Mate, area pack | **Yes**, US Government work [17]. The `application` parameter is requested so NOAA can trace issues; under heavy load "sleep statements" between calls are recommended [23] | **Yes**; already cached in localStorage and the pack | Courtesy "NOAA CO-OPS" | Hi/lo predictions are limited to 10 years per request; volume is throttled under heavy load [23] | **LOW** | Add `application=` to the two calls that lack it (`areadata.js` and `assistant.js` tide fetches) |
| **Cloudflare Workers AI relay** (first-mate.jbittlest.workers.dev, first-party) | Free First Mate chat (`assistant.js` → `proxy/first-mate-worker.js`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, max_tokens 512) and `/tts` (MeloTTS) | **Yes** (our own account) | n/a | n/a | 10,000 neurons/day free on both plans. Beyond that US$0.011 per 1,000 neurons, on Workers Paid only (US$5/month minimum) [33][34]. About **141 neurons, or US$0.0016, per question** (worked example below). The free tier covers only **~70 questions/day across all users** | **MED** (capacity/cost) | Owner decision (below). Add per-IP rate limiting. The Origin check is "soft" and lets requests with no Origin header through |
| **Anthropic API** (api.anthropic.com) | First Mate when the user adds **their own** key (`assistant.js`) | **Yes.** Bring-your-own-key; usage falls under the user's own Anthropic terms [37] | n/a | n/a | Paid by the user. US$0 to the owner | **LOW** | Keep. The key stays on the device |

Bundled data makes no runtime calls: `public/data/reefs-ca.json`, `mpa-ca.json` and `tide-stations-ca.json`. Their provenance (CDFW, NOAA) is credited in `src/legal/privacy.js` but was not re-audited here.

Voice input uses the browser's own `SpeechRecognition` (`src/engine/voice.js`). In Chrome, audio goes to Google's servers. This is a privacy disclosure point, not a data-source licence, and it is not in `SOURCES`.

## Per-source notes

### CARTO labels: broken today
- **Probe:** `https://basemaps.cartocdn.com/light_only_labels/12/700/1639.png` and the z10 tile both return the same 2,398-byte image reading **"API KEY REQUIRED / carto.com/basemaps/apikey"**. The result is identical when sent with the site's Referer/Origin and an iPhone UA. CARTO says: "Requests without a key are served with an 'API key required' watermark" [13].
- **Effect:** Anyone on Satellite or either Fishing-chart base sees watermark text across the map. Those tiles are then stored permanently by the browse cache and by offline downloads (`labels/` keys).
- **Why not just get a key:** The terms (last updated 29 Sep 2026) say the services "should not be used … to … display a dynamic or static map or visualization on a moving vehicle of any type" (§14.a(2)) [11]. A boat under way is very likely a "vehicle of any type". The terms also forbid "caching map content on an end user's device … for longer than thirty (30) days" (§9.c(2)) [11]. "Commercial Use" includes anything "operated by or on behalf of a business in the course of its trade or profession" (§1) [11]. Keys issued before 23 Sep 2026 keep the non-commercial limit only until 30 Nov 2026 [11][12].
- **Fix:** Drop `labels` from `LAYERS` and from `chartLayerIds`. Add a one-time `deleteTilesByPrefix('labels/')` migration, the same pattern as the existing `gmrt/` sweep in `src/engine/app.js`. For labelled imagery, use USGS `USGSImageryTopo` (below).

### RainViewer: broken above zoom 7 and limited to non-commercial use
- **Probes:**
  - `weather-maps.json` returns 13 `past` frames and `"nowcast":[]`.
  - Tile `/256/9/87/204/4/1_1.png` returns a 1,370-byte image reading **"Zoom Level Not Supported"**. z8 behaves the same.
  - z6 and z7 tiles return real radar.
  - Colour scheme 4 returns bytes identical to scheme 2, so only Universal Blue is served.
- **Effect:** `rain.js` adds every frame with `maxZoom: 20` and no `maxNativeZoom`. At the default map zoom of 9 the radar is grey "Zoom Level Not Supported" boxes. The "fcst" (nowcast) frames never appear any more.
- **Terms:**
  - "free for personal, educational, and small-scale community use … not intended for high-volume commercial applications" [28].
  - Attribution is mandatory: "Weather data by RainViewer" with a link [28].
  - Since 2026-01-01: "Maximum zoom level set to 7; Rate limiting set to 100 requests/IP/minute" [29][30].
  - The API page also says "no hard rate limits posted", which contradicts [29]. Treat 100/min as the real limit.
- **Replacement (verified):** NOAA nowCOAST MRMS base reflectivity, a WMS with a `TIME` dimension.
  - The capabilities document lists `Fees NONE`, `AccessConstraints NONE`, and frames about every 4 minutes over roughly the last 8 hours [19].
  - Endpoint: `https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=conus_base_reflectivity_mosaic&STYLES=&SRS=EPSG:3857&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME={iso}`
  - z9 and z6 tiles around 33.77,-118.42 returned HTTP 200 image/png in about 0.3 s. They were transparent because there was no rain in SoCal that day. A z6 tile over the southern Plains returned real echoes matching RainViewer's.
  - It renders at any zoom. MRMS is about 1 km resolution, so set `maxNativeZoom` to about 9.
  - It covers CONUS, which is enough for SoCal. Use `L.tileLayer.wms` with a `TIME` per frame.

### Esri basemaps (World Ocean Base is the default base; World Imagery)
- Esri's FAQ "about items owned by Esri in ArcGIS Online" (last updated April 21, 2025) [3]:
  - "Use with Esri software and comply with its terms of use. If you do not have Esri software, you must purchase an ArcGIS Online subscription."
  - You may not "Systematically harvest basemap tiles through any method other than using Esri Content Packages", "Redistribute basemap tiles", or "Use content from ArcGIS Living Atlas for commercial use in your application or product".
  - Offline use is allowed only "using Esri Content Packages … exclusively with Esri software".
- The item pages (licence text read from the ArcGIS sharing API) say both layers are under the Esri Master License Agreement and are "not intended to be used to export tiles for offline". World Ocean Base adds "Not to be used for navigation/safety at sea" [4][5].
- FishApp is Leaflet, not Esri software, has no subscription, and bulk-downloads these tiles. So it is outside the terms for both live and offline use.
- Attribution must be shown "on or near your map" [6]. The app's strings are out of date: Garmin is missing from Ocean, and World Imagery is now credited to "Vantor" rather than "Maxar".
- **Paid route, if the owner wants Esri:** ArcGIS Location Platform, 2M basemap tiles/month free, then US$0.15 per 1,000 [7]. It needs an access token shipped in the client. Offline storage on that plan was not confirmed, so treat it as live-only.
- **Recommended:** make `gmrt` (GEBCO/NCEI) the default base, or `bluetint` in US waters, and drop `ocean`/`sat`. Saved preferences with `base: 'ocean'` must be migrated; `loadPrefs` already falls back when a base id disappears.

### USGS National Map: public-domain replacement for Satellite and Street (verified)
- **Terms:** "Map services and data downloaded from The National Map are free and in the public domain." Requested credit: "Map services and data available from U.S. Geological Survey, National Geospatial Program." [38]. The responses carry `Access-Control-Allow-Origin: *`, which the app needs because it fetches tiles as blobs.
- **Probes at 33.77,-118.42:**
  - `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/16/26230/11210` returned 200 image/jpeg (real imagery).
  - `/USGSTopo/MapServer/tile/12/1639/700` returned 200 (topo with names).
  - `/USGSImageryTopo/MapServer/tile/12/1639/700` returned 200 (imagery with labels).
  - z17 returned **404**.
- **Zoom range:** cached tiles cover **z0–16**, even though the metadata lists LODs to 23. Set `maxNativeZoom: 16`.
- **Caveats:** US coverage only. The imagery has transparent/white gaps a few miles offshore (seen in the z12 tile); GEBCO underneath would fill those. Composite basemaps are re-cached about once a year.

### OpenStreetMap
- The Tile Usage Policy forbids exactly what Offline charts does when Street is the base: "Offline use is not permitted on tile.openstreetmap.org", and "Bulk downloading is any pre-emptive fetching of tiles other than those a user is actively viewing" [1].
- "Apps must configure a distinct, stable User-Agent naming your app" [1]. The web build is fine because the browser UA plus the Referer identifies us. The iOS wrapper sends WKWebView's generic UA. The fix is `config.applicationNameForUserAgent = "<brand>/<version>"` in `FishApp-iOS/FishApp/WebAppView.swift`; it is available since iOS 9, so iOS 16 is fine.
- **Attribution:** "OpenStreetMap", preferably linked to openstreetmap.org/copyright. A collapsed attribution is fine if licence info stays "easy to find" [2]. About → Sources already links /copyright. The on-map text should be a link, and the attribution bar's `max-width: 62vw; text-overflow: ellipsis` (`src/styles/base.css`) can hide providers on a phone.

### Open-Meteo
- **Commercial question:** The free tier is non-commercial only [24]. A free, ad-free app run by an LLC is not clearly covered by either list in [24], so it is ambiguous. Ask Open-Meteo in writing, or buy a plan.
- **Limits:** 600/min, 5,000/hour, 10,000/day, 300,000/month [24][25]. Requests over 10 variables or 2 weeks count as fractional extra calls [25].
- **Multi-location counting is undocumented** [25]. This matters for the wind overlay: `weather.js` sends one request per pan with about 32 points on a phone and about 220 on a desktop (95 px grid). The SST range uses 30 points.
- **Paid plans:** Standard is 1M calls/month and Professional 5M [25]. Open-Meteo's own 2023 post priced them at US$29 and US$99 per month [27]. The current page renders prices client-side, so confirm before buying. A paid key should be called from the Worker, not shipped in the app.
- **Attribution:** "You must include a link next to any location Open-Meteo data are displayed" [26].
- **Public-domain fallback (US only, partial):** NWS `api.weather.gov` covers wind, temperature and precipitation. It is "open data, free to use for any purpose", has no key, needs a User-Agent, and sends CORS `*` (verified `/points/33.77,-118.42` → `gridpoints/LOX/147,34`) [39]. It has no global coverage and no wave model, so it is not a drop-in replacement.

### iNaturalist
- The API is "intended to support application development, not data scraping". It is throttled at 100/min, and iNaturalist asks for "60 requests per minute or lower" and "under 10,000 requests per day", with blocks "without notification" [31]. It does not say whether 10k/day is per client or per app. Thousands of devices calling directly would pass it in aggregate.
- **Photos:** "Photos in the static.inaturalist.org domain do not have open licenses" [31]. The default licence for user content is CC BY-NC [32].
- **Sample** (100 research-grade fish observations near Palos Verdes, first photo each): 16 had no licence (all rights reserved), 57 were CC BY-NC, 25 CC BY-NC-ND, 1 CC BY-NC-SA and 1 CC0.
- **Fix (verified):** adding `&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd` to `fishSearchUrl` returned only licensed photos (7,278 of 8,727 observations).

### Cloudflare Workers AI: cost of the free First Mate
- **Rates** [33][36]:
  - llama-3.3-70b-instruct-fp8-fast: US$0.293 per million input tokens (26,668 neurons per million) and US$2.253 per million output tokens (204,805 neurons per million).
  - 10,000 neurons/day free on both the Free and Paid plans.
  - US$0.011 per 1,000 neurons beyond that, on Workers Paid only, with a US$5/month minimum [34].
- **Cost per question** at ~3,000 input and 300 output tokens: 80.0 + 61.4 = **~141 neurons, about US$0.0016**.
- **Worst case per question:** about 475 neurons (US$0.005). That assumes 512 output tokens and long history; the Worker forwards up to 12 messages of 4,000 characters plus an 8,000-character system prompt.
- **Free allowance:** about **70 questions/day for the whole user base**. Text-to-speech is cheap at 18.63 neurons per audio-minute [33].
- **Paid scenarios:**
  - 1,000 questions/day ≈ US$1.45/day (about US$44/month) plus US$5.
  - 10,000 questions/day ≈ US$15.45/day (about US$463/month) plus US$5.
- **Request cap:** the Workers Free plan also caps requests at 100,000/day [34].
- **Rate limit on the model:** the limits page gives 300 requests/minute for text generation unless the model needs Workers Paid [35]. The model page does not say whether it does [36].

## Live probes (2026-10-26, sample point 33.77,-118.42)

| Request | Result |
|---|---|
| Esri Ocean `tile/12/1639/700` | 200 jpeg, 0.45 s |
| Esri Imagery `tile/12/1639/700` | 200 jpeg |
| GEBCO NCEI `tile/10/409/175` | 200 jpeg; service LODs 0–23 |
| BlueTopo WMTS `EPSG:3857:11/819/350` (Leaflet z12, 512 px) | 200 png, 44 KB |
| NOAA ENC export, 1024 px, z12 bbox | 200 png, 303 KB, 1.2 s |
| GMRT WMS, 1024 px, z12 bbox | 200 png, 251 KB, 2.9 s |
| NCEI DEM identify (-118.45, 33.75) | 200, value -301.1 m |
| ERDDAP MUR SST transparentPng | 200 png |
| CO-OPS hi/lo, station 9410660 | 200 json |
| iNaturalist observations | 200 json |
| Open-Meteo marine and geocoding | 200 json |
| CARTO `light_only_labels/12/700/1639` | 200, **"API KEY REQUIRED" watermark** |
| RainViewer z9 tile | 200, **"Zoom Level Not Supported" image**; nowcast empty |
| OpenSeaMap `seamark/12/700/1639` | 200 png, CORS `*` |
| OSM `12/700/1639` (custom UA) | 200 png; `cache-control: max-age=89616` |
| **Alternative:** USGS ImageryOnly / Topo / ImageryTopo, z12 and z16 | 200; **z17 → 404** (range z0–16) |
| **Alternative:** nowCOAST radar WMS, z9 and z6 | 200 png, about 0.3 s |
| NOAA NCDS WMTS (`MarineChart_Services/NOAACharts`) | 400/500 "Could not find service". Do not use; NCDS MBTiles are the offline route |
| NDBC realtime2 | 200 but **no CORS header**, so it would need the Worker as a proxy |

## Fix before launch (prioritised)

1. **Remove CARTO labels and purge cached `labels/` tiles.** The watermark is visible today and the terms can't be met. Files: `src/engine/tiles.js`, `src/engine/layers.js` (`chartLayerIds`), and a migration in `src/engine/app.js`.
2. **Replace RainViewer with nowCOAST MRMS radar,** or at least add `maxNativeZoom: 7` and a linked "Weather data by RainViewer" credit. The radar is grey placeholder boxes at normal zooms today. File: `src/engine/rain.js`.
3. **Stop bulk-downloading tiles we may not pre-seed.** Exclude `ocean`, `sat`, `street` (and `seamark` until OpenSeaMap agrees) from the Offline charts plan, in `src/engine/download.js` and `src/engine/layers.js`.
4. **Change the default base from Esri `ocean` to GEBCO `gmrt`** (or `bluetint` in US waters), and migrate saved prefs. Replace Satellite with USGS `USGSImageryTopo`/`USGSImageryOnly` and Street with `USGSTopo` (z0–16, CORS ok). Otherwise the Esri bases are a terms violation and an Apple 5.2.2 risk.
5. **Open-Meteo:** get written OK or a plan (owner, below). In any case add a linked "Weather data by Open-Meteo.com" next to its data: weather panel `AgeNote`, wind legend, inspect card, catch details, and First Mate weather answers.
6. **iNaturalist:** add the `photo_license=` filter in `src/engine/fish.js` `fishSearchUrl`.
7. **iOS User-Agent:** set `applicationNameForUserAgent` in `FishApp-iOS/FishApp/WebAppView.swift`. This is required by OSM if OSM is kept, and polite to every other server.
8. **Attribution sweep** (`tiles.js` attribution strings, SST legend, `src/legal/privacy.js` `SOURCES`):
   - Esri: add Garmin; replace Maxar with Vantor (only if Esri is kept).
   - GEBCO: "GEBCO, NOAA NCEI".
   - GMRT: link.
   - MUR SST: NASA/JPL acknowledgement.
   - Radar provider credit.
   - USGS credit if adopted.
   - Make the on-map attribution linkable or expandable rather than ellipsis-truncated (`src/styles/base.css`).
9. **Worker hardening** (`proxy/first-mate-worker.js`): per-IP rate limiting, and a decision on Workers Paid plus a budget alert. Note the Origin check admits requests with no Origin header.
10. **CO-OPS:** add `application=` to the tide fetches in `src/engine/areadata.js` and `src/engine/assistant.js`.
11. Update `src/legal/privacy.js` `SOURCES` and the privacy page to match whatever ships (add USGS and nowCOAST radar; remove CARTO, RainViewer and Esri if dropped).

## Owner decisions (money or accounts)

1. **Open-Meteo commercial status.** Pick one:
   - (a) email info@open-meteo.com describing the app (free, no ads, no subscriptions, published by QuadSight Imaging LLC) and keep the written answer on file;
   - (b) subscribe to Standard (1M calls/month; US$29/month per the 2023 announcement [27], confirm current price), with calls routed through the Worker;
   - (c) fund an engineering move to NWS/NOAA for US weather (no waves).
2. **Esri.** Drop it (recommended). Or open an ArcGIS Location Platform account: 2M tiles/month free, then US$0.15 per 1,000, live use only, token in the app, attribution per [6].
3. **Cloudflare Workers plan.** On Free, the no-key First Mate stops for everyone after about 70 questions/day. Workers Paid is US$5/month plus about US$0.0016 per question beyond the free 10k neurons. Set a billing alert.
4. **Stay non-commercial?** Adding ads or a subscription later would void the CC BY-NC iNaturalist photos [32], the Open-Meteo free tier [24] and RainViewer [28] (if kept), and it already rules out CARTO [11].
5. **OpenSeaMap.** Ask the project whether app-driven offline pre-seeding is acceptable. If not, keep seamarks live-only (ENC covers US aids to navigation).
6. **Courtesy notices (no cost):** GMRT, and NOAA OCS via ASSIST, about expected render load from offline downloads. Long term, consider shipping NOAA NCDS MBTiles for offline charts [41].
7. **Keep evidence of permission** for every third-party source: Apple may ask, "Authorization must be provided upon request" [40].

## Ambiguities (not overstated)
- **Open-Meteo:** whether an LLC's free, ad-free app is "non-commercial", and how multi-location requests are counted. Neither is documented [24][25].
- **iNaturalist:** whether "10,000 requests per day" is per app or per client [31].
- **OSM:** whether serving the passive browse cache while offline counts as "offline use" [1]. The explicit download feature clearly does.
- **GEBCO tiles hosted by NCEI on ArcGIS Online:** the item has no usage restriction, and Esri's restrictions are written for "items owned by Esri" [3][9].
- **OpenSeaMap:** no tile-server policy was found.
- **CARTO:** whether a vessel counts as a "vehicle of any type" [11]. The wording is broad and there is no carve-out.
- **Open-Meteo prices:** current list prices could not be read; the page loads them client-side.

## References
- [1] OSMF Tile Usage Policy: https://operations.osmfoundation.org/policies/tiles/
- [2] OSMF Attribution Guidelines: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- [3] Esri, "Frequently asked questions about items owned by Esri in ArcGIS Online" (last updated April 21, 2025): https://goto.arcgis.com/termsofuse/viewsummary (redirects to https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf)
- [4] Esri World Ocean Base item (licence text): https://www.arcgis.com/home/item.html?id=1e126e7520f9466c9ca28b8f28b5e500 (read via https://www.arcgis.com/sharing/rest/content/items/1e126e7520f9466c9ca28b8f28b5e500?f=json)
- [5] Esri World Imagery item: https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 (same API)
- [6] Esri, displaying copyrights: https://doc.arcgis.com/en/arcgis-online/reference/display-copyrights.htm
- [7] ArcGIS Location Platform pricing: https://location.arcgis.com/pricing/
- [9] NOAA NCEI "GEBCO Basemap (NOAA NCEI Visualization)" item: https://www.arcgis.com/home/item.html?id=5fc85a7275cc462c97821c79327cfeae
- [10] GEBCO Grid terms of use: https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use
- [11] CARTO Basemap Terms (last updated 29 Sep 2026): https://carto.com/legal/basemap-terms/
- [12] CARTO basemaps API key page: https://www.carto.com/basemaps/apikey/
- [13] CARTO basemap-styles README: https://github.com/CartoDB/basemap-styles
- [14] OpenSeaMap FAQ: https://www.openseamap.org/index.php?L=1&id=faq
- [15] NOAA OCS GIS data and services: https://nauticalcharts.noaa.gov/data/gis-data-and-services.html
- [16] NOAA OCS, ENC Online notice: https://nauticalcharts.noaa.gov/updates/coast-survey-unveils-noaa-enc-online-viewer/
- [17] 17 U.S.C. §105 (US Government works): https://www.law.cornell.edu/uscode/text/17/105
- [18] nowCOAST WMTS capabilities: https://nowcoast.noaa.gov/geoserver/gwc/service/wmts?REQUEST=GetCapabilities
- [19] nowCOAST radar WMS capabilities: https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetCapabilities
- [20] NOAA BlueTopo: https://nauticalcharts.noaa.gov/data/bluetopo.html
- [21] GMRT terms of use: https://www.gmrt.org/about/terms_of_use.php
- [22] MUR SST dataset metadata: https://coastwatch.pfeg.noaa.gov/erddap/info/jplMURSST41/index.html and ERDDAP legal: https://coastwatch.pfeg.noaa.gov/erddap/legal.html
- [23] CO-OPS data API: https://api.tidesandcurrents.noaa.gov/api/prod/
- [24] Open-Meteo terms: https://open-meteo.com/en/terms
- [25] Open-Meteo pricing: https://open-meteo.com/en/pricing
- [26] Open-Meteo licence: https://open-meteo.com/en/licence
- [27] Open-Meteo, "API Subscriptions for Commercial Use" (June 12, 2023): https://openmeteo.substack.com/p/api-subscriptions-for-commercial
- [28] RainViewer API: https://www.rainviewer.com/api.html
- [29] RainViewer API transition FAQ: https://rainviewer.com/api/transition-faq.html
- [30] RainViewer Weather Maps API: https://www.rainviewer.com/api/weather-maps-api.html
- [31] iNaturalist API docs (terms, throttling, photo licensing): https://api.inaturalist.org/v1/docs/ (text served in https://api.inaturalist.org/v1/swagger.json)
- [32] iNaturalist licensing help: https://help.inaturalist.org/en/support/solutions/articles/151000173511
- [33] Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- [34] Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- [35] Cloudflare Workers AI limits: https://developers.cloudflare.com/workers-ai/platform/limits/
- [36] llama-3.3-70b-instruct-fp8-fast model page: https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
- [37] Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms and Usage Policy: https://www.anthropic.com/legal/aup
- [38] USGS, terms for The National Map services: https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map
- [39] NWS API: https://www.weather.gov/documentation/services-web-api
- [40] Apple App Review Guidelines 5.2.2: https://developer.apple.com/app-store/review/guidelines/
- [41] NOAA NCDS MBTiles distribution: https://distribution.charts.noaa.gov/ncds/index.html
