/* First Mate — in-app fishing & boating assistant.
   Hybrid: OFFLINE it answers deterministically from the app's own live data
   (position, solunar/sun/moon via astro.js, cached weather, catches, spots,
   reefs, regs, knots). ONLINE with an API key it becomes a full conversational
   AI (Claude) that is handed the same live snapshot as grounding. */
'use strict';

const ASST = {
  history: [],          // {role:'user'|'assistant', content:'…'}
  streaming: false,
  key() { return (localStorage.getItem('fishapp.asst.key') || '').trim(); },
  model() { return localStorage.getItem('fishapp.asst.model') || 'claude-opus-4-8'; },
};

/* ---------------- small helpers ---------------- */
function asstPos() {
  if (typeof GPS !== 'undefined' && GPS.lastLatLng) return { ll: GPS.lastLatLng, live: true };
  if (window._map) return { ll: window._map.getCenter(), live: false };
  return { ll: null, live: false };
}
function asstSpeedKn() {
  if (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.speed != null)
    return GPS.last.coords.speed * 1.94384;
  return null;
}
function asstHeading() {
  if (typeof GPS !== 'undefined' && GPS.last && GPS.last.coords && GPS.last.coords.heading != null && !isNaN(GPS.last.coords.heading))
    return GPS.last.coords.heading;
  return null;
}
function asstTime(d) { return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'; }
function asstCompass(deg) {
  if (deg == null) return '';
  if (typeof compass === 'function') return compass(deg);
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg / 22.5) % 16];
}
function asstCachedWx() {
  try { return JSON.parse(localStorage.getItem('fishapp.lastwx') || 'null'); } catch (e) { return null; }
}
function asstNearestReefs(ll, n) {
  if (typeof Reefs === 'undefined' || !Reefs.reefs || !Reefs.reefs.length || typeof L === 'undefined') return [];
  const here = L.latLng(ll.lat, ll.lng);
  return Reefs.reefs
    .map((r) => ({ r, nm: nmBetween(here, L.latLng(r.la, r.lo)), brg: bearingBetween(here, L.latLng(r.la, r.lo)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, n);
}
function asstNearestSpots(ll, n) {
  if (typeof Spots === 'undefined' || !Spots.all || !Spots.all.length || typeof L === 'undefined') return [];
  const here = L.latLng(ll.lat, ll.lng);
  return Spots.all
    .map((s) => ({ s, nm: nmBetween(here, L.latLng(s.lat, s.lng)), brg: bearingBetween(here, L.latLng(s.lat, s.lng)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, n);
}
function asstAstro(ll) {
  if (typeof Astro === 'undefined' || !ll) return null;
  const now = new Date();
  try {
    const ill = Astro.moonIllumination(now);
    return {
      now,
      sun: Astro.sunTimes(now, ll.lat, ll.lng),
      moonT: Astro.moonTimes(now, ll.lat, ll.lng),
      phaseName: Astro.moonPhaseName(ill.phase),
      lit: Math.round(ill.fraction * 100),
      solunar: Astro.solunar(now, ll.lat, ll.lng) || [],
    };
  } catch (e) { return null; }
}

/* ---------------- live-data snapshot (feeds both brains) ---------------- */
function asstSnapshot() {
  const { ll, live } = asstPos();
  const L1 = [];
  L1.push('=== LIVE BOAT DATA (' + new Date().toLocaleString() + ') ===');
  L1.push('Online: ' + (navigator.onLine ? 'yes' : 'NO — offshore/no signal'));
  if (ll) {
    L1.push('Position: ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) +
      (live ? ' (live GPS)' : ' (map center — no GPS fix yet)'));
    const sp = asstSpeedKn(), hd = asstHeading();
    if (sp != null) L1.push('Speed over ground: ' + sp.toFixed(1) + ' kn');
    if (hd != null) L1.push('Heading: ' + Math.round(hd) + '° (' + asstCompass(hd) + ')');
  } else {
    L1.push('Position: unknown (no GPS, no map).');
  }

  const a = asstAstro(ll);
  if (a) {
    L1.push('Sun: rise ' + asstTime(a.sun.sunrise) + ', set ' + asstTime(a.sun.sunset));
    L1.push('Moon: ' + a.phaseName + ' (' + a.lit + '% lit)' +
      (a.moonT.rise ? ', rise ' + asstTime(a.moonT.rise) : '') +
      (a.moonT.set ? ', set ' + asstTime(a.moonT.set) : ''));
    if (a.solunar.length) {
      L1.push('Solunar bite periods today: ' + a.solunar
        .map((p) => (p.type === 'major' ? 'MAJOR ' : 'minor ') + asstTime(p.start) + '–' + asstTime(p.end)).join('; '));
    }
  }

  const wx = asstCachedWx();
  if (wx && wx.wx && wx.wx.current) {
    const c = wx.wx.current, age = Math.round((Date.now() - wx.ts) / 60000);
    L1.push('Weather (cached ' + age + ' min ago): wind ' + Math.round(c.wind_speed_10m) + ' kn ' +
      asstCompass(c.wind_direction_10m) + ', gust ' + Math.round(c.wind_gusts_10m) + ' kn, air ' +
      Math.round(c.temperature_2m) + '°F');
    if (wx.marine && wx.marine.current) {
      const m = wx.marine.current;
      L1.push('Seas (cached): ' + (m.wave_height * 3.28084).toFixed(1) + ' ft @ ' +
        Math.round(m.wave_period) + 's from ' + asstCompass(m.wave_direction));
    }
  } else {
    L1.push('Weather: none cached (open the Weather panel while online to cache it).');
  }

  if (ll) {
    const reefs = asstNearestReefs(ll, 3);
    if (reefs.length) L1.push('Nearest reefs: ' + reefs
      .map((x) => x.r.n + ' (' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) + (x.r.d ? ', ~' + x.r.d + ' ft' : '') + ')').join('; '));
    const spots = asstNearestSpots(ll, 3);
    if (spots.length) L1.push('Your nearest saved spots: ' + spots
      .map((x) => x.s.name + ' [' + x.s.type + '] (' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) + ')').join('; '));
  }

  if (typeof Catch !== 'undefined' && Catch.all && Catch.all.length) {
    const n = Catch.all.length;
    const bySp = {};
    Catch.all.forEach((c) => { const s = (c.species || 'unknown').trim(); bySp[s] = (bySp[s] || 0) + 1; });
    const top = Object.entries(bySp).sort((a2, b2) => b2[1] - a2[1]).slice(0, 5)
      .map(([s, c]) => s + '×' + c).join(', ');
    const recent = Catch.all.slice().sort((x, y) => y.ts - x.ts).slice(0, 3)
      .map((c) => c.species + (c.length ? ' ' + c.length + '"' : '') + ' on ' + new Date(c.ts).toLocaleDateString() +
        (c.bait ? ' (' + c.bait + ')' : '')).join('; ');
    L1.push('Catch log: ' + n + ' logged. Species: ' + top + '. Recent: ' + recent);
  }

  if (typeof Nav !== 'undefined') {
    if (Nav.trip && Nav.trip.active) {
      const avg = Nav.trip.nKn ? (Nav.trip.sumKn / Nav.trip.nKn) : 0;
      L1.push('Trip running: ' + Nav.trip.dist.toFixed(1) + ' nm, avg ' + avg.toFixed(1) + ' kn, max ' + Nav.trip.maxKn.toFixed(1) + ' kn');
    }
    if (Nav.anchor && Nav.anchor.watching) L1.push('Anchor watch ON, radius ' + Nav.anchor.radiusFt + ' ft');
  }
  return L1.join('\n');
}

/* Compact CA regulations table for the online brain. */
function asstRegsTable() {
  if (typeof FISH_ID === 'undefined' || !FISH_ID.length) return '';
  return 'CA SALTWATER REGS (general reference — verify with CDFW):\n' +
    FISH_ID.map((f) => '- ' + f.name + ': min size ' + f.size + '; bag ' + f.bag + (f.note ? '; ' + f.note : '')).join('\n');
}

/* ================= OFFLINE deterministic engine ================= */
function asstOffline(q) {
  const t = q.toLowerCase();
  const { ll, live } = asstPos();
  const has = (...w) => w.some((x) => t.includes(x));

  // Position
  if (has('where am i', 'my position', 'coordinate', 'my location', 'lat/long', 'lat long', 'gps'))
    return asstAnsPosition(ll, live);
  // Speed / heading
  if (has('how fast', 'my speed', 'speed over', ' sog', 'heading', 'which way', 'course'))
    return asstAnsSpeed();
  // Bite / solunar
  if (has('bite', 'solunar', 'best time', 'when to fish', 'feeding', 'best window'))
    return asstAnsSolunar(ll);
  // Sun / daylight
  if (has('sunrise', 'sunset', 'daylight', 'dawn', 'dusk', 'first light', 'last light'))
    return asstAnsSun(ll);
  // Moon
  if (has('moon', 'lunar', 'phase'))
    return asstAnsMoon(ll);
  // Waves / seas
  if (has('wave', 'swell', 'seas', 'surf', 'chop'))
    return asstAnsWaves();
  // Weather / wind
  if (has('weather', 'wind', 'gust', 'forecast', 'breeze', 'conditions'))
    return asstAnsWeather();
  // Water temp
  if (has('water temp', 'sea temp', 'sst', 'surface temp', 'temperature of the water', 'how warm', 'how cold'))
    return asstAnsWaterTemp();
  // Reefs / structure
  if (has('reef', 'structure', 'artificial'))
    return asstAnsReefs(ll);
  // Regulations — species lookup
  if (has('legal', 'limit', 'size', 'bag', 'keep', 'regulation', 'slot', 'season', 'how many can i')) {
    const reg = asstAnsReg(t);
    if (reg) return reg;
  }
  // Knots
  if (has('knot', 'tie', 'rig ', 'loop', 'hitch', 'bend'))
    return asstAnsKnot(t);
  // Catch log
  if (has('catch', 'caught', 'my log', 'have i', 'what have i', 'my fish'))
    return asstAnsCatches();
  // Spots
  if (has('spot', 'marked', 'my spots', 'waypoint', 'nearest spot'))
    return asstAnsSpots(ll);
  // Distance/bearing to a named spot
  if (has('distance to', 'how far', 'bearing to', 'how do i get to')) {
    const d = asstAnsDistanceTo(t, ll);
    if (d) return d;
  }
  // Emergency
  if (has('emergency', 'mayday', 'sos', 'sinking', 'help me', 'man overboard', 'distress', 'pan-pan', 'pan pan'))
    return asstAnsEmergency(ll);
  // Species reference fallback (e.g. "yellowtail")
  const sp = asstFindSpecies(t);
  if (sp) return asstFormatSpecies(sp);
  const kn = asstFindKnot(t);
  if (kn) return asstFormatKnot(kn);

  return asstAnsHelp();
}

function asstAnsPosition(ll, live) {
  if (!ll) return "No position yet — I need a GPS fix. Tap the ◉ follow button and give it a moment under open sky.";
  const dec = ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
  const dm = (typeof formatCoord === 'function') ? (formatCoord(ll.lat, 'lat') + '  ' + formatCoord(ll.lng, 'lon')) : dec;
  return (live ? '📍 Your position:\n' : '📍 Map center (no live GPS fix yet):\n') +
    dm + '\n' + dec + '\n\nFor the Coast Guard, read the top line. Tap 🆘 to copy or text it.';
}
function asstAnsSpeed() {
  const sp = asstSpeedKn(), hd = asstHeading();
  if (sp == null && hd == null) return "No speed/heading yet — those come from a moving GPS fix.";
  let s = '';
  if (sp != null) s += '🚤 Speed over ground: ' + sp.toFixed(1) + ' kn (' + (sp * 1.15078).toFixed(1) + ' mph)\n';
  if (hd != null) s += '🧭 Heading: ' + Math.round(hd) + '° ' + asstCompass(hd);
  return s.trim();
}
function asstAnsSolunar(ll) {
  const a = asstAstro(ll);
  if (!a) return "I can't compute solunar times without a position.";
  if (!a.solunar.length) return "No strong solunar periods computed for today at this location.";
  const now = new Date();
  const lines = a.solunar.map((p) => {
    const active = now >= p.start && now <= p.end;
    return (p.type === 'major' ? '🎯 MAJOR' : '• minor') + '  ' + asstTime(p.start) + '–' + asstTime(p.end) + (active ? '  ← NOW' : '');
  });
  return "🐟 Best bite windows today (solunar):\n" + lines.join('\n') +
    "\n\nMajors are the strongest. Dawn and dusk overlapping a major are prime. " + a.phaseName + ', ' + a.lit + '% lit.';
}
function asstAnsSun(ll) {
  const a = asstAstro(ll);
  if (!a) return "I need a position to compute sun times.";
  return "☀️ Today:\nSunrise " + asstTime(a.sun.sunrise) + "\nSunset  " + asstTime(a.sun.sunset) +
    "\nSolar noon " + asstTime(a.sun.solarNoon);
}
function asstAnsMoon(ll) {
  const a = asstAstro(ll);
  if (!a) return "I need a position to compute moon times.";
  return "🌙 " + a.phaseName + " — " + a.lit + "% illuminated" +
    (a.moonT.rise ? "\nMoonrise " + asstTime(a.moonT.rise) : '') +
    (a.moonT.set ? "\nMoonset  " + asstTime(a.moonT.set) : '') +
    "\n\nNew and full moons drive the biggest tides and strongest solunar bite.";
}
function asstAnsWeather() {
  const wx = asstCachedWx();
  if (!wx || !wx.wx || !wx.wx.current) return asstNoWx();
  const c = wx.wx.current, age = Math.round((Date.now() - wx.ts) / 60000);
  let s = "🌤 Wind now (cached " + age + " min ago):\n" + Math.round(c.wind_speed_10m) + ' kn from ' +
    asstCompass(c.wind_direction_10m) + ', gusting ' + Math.round(c.wind_gusts_10m) + ' kn\nAir ' + Math.round(c.temperature_2m) + '°F';
  if (wx.marine && wx.marine.current) {
    const m = wx.marine.current;
    s += '\nSeas ' + (m.wave_height * 3.28084).toFixed(1) + ' ft @ ' + Math.round(m.wave_period) + 's';
  }
  const g = Math.round(c.wind_gusts_10m);
  if (g >= 25) s += '\n\n⚠️ ' + g + ' kn gusts — rough. Check conditions before heading out.';
  else if (g >= 18) s += '\n\nBreezy — expect a chop.';
  return s;
}
function asstAnsWaves() {
  const wx = asstCachedWx();
  if (!wx || !wx.marine || !wx.marine.current) {
    if (wx && wx.wx) return "No wave data cached. Open the Weather panel while online to cache seas — I only have wind then.";
    return asstNoWx();
  }
  const m = wx.marine.current, age = Math.round((Date.now() - wx.ts) / 60000);
  const ft = (m.wave_height * 3.28084);
  let s = "🌊 Seas (cached " + age + " min ago):\n" + ft.toFixed(1) + ' ft @ ' + Math.round(m.wave_period) + 's from ' + asstCompass(m.wave_direction);
  if (ft >= 5) s += '\n\n⚠️ Big — small boats beware.';
  else if (ft >= 3) s += '\n\nModerate chop — bumpy ride.';
  else s += '\n\nCalm-ish. Good conditions.';
  return s;
}
function asstAnsWaterTemp() {
  const wx = asstCachedWx();
  if (wx && wx.marine && wx.marine.current && wx.marine.current.sea_surface_temperature != null)
    return "🌡️ Sea-surface temp (cached): " + Math.round(wx.marine.current.sea_surface_temperature) + "°F";
  if (typeof SST !== 'undefined' && SST.range)
    return "🌡️ I don't have an exact water temp cached here. The SST layer's current color scale runs about " +
      Math.round(SST.range[0] * 9 / 5 + 32) + "–" + Math.round(SST.range[1] * 9 / 5 + 32) +
      "°F across the view. Turn on the 🌡️ Sea-surface-temp layer (needs internet) and tap the water for an exact reading.";
  return "I don't have a cached water temp. Online, turn on the SST layer and tap the water for an exact °F.";
}
function asstAnsReefs(ll) {
  if (!ll) return "I need a position to find nearby reefs.";
  const reefs = asstNearestReefs(ll, 5);
  if (!reefs.length) return "No reef data loaded (the bundled reef list is California-focused).";
  return "🪸 Nearest artificial reefs:\n" + reefs.map((x, i) =>
    (i + 1) + '. ' + x.r.n + ' — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) +
    (x.r.d ? ', ~' + x.r.d + ' ft' : '') + (x.r.c ? '\n   ' + x.r.c : '')).join('\n');
}
function asstAnsSpots(ll) {
  if (typeof Spots === 'undefined' || !Spots.all || !Spots.all.length)
    return "You have no saved spots yet. Tap 📌 or long-press the map to mark one.";
  if (!ll) return "You have " + Spots.all.length + " saved spots, but I need a GPS fix to sort by distance.";
  const spots = asstNearestSpots(ll, 6);
  return "📌 Your nearest spots:\n" + spots.map((x, i) =>
    (i + 1) + '. ' + x.s.name + ' [' + x.s.type + '] — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg) +
    (x.s.notes ? '\n   ' + x.s.notes : '')).join('\n');
}
function asstAnsDistanceTo(t, ll) {
  if (!ll || typeof Spots === 'undefined' || !Spots.all) return null;
  const spot = Spots.all.find((s) => s.name && t.includes(s.name.toLowerCase()));
  if (!spot) return null;
  const here = L.latLng(ll.lat, ll.lng), there = L.latLng(spot.lat, spot.lng);
  const nm = nmBetween(here, there), brg = bearingBetween(here, there);
  const sp = asstSpeedKn();
  let s = "➡️ " + spot.name + ": " + nm.toFixed(1) + " nm, bearing " + Math.round(brg) + "° " + asstCompass(brg);
  if (sp && sp > 0.5) s += "\nAt " + sp.toFixed(0) + " kn: ~" + Math.round((nm / sp) * 60) + " min";
  return s;
}
function asstAnsCatches() {
  if (typeof Catch === 'undefined' || !Catch.all || !Catch.all.length)
    return "Your catch log is empty. Tap 🧭 → Log a Catch to start building it.";
  const all = Catch.all.slice().sort((a, b) => b.ts - a.ts);
  const bySp = {};
  all.forEach((c) => { const s = (c.species || 'unknown').trim(); bySp[s] = (bySp[s] || 0) + 1; });
  const top = Object.entries(bySp).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => s + ' ×' + c).join(', ');
  const recent = all.slice(0, 5).map((c) => '• ' + c.species + (c.length ? ' ' + c.length + '"' : '') +
    (c.bait ? ' on ' + c.bait : '') + ' — ' + new Date(c.ts).toLocaleDateString()).join('\n');
  return "🎣 " + all.length + " catches logged.\nBy species: " + top + "\n\nMost recent:\n" + recent;
}
function asstAnsReg(t) {
  const sp = asstFindSpecies(t);
  if (!sp) return null;
  return asstFormatSpecies(sp);
}
function asstFindSpecies(t) {
  if (typeof FISH_ID === 'undefined') return null;
  // direct name / word overlap
  let best = FISH_ID.find((f) => t.includes(f.name.toLowerCase()));
  if (best) return best;
  const words = t.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  best = FISH_ID.find((f) => words.some((w) => f.name.toLowerCase().includes(w)));
  return best || null;
}
function asstFormatSpecies(f) {
  return f.emoji + ' ' + f.name + '\nMin size: ' + f.size + '\nBag limit: ' + f.bag +
    (f.note ? '\n' + f.note : '') + '\nID: ' + f.id +
    '\n\n⚠️ General reference — always confirm current CA regs with CDFW before keeping fish.';
}
function asstFindKnot(t) {
  if (typeof KNOTS === 'undefined') return null;
  const words = t.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  return KNOTS.find((k) => t.includes(k.name.toLowerCase())) ||
    KNOTS.find((k) => words.filter((w) => k.name.toLowerCase().includes(w)).length >= 1) || null;
}
function asstAnsKnot(t) {
  const k = asstFindKnot(t);
  if (k) return asstFormatKnot(k);
  if (typeof KNOTS === 'undefined' || !KNOTS.length) return "No knot guide loaded.";
  return "🪢 Which knot? I know: " + KNOTS.map((k2) => k2.name).join(', ') +
    ".\nOpen 📖 Guides → Knots for illustrated steps.";
}
function asstFormatKnot(k) {
  return '🪢 ' + k.name + ' — ' + k.use + ' (' + k.level + ')\n' +
    k.steps.map((s, i) => (i + 1) + '. ' + s).join('\n') +
    (k.tip ? '\n💡 ' + k.tip : '') + '\n\nOpen 📖 Guides → Knots for a diagram.';
}
function asstAnsEmergency(ll) {
  let s = "🆘 EMERGENCY\n• VHF Channel 16 — hail & distress\n• Call 911 / Coast Guard (needs signal)\n";
  if (ll) s += "• Your position: " + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) + "\n";
  s += "\nMAYDAY (life-threatening), say 3×: your boat name, position above, nature of emergency, # people aboard.\n" +
    "No signal + iPhone 14+? Emergency SOS via satellite — point at open sky.\n\nTap the 🆘 button for the full script, one-tap texting, and satellite steps.";
  return s;
}
function asstNoWx() {
  return "I have no cached weather. Open the 🌤 Weather panel once while you have signal — it caches so I can read it offline. " +
    (navigator.onLine ? "You're online now, so add an API key in settings for a live answer." : "");
}
function asstAnsHelp() {
  return "🎣 I'm First Mate. Offline I can tell you:\n" +
    "• Best bite times (solunar), sunrise/sunset, moon phase\n" +
    "• Your position, speed & heading\n" +
    "• Cached wind, seas & water temp\n" +
    "• Nearest reefs and your saved spots (with distance/bearing)\n" +
    "• Your catch log & patterns\n" +
    "• Fish size/bag limits and knot how-tos\n" +
    "• Emergency / Mayday info\n\n" +
    "Add an Anthropic API key in ⚙️ settings and, with signal, I'll chat about anything boating or fishing.";
}

/* ================= ONLINE brain (Claude) ================= */
function asstSystemPrompt() {
  return [
    "You are First Mate, a calm, concise assistant built into an offline marine navigation app for a recreational boater and angler.",
    "You have the user's LIVE boat data below — use it. Prefer it over guessing. Units: distances in nautical miles, speed in knots, temps in °F, depths/heights in feet.",
    "Be practical and brief — this is read on a phone on a boat. Lead with the answer. Use short lines. Only elaborate when asked.",
    "Safety first: for anything life-threatening, tell them to use VHF Ch 16 / call the Coast Guard and point to the app's 🆘 button. Never give false confidence about weather or conditions.",
    "Fishing regulations you cite are general reference — always tell them to confirm current limits with the state wildlife agency (CDFW in California) before keeping fish.",
    "You cannot control the app or place waypoints; you advise. If they need a tool (tides, layers, catch log, knots), point them to the matching button.",
    "",
    asstSnapshot(),
    "",
    asstRegsTable(),
  ].join('\n');
}

async function asstAskOnline(userText, botEl) {
  const messages = ASST.history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ASST.key(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: ASST.model(),
      max_tokens: 1024,
      system: asstSystemPrompt(),
      messages,
      stream: true,
    }),
  });

  if (!resp.ok || !resp.body) {
    let msg = 'HTTP ' + resp.status;
    try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
    const err = new Error(msg); err.status = resp.status; throw err;
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  botEl.classList.remove('thinking');
  botEl.textContent = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        full += ev.delta.text;
        botEl.textContent = full;
        asstScroll();
      } else if (ev.type === 'error') {
        throw new Error((ev.error && ev.error.message) || 'stream error');
      }
    }
  }
  return full.trim();
}

/* ================= UI plumbing ================= */
function asstScroll() {
  const box = document.getElementById('asst-messages');
  if (box) box.scrollTop = box.scrollHeight;
}
function asstAddMsg(role, text) {
  const box = document.getElementById('asst-messages');
  const el = document.createElement('div');
  el.className = 'asst-msg ' + role;
  el.textContent = text;
  box.appendChild(el);
  asstScroll();
  return el;
}
function asstSetStatus() {
  const el = document.getElementById('asst-status');
  if (!el) return;
  const hasKey = !!ASST.key();
  const online = navigator.onLine;
  let dot = 'warn', txt;
  if (online && hasKey) { dot = 'ok'; txt = 'Online AI · ' + asstModelLabel(); }
  else if (!online) { dot = 'warn'; txt = 'Offline — answering from your boat data'; }
  else { dot = 'warn'; txt = 'No API key — offline data mode (add a key in ⚙️)'; }
  el.innerHTML = '<span class="dot ' + dot + '"></span>' + txt;
}
function asstModelLabel() {
  const m = ASST.model();
  if (m.indexOf('opus') >= 0) return 'Opus 4.8';
  if (m.indexOf('sonnet') >= 0) return 'Sonnet 5';
  if (m.indexOf('haiku') >= 0) return 'Haiku 4.5';
  return m;
}

async function asstSend(text) {
  text = (text || '').trim();
  if (!text || ASST.streaming) return;
  const input = document.getElementById('asst-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  asstAddMsg('user', text);

  const useOnline = navigator.onLine && !!ASST.key();
  ASST.streaming = true;
  asstSetSending(true);

  if (useOnline) {
    const botEl = asstAddMsg('bot', '…');
    botEl.classList.add('thinking');
    try {
      const reply = await asstAskOnline(text, botEl);
      ASST.history.push({ role: 'user', content: text });
      ASST.history.push({ role: 'assistant', content: reply });
      if (ASST.history.length > 24) ASST.history = ASST.history.slice(-24);
    } catch (e) {
      // graceful fallback to the offline engine
      const off = asstOffline(text);
      botEl.classList.remove('thinking');
      botEl.classList.add('err');
      let note = "⚠️ Couldn't reach the AI (" + (e.status === 401 ? 'bad API key' : (e.message || 'network')) + "). Offline answer:";
      botEl.textContent = note + '\n\n' + off;
    }
  } else {
    const botEl = asstAddMsg('bot', '');
    botEl.textContent = asstOffline(text);
    asstScroll();
  }

  ASST.streaming = false;
  asstSetSending(false);
  asstSetStatus();
}

function asstSetSending(on) {
  const btn = document.getElementById('asst-send');
  if (btn) btn.disabled = on;
}

const ASST_CHIPS = [
  'Best bite times today', 'Wind & waves now', 'Where am I?',
  'Nearest reef', 'Sunrise & sunset', 'Is a calico bass legal?',
];
function asstRenderChips() {
  const box = document.getElementById('asst-suggest');
  if (!box) return;
  box.innerHTML = '';
  ASST_CHIPS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'asst-chip';
    b.textContent = c;
    b.onclick = () => asstSend(c);
    box.appendChild(b);
  });
}

function asstOnOpen() {
  asstSetStatus();
  const box = document.getElementById('asst-messages');
  if (box && !box.children.length) {
    asstAddMsg('bot', "Ahoy! I'm First Mate 🎣\nAsk me about bite times, wind, water temp, reefs, your catches, fish limits or knots. Tap a suggestion below to start.");
    asstRenderChips();
  }
}

function asstInit() {
  // settings
  const keyIn = document.getElementById('asst-key');
  const modelIn = document.getElementById('asst-model');
  if (keyIn) keyIn.value = ASST.key();
  if (modelIn) modelIn.value = ASST.model();

  document.getElementById('asst-save').onclick = () => {
    if (keyIn) localStorage.setItem('fishapp.asst.key', keyIn.value.trim());
    if (modelIn) localStorage.setItem('fishapp.asst.model', modelIn.value);
    asstSetStatus();
    if (typeof toast === 'function') toast('Assistant settings saved');
    const det = document.getElementById('asst-settings'); if (det) det.open = false;
  };
  document.getElementById('asst-clear').onclick = () => {
    ASST.history = [];
    const box = document.getElementById('asst-messages');
    if (box) box.innerHTML = '';
    asstOnOpen();
  };

  const send = document.getElementById('asst-send');
  const input = document.getElementById('asst-input');
  if (send) send.onclick = () => asstSend(input ? input.value : '');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); asstSend(input.value); }
    });
    input.addEventListener('input', () => {   // auto-grow
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }
  window.addEventListener('online', asstSetStatus);
  window.addEventListener('offline', asstSetStatus);
}
