/* Sun & moon astronomy (compact SunCalc port, MIT) + solunar fishing periods.
   Pure math, no network — works fully offline. */
'use strict';

const Astro = (function () {
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const e = rad * 23.4397;

  const toJulian = (d) => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = (d) => toJulian(d) - J2000;

  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const azimuth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
  function eclipticLongitude(M) {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + rad * 102.9372 + Math.PI;
  }
  function sunCoords(d) { const M = solarMeanAnomaly(d), L = eclipticLongitude(M); return { dec: declination(L, 0), ra: rightAscension(L, 0) }; }
  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }

  function moonPosition(date, lat, lng) {
    const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = siderealTime(d, lw) - c.ra;
    return { azimuth: azimuth(H, phi, c.dec), altitude: altitude(H, phi, c.dec) };
  }

  /* Sun times (sunrise, sunset, solar noon) */
  const J0 = 0.0009;
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
  const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

  function sunTimes(date, lat, lng) {
    const lw = rad * -lng, phi = rad * lat, d = toDays(date);
    const n = Math.round(d - J0 - lw / (2 * Math.PI)), ds = approxTransit(0, lw, n);
    const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
    const Jnoon = solarTransitJ(ds, M, L);
    const w = hourAngle(-0.833 * rad, phi, dec), Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    return { sunrise: fromJulian(Jnoon - (Jset - Jnoon)), sunset: fromJulian(Jset), solarNoon: fromJulian(Jnoon) };
  }

  const hoursLater = (date, h) => new Date(date.valueOf() + h * 3600000);

  function moonTimes(date, lat, lng) {
    const t = new Date(date); t.setHours(0, 0, 0, 0);
    const hc = 0.133 * rad;
    let h0 = moonPosition(t, lat, lng).altitude - hc, rise, set, x1, x2, ye;
    for (let i = 1; i <= 24; i += 2) {
      const h1 = moonPosition(hoursLater(t, i), lat, lng).altitude - hc;
      const h2 = moonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
      const a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a), yex = (a * xe + b) * xe + h1, d = b * b - 4 * a * h1;
      let roots = 0;
      if (d >= 0) {
        const dx = Math.sqrt(d) / (Math.abs(a) * 2); x1 = xe - dx; x2 = xe + dx;
        if (Math.abs(x1) <= 1) roots++; if (Math.abs(x2) <= 1) roots++; if (x1 < -1) x1 = x2;
      }
      if (roots === 1) { if (h0 < 0) rise = i + x1; else set = i + x1; }
      else if (roots === 2) { rise = i + (yex < 0 ? x2 : x1); set = i + (yex < 0 ? x1 : x2); }
      if (rise && set) break;
      h0 = h2;
    }
    const res = {};
    if (rise) res.rise = hoursLater(t, rise);
    if (set) res.set = hoursLater(t, set);
    return res;
  }

  function moonIllumination(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }

  function moonPhaseName(phase) {
    const names = ['🌑 New Moon', '🌒 Waxing Crescent', '🌓 First Quarter', '🌔 Waxing Gibbous',
      '🌕 Full Moon', '🌖 Waning Gibbous', '🌗 Last Quarter', '🌘 Waning Crescent'];
    return names[Math.round(phase * 8) % 8];
  }

  /* Solunar periods for a day: MAJOR = lunar transit overhead/underfoot (±1h),
     MINOR = moonrise / moonset (±45min). These are the traditional best-bite windows. */
  function solunar(date, lat, lng) {
    const day = new Date(date); day.setHours(0, 0, 0, 0);
    let maxAlt = -99, minAlt = 99, upper, lower;
    for (let m = 0; m <= 1440; m += 10) {
      const t = new Date(day.valueOf() + m * 60000);
      const a = moonPosition(t, lat, lng).altitude;
      if (a > maxAlt) { maxAlt = a; upper = t; }
      if (a < minAlt) { minAlt = a; lower = t; }
    }
    const mt = moonTimes(date, lat, lng);
    const periods = [];
    if (upper) periods.push({ type: 'major', center: upper });
    if (lower) periods.push({ type: 'major', center: lower });
    if (mt.rise) periods.push({ type: 'minor', center: mt.rise });
    if (mt.set) periods.push({ type: 'minor', center: mt.set });
    periods.forEach((p) => {
      const half = (p.type === 'major' ? 60 : 45) * 60000;
      p.start = new Date(+p.center - half); p.end = new Date(+p.center + half);
    });
    periods.sort((a, b) => a.center - b.center);
    return periods;
  }

  return { sunTimes, moonTimes, moonIllumination, moonPhaseName, solunar, moonPosition };
})();
