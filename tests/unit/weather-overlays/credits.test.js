// @vitest-environment jsdom
/* Data-source etiquette and credits: the request builders send what each source asks for
   (iNaturalist licence filter, CO-OPS application id), photo licences are read safely, and the
   map's Credits control lists every layer's credit in full and opens / closes on a phone. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import L from 'leaflet';
import { SITE } from '../../../src/services/site';
import {
  COOPS_APP, INAT_PHOTO_LICENSES, MUR_SST_ACK, MUR_SST_ATTRIBUTION, OPEN_METEO_ATTRIBUTION, OPEN_METEO_CREDIT, OPEN_METEO_URL,
  coopsAppId, coopsHiLoUrl, creditLink, inatObservationsUrl, inatOpenPhoto, inatPhotoCredit, inatPhotoLicence,
} from '../../../src/engine/datasources.js';
import { CreditsControl, creditsInit } from '../../../src/engine/attribution.js';

const params = (url) => new URL(url).searchParams;

describe('iNaturalist requests', () => {
  it('asks only for observations with an openly licensed photo', () => {
    const p = params(inatObservationsUrl('1,2,3', { n: 34.2, e: -117.9, s: 33.1, w: -119.3 }));
    expect(p.get('photo_license')).toBe('cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd');
    expect(p.get('photo_license').split(',')).toEqual(INAT_PHOTO_LICENSES);
    expect(p.get('photos')).toBe('true');
    expect(p.get('taxon_id')).toBe('1,2,3');
    expect(p.get('quality_grade')).toBe('research');
    expect(p.get('geoprivacy')).toBe('open');
    expect([p.get('nelat'), p.get('nelng'), p.get('swlat'), p.get('swlng')]).toEqual(['34.2000', '-117.9000', '33.1000', '-119.3000']);
  });

  it('reads a photo licence from license_code, or from the attribution text without one', () => {
    expect(inatPhotoLicence({ license_code: 'CC-BY-NC' })).toBe('cc-by-nc');
    expect(inatPhotoLicence({ license_code: null, attribution: '(c) Ann, some rights reserved (CC BY)' })).toBe('');   // null = none, whatever the text says
    expect(inatPhotoLicence({ attribution: '(c) Sam, some rights reserved (CC BY-NC-SA)' })).toBe('cc-by-nc-sa');
    expect(inatPhotoLicence({ attribution: 'Sam, no rights reserved' })).toBe('cc0');
    expect(inatPhotoLicence({ attribution: '(c) Sam, all rights reserved' })).toBe('');
    expect(inatPhotoLicence(null)).toBe('');
  });

  it('picks the first licensed photo with a URL, never an unlicensed one', () => {
    const arr = { url: 'a', license_code: null };
    const ccby = { url: 'b', license_code: 'cc-by' };
    expect(inatOpenPhoto([arr, ccby])).toBe(ccby);
    expect(inatOpenPhoto([arr])).toBeNull();
    expect(inatOpenPhoto([{ license_code: 'cc0' }])).toBeNull();   // no URL
    expect(inatOpenPhoto([{ url: 'c', license_code: 'pd' }])).toBeNull();   // not in the list
    expect(inatOpenPhoto(undefined)).toBeNull();
  });

  it('credits the observer and the licence', () => {
    expect(inatPhotoCredit({ attribution: ' (c) Sam, some rights reserved (CC BY-NC) ' })).toBe('(c) Sam, some rights reserved (CC BY-NC)');
    expect(inatPhotoCredit({ license_code: 'cc-by-sa' }, { name: 'Sam Diver', login: 'sam' })).toBe('(c) Sam Diver, some rights reserved (CC BY-SA)');
    expect(inatPhotoCredit({ license_code: 'cc0' }, { login: 'sam' })).toBe('sam, no rights reserved (CC0)');
    expect(inatPhotoCredit({ license_code: 'cc-by' })).toBe('(c) an iNaturalist observer, some rights reserved (CC BY)');
    expect(inatPhotoCredit({ license_code: null }, { login: 'sam' })).toBe('');
  });
});

describe('NOAA CO-OPS requests', () => {
  it('the application id is the brand, URL-safe', () => {
    expect(COOPS_APP).toBe(coopsAppId(SITE.brandName));
    expect(COOPS_APP).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(coopsAppId('FishApp')).toBe('fishapp');
    expect(coopsAppId('  Fish & Tide! ')).toBe('fish-tide');
    expect(coopsAppId('Pêche')).toBe('p-che');
    expect(coopsAppId('')).toBe('app');
    expect(coopsAppId(null)).toBe('app');
  });

  it('hi/lo predictions carry application= and the station and dates', () => {
    const p = params(coopsHiLoUrl('9410660', '20261026', '20261028'));
    expect(p.get('application')).toBe(COOPS_APP);
    expect(p.get('station')).toBe('9410660');
    expect(p.get('begin_date')).toBe('20261026');
    expect(p.get('end_date')).toBe('20261028');
    expect(p.get('product')).toBe('predictions');
    expect(p.get('interval')).toBe('hilo');
    expect(p.get('datum')).toBe('MLLW');
    expect(p.get('time_zone')).toBe('lst_ldt');
    expect(p.get('units')).toBe('english');
    expect(p.get('format')).toBe('json');
    expect(coopsHiLoUrl('9410660', 'a', 'b').startsWith('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?')).toBe(true);
  });
});

describe('credit strings', () => {
  it('Open-Meteo: the licence wording, linked to open-meteo.com, opening outside the app', () => {
    expect(OPEN_METEO_CREDIT).toBe('Weather data by Open-Meteo.com');
    const a = new DOMParser().parseFromString(OPEN_METEO_ATTRIBUTION, 'text/html').querySelector('a');
    expect(a.getAttribute('href')).toBe(OPEN_METEO_URL);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe(OPEN_METEO_CREDIT);
  });

  it('MUR SST: carries the NASA/JPL acknowledgement the dataset asks for', () => {
    const text = new DOMParser().parseFromString(MUR_SST_ATTRIBUTION, 'text/html').body.textContent;
    expect(MUR_SST_ACK).toBe('These data were provided by JPL under support by NASA MEaSUREs program.');
    expect(text).toContain('provided by JPL under support by NASA MEaSUREs program');
    // tiles from NASA GIBS, which asks to be acknowledged; the scale is fitted to MUR itself (no Open-Meteo)
    expect(text).toContain('NASA GIBS');
    expect(text).not.toContain('Open-Meteo');
    expect(creditLink('https://x.test/', 'X')).toBe('<a href="https://x.test/" target="_blank" rel="noopener noreferrer">X</a>');
  });
});

/* ------------------------------------------------------------- Credits control */
function makeMap() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const map = L.map(el, { center: [33.7, -118.3], zoom: 9, attributionControl: true, zoomControl: false });
  map.attributionControl.setPrefix(false);
  return map;
}
const box = () => document.querySelector('.fa-credits');
const toggle = () => document.querySelector('.fa-credits__toggle');

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--credits-clear');
  vi.unstubAllGlobals();
});

describe('Credits control', () => {
  it('replaces the stock control and lists every credit in full, one element each', () => {
    const map = makeMap();
    const ctl = creditsInit(map);
    expect(ctl).toBeInstanceOf(CreditsControl);
    expect(map.attributionControl).toBe(ctl);
    expect(document.querySelectorAll('.leaflet-control-attribution')).toHaveLength(1);
    L.layerGroup([], { attribution: '© ' + creditLink('https://www.openstreetmap.org/copyright', 'OpenStreetMap') + ' contributors' }).addTo(map);
    L.layerGroup([], { attribution: OPEN_METEO_ATTRIBUTION }).addTo(map);
    expect(ctl.getText()).toEqual(['© OpenStreetMap contributors', 'Weather data by Open-Meteo.com']);
    expect(box().querySelectorAll('.fa-credits__item a')).toHaveLength(2);
    expect(box().classList.contains('is-empty')).toBe(false);
  });

  it('carries over the credits of layers added before it, and follows layers coming and going', () => {
    const map = makeMap();
    const early = L.layerGroup([], { attribution: 'NOAA Office of Coast Survey' }).addTo(map);
    const ctl = creditsInit(map);
    expect(ctl.getText()).toEqual(['NOAA Office of Coast Survey']);
    // two layers with the same credit (the SST day frames) list it once, until the last goes
    const a = L.layerGroup([], { attribution: MUR_SST_ATTRIBUTION }).addTo(map);
    const b = L.layerGroup([], { attribution: MUR_SST_ATTRIBUTION }).addTo(map);
    expect(ctl.getText()).toHaveLength(2);
    map.removeLayer(a);
    expect(ctl.getText()).toHaveLength(2);
    map.removeLayer(b);
    expect(ctl.getText()).toEqual(['NOAA Office of Coast Survey']);
    map.removeLayer(early);
    expect(ctl.getText()).toEqual([]);
    expect(box().classList.contains('is-empty')).toBe(true);
  });

  it('the toggle opens and closes the list, with aria-expanded to match', () => {
    const map = makeMap();
    const ctl = creditsInit(map);
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    const btn = toggle();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.textContent).toBe('Credits');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(btn.getAttribute('aria-controls'))).toBe(box().querySelector('.fa-credits__text'));
    btn.click();
    expect(ctl.isOpen()).toBe(true);
    expect(box().classList.contains('is-open')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(ctl.isOpen()).toBe(false);
    expect(box().classList.contains('is-open')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape, on a tap or drag on the chart, and when the last credit goes', () => {
    const map = makeMap();
    const ctl = creditsInit(map);
    const layer = L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    toggle().click();
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctl.isOpen()).toBe(false);
    ctl.setOpen(true);
    map.fire('click', { latlng: L.latLng(33.7, -118.3) });
    expect(ctl.isOpen()).toBe(false);
    ctl.setOpen(true);
    map.fire('dragstart');
    expect(ctl.isOpen()).toBe(false);
    ctl.setOpen(true);
    map.removeLayer(layer);
    expect(ctl.isOpen()).toBe(false);
    ctl.setOpen(true);   // nothing to show: it stays shut
    expect(ctl.isOpen()).toBe(false);
  });

  it('a tap on the toggle never reaches the chart underneath', () => {
    const map = makeMap();
    creditsInit(map);
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    const onClick = vi.fn();
    map.on('click', onClick);
    toggle().click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('on a phone, publishes the room the open list takes so the legends move above it', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const map = makeMap();
    const ctl = creditsInit(map);
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    box().getBoundingClientRect = () => ({ x: 0, y: 0, width: 366, height: 120, top: 0, left: 0, right: 366, bottom: 120, toJSON() {} });
    const clear = () => document.documentElement.style.getPropertyValue('--credits-clear');
    expect(clear()).toBe('0px');
    ctl.setOpen(true);
    expect(clear()).toBe('138px');   // 120 + 8 above the zoom keys + 10 gap
    ctl.setOpen(false);
    expect(clear()).toBe('0px');
  });

  it('nothing is published when the legend column sits beside the list (landscape phone)', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const leg = document.createElement('div');
    leg.className = 'wx-legends';
    document.body.appendChild(leg);
    const rect = (left, width, height) => () => ({ x: left, y: 0, left, width, height, top: 0, right: left + width, bottom: height, toJSON() {} });
    leg.getBoundingClientRect = rect(12, 400, 94);
    const map = makeMap();
    const ctl = creditsInit(map);
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    box().getBoundingClientRect = rect(432, 400, 84);
    ctl.setOpen(true);
    expect(document.documentElement.style.getPropertyValue('--credits-clear')).toBe('0px');
    ctl.setOpen(false);
    box().getBoundingClientRect = rect(12, 366, 84);   // portrait: the list spans the column's width
    ctl.setOpen(true);
    expect(document.documentElement.style.getPropertyValue('--credits-clear')).toBe('102px');
  });

  it('on a wide screen the always-shown line reserves its own height, so the legends never cover it', () => {
    /* Beside an open side panel the line wraps to several rows (base.css), and the legend column
       next to the panel used to sit on top of the first ones. */
    vi.stubGlobal('matchMedia', (q) => ({ matches: !q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const map = makeMap();
    const ctl = creditsInit(map);
    let h = 25;
    box().getBoundingClientRect = () => ({ x: 0, y: 0, width: 366, height: h, top: 0, left: 0, right: 366, bottom: h, toJSON() {} });
    const clear = () => document.documentElement.style.getPropertyValue('--credits-clear');
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    expect(clear()).toBe('35px');   // 25 + 10 gap
    h = 48;   // re-wrapped (the panel opened): the ResizeObserver / resize re-measures
    window.dispatchEvent(new Event('resize'));
    expect(clear()).toBe('58px');
    ctl.setOpen(true);   // no list to open on a wide screen: same room
    expect(clear()).toBe('58px');
    map.removeControl(ctl);
    expect(clear()).toBe('0px');
  });

  it('on a wide screen, no credits reserve no room', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: !q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const map = makeMap();
    creditsInit(map);
    const layer = L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    box().getBoundingClientRect = () => ({ height: 25 });
    map.removeLayer(layer);
    expect(document.documentElement.style.getPropertyValue('--credits-clear')).toBe('0px');
  });

  it('removing the control clears what it published', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const map = makeMap();
    const ctl = creditsInit(map);
    L.layerGroup([], { attribution: 'GEBCO, NOAA NCEI' }).addTo(map);
    box().getBoundingClientRect = () => ({ height: 50 });
    ctl.setOpen(true);
    expect(document.documentElement.style.getPropertyValue('--credits-clear')).toBe('68px');
    map.removeControl(ctl);
    expect(document.documentElement.style.getPropertyValue('--credits-clear')).toBe('0px');
  });
});
