import { SITE } from '../services/site';

/* Third-party data sources: how the app identifies itself when it calls them, which of their
   records it may show, and the credit lines their terms ask for. Kept in one module (with no
   app dependencies) so every caller sends the same request and every screen shows the same
   credit. The terms behind each line are quoted in docs/launch/data-sources.md. */
'use strict';

/* Credit links open outside the app: target=_blank goes to the browser on the web and to Safari
   from the iOS shell (NativeBridge), and never navigates the chart itself away. Same markup as
   the tile credits in tiles.js; the map's attribution control renders these as HTML. */
export const creditLink = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';

/* ---------------------------------------------------------------- iNaturalist */
/* "Photos in the static.inaturalist.org domain do not have open licenses", and about one photo
   in six near Palos Verdes is all rights reserved. Every iNaturalist query asks only for
   observations with a photo under one of these licences, and a photo is only ever shown with
   its observer and licence. The NC licences hold only while the app stays non-commercial. */
export const INAT_PHOTO_LICENSES = ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd'];
export const INAT_URL = 'https://www.inaturalist.org/';

/** Research-grade iNaturalist observations of `taxa` (comma-separated ids) inside a box
 *  {n, e, s, w}: newest first, exact location only, each with an openly licensed photo. */
export function inatObservationsUrl(taxa, box) {
  return 'https://api.inaturalist.org/v1/observations?taxon_id=' + taxa +
    '&nelat=' + box.n.toFixed(4) + '&nelng=' + box.e.toFixed(4) +
    '&swlat=' + box.s.toFixed(4) + '&swlng=' + box.w.toFixed(4) +
    '&per_page=100&order_by=observed_on&order=desc&geo=true&photos=true' +
    '&photo_license=' + INAT_PHOTO_LICENSES.join(',') +
    '&quality_grade=research&geoprivacy=open'; // open = not location-obscured
}

/** A photo's licence as an iNaturalist code ('cc-by-nc', 'cc0'), or '' when it has none (all
 *  rights reserved). The API sends `license_code` (null = none); without the field, the
 *  attribution text ("… (CC BY-NC)", "no rights reserved") is read instead. */
export function inatPhotoLicence(photo) {
  if (!photo) return '';
  if (typeof photo.license_code === 'string') return photo.license_code.toLowerCase();
  if (photo.license_code === null) return '';
  const a = typeof photo.attribution === 'string' ? photo.attribution : '';
  if (/no rights reserved/i.test(a)) return 'cc0';
  const m = /\((CC0|CC[ -]BY(?:-[A-Z]{2})*)\)/i.exec(a);
  return m ? m[1].toLowerCase().replace(' ', '-') : '';
}

/** The first photo of an observation that may be shown (an open licence and a URL), or null.
 *  The query already asks for licensed photos, but an observation can mix licensed and
 *  all-rights-reserved photos, and the first one is not always the licensed one. */
export function inatOpenPhoto(photos) {
  if (!Array.isArray(photos)) return null;
  return photos.find((p) => p && typeof p.url === 'string' && p.url &&
    INAT_PHOTO_LICENSES.indexOf(inatPhotoLicence(p)) >= 0) || null;
}

/** The photo credit: observer and licence. iNaturalist's own attribution line when it has one
 *  ("(c) Sam, some rights reserved (CC BY-NC)"), otherwise built from the observer's name. */
export function inatPhotoCredit(photo, user) {
  if (!photo) return '';
  if (typeof photo.attribution === 'string' && photo.attribution.trim()) return photo.attribution.trim();
  const code = inatPhotoLicence(photo);
  if (!code) return '';
  const who = (user && (user.name || user.login)) || 'an iNaturalist observer';
  return code === 'cc0' ? who + ', no rights reserved (CC0)' : '(c) ' + who + ', some rights reserved (' + code.toUpperCase().replace(/^CC-/, 'CC ') + ')';
}

/* ------------------------------------------------------------------ NOAA CO-OPS */
/* CO-OPS asks every caller to name itself with application=<name> so NOAA can trace problems
   back to an app (docs/launch/data-sources.md [23]). Derived from the brand, so a rename follows. */
/** A URL-safe identifier from an app name: "FishApp" → "fishapp", "Fish & Tide!" → "fish-tide". */
export function coopsAppId(name) {
  const id = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'app';
}
export const COOPS_APP = coopsAppId(SITE.brandName);

/** Hi/lo tide predictions for one station, MLLW, feet, station-local time (lst_ldt), from
 *  `beginYmd` to `endYmd` (YYYYMMDD). Hi/lo works for every station, including subordinate
 *  ones with no time series. */
export function coopsHiLoUrl(stationId, beginYmd, endYmd) {
  return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=' + encodeURIComponent(COOPS_APP) +
    '&datum=MLLW&time_zone=lst_ldt&units=english&format=json&product=predictions&interval=hilo' +
    '&station=' + encodeURIComponent(String(stationId)) + '&begin_date=' + beginYmd + '&end_date=' + endYmd;
}

/* -------------------------------------------------------------------- credits */
/* Open-Meteo data are CC BY 4.0: "You must include a link next to any location Open-Meteo data
   are displayed", e.g. "Weather data by Open-Meteo.com". */
export const OPEN_METEO_URL = 'https://open-meteo.com/';
export const OPEN_METEO_CREDIT = 'Weather data by Open-Meteo.com';
export const OPEN_METEO_ATTRIBUTION = creditLink(OPEN_METEO_URL, OPEN_METEO_CREDIT);

/* The MUR SST dataset (NOAA CoastWatch ERDDAP) asks for this acknowledgement. The overlay's
   colour scale is stretched to temperatures sampled from Open-Meteo, so that is credited too. */
export const MUR_SST_URL = 'https://coastwatch.pfeg.noaa.gov/erddap/info/jplMURSST41/index.html';
export const MUR_SST_ACK = 'These data were provided by JPL under support by NASA MEaSUREs program.';
export const MUR_SST_ATTRIBUTION = 'Sea temperature: MUR SST provided by JPL under support by NASA MEaSUREs program, via ' +
  creditLink(MUR_SST_URL, 'NOAA CoastWatch') + '; scale from ' + creditLink(OPEN_METEO_URL, 'Open-Meteo.com');

export const INAT_ATTRIBUTION = 'Fish sightings: ' + creditLink(INAT_URL, 'iNaturalist') + ' observers';
