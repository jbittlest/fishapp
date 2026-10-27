// Search and social tags for the app page (the built index.html). index.html carries a
// <!--SITE-HEAD …--> marker; this fills it from src/site.config.json at deploy time, so the brand
// and URL are never typed into the page and a rename is a config change.
import { absUrl, esc } from './lib.mjs';
import { jsonLdTag, OG_IMAGE, PITCH, smartBannerTag, socialTags, TAGLINE } from './layout.mjs';

export function appHead(site) {
  const title = `${site.brandName} — offline marine charts, tides & an AI first mate`;
  const description = PITCH;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.brandName,
    description,
    url: site.siteUrl,
    image: absUrl(site.siteUrl, OG_IMAGE.path),
    // Google's list of app types has no Navigation entry; the sub-category carries it
    applicationCategory: 'TravelApplication',
    applicationSubCategory: 'Navigation',
    operatingSystem: 'Web browser',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    slogan: TAGLINE,
  };
  if (site.appStoreId) jsonLd.sameAs = ['https://apps.apple.com/app/id' + site.appStoreId];
  const tags = [
    socialTags({ site, title, description, url: site.siteUrl }),
    smartBannerTag(site),
    jsonLdTag(jsonLd),
  ].filter(Boolean).join('\n');
  return { title, description, tags };
}

const MARKER = /<!--SITE-HEAD[^>]*-->(?:[\s\S]*?<!--\/SITE-HEAD-->)?/;

/** Fill the marker (again, if this build was already processed) and set title + description. */
export function injectAppHead(html, site) {
  const { title, description, tags } = appHead(site);
  if (!MARKER.test(html)) throw new Error('index.html: <!--SITE-HEAD--> marker not found');
  if (!/<title>[^<]*<\/title>/.test(html)) throw new Error('index.html: <title> not found');
  if (!/<meta name="description" content="[^"]*">/.test(html)) throw new Error('index.html: meta description not found');
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(description)}">`)
    .replace(MARKER, () => `<!--SITE-HEAD-->\n${tags}\n<!--/SITE-HEAD-->`);
}
