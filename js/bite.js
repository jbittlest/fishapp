/* Personal bite-pattern engine.

   Learns from YOUR catch log — not generic solunar tables — then scores upcoming hours
   against what has actually worked for you, and ranks the best windows to go.

   How it works:
     1. biteProfile()  — for each condition the catch log records, build a distribution from
                         your history. Dimensions where your catches cluster tightly (say the
                         water was 62-65F every time) get more weight than ones that are all
                         over the place (which carry no signal).
     2. biteCondAt()   — reconstruct the same condition set for a future hour from the cached
                         10-day forecast, tide predictions and astronomy.
     3. biteScore()    — compare the two, weighted by how predictive each dimension has been.
     4. biteWindows()  — score every forecast hour, merge good neighbours into windows, rank.

   Deliberately simple statistics rather than a model: with a few dozen catches, anything
   fancier would be inventing confidence that isn't there. The engine reports its own sample
   size and refuses to pretend — see biteConfidence(). */
'use strict';

const Bite = {
  MIN_CATCHES: 4,             // below this we decline to predict at all
  TIDE_CACHE: 'fishapp.bite.tides',
};

/* Numeric dimensions: [key, tolerance, circularPeriod|null]. Tolerance is the "still counts
   as a match" half-width in that dimension's own units, used when history is too small to
   derive a spread. */
const BITE_NUM = [
  ['sst', 3, null],                 // water temp F — usually the strongest single signal
  ['windKn', 5, null],
  ['waveFt', 1.5, null],
  ['pressureHpa', 4, null],
  ['pressureTrend3h', 1.5, null],   // rising/falling matters more than absolute
  ['minsFromLightChange', 75, null],
  ['minsToTideChange', 90, null],
  ['tidePct', 25, null],
  ['cloudPct', 35, null],
  ['moonPhase', 0.12, 1],           // circular: 0.98 and 0.02 are adjacent
  ['windDir', 50, 360],             // circular degrees
];
const BITE_CAT = ['tide', 'solunar', 'lightPhase'];

/* ---- small stats helpers ---- */
function biteMedian(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function biteQuantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
/* Distance honouring circular dimensions (moon phase, compass bearing). */
function biteDist(a, b, period) {
  const d = Math.abs(a - b);
  return period ? Math.min(d, period - d) : d;
}

/* ---- 1. Learn a profile from a set of catches ---- */
function biteProfile(catches) {
  const prof = { n: catches.length, num: {}, cat: {} };
  BITE_NUM.forEach(([key, tol, period]) => {
    const vals = catches.map((c) => c.cond && c.cond[key]).filter((v) => typeof v === 'number' && !isNaN(v));
    if (vals.length < 3) return;                       // too thin to say anything
    const med = biteMedian(vals);
    const iqr = biteQuantile(vals, 0.75) - biteQuantile(vals, 0.25);
    /* Consistency = how tightly your catches cluster relative to the tolerance we'd accept
       anyway. Tight cluster → this dimension actually predicts something for you → weight up.
       Scattered → it's noise for you → weight down. This is what makes the profile personal
       rather than a set of rules someone else picked. */
    const spread = Math.max(iqr, tol * 0.35);
    const consistency = Math.max(0.15, Math.min(1, tol / spread));
    prof.num[key] = { med, iqr, tol, period, n: vals.length, weight: consistency };
  });
  BITE_CAT.forEach((key) => {
    const vals = catches.map((c) => c.cond && c.cond[key]).filter((v) => typeof v === 'string' && v);
    if (vals.length < 3) return;
    const counts = {};
    vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const share = counts[top] / vals.length;
    // A 50/50 split says nothing; a 5-of-6 lean says a lot.
    prof.cat[key] = { counts, top, share, n: vals.length, weight: Math.max(0, (share - 0.5) * 2) };
  });
  return prof;
}

/* ---- 2. Reconstruct conditions for a future moment ---- */
/* Pulls from the cached 10-day forecast (weather.js writes fishapp.fc10) plus astronomy,
   which is computed locally and therefore always available offline. */
function biteCondAt(ms, ll, fc, tideHiLo) {
  const cond = {};
  const when = new Date(ms);

  // --- astronomy: always available, no network ---
  try {
    const ill = Astro.moonIllumination(when);
    cond.moonPhase = +ill.phase.toFixed(3);
    const per = Astro.solunar(when, ll.lat, ll.lng);
    const act = per.find((p) => ms >= p.start && ms <= p.end);
    cond.solunar = act ? act.type : 'off';
    const st = Astro.sunTimes(when, ll.lat, ll.lng);
    if (st.sunrise && st.sunset) {
      const dSr = Math.round((ms - st.sunrise) / 60000);
      const dSs = Math.round((ms - st.sunset) / 60000);
      const nearest = Math.abs(dSr) <= Math.abs(dSs) ? dSr : dSs;
      cond.minsFromLightChange = nearest;
      cond.lightPhase = Math.abs(nearest) <= 60 ? (Math.abs(dSr) <= Math.abs(dSs) ? 'dawn' : 'dusk')
        : (dSr > 0 && dSs < 0 ? 'day' : 'night');
    }
  } catch (e) { /* astronomy is best-effort */ }

  // --- forecast: hourly arrays from the cached 10-day pack ---
  if (fc && fc.wx && fc.wx.hourly && fc.wx.hourly.time) {
    const h = fc.wx.hourly;
    const i = biteHourIdx(h.time, ms);
    if (i >= 0) {
      if (h.wind_speed_10m) cond.windKn = Math.round(h.wind_speed_10m[i]);
      if (h.wind_direction_10m) cond.windDir = Math.round(h.wind_direction_10m[i]);
      if (h.pressure_msl && h.pressure_msl[i] != null) {
        cond.pressureHpa = +h.pressure_msl[i].toFixed(1);
        const j = Math.max(0, i - 3);
        if (h.pressure_msl[j] != null) cond.pressureTrend3h = +(h.pressure_msl[i] - h.pressure_msl[j]).toFixed(1);
      }
      if (h.cloud_cover && h.cloud_cover[i] != null) cond.cloudPct = Math.round(h.cloud_cover[i]);
    }
    const mh = fc.marine && fc.marine.hourly;
    if (mh && mh.time) {
      const k = biteHourIdx(mh.time, ms);
      if (k >= 0) {
        if (mh.wave_height && mh.wave_height[k] != null) cond.waveFt = +(mh.wave_height[k] * MS_TO_FT).toFixed(1);
        if (mh.sea_surface_temperature && mh.sea_surface_temperature[k] != null) cond.sst = Math.round(mh.sea_surface_temperature[k]);
      }
    }
  }

  // --- tide state from cached hi/lo predictions ---
  if (tideHiLo && tideHiLo.length) {
    const next = tideHiLo.find((p) => p.t > ms);
    const prevs = tideHiLo.filter((p) => p.t <= ms);
    const prev = prevs.length ? prevs[prevs.length - 1] : null;
    if (next) {
      cond.tide = next.type === 'H' ? 'incoming' : 'outgoing';
      cond.minsToTideChange = Math.round((next.t - ms) / 60000);
      if (prev && next.t > prev.t) cond.tidePct = Math.round(((ms - prev.t) / (next.t - prev.t)) * 100);
    }
  }
  return cond;
}
/* Nearest hourly sample to a timestamp (forecast arrays are local-time ISO strings). */
function biteHourIdx(times, ms) {
  if (!times || !times.length) return -1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(new Date(times[i]).getTime() - ms);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= 90 * 60000 ? best : -1;   // don't match more than 90 min away
}

/* ---- 3. Score a candidate condition set against the learned profile ---- */
function biteScore(prof, cond) {
  let total = 0, weightSum = 0;
  const hits = [], misses = [];
  Object.keys(prof.num).forEach((key) => {
    const p = prof.num[key], v = cond[key];
    if (typeof v !== 'number' || isNaN(v)) return;
    const dist = biteDist(v, p.med, p.period);
    const tol = Math.max(p.tol, p.iqr || 0);
    // 1 inside tolerance, tapering to 0 at twice tolerance
    const s = dist <= tol ? 1 : Math.max(0, 1 - (dist - tol) / tol);
    total += s * p.weight; weightSum += p.weight;
    (s >= 0.65 ? hits : misses).push({ key, v, med: p.med, s, weight: p.weight });
  });
  Object.keys(prof.cat).forEach((key) => {
    const p = prof.cat[key], v = cond[key];
    if (typeof v !== 'string' || !v) return;
    const s = (p.counts[v] || 0) / p.n;
    total += s * p.weight; weightSum += p.weight;
    (v === p.top ? hits : misses).push({ key, v, top: p.top, s, weight: p.weight });
  });
  return {
    score: weightSum > 0 ? total / weightSum : 0,
    weightSum,
    hits: hits.sort((a, b) => b.weight * b.s - a.weight * a.s),
    misses: misses.sort((a, b) => b.weight - a.weight),
  };
}

/* ---- confidence, stated honestly ---- */
function biteConfidence(n) {
  if (n < Bite.MIN_CATCHES) return { level: 'none', label: 'not enough catches yet' };
  if (n < 8) return { level: 'very low', label: 'very low confidence — only ' + n + ' catches' };
  if (n < 15) return { level: 'low', label: 'low confidence — ' + n + ' catches' };
  if (n < 40) return { level: 'moderate', label: 'moderate confidence — ' + n + ' catches' };
  return { level: 'good', label: 'good confidence — ' + n + ' catches' };
}

/* ---- catch selection ---- */
function biteCatches(opts) {
  opts = opts || {};
  let all = (typeof Catch !== 'undefined' && Catch.all) ? Catch.all.slice() : [];
  if (opts.species) {
    const q = opts.species.toLowerCase();
    all = all.filter((c) => (c.species || '').toLowerCase().includes(q));
  }
  if (opts.near && opts.radiusNm) {
    all = all.filter((c) => {
      try { return nmBetween(L.latLng(c.lat, c.lng), opts.near) <= opts.radiusNm; } catch (e) { return false; }
    });
  }
  return all.filter((c) => c.cond);   // records without conditions teach us nothing
}

/* ---- tide predictions covering the forecast range (own cache; the display cache in
   tides.js only spans 2 days, which isn't enough to rank a 10-day outlook) ---- */
async function biteTides(ll) {
  const cached = readJSON(Bite.TIDE_CACHE, null);
  /* The fallbacks below used to return the cache with NO location check, so tides
     from a station 250 nm away could drive three of the eleven scored dimensions —
     and "40 min off the tide turn" was then given as a reason to fish here. */
  const nearEnough = cached && cached.hl &&
    Math.abs(cached.lat - ll.lat) < 0.5 && Math.abs(cached.lng - ll.lng) < 0.5;
  const fallback = nearEnough ? cached.hl : [];
  if (nearEnough && cached.ts && (Date.now() - cached.ts) < 12 * 3600000) return cached.hl;
  if (!navigator.onLine || typeof Tides === 'undefined' || !Tides.stations.length) return fallback;
  try {
    const st = nearestTideStation(ll);
    const now = new Date();
    const end = new Date(Date.now() + 11 * 86400000);
    const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=fishapp&datum=MLLW' +
      '&time_zone=lst_ldt&units=english&format=json&product=predictions&interval=hilo&station=' + st.id +
      '&begin_date=' + ymd(now) + '&end_date=' + ymd(end);
    const r = await fetch(url).then((x) => x.json());
    const hl = (r.predictions || []).map((p) => ({ t: new Date(p.t.replace(' ', 'T')).getTime(), type: p.type }));
    if (hl.length) localStorage.setItem(Bite.TIDE_CACHE, JSON.stringify({ hl, ts: Date.now(), lat: ll.lat, lng: ll.lng }));
    return hl;
  } catch (e) { return fallback; }
}

/* ---- 4. Rank upcoming windows ---- */
async function biteWindows(opts) {
  opts = opts || {};
  const ll = opts.at || (typeof GPS !== 'undefined' && GPS.lastLatLng) || (window._map && window._map.getCenter());
  if (!ll) return { error: 'no position' };

  const catches = biteCatches(opts);
  const conf = biteConfidence(catches.length);
  if (catches.length < Bite.MIN_CATCHES) {
    return { error: 'too few', n: catches.length, need: Bite.MIN_CATCHES, confidence: conf };
  }
  const prof = biteProfile(catches);
  if (!Object.keys(prof.num).length && !Object.keys(prof.cat).length) {
    return { error: 'no usable conditions', n: catches.length, confidence: conf };
  }

  /* Location- and age-checked, like the weather panel does. Reading the raw key meant
     that if you'd once tapped a distant spot on the map to peek at its forecast, that
     payload stayed in fishapp.fc10 — and the bite windows for HERE were then scored on
     the wind, pressure, cloud and SST of somewhere hundreds of miles away, under a
     confident percentage. */
  const fc = biteForecast(ll);
  const tideHiLo = await biteTides(ll);
  if (!fc) return { error: 'no forecast', confidence: conf };

  // Score each future hour out to the end of the forecast (cap ~7 days: beyond that the
  // forecast itself is model noise, as the 10-day tab already warns).
  // Snap to the next whole hour so windows read "5:00–9:00", not "5:10–9:10".
  const startMs = Math.ceil(Date.now() / 3600000) * 3600000;
  const endMs = startMs + (opts.days || 7) * 86400000;
  const hours = [];
  for (let ms = startMs; ms <= endMs; ms += 3600000) {
    const cond = biteCondAt(ms, ll, fc, tideHiLo);
    const sc = biteScore(prof, cond);
    if (sc.weightSum <= 0) continue;
    hours.push({ ms, score: sc.score, hits: sc.hits, misses: sc.misses, cond });
  }
  if (!hours.length) return { error: 'no forecast overlap', confidence: conf };

  // Merge runs of good hours into windows.
  const thresh = Math.max(0.55, biteQuantile(hours.map((h) => h.score), 0.8));
  const windows = [];
  let run = null;
  hours.forEach((h) => {
    if (h.score >= thresh) {
      if (run && h.ms - run.endMs <= 3600000 * 1.5) { run.endMs = h.ms; run.hours.push(h); }
      else { if (run) windows.push(run); run = { startMs: h.ms, endMs: h.ms, hours: [h] }; }
    } else if (run) { windows.push(run); run = null; }
  });
  if (run) windows.push(run);

  windows.forEach((w) => {
    w.best = w.hours.reduce((a, b) => (b.score > a.score ? b : a), w.hours[0]);
    w.score = w.best.score;
    w.endMs = w.endMs + 3600000;      // a window covers the hour it starts
  });
  windows.sort((a, b) => b.score - a.score);

  return {
    n: catches.length, confidence: conf, profile: prof,
    windows: windows.slice(0, opts.limit || 5),
    scoredHours: hours.length,
  };
}

/* ---- Plain-English rendering (shared by the panel, First Mate and voice) ---- */
const BITE_LABEL = {
  sst: 'water temp', windKn: 'wind', waveFt: 'swell', pressureHpa: 'pressure',
  pressureTrend3h: 'pressure trend', minsFromLightChange: 'light', minsToTideChange: 'tide timing',
  tidePct: 'tide stage', cloudPct: 'cloud', moonPhase: 'moon', windDir: 'wind direction',
  tide: 'tide', solunar: 'solunar', lightPhase: 'time of day',
};
function biteReason(hit) {
  const k = hit.key;
  if (k === 'sst') return 'water ' + Math.round(hit.v) + '°';
  if (k === 'windKn') return 'wind ' + Math.round(hit.v) + ' kn';
  if (k === 'waveFt') return 'swell ' + hit.v.toFixed(1) + ' ft';
  if (k === 'pressureTrend3h') return 'pressure ' + (hit.v > 1 ? 'rising' : hit.v < -1 ? 'falling' : 'steady');
  if (k === 'minsFromLightChange') {
    const m = Math.abs(Math.round(hit.v));
    return m <= 20 ? 'right at first/last light' : m + ' min from light change';
  }
  if (k === 'minsToTideChange') return Math.round(hit.v) + ' min off the tide turn';
  if (k === 'tide') return hit.v + ' tide';
  if (k === 'solunar') return hit.v === 'off' ? 'outside solunar' : hit.v + ' solunar period';
  if (k === 'lightPhase') return hit.v;
  if (k === 'moonPhase') return 'similar moon';
  if (k === 'windDir') return 'wind from ' + (typeof compass === 'function' ? compass(hit.v) : Math.round(hit.v) + '°');
  return BITE_LABEL[k] || k;
}
function biteFmtWindow(w) {
  const s = new Date(w.startMs), e = new Date(w.endMs);
  const day = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return day + ', ' + t(s) + '–' + t(e);
}
/* ---- Panel rendering ---- */
async function renderBiteWindows(opts) {
  const box = document.getElementById('bite-windows');
  if (!box) return;
  opts = opts || {};
  box.innerHTML = (typeof loadingHTML === 'function') ? loadingHTML('Reading your catch history…') : 'Loading…';
  let res;
  try { res = await biteWindows({ days: 7, limit: 4, species: opts.species }); }
  catch (e) { res = { error: 'failed' }; }

  if (res.error === 'too few') {
    box.innerHTML = '<p class="hint">Log <b>' + Bite.MIN_CATCHES + '</b> or more catches and I\'ll learn the conditions that work for you, then rank the next week against them. You have <b>' +
      res.n + '</b> so far.</p>';
    return;
  }
  if (res.error === 'no forecast') {
    box.innerHTML = '<p class="hint">Open the 10-day tab once with signal — I need a forecast to score against.</p>';
    return;
  }
  if (res.error || !res.windows || !res.windows.length) {
    box.innerHTML = '<p class="hint">Nothing in the next week closely matches your logged catches.</p>';
    return;
  }
  /* Lead with the confidence caveat rather than burying it — with a handful of catches these
     rankings are suggestive at best, and the UI should say so before the numbers. */
  let html = '<p class="hint" style="margin-bottom:6px">Ranked against <b>' + res.n +
    '</b> logged catches · ' + escapeHtml(res.confidence.label) + '</p>';
  res.windows.forEach((w, i) => {
    const pct = Math.round(w.score * 100);
    const reasons = w.best.hits.slice(0, 3).map(biteReason).map(escapeHtml).join(' · ');
    html += '<div class="bite-win' + (i === 0 ? ' top' : '') + '">' +
      '<div class="bw-head"><b>' + escapeHtml(biteFmtWindow(w)) + '</b>' +
      '<span class="bw-score">' + pct + '%</span></div>' +
      (reasons ? '<div class="bw-why">' + reasons + '</div>' : '') + '</div>';
  });
  box.innerHTML = html;
}

/* ---- Proactive conditions watch ----
   Speaks up unprompted when the sea is about to turn on you, instead of waiting to be asked.
   Rules kept deliberately few and the cooldown long: an alert that cries wolf gets ignored
   exactly when it matters, so this only fires on a genuine, imminent deterioration. */
const Watch = {
  COOLDOWN_MS: 2 * 3600000,       // never repeat the same alert type inside 2 hours
  WIND_ALERT_KN: 18,              // absolute threshold worth mentioning
  WIND_RISE_KN: 6,                // ...and only if it's meaningfully worse than now
  WAVE_ALERT_FT: 6,
  WAVE_RISE_FT: 2,
  LOOKAHEAD_H: 3,
  _last: {},
};

/* Returns an alert object (or null). Pure — no side effects — so it's testable. */
function watchEvaluate(fc, nowMs) {
  if (!fc || !fc.wx || !fc.wx.hourly || !fc.wx.hourly.time) return null;
  const h = fc.wx.hourly;
  const i = biteHourIdx(h.time, nowMs);
  if (i < 0 || !h.wind_speed_10m) return null;
  const end = Math.min(h.time.length - 1, i + Watch.LOOKAHEAD_H);

  const nowWind = h.wind_speed_10m[i];
  let peakWind = nowWind, peakAt = i;
  for (let k = i; k <= end; k++) {
    if (h.wind_speed_10m[k] != null && h.wind_speed_10m[k] > peakWind) { peakWind = h.wind_speed_10m[k]; peakAt = k; }
  }
  if (nowWind != null && peakWind >= Watch.WIND_ALERT_KN && (peakWind - nowWind) >= Watch.WIND_RISE_KN) {
    const at = new Date(h.time[peakAt]);
    return {
      type: 'wind',
      msg: 'Heads up — wind is building. ' + Math.round(nowWind) + ' knots now, ' + Math.round(peakWind) +
        ' by ' + at.toLocaleTimeString([], { hour: 'numeric' }) + '. Worth thinking about heading in.',
    };
  }

  const mh = fc.marine && fc.marine.hourly;
  if (mh && mh.time && mh.wave_height) {
    const j = biteHourIdx(mh.time, nowMs);
    if (j >= 0) {
      const jEnd = Math.min(mh.time.length - 1, j + Watch.LOOKAHEAD_H);
      const nowFt = mh.wave_height[j] != null ? mh.wave_height[j] * MS_TO_FT : null;
      let peakFt = nowFt, peakJ = j;
      for (let k = j; k <= jEnd; k++) {
        const v = mh.wave_height[k] != null ? mh.wave_height[k] * MS_TO_FT : null;
        if (v != null && (peakFt == null || v > peakFt)) { peakFt = v; peakJ = k; }
      }
      if (nowFt != null && peakFt >= Watch.WAVE_ALERT_FT && (peakFt - nowFt) >= Watch.WAVE_RISE_FT) {
        const at = new Date(mh.time[peakJ]);
        return {
          type: 'wave',
          msg: 'Swell is building — ' + nowFt.toFixed(1) + ' feet now, ' + peakFt.toFixed(1) +
            ' by ' + at.toLocaleTimeString([], { hour: 'numeric' }) + '.',
        };
      }
    }
  }
  return null;
}

/* The cached 10-day forecast, but ONLY if it was saved for near enough to here and
   recently enough to still describe the weather. weather.js has always guarded this
   (wxCacheFor); the bite engine and the conditions watch used to read the key raw. */
const BITE_FC_MAX_AGE_MS = 6 * 3600000;
const BITE_FC_MAX_DEG = 0.25;                   // ~25 km, same as the weather panel
function biteForecast(ll) {
  const fc = readJSON('fishapp.fc10', null);
  if (!fc || !ll) return null;
  if (fc.lat == null || fc.lng == null) return null;
  if (Math.abs(fc.lat - ll.lat) > BITE_FC_MAX_DEG || Math.abs(fc.lng - ll.lng) > BITE_FC_MAX_DEG) return null;
  if (!fc.ts || Date.now() - fc.ts > BITE_FC_MAX_AGE_MS) return null;
  return fc;
}

function watchCheck() {
  // Only relevant if we're actually out there: no fix, nothing to warn about.
  if (typeof GPS === 'undefined' || !GPS.lastLatLng) return null;
  if (document.hidden) return null;
  /* A safety warning has to be about HERE and about NOW. Unchecked, this could
     announce "wind is building, 22 knots by 4 PM" out loud, hands-free, from a
     three-day-old forecast for a different part of the coast. */
  const fc = biteForecast(GPS.lastLatLng);
  const alert = watchEvaluate(fc, Date.now());
  if (!alert) return null;
  const last = Watch._last[alert.type] || 0;
  if (Date.now() - last < Watch.COOLDOWN_MS) return null;      // already said this recently
  Watch._last[alert.type] = Date.now();
  // Speak it when hands-free is on (you're driving, not reading); otherwise toast it.
  if (typeof Voice !== 'undefined' && Voice.on && typeof voiceSay === 'function') voiceSay(alert.msg);
  else if (typeof toast === 'function') toast('⚠️ ' + alert.msg);
  return alert;
}

/* One-paragraph answer suitable for speaking aloud. */
function biteSpokenSummary(res, opts) {
  opts = opts || {};
  const what = opts.species ? opts.species : 'fish';
  if (!res || res.error === 'too few') {
    const n = (res && res.n) || 0;
    return 'I need at least ' + Bite.MIN_CATCHES + ' logged catches with conditions before I can find your patterns. You have ' + n + '.';
  }
  if (res.error === 'no forecast') return "I don't have a forecast saved for here yet — open the 10-day tab once with signal.";
  if (res.error) return "I can't work out a window from what I have here.";
  if (!res.windows.length) return 'Nothing in the next week looks much like your past ' + what + ' catches.';
  const w = res.windows[0];
  const reasons = w.best.hits.slice(0, 3).map(biteReason);
  return 'Best window is ' + biteFmtWindow(w) + '. ' +
    (reasons.length ? reasons.join(', ') + ' — matching your ' + res.n + ' logged catches. ' : '') +
    'That is ' + res.confidence.label + '.';
}
