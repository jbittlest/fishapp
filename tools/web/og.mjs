// The link-preview image (public/og.png) has the brand, the tagline and the site URL drawn into its
// pixels by tools/web/render-og.mjs, so a site-config change alone never updates it. render-og writes
// tools/web/og.stamp.json — what it rendered from and the image's hash — and make-web-pages checks
// the build's og.png against it, so a rename or a new domain cannot ship the old brand in every
// link preview.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TAGLINE } from './layout.mjs';

/** Where the stamp lives, relative to the source root. Not in public/: it is not deployed. */
export const OG_STAMP = 'tools/web/og.stamp.json';
const RERUN = 'rerun `node tools/web/render-og.mjs`';

/** The words render-og prints on the image, from the site config. */
export function ogText(site) {
  return {
    brandName: site.brandName,
    tagline: TAGLINE,
    shortUrl: site.shortUrl || String(site.siteUrl).replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

/* What an image is rendered from: the words it prints and the site it was made for (a new siteUrl
   with an unchanged shortUrl is caught too — the image would still print the old address). */
const ogSource = (site) => ({ ...ogText(site), siteUrl: site.siteUrl });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The stamp for an image just rendered from this config. */
export function ogStamp(site, png) {
  return { ...ogSource(site), sha256: sha256(png) };
}

export function readOgStamp(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, OG_STAMP), 'utf8')); } catch (e) { return null; }
}

/**
 * Does this og.png fit this site config? `error` when the stamp proves it was rendered for another
 * brand, tagline or URL (the build must stop); `warning` when the image is not the one render-og
 * stamped, so nothing can be proved either way (a hand-made image, or the stamp went missing).
 * @returns {{ error: string, warning: string }}
 */
export function checkOgImage(stamp, site, png) {
  if (!stamp || stamp.sha256 !== sha256(png)) {
    return { error: '', warning: `og.png is not the image ${OG_STAMP} describes, so it cannot be checked against the site config — ${RERUN} unless it was made by hand for "${site.brandName}"` };
  }
  const want = ogSource(site);
  const stale = Object.keys(want).filter((k) => stamp[k] !== want[k]);
  if (!stale.length) return { error: '', warning: '' };
  const list = (o) => stale.map((k) => `${k} "${o[k]}"`).join(', ');
  const urlOnly = stale.includes('siteUrl') && !stale.includes('shortUrl') && site.shortUrl;
  return {
    error: `og.png (the link-preview image) was rendered for ${list(stamp)}, but the config now has ${list(want)} — ` +
      `${urlOnly ? 'check shortUrl in src/site.config.json (the image prints it), then ' : ''}${RERUN}`,
    warning: '',
  };
}
