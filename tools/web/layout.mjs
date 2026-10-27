// Page chrome shared by the public pages (get/, places/): <head> with search + social tags, the
// brand bar and the footer. Every URL is derived from src/site.config.json.
import { absUrl, esc, jsonForScript } from './lib.mjs';

export const OG_IMAGE = { path: 'og.png', width: 1200, height: 630 };
export const TAGLINE = 'Offline charts, tides & an AI first mate';
/** The one-sentence pitch: meta description of the app page and of get/. */
export const PITCH = 'Free offline marine charts, GPS navigation, tides and weather for the boat, with California reefs and MPAs built in and an AI first mate that works with no signal.';

/** Canonical + Open Graph + Twitter card tags (one set for the app page and every static page). */
export function socialTags({ site, title, description, url, type = 'website' }) {
  const img = absUrl(site.siteUrl, OG_IMAGE.path);
  const alt = `${site.brandName} — ${TAGLINE}`;
  return [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:site_name" content="${esc(site.brandName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${esc(alt)}">`,
    '<meta property="og:locale" content="en_US">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<meta name="twitter:image:alt" content="${esc(alt)}">`,
  ].join('\n');
}

/* The Smart App Banner only exists once there is a listing to point at. */
export function smartBannerTag(site) {
  return site.appStoreId ? `<meta name="apple-itunes-app" content="app-id=${esc(site.appStoreId)}">` : '';
}

export function jsonLdTag(value) {
  return `<script type="application/ld+json">${jsonForScript(value)}</script>`;
}

/**
 * A complete static page. `up` is the relative path back to the site root ('../' for get/ and
 * places/) so the same output works on GitHub Pages, a custom domain and a local preview.
 */
export function page({ site, up, css, title, description, url, jsonLd, bodyClass = '', body, script = '', notice = '', credit = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${socialTags({ site, title, description, url })}
${smartBannerTag(site)}
<meta name="theme-color" content="#0B131C">
<meta name="color-scheme" content="dark light">
<link rel="icon" type="image/png" href="${up}icons/icon-192.png">
<link rel="apple-touch-icon" href="${up}icons/icon-180.png">
<link rel="stylesheet" href="${up}${css}">
${jsonLd ? jsonLdTag(jsonLd) : ''}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="${up}"><img src="${up}icons/icon-192.png" width="32" height="32" alt=""><span>${esc(site.brandName)}</span></a>
  <nav aria-label="Site"><a href="${up}places/">Places</a><a href="${up}get/">Get the app</a></nav>
</header>
<main id="main">
${body}
</main>
${footer({ up, notice, credit })}
${script}
</body>
</html>
`.replace(/\n{2,}/g, '\n');
}

function footer({ up, notice, credit }) {
  return `<footer class="foot">
  ${notice ? `<p class="nfn">${esc(notice)}</p>` : ''}
  ${credit ? `<p>${esc(credit)}</p>` : ''}
  <p class="links"><a href="${up}places/">Places</a><a href="${up}get/">Get the app</a><a href="${up}privacy.html">Privacy</a><a href="${up}support.html">Support</a></p>
</footer>`;
}
