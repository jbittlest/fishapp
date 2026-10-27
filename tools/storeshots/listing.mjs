/* The App Store screenshot set: Apple's required sizes, the captions file and its rules, and the
 * checks that keep an out-of-date or mixed set from looking finished.
 * Pure (no browser), so the rules are unit-tested and render.mjs stays a thin driver. */
import fs from 'node:fs';
import path from 'node:path';

/** Where tests/visual/appstore.spec.ts writes the raw app screens by default (repo-relative).
 *  Deliberately not the iOS AppStoreScreenshots/ folder: that one holds the framed set to upload. */
export const RAW_DIR = 'tools/out/storeshots/raw';

/** What a raw screen shows (repo-relative): a raw older than the newest of these may show UI or
 *  copy the app no longer has. Conservative on purpose — any change asks for a recapture. */
export const APP_SOURCES = ['src', 'public', 'index.html'];

/** App Store Connect's required sizes. `dir` is both the raw-capture and the output sub-folder
 *  (tests/visual/appstore.spec.ts writes the raw screens with the same names). CSS size × dpr = pixels. */
export const SIZES = [
  { dir: 'iphone-6.9', kind: 'phone', width: 1320, height: 2868, css: { width: 440, height: 956 }, dpr: 3 },
  { dir: 'ipad-13', kind: 'tablet', width: 2064, height: 2752, css: { width: 1032, height: 1376 }, dpr: 2 },
];

/** App Store Connect takes up to 10 screenshots per device size; the first three show in search. */
export const MAX_SCREENS = 10;
export const MAX_HEADLINE_WORDS = 5;
/** Sublines have to sit on one line on the phone canvas at 17 px Barlow. */
export const MAX_SUBLINE_CHARS = 52;

/** Which signal colour the accent takes: the day amber, or night mode's red-orange for a night screen. */
export const THEMES = ['day', 'night'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Words a reader counts: "10-day" is one, a lone "&" is none. */
export function wordCount(s) {
  return String(s).trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** Every rule the captions file breaks, as readable lines (empty = good). */
export function validateCaptions(data) {
  const problems = [];
  const screens = data && Array.isArray(data.screens) ? data.screens : null;
  if (!screens) return ['captions: expected { "screens": [ ... ] }'];
  if (screens.length < 3) problems.push(`captions: ${screens.length} screens — the first three show in search results, give at least 3`);
  if (screens.length > MAX_SCREENS) problems.push(`captions: ${screens.length} screens — App Store Connect takes at most ${MAX_SCREENS}`);
  // held: names that must not appear in any caption yet, each with the reason (an owner decision)
  const held = data.held == null ? {} : data.held;
  const heldOk = typeof held === 'object' && !Array.isArray(held)
    && Object.entries(held).every(([term, why]) => term.trim() && typeof why === 'string' && why.trim());
  if (!heldOk) problems.push('captions: held must map each held name to the reason it is held');
  const heldTerms = heldOk ? Object.keys(held) : [];
  const ids = new Set();
  screens.forEach((s, i) => {
    const at = `screens[${i}]${s && s.id ? ` (${s.id})` : ''}`;
    if (!s || typeof s !== 'object') { problems.push(`${at}: not an object`); return; }
    if (!SLUG.test(s.id || '')) problems.push(`${at}: id must be a lowercase-hyphen slug`);
    else if (ids.has(s.id)) problems.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!SLUG.test(s.screen || '')) problems.push(`${at}: screen must name a raw capture like "01-goto"`);
    const headline = typeof s.headline === 'string' ? s.headline.trim() : '';
    if (!headline) problems.push(`${at}: headline missing`);
    else if (wordCount(headline) > MAX_HEADLINE_WORDS) problems.push(`${at}: headline "${headline}" has ${wordCount(headline)} words (max ${MAX_HEADLINE_WORDS})`);
    if (s.accent != null && !headline.includes(s.accent)) problems.push(`${at}: accent "${s.accent}" is not part of the headline`);
    if (s.theme != null && !THEMES.includes(s.theme)) problems.push(`${at}: theme must be one of ${THEMES.join(', ')}`);
    if (s.subline != null) {
      if (typeof s.subline !== 'string' || !s.subline.trim()) problems.push(`${at}: subline must be text (or leave it out)`);
      else if (s.subline.length > MAX_SUBLINE_CHARS) problems.push(`${at}: subline is ${s.subline.length} chars (max ${MAX_SUBLINE_CHARS}, one line)`);
    }
    // a held name in any case: "first mate" is the same mark as "First Mate"
    const said = `${headline} ${typeof s.subline === 'string' ? s.subline : ''}`.toLowerCase();
    for (const term of heldTerms) {
      if (said.includes(term.toLowerCase())) problems.push(`${at}: uses "${term}", which is held — ${held[term]}`);
    }
  });
  return problems;
}

/** The output file names a captions set produces, in listing order. */
export function plannedNames(data) {
  return data.screens.map((s, i) => outName(i, s.id));
}

/** Screenshot files in an output folder that this listing would not write: left over from a
 *  renamed or reordered caption, or raw captures. A folder upload would carry them along. */
export function strayShots(files, planned) {
  const keep = new Set(planned);
  return files.filter((f) => /\.(png|jpe?g)$/i.test(f) && !keep.has(f)).sort();
}

/** The most recently modified file under `paths` (files or folders, walked recursively), as
 *  { file, mtimeMs } — or null when none of them exist. */
export function newestFile(paths) {
  let best = null;
  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) visit(path.join(p, name));
    } else if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) {
      best = { file: p, mtimeMs: st.mtimeMs };
    }
  };
  paths.forEach(visit);
  return best;
}

/** The files among `files` last written before `sinceMs`. */
export function filesOlderThan(files, sinceMs) {
  return files.filter((f) => fs.statSync(f).mtimeMs < sinceMs);
}

export function loadCaptions(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Output file name: listing order first, so App Store Connect uploads them in order. */
export function outName(index, id) {
  return `${String(index + 1).padStart(2, '0')}-${id}.png`;
}

/** The headline split around its accent phrase, for the template to colour. */
export function splitAccent(headline, accent) {
  const i = accent ? headline.indexOf(accent) : -1;
  if (i < 0) return [{ text: headline, accent: false }];
  return [
    { text: headline.slice(0, i), accent: false },
    { text: accent, accent: true },
    { text: headline.slice(i + accent.length), accent: false },
  ].filter((p) => p.text);
}
