// @vitest-environment node
/* get/ — the smart link behind posters and QR codes. getTarget() is the code the page runs (its
 * source is inlined), so it is tested directly, against appStoreUrl() for parity, and then the
 * generated page is run in jsdom with real user agents to see which panel a visitor gets. */
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { getPage, getTarget } from '../../../tools/web/get-page.mjs';
import { SITE, appStoreUrl } from '../../../src/services/site';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // iPadOS "desktop website" mode: a Mac user agent, but a touch screen
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const NONE = { appStoreId: null, appStoreProviderToken: null, playStoreUrl: null };
const LISTED = { appStoreId: '6400000001', appStoreProviderToken: '123456', playStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.app' };

describe('getTarget', () => {
  it('tells iPhone, iPad (even in desktop mode), Android and desktop apart', () => {
    expect(getTarget({ ua: UA.iphone }, NONE).platform).toBe('ios');
    expect(getTarget({ ua: UA.ipadDesktop, maxTouchPoints: 5 }, NONE).platform).toBe('ios');
    expect(getTarget({ ua: UA.ipadDesktop, maxTouchPoints: 0 }, NONE).platform).toBe('desktop');   // a real Mac
    expect(getTarget({ ua: UA.android }, NONE).platform).toBe('android');
    expect(getTarget({ ua: UA.desktop }, NONE).platform).toBe('desktop');
  });
  it('no store links until the listings exist', () => {
    for (const ua of Object.values(UA)) expect(getTarget({ ua, maxTouchPoints: 5, campaign: 'poster' }, NONE).store).toBeNull();
  });
  it('the App Store link follows appStoreUrl(): pt+ct only with a provider token and a campaign', () => {
    const saved = { ...SITE };
    try {
      Object.assign(SITE, LISTED);
      expect(getTarget({ ua: UA.iphone, campaign: 'poster-2026' }, LISTED).store).toBe(appStoreUrl('poster-2026'));
      expect(getTarget({ ua: UA.iphone }, LISTED).store).toBe(appStoreUrl());
      Object.assign(SITE, { appStoreProviderToken: null });
      expect(getTarget({ ua: UA.iphone, campaign: 'poster' }, { ...LISTED, appStoreProviderToken: null }).store).toBe(appStoreUrl('poster'));
    } finally {
      Object.assign(SITE, saved);
    }
    expect(getTarget({ ua: UA.iphone, campaign: 'poster' }, LISTED).store).toBe('https://apps.apple.com/app/id6400000001?pt=123456&ct=poster');
  });
  it('sanitises the campaign token (characters and Apple’s 40-character limit)', () => {
    const t = getTarget({ ua: UA.iphone, campaign: '<script>"x"&y=1 ' + 'a'.repeat(60) }, LISTED);
    expect(t.campaign).toMatch(/^[A-Za-z0-9_.-]{1,40}$/);
    expect(t.store).not.toMatch(/[<>"\s]/);
  });
  it('Google Play gets the campaign as an install referrer', () => {
    const t = getTarget({ ua: UA.android, campaign: 'card' }, LISTED);
    expect(new URL(t.store).searchParams.get('referrer')).toBe('utm_source=get&utm_campaign=card');
    expect(new URL(t.store).searchParams.get('id')).toBe('com.example.app');
  });
});

describe('get/index.html', () => {
  const site = (over = {}) => ({ brandName: 'FishApp', siteUrl: 'https://example.test/fishapp/', shortUrl: 'example.test/fishapp', ...NONE, ...over });
  let dom;
  afterEach(() => { dom?.window.close(); dom = null; });

  function run(html, ua, { touch = 0, search = '?c=poster' } = {}) {
    const timers = [];                       // the page's setTimeout calls: a forward is one
    dom = new JSDOM(html, {
      url: 'https://example.test/fishapp/get/' + search, runScripts: 'dangerously',
      // set on the instance: jsdom's own userAgent option needs a resource loader, which would fetch
      beforeParse(w) {
        Object.defineProperty(w.navigator, 'userAgent', { value: ua });
        Object.defineProperty(w.navigator, 'maxTouchPoints', { value: touch });
        w.setTimeout = (fn, ms) => { timers.push(ms); return timers.length; };
      },
    });
    const doc = dom.window.document;
    const visible = [...doc.querySelectorAll('[data-for]')].filter((el) => !el.hidden).map((el) => el.getAttribute('data-for'));
    return { visible, doc, timers };
  }

  it('has no Smart App Banner while there is no App Store id, and one once there is', () => {
    expect(getPage({ site: site(), css: 'site/x.css' })).not.toContain('apple-itunes-app');
    expect(getPage({ site: site(LISTED), css: 'site/x.css' })).toContain('<meta name="apple-itunes-app" content="app-id=6400000001">');
  });
  it('without JavaScript the desktop landing (open the web app) is what shows', () => {
    const doc = new JSDOM(getPage({ site: site(), css: 'site/x.css' })).window.document;
    const shown = [...doc.querySelectorAll('[data-for]')].filter((el) => !el.hidden).map((el) => el.getAttribute('data-for'));
    expect(shown).toEqual(['desktop']);
    expect(doc.querySelector('[data-for="desktop"] a.btn').getAttribute('href')).toBe('../');
  });
  it('iPhone with no listing: "coming soon — use it in Safari" with the Add to Home Screen steps', () => {
    const { visible, doc } = run(getPage({ site: site(), css: 'site/x.css' }), UA.iphone);
    expect(visible).toEqual(['ios']);
    const panel = doc.querySelector('[data-for="ios"]').textContent;
    expect(panel).toContain('Coming soon to the App Store');
    expect(panel).toContain('Add to Home Screen');
  });
  it('iPhone with a listing: the App Store button carries the campaign', () => {
    const { visible, doc } = run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.iphone);
    expect(visible).toEqual(['ios-store']);
    expect(doc.querySelector('[data-for="ios-store"] [data-dest]').href).toBe('https://apps.apple.com/app/id6400000001?pt=123456&ct=poster');
  });
  it('desktop: the landing with four feature blurbs and Open the web app', () => {
    const { visible, doc } = run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.desktop);
    expect(visible).toEqual(['desktop']);
    expect(doc.querySelectorAll('.feature')).toHaveLength(4);
  });
  it('Android: Google Play when listed, otherwise the web app', () => {
    expect(run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.android).visible).toEqual(['android-store']);
    const { visible, doc } = run(getPage({ site: site(), css: 'site/x.css' }), UA.android);
    expect(visible).toEqual(['android']);
    expect(doc.querySelector('[data-for="android"] a.btn').getAttribute('href')).toBe('../');
  });
  it('forwards only to a store listing: with none the panel stays put, so its install steps can be read', () => {
    const googlebot = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    for (const ua of [UA.android, googlebot, UA.iphone, UA.desktop]) {
      const { doc, timers } = run(getPage({ site: site(), css: 'site/x.css' }), ua);
      expect(timers, ua).toEqual([]);
      expect(doc.querySelector('[data-for]:not([hidden]) [data-forwarding]'), ua).toBeNull();
    }
    expect(run(getPage({ site: site(), css: 'site/x.css' }), UA.android).doc.querySelector('[data-for="android"]').textContent).toContain('Add to Home screen');
    // with listings, phones are sent on to the store after a beat
    expect(run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.android).timers).toEqual([1500]);
    expect(run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.iphone).timers).toEqual([1500]);
    expect(run(getPage({ site: site(LISTED), css: 'site/x.css' }), UA.desktop).timers).toEqual([]);
  });
  it('the title keeps the tagline’s capitals after the dash ("AI", not "ai")', () => {
    const html = getPage({ site: site(), css: 'site/x.css' });
    const title = 'Get FishApp — offline charts, tides &amp; an AI first mate';
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}">`);
    expect(html).toContain(`<meta name="twitter:title" content="${title}">`);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    expect(ld.name).toBe('Get FishApp — offline charts, tides & an AI first mate');
  });
});
