// tools/deploy.mjs — copy the production build (dist/) into the GitHub Pages working copy.
//
//   node tools/deploy.mjs [--dry] [--target <dir>]
//
// The Pages repo serves branch `main` from its root, so the built site has to live at the root
// of that checkout. This source tree (branch `ui-src`, outside OneDrive so node_modules never
// syncs) builds into dist/; this script mirrors dist/ into the deploy checkout and nothing else.
//
// Guarded so it can never wipe the wrong folder: the target must be a git checkout of
// jbittlest/fishapp on branch main, and only the paths listed in MANAGED/LEGACY are ever
// removed. .git, .claude, .gitignore and anything unlisted are left alone.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_TARGET = 'C:/Users/jbitt/OneDrive/Desktop/Projects/FishApp';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const ti = argv.indexOf('--target');
const TARGET = path.resolve(ti >= 0 ? argv[ti + 1] : (process.env.FISHAPP_DEPLOY_DIR || DEFAULT_TARGET));

/* Paths the build owns in the deploy checkout: replaced wholesale on every deploy. */
const MANAGED = ['index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll', 'assets', 'icons', 'data'];
/* The pre-React vanilla app. Removed if present; they are not part of the new build. */
const LEGACY = ['js', 'css', 'libs'];
/* Docs + infra that live in this source tree and are mirrored so the public repo stays readable. */
const DOCS = ['README.md', 'MOTOR.md', 'proxy'];

function fail(msg) { console.error('deploy: ' + msg); process.exit(1); }
function git(...args) { return execFileSync('git', ['-C', TARGET, ...args], { encoding: 'utf8' }).trim(); }

if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(DIST, 'sw.js'))) fail('dist/ is missing index.html or sw.js — run `npm run build` first');
if (path.relative(ROOT, TARGET) === '' || !path.relative(ROOT, TARGET).startsWith('..')) fail(`refusing to deploy into the source tree itself (${TARGET})`);
if (!fs.existsSync(path.join(TARGET, '.git'))) fail(`${TARGET} is not a git checkout`);
let origin = '', branch = '';
try { origin = git('remote', 'get-url', 'origin'); branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch (e) { fail('could not read git state of target: ' + e.message); }
if (!/jbittlest\/fishapp(\.git)?$/i.test(origin)) fail(`target origin is ${origin}, expected jbittlest/fishapp`);
if (branch !== 'main') fail(`target is on branch ${branch}, expected main`);

const rm = (rel) => {
  const p = path.join(TARGET, rel);
  if (!fs.existsSync(p)) return;
  console.log(`${dry ? '[dry] ' : ''}remove  ${rel}`);
  if (!dry) fs.rmSync(p, { recursive: true, force: true });
};
const cp = (from, rel) => {
  console.log(`${dry ? '[dry] ' : ''}copy    ${rel}`);
  if (!dry) fs.cpSync(from, path.join(TARGET, rel), { recursive: true });
};

for (const rel of [...MANAGED, ...LEGACY]) rm(rel);
for (const name of fs.readdirSync(DIST)) {
  if (!MANAGED.includes(name)) fail(`dist/${name} is not in the MANAGED list — add it to tools/deploy.mjs so it is cleaned up on the next deploy`);
  cp(path.join(DIST, name), name);
}
for (const rel of DOCS) if (fs.existsSync(path.join(ROOT, rel))) { rm(rel); cp(path.join(ROOT, rel), rel); }

console.log(dry ? 'deploy: dry run only — nothing changed' : `deploy: ok → ${TARGET}`);
if (!dry) console.log(git('status', '--short').split('\n').slice(0, 40).join('\n') || '(no changes)');
