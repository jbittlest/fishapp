/* Privacy policy + data-source credits — ONE source for the in-app About sheet and the public
   privacy.html / support.html pages (tools/make-legal-pages.mjs) that App Store Connect links to.
   Plain JS on purpose: imported by Vite and by Node. Keep it truthful to what the code does. */

export const POLICY_UPDATED = 'October 27, 2026';
export const SUPPORT_URL = 'https://github.com/jbittlest/fishapp/issues';
export const PRIVACY_URL = 'https://jbittlest.github.io/fishapp/privacy.html';

export const POLICY = [
  {
    title: 'The short version',
    body: [
      'FishApp has no accounts, no ads, no analytics and no tracking. Everything you create — spots, tracks, catches and their photos, voyages, downloaded charts and settings — is stored only on your device.',
      'FishApp only sends data off your device when it needs to fetch something for you, and only to the services listed below — or when you choose to share something.',
      'Because FishApp does not track you across other apps or websites, and lets no third party do so, it treats every user the same whether or not a browser sends a “Do Not Track” signal.',
    ],
  },
  {
    title: 'Location',
    body: [
      'Your location is used on your device to show your boat on the chart, record tracks you start, run the anchor watch and Go-To navigation, and to look up conditions where you are.',
      'When you ask for weather, waves, tides, water temperature, depth or recent fish sightings, the app sends the coordinates of the place you asked about — not your name or any identifier — to the public data service that answers. Those services return data for that place.',
      'When you ask First Mate about a place by name, that name (for example “Catalina”) is sent to Open-Meteo’s geocoding service to find its coordinates.',
      'In the iPhone app, location keeps updating with the screen locked only while an anchor watch, a track recording or a Go-To route is active.',
    ],
  },
  {
    title: 'First Mate, the AI assistant',
    body: [
      'With no internet, or until you allow cloud AI, First Mate answers on your device from your own boat data.',
      'If you allow cloud AI (the app asks first), your question, the recent conversation and the boat data needed to answer it — your position, speed and heading, local conditions, nearby reefs, your saved spots with their names, positions and notes, your catch log entries, and trip and anchor-watch status — are sent to the FishApp AI relay, which runs on Cloudflare Workers AI. It is processed to produce the reply and is not stored by FishApp.',
      'Like any web service, the relay receives your device’s IP address with each request. Cloudflare processes it only briefly, to cap how many requests one address can make and stop abuse; we do not store it. To enforce a daily limit the relay keeps only a scrambled fingerprint of it (a salted one-way hash, with a new salt each day, that cannot be turned back into the address), and deletes it after midnight UTC.',
      'If you add your own Anthropic API key, the same information is sent directly from your device to Anthropic under your account and Anthropic’s terms. Your key is stored only on your device.',
      'If you turn on the natural cloud voice, and only if you have allowed cloud AI, the text of each answer is sent to the relay to be turned into speech.',
      'You can turn cloud AI off at any time in First Mate settings. AI answers can be wrong; never rely on them for safety.',
    ],
  },
  {
    title: 'Microphone and speech',
    body: [
      'The microphone is used only while hands-free mode or the microphone button is active. Speech is recognised by your device’s operating system (Apple or Google speech services under their terms). FishApp does not record or upload audio itself.',
    ],
  },
  {
    title: 'Camera and photos',
    body: [
      'The camera and photo library are used only when you attach a photo to a catch you log. Photos stay on your device unless you choose to share them.',
    ],
  },
  {
    title: 'Sharing',
    body: [
      'A share link is created only when you tap Share on a spot. The link holds that spot’s name and coordinates in the part after the #, which browsers do not send to our web server. Anyone who receives the link — and anyone they pass it on to — can see that name and position.',
      'Sharing a catch makes an image card of it, with its photo if it has one. Your position is not on the card unless you turn on Show position for that card; it starts off every time.',
    ],
  },
  {
    title: 'App Store ratings',
    body: [
      'Now and then the iPhone app asks iOS to show Apple’s rating prompt. Apple shows and handles it, and nothing about it — whether it appeared, or any rating or review you leave — is sent to us. When to ask is worked out on your device.',
    ],
  },
  {
    title: 'Emergency features',
    body: [
      '“Text my location for help” opens your Messages app with a pre-filled message. Nothing is sent until you press send. Your emergency contact is stored only on your device.',
    ],
  },
  {
    title: 'Keeping and deleting your data',
    body: [
      'Because your data lives on your device, deleting the app (or clearing this site’s data in your browser) deletes it. You can export a backup file from Spots & tracks at any time.',
      'FishApp is not directed to children under 13 and does not knowingly collect information from anyone.',
    ],
  },
  {
    title: 'Changes and contact',
    body: [
      'If this policy changes, the date at the top changes with it. Questions or problems: open an issue at ' + SUPPORT_URL + '.',
    ],
  },
];

/* Services the app contacts directly from your device, and what they provide. Each credit carries
   what its source asks for (docs/launch/data-sources.md); the map's own attribution line comes
   from LAYERS in engine/tiles.js. */
export const SOURCES = [
  { name: 'NOAA Office of Coast Survey', what: 'Electronic nautical charts (ENC); not certified for navigation', url: 'https://nauticalcharts.noaa.gov/' },
  { name: 'NOAA National Bathymetric Source (BlueTopo) via nowCOAST', what: 'US survey bathymetry and hillshade', url: 'https://nauticalcharts.noaa.gov/data/bluetopo.html' },
  { name: 'NOAA NCEI', what: 'Coastal elevation (depth at a tapped point) and the GEBCO base map it publishes', url: 'https://www.ncei.noaa.gov/' },
  { name: 'NOAA CO-OPS Tides & Currents', what: 'Tide predictions', url: 'https://tidesandcurrents.noaa.gov/' },
  { name: 'NASA GIBS (MUR SST)', what: 'Sea surface temperature map tiles for the area on the chart, fetched in the background a few seconds after launch and kept on your device for about 10 days (with offline areas, until a newer day replaces them). These data were provided by JPL under support by NASA MEaSUREs program; imagery from NASA’s Global Imagery Browse Services (GIBS), part of NASA’s ESDIS.', url: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { name: 'Esri (ArcGIS Online)', what: 'Ocean base map (Esri, GEBCO, NOAA, Garmin, and other contributors) and satellite imagery (Esri, Vantor, Earthstar Geographics, and the GIS User Community), shown live and never saved offline; its ArcGIS Online servers (tiles.arcgis.com) also deliver the GEBCO base map', url: 'https://www.esri.com/' },
  { name: 'GEBCO', what: 'Global bathymetry base map (GEBCO, NOAA NCEI), delivered from Esri ArcGIS Online; saved with offline areas', url: 'https://www.gebco.net/' },
  { name: 'GMRT (Lamont-Doherty Earth Observatory)', what: 'Seafloor relief detail, CC BY 4.0 (Ryan et al., 2009)', url: 'https://www.gmrt.org/' },
  { name: 'OpenStreetMap contributors', what: 'Street map; shown live, never saved offline', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenSeaMap contributors', what: 'Seamarks — buoys and beacons, CC BY-SA; shown live, never saved offline', url: 'https://www.openseamap.org/' },
  { name: 'Open-Meteo', what: 'Weather and marine forecasts, CC BY 4.0', url: 'https://open-meteo.com/' },
  { name: 'NOAA nowCOAST (MRMS radar)', what: 'Rain radar for the continental US (NWS and OAR Multi-Radar/Multi-Sensor mosaics); shown live, never saved offline', url: 'https://nowcoast.noaa.gov/' },
  { name: 'iNaturalist', what: 'Recent fish observations (research grade)', url: 'https://www.inaturalist.org/' },
  { name: 'NOAA Artificial Reefs · California Dept. of Fish and Wildlife', what: 'Bundled reef and Marine Protected Area data; fishing regulations', url: 'https://wildlife.ca.gov/' },
  { name: 'Cloudflare Workers AI', what: 'The free First Mate AI relay (only if you allow cloud AI)', url: 'https://www.cloudflare.com/privacypolicy/' },
  { name: 'Anthropic', what: 'Claude, only if you add your own API key', url: 'https://www.anthropic.com/legal/privacy' },
];

export const NOT_FOR_NAVIGATION =
  'FishApp is a navigation aid, not a substitute for official NOAA charts, a depth sounder, a VHF radio or a proper lookout. Charts, depths, forecasts, tides, regulations and AI answers come from public sources and can be wrong, out of date or missing. Always cross-check anything you rely on and use your own judgement on the water.';
