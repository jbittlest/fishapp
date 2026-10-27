// Open-source licence notices for everything the app ships: the runtime `dependencies` in
// package.json and their own dependencies (react-dom → scheduler), read from node_modules. The
// MIT/ISC/BSD licences and the fonts' SIL OFL all require their notice to travel with the
// software; More › About › Open-source licences shows this file.
//
//   node tools/make-licenses.mjs          writes src/legal/licenses.json (rerun after a dependency change)
//   node tools/make-licenses.mjs --check  exits 1 if the file is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LICENSES_FILE = path.join(ROOT, 'src', 'legal', 'licenses.json');

function readPkg(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
}

function licenceText(root, name) {
  const dir = path.join(root, 'node_modules', name);
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`${name}: no LICENSE file in node_modules — add its notice by hand`);
  return fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim();
}

/** [{name, version, license, homepage, text}] for every shipped runtime package, sorted by name. */
export function collectLicenses(root = ROOT) {
  const top = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies || {});
  const seen = new Map();
  const visit = (name) => {
    if (seen.has(name)) return;
    const pkg = readPkg(root, name);
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || 'see text';
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const homepage = pkg.homepage || (repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : null);
    seen.set(name, { name, version: pkg.version, license, homepage: homepage || null, text: licenceText(root, name) });
    for (const dep of Object.keys(pkg.dependencies || {})) visit(dep);
  };
  top.forEach(visit);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function licensesJson(root = ROOT) {
  return JSON.stringify(collectLicenses(root), null, 1) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = licensesJson();
  const cur = fs.existsSync(LICENSES_FILE) ? fs.readFileSync(LICENSES_FILE, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (cur !== next) { console.error('make-licenses: src/legal/licenses.json is out of date — run node tools/make-licenses.mjs'); process.exit(1); }
    console.log('make-licenses: up to date');
  } else {
    fs.writeFileSync(LICENSES_FILE, next);
    console.log(`make-licenses: ${JSON.parse(next).length} packages → ${path.relative(ROOT, LICENSES_FILE)}`);
  }
}
