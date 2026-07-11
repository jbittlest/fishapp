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
function asstAgo(ts) {
  const m = (Date.now() - ts) / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + ' min ago';
  const h = m / 60;
  if (h < 24) return Math.round(h) + ' h ago';
  return Math.round(h / 24) + ' d ago';
}
/* Rough natural-time parser: "tomorrow afternoon", "tonight", "this morning". */
function asstParseWhen(t) {
  const d = new Date(); let label = 'Now';
  const at = (h) => d.setHours(h, 0, 0, 0);
  if (/tomorrow/.test(t)) {
    d.setDate(d.getDate() + 1); at(12); label = 'Tomorrow';
    if (/morning/.test(t)) { at(8); label = 'Tomorrow morning'; }
    else if (/afternoon/.test(t)) { at(14); label = 'Tomorrow afternoon'; }
    else if (/evening|night/.test(t)) { at(19); label = 'Tomorrow evening'; }
  } else if (/tonight/.test(t)) { at(20); label = 'Tonight'; }
  else if (/this afternoon/.test(t)) { at(14); label = 'This afternoon'; }
  else if (/this morning/.test(t)) { at(8); label = 'This morning'; }
  else if (/this evening/.test(t)) { at(19); label = 'This evening'; }
  if (label === 'Now') {
    const wds = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < 7; i++) {
      if (t.indexOf(wds[i]) < 0) continue;
      let add = (i - d.getDay() + 7) % 7; if (add === 0) add = 7;   // next occurrence, not today
      d.setDate(d.getDate() + add); at(12);
      label = wds[i].charAt(0).toUpperCase() + wds[i].slice(1);
      if (/morning/.test(t)) { at(8); label += ' morning'; }
      else if (/afternoon/.test(t)) { at(14); label += ' afternoon'; }
      else if (/evening|night/.test(t)) { at(19); label += ' evening'; }
      break;
    }
  }
  return { ms: d.getTime(), label };
}
function asstAreaPack() {
  const ll = asstPos().ll;
  return (ll && typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
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

  const pk = (ll && typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
  if (pk && pk.data) {
    const d = pk.data;
    const parts = [];
    if (d.forecast) parts.push('7-day wind/wave forecast');
    if (d.tides) parts.push('a week of tides');
    if (d.sstGrid) parts.push('water-temp grid');
    if (d.depthGrid) parts.push('depth grid');
    if (d.fish) parts.push(d.fish.total + ' fish records');
    if (d.mpas) parts.push(d.mpas.length + ' closures');
    L1.push('Downloaded area pack "' + pk.name + '" covers this location (captured ' + asstAgo(d.capturedTs) +
      '): ' + parts.join(', ') + '. Call get_area_intel to read it — especially useful offline.');
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

  // Place a waypoint — a LOCAL action, so it works offline too
  if (has('waypoint', 'drop a pin', 'pin it', 'mark this', 'mark here', 'mark spot', 'marker here',
    'save this spot', 'save this location', 'save my spot', 'drop a mark') ||
    (has('name it', 'call it', 'named', 'called') && has('here', 'spot', 'pin', 'waypoint', 'mark')))
    return asstOfflinePlaceWaypoint(q);

  // Position
  if (has('where am i', 'my position', 'coordinate', 'my location', 'lat/long', 'lat long', 'gps'))
    return asstAnsPosition(ll, live);
  // Speed / heading
  if (has('how fast', 'my speed', 'speed over', ' sog', 'heading', 'which way', 'my course', 'course over'))
    return asstAnsSpeed();
  // Multi-day "best day to fish" planner (bite + weather)
  if (has('best day', 'which day', 'when should i go', 'plan my trip', 'plan a trip', 'should i go fishing',
    'best day to fish', 'best morning', 'coming days to fish', 'when to go fishing') ||
    (has('best time', 'when') && has('week', 'tomorrow', 'days', 'weekend')))
    return asstAnsPlan();
  // Bite / solunar (today)
  if (has('bite', 'solunar', 'best time', 'when to fish', 'feeding', 'best window'))
    return asstAnsSolunar(ll);
  // Multi-day weather outlook
  if (has('this week', 'next few days', 'coming days', 'outlook', 'week ahead', 'multi-day',
    'next 3 days', 'next three days', 'weekend forecast', '7 day', '7-day', 'forecast for the week'))
    return asstAnsOutlook();
  // Go / no-go conditions read
  if (has('rough', 'safe to go', 'go out', 'sea state', 'small craft', 'too windy', 'calm enough',
    'how bad', 'fishable', 'should i go out', 'okay to go', 'ok to go', 'nasty out'))
    return asstAnsGoNoGo();
  // Nearest saved spot by type (ramp / anchorage / hazard / wreck)
  if (has('nearest ramp', 'closest ramp', 'nearest launch', 'boat ramp', 'launch ramp', 'nearest dock',
    'nearest anchorage', 'closest anchorage', 'nearest hazard', 'nearest wreck', 'place to anchor')) {
    const near = asstAnsNearest(t); if (near) return near;
  }
  // What bait/lure works for a species (from the catch log)
  if (has('what bait', 'best bait', 'what should i use', 'what lure', 'which lure', 'what to throw', 'what do they hit')) {
    const bait = asstAnsBait(t); if (bait) return bait;
  }
  // Sun / daylight
  if (has('sunrise', 'sunset', 'daylight', 'dawn', 'dusk', 'first light', 'last light'))
    return asstAnsSun(ll);
  // Moon
  if (has('moon', 'lunar', 'phase'))
    return asstAnsMoon(ll);
  // Tides (now answerable offline from a downloaded area pack)
  if (has('tide', 'high tide', 'low tide', 'slack', 'ebb', 'flood'))
    return asstAnsTides(t);
  // Fish history in this area (from the downloaded pack)
  if (has('what fish', 'been caught', 'caught here', 'biting', 'what bites', 'species here',
    'what lives here', 'what can i catch', 'fish been', 'whats around', "what's around"))
    return asstAnsFishHistory();
  // Closures / protected areas  (note: avoid bare 'mpa' — it's a substring of "compare")
  if (has('closure', 'closed to fish', 'protected area', 'marine protected', ' mpa', 'mpas',
    'can i fish here', 'legal to fish here', 'no-take', 'no take', 'reserve'))
    return asstAnsClosures();
  // Waves / seas
  if (has('wave', 'swell', 'seas', 'surf', 'chop'))
    return asstAnsWaves();
  // Weather / wind
  if (has('weather', 'wind', 'windy', 'gust', 'forecast', 'breeze', 'conditions', 'rain', 'raining',
    'cloudy', 'sunny', 'hot out', 'cold out'))
    return asstAnsWeather(t);
  // Water temp
  if (has('water temp', 'sea temp', 'sst', 'surface temp', 'temperature of the water', 'how warm', 'how cold'))
    return asstAnsWaterTemp();
  // Depth (from the downloaded depth grid)
  if (has('how deep', 'depth here', 'depth at', 'bottom depth', 'water depth', 'fathom', 'how much water', 'deep is it'))
    return asstAnsDepth(t);
  // Compare two saved spots
  if (has('compare', ' vs ', 'versus', 'which is closer', 'which spot', 'better spot')) {
    const cmp = asstAnsCompareSpots(t); if (cmp) return cmp;
  }
  // Distance / bearing / trip time / fuel to a named spot (before knots — "25 knots" ≠ a knot!)
  if (has('distance to', 'how far', 'bearing to', 'how do i get to', 'fuel to', 'how much fuel',
    'how long to', 'time to get to', 'eta to', 'get to', 'and back', 'round trip')) {
    const d = asstAnsDistanceTo(t, ll);
    if (d) return d;
  }
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
  // Emergency
  if (has('emergency', 'mayday', 'sos', 'sinking', 'help me', 'man overboard', 'distress', 'pan-pan', 'pan pan'))
    return asstAnsEmergency(ll);
  // Bare saved-spot name → distance/bearing
  if (typeof Spots !== 'undefined' && ll && Spots.all.length) {
    const spot = Spots.all.find((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
    if (spot) {
      const here = L.latLng(ll.lat, ll.lng), there = L.latLng(spot.lat, spot.lng);
      const nm = nmBetween(here, there), brg = bearingBetween(here, there);
      return '➡️ ' + spot.name + ': ' + nm.toFixed(1) + ' nm, bearing ' + Math.round(brg) + '° ' + asstCompass(brg);
    }
  }
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
  const hrs = (a.sun.sunset - a.sun.sunrise) / 3600000;
  return "☀️ Today:\nSunrise " + asstTime(a.sun.sunrise) + "\nSunset  " + asstTime(a.sun.sunset) +
    "\nSolar noon " + asstTime(a.sun.solarNoon) + "\nDaylight: " + hrs.toFixed(1) + " hrs";
}
function asstAnsMoon(ll) {
  const a = asstAstro(ll);
  if (!a) return "I need a position to compute moon times.";
  return "🌙 " + a.phaseName + " — " + a.lit + "% illuminated" +
    (a.moonT.rise ? "\nMoonrise " + asstTime(a.moonT.rise) : '') +
    (a.moonT.set ? "\nMoonset  " + asstTime(a.moonT.set) : '') +
    "\n\nNew and full moons drive the biggest tides and strongest solunar bite.";
}
function asstAnsWeather(q) {
  // Prefer a downloaded area pack (multi-day forecast, works offline & supports "tomorrow")
  const a = asstAreaPack();
  if (a && a.data && a.data.forecast) {
    const when = asstParseWhen((q || '').toLowerCase());
    const d = a.data, i = areaFcstIndex(d.forecast, when.ms);
    if (i >= 0) {
      const f = d.forecast;
      let s = '🌤 ' + when.label + ' — ' + a.name + ' (downloaded ' + asstAgo(d.capturedTs) + '):\n' +
        'Wind ' + Math.round(f.wind[i]) + ' kn ' + asstCompass(f.dir[i]) + ', gust ' + Math.round(f.gust[i]) + ' kn\n' +
        'Air ' + Math.round(f.temp[i]) + '°F' + (f.precip[i] != null ? ', ' + f.precip[i] + '% rain' : '');
      if (d.marine) {
        const mi = areaFcstIndex(d.marine, when.ms);
        if (mi >= 0 && d.marine.wave_m[mi] != null) s += '\nSeas ' + (d.marine.wave_m[mi] * 3.28084).toFixed(1) + ' ft @ ' + Math.round(d.marine.period[mi]) + 's';
        if (mi >= 0 && d.marine.sst[mi] != null) s += '\nWater ' + Math.round(d.marine.sst[mi]) + '°F';
      }
      const g = Math.round(f.gust[i]);
      if (g >= 25) s += '\n\n⚠️ ' + g + ' kn gusts — rough.';
      else if (g >= 18) s += '\n\nBreezy — expect a chop.';
      return s;
    }
  }
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
function asstAnsTides(q) {
  const a = asstAreaPack();
  if (a && a.data && a.data.tides && a.data.tides.preds && a.data.tides.preds.length) {
    const t = (q || '').toLowerCase();
    const when = asstParseWhen(t);
    const day = asstYmd(new Date(when.ms));   // local date — tide preds are station-local, not UTC
    let show;
    if (/tomorrow|tonight|today|this /.test(t)) {
      show = a.data.tides.preds.filter((p) => p.t.slice(0, 10) === day)
        .map((p) => ({ time: p.t.slice(11, 16), type: p.type === 'H' ? 'High' : 'Low', ft: p.v }));
    } else {
      show = areaTidesNext(a.data, Date.now(), 4);
    }
    if (!show.length) show = areaTidesNext(a.data, when.ms, 4);
    const lines = show.map((p) => (p.type === 'High' ? '🔼 High' : '🔽 Low') + '  ' + p.time + '   ' + p.ft + ' ft');
    return '🌊 Tides — ' + a.data.tides.station + ' (' + when.label + ', downloaded ' + asstAgo(a.data.capturedTs) + '):\n' + lines.join('\n');
  }
  return "I don't have tide predictions offline for here. Download this area while online — it now captures a week of tides — or open the 🌙 Tides panel with signal.";
}
function asstAnsFishHistory() {
  const a = asstAreaPack();
  if (a && a.data && a.data.fish && a.data.fish.total) {
    const top = Object.entries(a.data.fish.tally).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => k + ' ×' + v).join(', ');
    const recent = (a.data.fish.recent || []).slice(0, 6).map((r) => '• ' + r.species + ' (' + r.date + ')').join('\n');
    return '🐟 Reported in this area (iNaturalist, downloaded ' + asstAgo(a.data.capturedTs) + ' · ' + a.data.fish.total + ' records):\nTop: ' + top +
      (recent ? '\n\nRecent:\n' + recent : '') + '\n\n(Community sightings — divers & anglers, not all rod-and-reel.)';
  }
  return "No local fish-sighting data offline. Turn on the 🐟 layer with signal, or download this area — it captures recent sightings.";
}
function asstAnsClosures() {
  const a = asstAreaPack();
  if (a && a.data && a.data.mpas) {
    if (!a.data.mpas.length) return "No marine protected areas were captured inside this downloaded area — but always confirm with CDFW before fishing near a closure.";
    const lines = a.data.mpas.slice(0, 12).map((m) => '• ' + m.n + (m.t ? ' [' + m.t + ']' : '')).join('\n');
    return '🚫 Protected areas in this download:\n' + lines + '\n\n⚠️ Boundaries are approximate — confirm exact lines & take rules with CDFW before fishing.';
  }
  return "No closure data captured offline here. The 🚫 MPA layer is bundled — turn it on in Layers, or download this area so I can summarize closures offline.";
}
function asstYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* Synthesized offline planner: rank the next few days by bite (solunar overlapping
   daylight) + weather (from the downloaded area pack, if any). */
function asstAnsPlan() {
  const { ll } = asstPos();
  if (!ll || typeof Astro === 'undefined') return "I need a position to plan bite times.";
  const a = asstAreaPack();
  const daily = (a && a.data) ? areaDailyForecast(a.data) : null;
  const nDays = daily ? Math.min(daily.length, 5) : 3;
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const date = new Date(); date.setDate(date.getDate() + i); date.setHours(12, 0, 0, 0);
    const sun = Astro.sunTimes(date, ll.lat, ll.lng);
    const sol = Astro.solunar(date, ll.lat, ll.lng) || [];
    let best = null;
    sol.forEach((p) => {
      if (p.type !== 'major') return;
      const inDay = p.end >= sun.sunrise && p.start <= sun.sunset;
      const near = Math.min(Math.abs(p.center - sun.sunrise), Math.abs(p.center - sun.sunset)) < 90 * 60000;
      const score = (inDay ? 2 : 0) + (near ? 1 : 0);
      if (!best || score > best.score) best = { p, score, inDay, near };
    });
    const wx = daily ? daily.find((d) => d.date === asstYmd(date)) : null;
    let s = 0;
    if (best) s += best.inDay ? 3 : 1;
    if (best && best.near) s += 1;
    if (wx) {
      if (wx.wind_kn[1] <= 12) s += 2; else if (wx.wind_kn[1] <= 18) s += 1; else s -= 1;
      if (wx.wave_ft != null) { if (wx.wave_ft <= 2) s += 1; else if (wx.wave_ft >= 5) s -= 1; }
      if (wx.precip_pct <= 20) s += 0.5;
    }
    days.push({ date, best, wx, s });
  }
  days.sort((x, y) => y.s - x.s);
  const lines = days.slice(0, 3).map((d, idx) => {
    const wd = d.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    let line = (idx === 0 ? '⭐ ' : '• ') + wd;
    if (d.best) line += ' — bite ' + asstTime(d.best.p.start) + '–' + asstTime(d.best.p.end) +
      (d.best.inDay ? (d.best.near ? ' (near sunrise/sunset 🔥)' : '') : ' (after dark)');
    if (d.wx) line += '\n   wind ' + d.wx.wind_kn[0] + '–' + d.wx.wind_kn[1] + 'kn' +
      (d.wx.wave_ft != null ? ', seas ' + d.wx.wave_ft + 'ft' : '') + ', ' + d.wx.precip_pct + '% rain';
    return line;
  });
  return '🎣 Best days to fish' + (daily ? ' (bite + weather, downloaded ' + asstAgo(a.data.capturedTs) + ')' : ' (bite windows only)') + ':\n' +
    lines.join('\n') + (daily ? '' : '\n\nDownload this area while online and I can factor in wind & seas too.');
}

/* Multi-day weather outlook from the downloaded pack. */
function asstAnsOutlook() {
  const a = asstAreaPack();
  if (!a || !a.data || !a.data.forecast) return "I don't have a multi-day forecast offline here. Download this area while online to capture a 7-day outlook.";
  const daily = areaDailyForecast(a.data);
  const lines = daily.slice(0, 7).map((d) => {
    const dt = new Date(d.date + 'T12:00');
    const wd = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return wd + ': wind ' + d.wind_kn[0] + '–' + d.wind_kn[1] + 'kn (g' + d.gust_kn + ')' +
      (d.wave_ft != null ? ', seas ' + d.wave_ft + 'ft' : '') + ', ' + d.air_f[0] + '–' + d.air_f[1] + '°F, ' + d.precip_pct + '% rain';
  });
  return '📅 ' + a.name + ' — ' + lines.length + '-day outlook (downloaded ' + asstAgo(a.data.capturedTs) + '):\n' + lines.join('\n');
}

/* Plain go/no-go read on current wind + seas (with a safety caveat). */
function asstAnsGoNoGo() {
  let wind, gust, wave, src;
  const a = asstAreaPack();
  if (a && a.data && a.data.forecast) {
    const i = areaFcstIndex(a.data.forecast, Date.now());
    if (i >= 0) {
      wind = a.data.forecast.wind[i]; gust = a.data.forecast.gust[i];
      if (a.data.marine) { const mi = areaFcstIndex(a.data.marine, Date.now()); if (mi >= 0 && a.data.marine.wave_m[mi] != null) wave = a.data.marine.wave_m[mi] * 3.28084; }
      src = 'downloaded ' + asstAgo(a.data.capturedTs);
    }
  }
  if (wind == null) {
    const wx = asstCachedWx();
    if (wx && wx.wx && wx.wx.current) {
      wind = wx.wx.current.wind_speed_10m; gust = wx.wx.current.wind_gusts_10m;
      if (wx.marine && wx.marine.current) wave = wx.marine.current.wave_height * 3.28084;
      src = 'cached ' + asstAgo(wx.ts);
    }
  }
  if (wind == null) return "I don't have wind/sea data offline right now. Download this area or open 🌤 Weather with signal.";
  const g = Math.round(gust), w = wave != null ? wave : null;
  let emoji, verdict;
  if (g >= 25 || (w != null && w >= 6)) { emoji = '⛔'; verdict = 'Rough — think hard before going. Small boats should probably stay in.'; }
  else if (g >= 18 || (w != null && w >= 4)) { emoji = '⚠️'; verdict = 'Marginal — doable in the right boat, but expect a bumpy, wet ride.'; }
  else if (g >= 12 || (w != null && w >= 2.5)) { emoji = '🟡'; verdict = 'A little chop, but generally fishable.'; }
  else { emoji = '✅'; verdict = 'Looks calm and fishable.'; }
  return emoji + ' ' + verdict + '\nWind ~' + Math.round(wind) + ' kn (gust ' + g + ')' + (w != null ? ', seas ~' + w.toFixed(1) + ' ft' : '') + ' (' + src + ').' +
    '\n\n⚠️ Rough read only — always get an official marine forecast (VHF WX / NOAA) before you head out.';
}

/* Nearest saved spot of a given type (ramp, anchorage, hazard, wreck). */
function asstAnsNearest(t) {
  let type = null, label = '';
  if (/ramp|launch|boat ?ramp|put.?in/.test(t)) { type = 'ramp'; label = 'ramp/dock'; }
  else if (/anchorage|anchor spot|place to anchor/.test(t)) { type = 'anchor'; label = 'anchorage'; }
  else if (/hazard|danger/.test(t)) { type = 'hazard'; label = 'hazard'; }
  else if (/wreck/.test(t)) { type = 'wreck'; label = 'wreck'; }
  if (!type) return null;
  const list = (typeof Spots !== 'undefined' ? Spots.all : []).filter((s) => s.type === type);
  if (!list.length) return 'You have no saved ' + label + 's yet. Drop one by saying "mark this as a ' + type + ' named …".';
  const { ll } = asstPos();
  if (!ll) return 'You have ' + list.length + ' saved ' + label + '(s), but I need a GPS fix to sort by distance.';
  const sorted = list.map((s) => ({ s, nm: nmBetween(ll, L.latLng(s.lat, s.lng)), brg: bearingBetween(ll, L.latLng(s.lat, s.lng)) }))
    .sort((a, b) => a.nm - b.nm).slice(0, 3);
  return 'Nearest ' + label + ':\n' + sorted.map((x, i) => (i + 1) + '. ' + x.s.name + ' — ' + x.nm.toFixed(1) + ' nm ' + asstCompass(x.brg)).join('\n');
}

/* What bait/lure has worked for a species, from your own catch log. */
function asstAnsBait(t) {
  const sp = asstFindSpecies(t);
  if (!sp || typeof Catch === 'undefined' || !Catch.all.length) return null;
  // match logged catches on ANY significant word of the species name — its first word is
  // often a generic qualifier ("California"/"Pacific"/"Kelp"), so split(' ')[0] missed the popular targets
  const nameWords = sp.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const matches = Catch.all.filter((c) => c.species && c.bait && nameWords.some((w) => c.species.toLowerCase().includes(w)));
  if (!matches.length) return null;
  const tally = {};
  matches.forEach((c) => { const b = c.bait.trim(); tally[b] = (tally[b] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b, n]) => b + ' ×' + n);
  return '🎣 From your catch log, ' + matches[0].species + ' have hit: ' + top.join(', ') + '.';
}

function asstAnsWaterTemp() {
  const a = asstAreaPack();
  if (a && a.data && typeof areaSstStats === 'function') {
    const st = areaSstStats(a.data);
    if (st) return "🌡️ Water temp in " + a.name + " (downloaded " + asstAgo(a.data.capturedTs) + "):\n" +
      "About " + st.avg + "°F, ranging " + st.min + "–" + st.max + "°F across the area" +
      (st.span >= 2 ? ".\nWarmest water (a break to try) is near " + st.warmest.lat.toFixed(3) + ", " + st.warmest.lng.toFixed(3) + " (" + st.max + "°F)." : ".");
  }
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
  // Speed: "at 25 kn/mph" in the query → Nav route-speed input → live GPS → 20 kn default
  let sp = null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kn|knots?|kt|mph)/);
  if (m) { sp = parseFloat(m[1]); if (/mph/.test(m[2])) sp = sp / 1.15078; }
  if (sp == null) { const rs = parseFloat((document.getElementById('route-speed') || {}).value); if (rs > 0) sp = rs; }
  if (sp == null) { const g = asstSpeedKn(); if (g && g > 1) sp = g; }
  if (sp == null) sp = 20;
  const gph = parseFloat((document.getElementById('route-gph') || {}).value) || 8;
  const roundTrip = /back|round|return/.test(t);
  const legMin = nm / sp * 60, fuel = nm / sp * gph;
  let s = '➡️ ' + spot.name + ': ' + nm.toFixed(1) + ' nm, bearing ' + Math.round(brg) + '° ' + asstCompass(brg) +
    '\nAt ' + Math.round(sp) + ' kn: ~' + Math.round(legMin) + ' min one way, ~' + fuel.toFixed(1) + ' gal';
  if (roundTrip) s += '\n↩️ Round trip: ' + (nm * 2).toFixed(1) + ' nm, ~' + Math.round(legMin * 2) + ' min, ~' + (fuel * 2).toFixed(1) + ' gal';
  s += '\n(Assumes ' + gph + ' gal/hr — set speed & GPH in 🧭 Nav Tools.)';
  return s;
}
function asstAnsDepth(t) {
  const a = asstAreaPack();
  if (!a || !a.data || !a.data.depthGrid || !a.data.depthGrid.length)
    return "I don't have depth data offline here. Tap the water with signal (depth shows in the popup), or download this area — it now captures a depth grid.";
  let ll = asstPos().ll, where = 'here';
  const spot = (typeof Spots !== 'undefined' ? Spots.all : []).find((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
  if (spot) { ll = L.latLng(spot.lat, spot.lng); where = spot.name; }
  if (!ll) return "I need a position (or a saved spot name) to read depth.";
  const p = areaDepthAt(a.data, ll);
  if (!p) return "No depth was captured near " + where + ".";
  if (p.land) return "That point (" + where + ") reads as land on the survey grid.";
  return "⚓ Depth " + where + ": about " + p.ft + " ft (" + Math.round(p.ft / 6) + " fathoms) — nearest point in a coarse grid, downloaded " + asstAgo(a.data.capturedTs) + ".\nTap the chart with signal for an exact sounding.";
}
function asstAnsCompareSpots(t) {
  if (typeof Spots === 'undefined' || Spots.all.length < 2) return null;
  const found = Spots.all.filter((s) => s.name && s.name.length > 2 && t.includes(s.name.toLowerCase()));
  if (found.length < 2) return null;
  const { ll } = asstPos();
  const sp = asstSpeedKn() || parseFloat((document.getElementById('route-speed') || {}).value) || 20;
  const rows = found.slice(0, 3).map((s) => {
    let line = '📍 ' + s.name + ' [' + s.type + ']';
    if (ll) {
      const there = L.latLng(s.lat, s.lng), here = L.latLng(ll.lat, ll.lng);
      const nm = nmBetween(here, there);
      line += ' — ' + nm.toFixed(1) + ' nm ' + asstCompass(bearingBetween(here, there)) +
        (sp > 0 ? ', ~' + Math.round(nm / sp * 60) + ' min' : '');
    }
    if (s.notes) line += '\n   ' + s.notes;
    return line;
  });
  let head = 'Comparing ' + found.slice(0, 3).map((s) => s.name).join(' vs ') + ':';
  if (ll) {
    const here = L.latLng(ll.lat, ll.lng);
    const closest = found.slice().sort((a, b) => nmBetween(here, L.latLng(a.lat, a.lng)) - nmBetween(here, L.latLng(b.lat, b.lng)))[0];
    head += '\nClosest to you: ' + closest.name + '.';
  }
  return head + '\n\n' + rows.join('\n');
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
  // drop generic terms — every knot NAME contains "Knot", so the bare token "knot" would
  // match the first entry (Palomar) for any knot query. Keep only distinctive words.
  const stop = ['knot', 'knots', 'tie', 'line', 'hook', 'lure', 'rig', 'best', 'good', 'the', 'for', 'how', 'what'];
  const words = t.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && stop.indexOf(w) < 0);
  return KNOTS.find((k) => t.includes(k.name.toLowerCase())) ||
    KNOTS.find((k) => words.some((w) => k.name.toLowerCase().includes(w))) || null;
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
  return "🎣 I'm First Mate. Even with NO signal or key, I can tell you:\n" +
    "• Best day/time to fish (bite + weather) & the week's outlook\n" +
    "• Is it too rough to go out? (go/no-go read)\n" +
    "• Tides, sunrise/sunset, moon phase, solunar bite windows\n" +
    "• Weather for now or 'tomorrow afternoon', wind, seas, water temp & breaks\n" +
    "• Your position, speed, heading; nearest reef / ramp / anchorage / spot\n" +
    "• What's been caught here & what bait worked (from your log)\n" +
    "• Fish size/bag limits, closures, knots, Mayday info\n" +
    "• Drop & name a waypoint\n\n" +
    "(Tides, multi-day weather & fish history need the area downloaded first.) Add an API key in ⚙️ and, with signal, I'll also chat freely and take actions.";
}

/* ---- Local waypoint action (used offline AND by the online place_waypoint tool) ---- */
async function asstCreateSpot(o) {
  const spot = { lat: o.lat, lng: o.lng, name: o.name, type: o.type || 'fish', notes: o.notes || '', ts: Date.now() };
  const id = await idb.put('spots', spot);
  spot.id = spot.id || id;
  Spots.all.push(spot);
  addSpotMarker(spot);
  renderSpotsList();
  return spot;
}
function asstParseWaypointName(q) {
  let m = q.match(/["“']([^"”']{1,40})["”']/);
  if (m) return m[1].trim();
  m = q.match(/(?:name(?:d| it)?|call(?:ed)?(?: it)?|label(?:ed)?(?: it)?)\s+([\w '&.\-]{1,40})/i);
  if (m) return m[1].trim().replace(/[.,!?]+$/, '');
  return null;
}
function asstOfflinePlaceWaypoint(q) {
  const { ll, live } = asstPos();
  if (!ll) return "I can't drop a waypoint without a position — I need a GPS fix (or pan the map there first).";
  const t = q.toLowerCase();
  const name = asstParseWaypointName(q) || ('Waypoint ' + ((typeof Spots !== 'undefined' ? Spots.all.length : 0) + 1));
  let type = 'fish';
  if (t.includes('anchor')) type = 'anchor';
  else if (t.includes('hazard') || t.includes('danger') || t.includes('rock')) type = 'hazard';
  else if (t.includes('wreck') || t.includes('structure')) type = 'wreck';
  else if (t.includes('ramp') || t.includes('dock')) type = 'ramp';
  asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: type })
    .then(() => { if (typeof toast === 'function') toast('📌 ' + name + ' saved'); });
  return '📌 Dropped "' + name + '" (' + type + ') at ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) +
    (live ? '' : ' (map center — no GPS fix yet)') + '.\nSaved and on the map. Open ☰ Spots to rename or remove it.';
}

/* ================= ONLINE brain (Claude) ================= */
function asstSystemPrompt() {
  return [
    "You are First Mate, a calm, concise assistant built into an offline marine navigation app for a recreational boater and angler.",
    "You have the user's LIVE boat data below — use it. Prefer it over guessing. Units: distances in nautical miles, speed in knots, temps in °F, depths/heights in feet.",
    "Be practical and brief — this is read on a phone on a boat. Lead with the answer. Use short lines. Only elaborate when asked.",
    "Safety first: for anything life-threatening, tell them to use VHF Ch 16 / call the Coast Guard and point to the app's 🆘 button. Never give false confidence about weather or conditions.",
    "Fishing regulations you cite are general reference — always tell them to confirm current limits with the state wildlife agency (CDFW in California) before keeping fish.",
    "You can take real actions in the app via tools: place / list / delete waypoints, toggle map layers, start or stop trip tracking, center the map, and pull LIVE weather & tides for a point. For current weather, seas, water temp or tides, CALL get_conditions / get_tides — don't answer those from the cached snapshot alone. Default every location to the boat's current position unless the user gives coordinates or names a saved spot. After acting, confirm briefly and naturally what you did.",
    "If the user is offline (get_conditions / get_tides can't reach the network) or asks about a downloaded area, call get_area_intel — it reads the offline data pack captured when the area was downloaded (multi-day forecast, a week of tides, water-temp grid, fish-sighting history, closures). Always mention when the data was captured so they know its age.",
    "Catch logging and knots aren't automated yet — for those, point them to the 🧭 and 📖 buttons.",
    "",
    asstSnapshot(),
    "",
    asstRegsTable(),
  ].join('\n');
}

async function asstApiCall(messages) {
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
      tools: asstTools(),
      messages,
    }),
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
    const err = new Error(msg); err.status = resp.status; throw err;
  }
  return resp.json();
}

/* Agentic loop: let Claude answer, or call tools (which act on the app / fetch
   live data), feed results back, and repeat until it produces a final answer. */
async function asstAskOnline(userText, botEl) {
  const messages = ASST.history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });

  let finalText = '';
  for (let step = 0; step < 6; step++) {
    const data = await asstApiCall(messages);
    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const b of data.content) {
        if (b.type !== 'tool_use') continue;
        botEl.textContent = '⚙️ ' + asstToolLabel(b.name) + '…';
        asstScroll();
        const out = await asstExecTool(b.name, b.input || {});
        results.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
          is_error: !!(out && out.error),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    finalText = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    break;
  }
  return finalText || '(no reply)';
}

function asstToolLabel(n) {
  return {
    get_conditions: 'checking conditions', get_tides: 'checking tides',
    place_waypoint: 'placing waypoint', list_waypoints: 'reading waypoints',
    delete_waypoint: 'removing waypoint', toggle_layer: 'toggling layer',
    set_trip: 'updating trip', go_to: 'centering the map',
    get_area_intel: 'reading offline area data',
  }[n] || 'working';
}

function asstToolAreaIntel(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position' };
  const a = (typeof areaPackFor === 'function') ? areaPackFor(ll) : null;
  if (!a || !a.data) return { error: 'no downloaded area pack covers this location — the user can download this area (📊) while online to capture its data.' };
  return areaPackSummary(a);
}

/* ---- Tool schemas handed to Claude ---- */
function asstTools() {
  return [
    { name: 'get_conditions', description: 'Live marine weather at a point: wind, gusts, air temp, wave height/period/direction, and sea-surface water temp. Defaults to the boat\'s current position.',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
    { name: 'get_tides', description: 'Today\'s high/low tide predictions for the nearest tide station (or a given point).',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
    { name: 'place_waypoint', description: 'Drop and save a named waypoint/spot on the map. Defaults to the boat\'s current position unless lat/lng are given.',
      input_schema: { type: 'object', properties: {
        name: { type: 'string', description: 'Waypoint name' },
        type: { type: 'string', enum: ['fish', 'anchor', 'hazard', 'ramp', 'wreck', 'other'], description: 'Marker type (default fish)' },
        notes: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['name'] } },
    { name: 'list_waypoints', description: 'List the user\'s saved waypoints with distance & bearing from the boat.',
      input_schema: { type: 'object', properties: {} } },
    { name: 'delete_waypoint', description: 'Delete a saved waypoint by (partial) name.',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'toggle_layer', description: 'Turn a map overlay on or off.',
      input_schema: { type: 'object', properties: {
        layer: { type: 'string', enum: ['sst', 'rain', 'wind', 'reefs', 'mpa', 'fish'], description: 'sst=water temp, rain=radar, wind=wind arrows, reefs=artificial reefs, mpa=protected areas, fish=recent catches' },
        on: { type: 'boolean' } }, required: ['layer', 'on'] } },
    { name: 'set_trip', description: 'Start or stop trip tracking (distance, average & max speed).',
      input_schema: { type: 'object', properties: { active: { type: 'boolean' }, reset: { type: 'boolean' } }, required: ['active'] } },
    { name: 'go_to', description: 'Center the map on the boat, a named saved spot, or coordinates.',
      input_schema: { type: 'object', properties: { spot: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } },
    { name: 'get_area_intel', description: 'Read the OFFLINE data pack for a downloaded area covering a point (default current position): multi-day wind/wave/tide/water-temp forecast, a sea-temp grid (warmest/coolest water), recent fish-sighting history, and protected-area closures — all captured when the area was downloaded. Use this for area questions when offline, for a multi-day outlook, or for historical fish patterns and closures.',
      input_schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  ];
}

function asstPointFrom(input) {
  if (input && input.lat != null && input.lng != null && typeof L !== 'undefined') return L.latLng(input.lat, input.lng);
  return asstPos().ll;
}

async function asstExecTool(name, input) {
  try {
    switch (name) {
      case 'get_conditions': return await asstToolConditions(input);
      case 'get_tides': return await asstToolTides(input);
      case 'place_waypoint': return await asstToolPlaceWaypoint(input);
      case 'list_waypoints': return asstToolListWaypoints();
      case 'delete_waypoint': return await asstToolDeleteWaypoint(input);
      case 'toggle_layer': return asstToolToggleLayer(input);
      case 'set_trip': return asstToolSetTrip(input);
      case 'go_to': return asstToolGoTo(input);
      case 'get_area_intel': return asstToolAreaIntel(input);
      default: return { error: 'unknown tool ' + name };
    }
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

async function asstToolConditions(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position — provide lat and lng' };
  const lat = ll.lat, lng = ll.lng;
  const out = { position: lat.toFixed(4) + ', ' + lng.toFixed(4) };
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=kn&temperature_unit=fahrenheit');
    const c = (await r.json()).current || {};
    out.wind_kn = Math.round(c.wind_speed_10m);
    out.gust_kn = Math.round(c.wind_gusts_10m);
    out.wind_from = asstCompass(c.wind_direction_10m) + ' (' + Math.round(c.wind_direction_10m) + '°)';
    out.air_temp_f = Math.round(c.temperature_2m);
  } catch (e) { out.wind = 'unavailable (offline?)'; }
  try {
    const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lng +
      '&current=wave_height,wave_period,wave_direction,sea_surface_temperature&temperature_unit=fahrenheit');
    const c = (await r.json()).current || {};
    if (c.wave_height != null) {
      out.wave_ft = +(c.wave_height * 3.28084).toFixed(1);
      out.wave_period_s = Math.round(c.wave_period);
      out.wave_from = asstCompass(c.wave_direction);
    }
    if (c.sea_surface_temperature != null) out.water_temp_f = Math.round(c.sea_surface_temperature);
  } catch (e) { /* marine may be unavailable inland */ }
  return out;
}

async function asstToolTides(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position' };
  if (typeof nearestTideStation !== 'function') return { error: 'tides unavailable' };
  const st = nearestTideStation(ll);
  if (!st) return { error: 'no tide station found' };
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  try {
    const r = await fetch('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo&datum=MLLW&units=english&time_zone=lst_ldt&format=json&station=' +
      st.id + '&begin_date=' + ymd + '&end_date=' + ymd);
    const preds = ((await r.json()).predictions || []).map((p) => ({
      time: p.t.split(' ')[1], type: p.type === 'H' ? 'High' : 'Low', height_ft: +parseFloat(p.v).toFixed(1),
    }));
    const nm = nmBetween(ll, L.latLng(st.la, st.lo));
    return { station: st.n, distance_nm: +nm.toFixed(0), today: preds };
  } catch (e) { return { station: st.n, error: 'could not fetch tide predictions' }; }
}

async function asstToolPlaceWaypoint(input) {
  const ll = asstPointFrom(input);
  if (!ll) return { error: 'no position available — provide lat and lng' };
  const name = (input.name || '').trim();
  if (!name) return { error: 'name is required' };
  const spot = await asstCreateSpot({ lat: ll.lat, lng: ll.lng, name: name, type: input.type || 'fish', notes: input.notes || '' });
  if (typeof toast === 'function') toast('📌 ' + name + ' saved');
  return { ok: true, name: name, type: spot.type, lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5) };
}

function asstToolListWaypoints() {
  if (typeof Spots === 'undefined' || !Spots.all.length) return { waypoints: [] };
  const p = asstPos().ll;
  return { waypoints: Spots.all.map((s) => {
    const o = { name: s.name, type: s.type, lat: +s.lat.toFixed(5), lng: +s.lng.toFixed(5) };
    if (s.notes) o.notes = s.notes;
    if (p) { o.nm = +nmBetween(p, L.latLng(s.lat, s.lng)).toFixed(2); o.bearing = Math.round(bearingBetween(p, L.latLng(s.lat, s.lng))); }
    return o;
  }) };
}

async function asstToolDeleteWaypoint(input) {
  const q = (input.name || '').toLowerCase().trim();
  if (!q) return { error: 'name required' };
  if (typeof Spots === 'undefined') return { error: 'spots unavailable' };
  const matches = Spots.all.filter((s) => s.name && s.name.toLowerCase().includes(q));
  if (!matches.length) return { error: 'no waypoint matching "' + input.name + '"' };
  const s = matches[0];
  await deleteSpot(s.id);
  if (typeof toast === 'function') toast('🗑 ' + s.name + ' deleted');
  return { deleted: s.name, other_matches: matches.length - 1 };
}

function asstToolToggleLayer(input) {
  const map = { sst: 'ovl-sst', rain: 'ovl-rain', wind: 'ovl-wind', reefs: 'ovl-reefs', mpa: 'ovl-mpa', fish: 'ovl-fish' };
  const cb = document.getElementById(map[input.layer]);
  if (!cb) return { error: 'unknown layer "' + input.layer + '"' };
  const want = !!input.on;
  if (cb.checked !== want) { cb.checked = want; cb.dispatchEvent(new Event('change')); }
  return { layer: input.layer, on: want };
}

function asstToolSetTrip(input) {
  if (typeof Nav === 'undefined' || !Nav.trip || typeof tripToggle !== 'function') return { error: 'trip tracking unavailable' };
  const want = !!input.active;
  if (want && !Nav.trip.active) tripToggle();
  else if (!want && Nav.trip.active) tripToggle();
  if (input.reset && typeof tripReset === 'function') tripReset();
  const avg = Nav.trip.nKn ? (Nav.trip.sumKn / Nav.trip.nKn) : 0;
  return { trip_active: Nav.trip.active, distance_nm: +Nav.trip.dist.toFixed(2), avg_kn: +avg.toFixed(1), max_kn: +Nav.trip.maxKn.toFixed(1) };
}

function asstToolGoTo(input) {
  if (!window._map) return { error: 'map unavailable' };
  let ll = null, label = '';
  if (input.lat != null && input.lng != null) { ll = L.latLng(input.lat, input.lng); label = 'coordinates'; }
  else if (input.spot && typeof Spots !== 'undefined') {
    const s = Spots.all.find((x) => x.name && x.name.toLowerCase().includes(String(input.spot).toLowerCase()));
    if (!s) return { error: 'no saved spot matching "' + input.spot + '"' };
    ll = L.latLng(s.lat, s.lng); label = s.name;
  } else { const p = asstPos(); if (p.ll) { ll = p.ll; label = 'your position'; } }
  if (!ll) return { error: 'no target to center on' };
  if (typeof setFollow === 'function') setFollow(false);
  window._map.setView(ll, Math.max(window._map.getZoom(), 14));
  return { centered_on: label };
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
/* ---- Voice: speak answers (TTS, works offline incl. iPhone) + voice input (STT) ---- */
function asstStripForSpeech(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}️⃣]/gu, ' ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function asstSpeak(text) {
  if (!ASST.speak || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const clean = asstStripForSpeech(text).slice(0, 700);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US'; u.rate = 1; u.pitch = 1;
    if (ASST._voice) u.voice = ASST._voice;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
function asstPickVoice() {
  if (!('speechSynthesis' in window)) return;
  const pick = () => {
    const vs = window.speechSynthesis.getVoices() || [];
    ASST._voice =
      vs.find((v) => /en[-_]US/i.test(v.lang) && /samantha|aaron|natural|enhanced|siri/i.test(v.name)) ||
      vs.find((v) => /en[-_]US/i.test(v.lang)) ||
      vs.find((v) => /^en/i.test(v.lang)) || null;
  };
  pick();
  window.speechSynthesis.onvoiceschanged = pick;
}
function asstUpdateSpeakBtn() {
  const b = document.getElementById('asst-speak');
  if (!b) return;
  b.textContent = ASST.speak ? '🔊' : '🔇';
  b.classList.toggle('on', ASST.speak);
  b.title = ASST.speak ? 'Voice on — tap to mute' : 'Read answers aloud';
}
function asstToggleSpeak() {
  ASST.speak = !ASST.speak;
  localStorage.setItem('fishapp.asst.speak', ASST.speak ? '1' : '0');
  asstUpdateSpeakBtn();
  if (!ASST.speak) { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  else asstSpeak("Voice on. I'll read my answers aloud.");
}
function asstStartMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { if (typeof toast === 'function') toast("Voice input isn't supported here — tap the mic on your keyboard to talk"); return; }
  try {
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    const mic = document.getElementById('asst-mic');
    if (mic) mic.classList.add('listening');
    r.onresult = (e) => { const txt = e.results[0][0].transcript; if (txt) asstSend(txt); };
    r.onerror = (e) => { if (typeof toast === 'function') toast('Voice: ' + (e.error || 'error')); };
    r.onend = () => { if (mic) mic.classList.remove('listening'); };
    r.start();
  } catch (e) { if (typeof toast === 'function') toast('Voice input failed'); }
}

function asstSetStatus() {
  const el = document.getElementById('asst-status');
  if (!el) return;
  const hasKey = !!ASST.key();
  const online = navigator.onLine;
  let dot = 'warn', txt;
  if (online && hasKey) { dot = 'ok'; txt = 'Full AI chat · ' + asstModelLabel(); }
  else if (!online) { dot = 'ok'; txt = 'Offline — answering from your boat data 🧭'; }
  else { dot = 'ok'; txt = 'Data mode — add a key in ⚙️ for free-form chat'; }
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
      botEl.classList.remove('thinking');
      botEl.textContent = reply;
      asstScroll();
      asstSpeak(reply);
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
      asstSpeak(off);
    }
  } else {
    const botEl = asstAddMsg('bot', '');
    const ans = asstOffline(text);
    botEl.textContent = ans;
    asstScroll();
    asstSpeak(ans);
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
  'Best day to fish this week?', 'Is it too rough today?', "What's the weather where I am?",
  'Tides today', 'Drop a waypoint here', "What's been caught here?",
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
    asstAddMsg('bot', "Ahoy! I'm First Mate 🎣\nNo signal needed for most of what you'll ask — best days to fish, is it too rough, tides, weather outlook, water temp, reefs, fish limits, knots, or dropping a waypoint. With a key + signal I'll also chat freely and take actions. Tap a suggestion to start.");
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

  // voice: speak answers (TTS) + voice input (STT)
  ASST.speak = localStorage.getItem('fishapp.asst.speak') === '1';
  asstPickVoice();
  asstUpdateSpeakBtn();
  const speakBtn = document.getElementById('asst-speak');
  if (speakBtn) speakBtn.onclick = asstToggleSpeak;
  const micBtn = document.getElementById('asst-mic');
  if (micBtn) {
    if (window.SpeechRecognition || window.webkitSpeechRecognition) micBtn.onclick = asstStartMic;
    else micBtn.style.display = 'none';   // e.g. iOS Safari has no web speech recognition — use keyboard dictation
  }

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
