/* Shared fixtures for the weather-overlays characterisation tests (not a test file itself).
   Payload shapes follow the Open-Meteo responses the legacy weather.js consumed. */

const pad = (n) => String(n).padStart(2, '0');

/** Local ISO hour string like Open-Meteo returns with timezone=auto: "2026-10-25T10:00". */
export function isoHour(day, hour) {
  const d = new Date(day + 'T00:00');
  d.setHours(hour);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':00';
}

export function isoDay(day, plus) {
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() + plus);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** A "Now & 24h" payload: 48 hourly rows from 00:00 on `day`; marine hourly starts 5 h later. */
export function nowPayload(day = '2026-10-25', over = {}) {
  const time = Array.from({ length: 48 }, (_, i) => isoHour(day, i));
  const wx = {
    current: { wind_speed_10m: 12.4, wind_direction_10m: 315, wind_gusts_10m: 18.6, temperature_2m: 66.2 },
    hourly: {
      time,
      wind_speed_10m: time.map((_, i) => 5 + i * 0.5),
      wind_direction_10m: time.map(() => 270),
      wind_gusts_10m: time.map((_, i) => 9 + i * 0.5),
      temperature_2m: time.map(() => 64),
      precipitation_probability: time.map((_, i) => i % 10),
    },
  };
  const mtime = Array.from({ length: 43 }, (_, i) => isoHour(day, i + 5));
  const marine = {
    current: { wave_height: 1, wave_direction: 270, wave_period: 9, swell_wave_height: 0.8, swell_wave_direction: 260, swell_wave_period: 12 },
    hourly: { time: mtime, wave_height: mtime.map((_, i) => (i + 5) / 10), wave_period: mtime.map(() => 9) },
  };
  return Object.assign({ wx, marine, ts: Date.now(), lat: 33.7, lng: -118.3 }, over);
}

/** A 10-day payload whose first daily entry is YESTERDAY (it must be dropped). */
export function fc10Payload(today = '2026-10-25', over = {}) {
  const first = isoDay(today, -1);
  const dtime = Array.from({ length: 10 }, (_, i) => isoDay(first, i));
  const daily = {
    time: dtime,
    weather_code: [0, 0, 1, 3, 45, 61, 80, 95, 2, 71],
    temperature_2m_max: dtime.map(() => 70.4),
    temperature_2m_min: dtime.map(() => 60.6),
    precipitation_sum: dtime.map((_, i) => (i === 3 ? 0.12 : 0)),
    precipitation_probability_max: dtime.map((_, i) => i * 10),
    wind_speed_10m_max: [10, 10, 22, 12, 19, null, 8, 8, 8, 8],
    wind_gusts_10m_max: [15, 15, 30, 18, 25, null, 12, 12, 12, 12],
    wind_direction_10m_dominant: dtime.map(() => 300),
    sunrise: dtime.map((d) => d + 'T06:58'),
    sunset: dtime.map((d) => d + 'T18:05'),
    uv_index_max: dtime.map(() => 4.6),
  };
  const htime = [];
  for (let i = 0; i < dtime.length; i++) for (let h = 0; h < 24; h++) htime.push(dtime[i] + 'T' + pad(h) + ':00');
  const hourly = {
    time: htime,
    temperature_2m: htime.map(() => 65),
    precipitation_probability: htime.map(() => 10),
    wind_speed_10m: htime.map((_, i) => (i % 24 === 6 ? null : 8)),
    wind_direction_10m: htime.map(() => 280),
    wind_gusts_10m: htime.map(() => 12),
    pressure_msl: htime.map(() => 1015),
    cloud_cover: htime.map(() => 40),
  };
  // Marine daily starts TODAY (one day later than the forecast) and covers 8 days.
  const mdtime = Array.from({ length: 8 }, (_, i) => isoDay(today, i));
  const marine = {
    daily: {
      time: mdtime,
      wave_height_max: [0.6, 1.6, 1.0, 1.49, null, 0.9, 0.9, 0.9],
      wave_direction_dominant: mdtime.map(() => 270),
      wave_period_max: [11, null, 10, 10, 10, 10, 10, 10],
      swell_wave_height_max: mdtime.map(() => 0.5),
      swell_wave_period_max: mdtime.map(() => 13),
    },
    hourly: {
      time: htime,
      wave_height: htime.map(() => 0.7),
      sea_surface_temperature: htime.map(() => 63.4),
    },
  };
  return Object.assign({ wx: { daily, hourly }, marine, ts: Date.now(), lat: 33.7, lng: -118.3 }, over);
}

/** A fetch Response-like object. */
export function res(body, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
}

/** Let pending promise chains settle (real timers). */
export async function settle(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
