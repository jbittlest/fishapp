// get/index.html — the one link printed on posters, cards and QR codes (?c=<campaign>). Static and
// framework-free: iPhone/iPad → the App Store once a listing exists (else how to use it from
// Safari today), Android → Google Play once listed (else the web app and how to install it),
// desktop → a short landing. Only a store listing is ever forwarded to automatically.
import { absUrl, esc } from './lib.mjs';
import { page, PITCH, TAGLINE } from './layout.mjs';

/**
 * Where this visitor should go. Pure; its SOURCE is inlined into the page (Function#toString), so
 * the unit tests run exactly the code the browser runs — keep it self-contained.
 * The App Store link follows appStoreUrl() in src/services/site.ts: pt+ct only with both a
 * provider token and a campaign.
 * @param {{ ua?: string, maxTouchPoints?: number, campaign?: string|null }} env
 * @param {{ appStoreId?: string|null, appStoreProviderToken?: string|null, playStoreUrl?: string|null }} cfg
 * @returns {{ platform: 'ios'|'android'|'desktop', store: string|null, campaign: string }}
 */
export function getTarget(env, cfg) {
  const ua = String(env.ua || '');
  // iPadOS asks for desktop sites with a Mac user agent; touch points give it away
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(env.maxTouchPoints) > 1);
  const android = !ios && /Android/i.test(ua);
  // App Store Connect campaign tokens are at most 40 characters
  const campaign = String(env.campaign || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  let store = null;
  if (ios && cfg.appStoreId) {
    const u = new URL('https://apps.apple.com/app/id' + cfg.appStoreId);
    if (campaign && cfg.appStoreProviderToken) {
      u.searchParams.set('pt', cfg.appStoreProviderToken);
      u.searchParams.set('ct', campaign);
    }
    store = u.toString();
  } else if (android && cfg.playStoreUrl) {
    const u = new URL(cfg.playStoreUrl);
    if (campaign && /(^|\.)play\.google\.com$/.test(u.hostname)) u.searchParams.set('referrer', 'utm_source=get&utm_campaign=' + campaign);
    store = u.toString();
  }
  return { platform: ios ? 'ios' : android ? 'android' : 'desktop', store, campaign };
}

const FEATURES = [
  ['Charts that work offshore', 'NOAA charts and seafloor relief, with California’s artificial reefs and marine protected areas built in. Download an area while you have signal and it keeps working with none.'],
  ['Tides, weather and water temperature', 'Tides and solunar periods, wind, swell and rain radar loops, and satellite sea-surface temperature to find the breaks.'],
  ['An AI first mate', 'Ask about conditions, reefs, your spots and your catch log. It answers from your boat data, even with no signal.'],
  ['Navigation and safety', 'Go-To and planned routes with ETA, track recording, an anchor-drag alarm and an SOS screen with your position.'],
];

/* iOS share glyph (box with an up arrow), drawn inline so the hint matches what Safari shows. */
const SHARE_GLYPH = '<svg class="glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M7 11H5v10h14V11h-2"/></svg>';

/** The page script: decide, reveal the right panel, then (store links only) forward after a beat. */
function script(cfg) {
  const data = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<script>
(function () {
  var CFG = ${data};
  ${getTarget.toString()}
  var q = new URLSearchParams(location.search);
  var t = getTarget({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, campaign: q.get('c') }, CFG);
  var key = t.platform === 'desktop' ? 'desktop' : t.platform + (t.store ? '-store' : '');
  var panels = document.querySelectorAll('[data-for]');
  for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-for') !== key;
  document.documentElement.setAttribute('data-platform', t.platform);
  /* Only a store listing is forwarded to. Without one the panel IS the answer (Android's install
     hint, iPhone's Add to Home Screen steps) and must stay readable; a timed jump to the web app
     would also make this page a JS redirect to crawlers, which run as Android phones. */
  var dest = t.store;
  if (!dest) return;
  var links = document.querySelectorAll('[data-dest]');
  for (var j = 0; j < links.length; j++) links[j].href = dest;
  /* Forward after a visible beat, with replace() so Back leaves this page instead of bouncing
     into the store again. Coming back via history, or touching the page, cancels it. */
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'back_forward') return;
  var timer = setTimeout(function () { location.replace(dest); }, 1500);
  var stop = function () { clearTimeout(timer); var s = document.querySelectorAll('[data-forwarding]'); for (var k = 0; k < s.length; k++) s[k].hidden = true; };
  ['pointerdown', 'keydown', 'scroll'].forEach(function (ev) { addEventListener(ev, stop, { once: true, passive: true }); });
  addEventListener('pagehide', function () { clearTimeout(timer); });
})();
</script>`;
}

/** get/index.html. `ctx` = { site, css, notice }. */
export function getPage(ctx) {
  const { site } = ctx;
  const brand = esc(site.brandName);
  const url = absUrl(site.siteUrl, 'get/');
  // mid-sentence after the dash: lower-case the first letter only, so "AI" (or a name) survives
  const title = `Get ${site.brandName} — ${TAGLINE.charAt(0).toLowerCase()}${TAGLINE.slice(1)}`;
  const description = PITCH;
  const cfg = { appStoreId: site.appStoreId || null, appStoreProviderToken: site.appStoreProviderToken || null, playStoreUrl: site.playStoreUrl || null };
  const body = `<section class="hero">
<img class="hero-icon" src="../icons/icon-192.png" width="88" height="88" alt="">
<h1>${esc(TAGLINE)}</h1>
<p class="lede">${brand} is a free marine navigation and fishing app for the boat, built to keep working when you lose signal offshore. No account, no ads.</p>
<div class="cta">
  <div data-for="desktop">
    <p class="actions"><a class="btn primary" href="../">Open the web app</a></p>
    <p class="muted">Runs in any modern browser. On a phone, open this page there to install it.</p>
  </div>
  <div data-for="ios-store" hidden>
    <p class="actions"><a class="btn primary" data-dest href="../">Get ${brand} on the App Store</a></p>
    <p class="muted" data-forwarding>Opening the App Store…</p>
    <p><a href="../">Or use it in Safari</a></p>
  </div>
  <div data-for="ios" hidden>
    <div class="panel">
      <p class="eyebrow">Coming soon to the App Store</p>
      <h2>Use it now in Safari</h2>
      <ol class="steps">
        <li>Tap <b>Open ${brand}</b> below.</li>
        <li>Tap ${SHARE_GLYPH}<b>Share</b>, then <b>Add to Home Screen</b>.</li>
        <li>Launch it from your Home Screen. Charts you download keep working offline.</li>
      </ol>
      <p class="actions"><a class="btn primary" href="../">Open ${brand}</a></p>
    </div>
  </div>
  <div data-for="android-store" hidden>
    <p class="actions"><a class="btn primary" data-dest href="../">Get ${brand} on Google Play</a></p>
    <p class="muted" data-forwarding>Opening Google Play…</p>
    <p><a href="../">Or use it in your browser</a></p>
  </div>
  <div data-for="android" hidden>
    <p class="actions"><a class="btn primary" href="../">Open ${brand}</a></p>
    <p class="muted">To install it, open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
  </div>
</div>
</section>
<section class="features" aria-label="What it does">
${FEATURES.map(([h, p]) => `<div class="feature"><h2>${esc(h)}</h2><p>${esc(p)}</p></div>`).join('\n')}
</section>
<p class="more">Looking for a spot? Browse <a href="../places/">California marine protected areas and artificial reefs</a>.</p>`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url,
    isPartOf: { '@type': 'WebSite', name: site.brandName, url: site.siteUrl },
  };
  return page({ site, up: '../', css: ctx.css, title, description, url, jsonLd, bodyClass: 'get', body, script: script(cfg), notice: ctx.notice });
}
