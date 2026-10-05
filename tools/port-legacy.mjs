// tools/port-legacy.mjs — one-shot mechanical conversion of the vanilla global-script app
// (js/*.js, loaded in index.html order) into ES modules under src/engine/.
//
//   node tools/port-legacy.mjs [--check]
//
// For every legacy file:
//   * every top-level declaration gets `export` (legacy global names ARE the module API, so any
//     module can import any other module's symbol by its old name with no coordination);
//   * every free identifier that another legacy file declares at top level becomes an explicit
//     `import { name } from './file.js'`; Leaflet's `L` becomes `import L from 'leaflet'`;
//   * names that only exist because some file assigned `window.NAME = …` are reported, as are
//     writes to imported bindings (illegal in ESM) and identifiers nobody declares.
// The report lands in tools/out/port-report.json. Nothing here is clever: it exists so the
// conversion is reproducible and auditable instead of 30 hand edits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import * as eslintScope from 'eslint-scope';
import MagicString from 'magic-string';
import globals from 'globals';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy', 'js');
const OUT = path.join(ROOT, 'src', 'engine');
const check = process.argv.includes('--check');

const html = fs.readFileSync(path.join(ROOT, 'legacy', 'index.html'), 'utf8');
const order = [...html.matchAll(/<script src="\.\/js\/([\w-]+)\.js"><\/script>/g)].map((m) => m[1]);
if (!order.length) throw new Error('no legacy <script src="./js/…"> tags found in index.html');

const BROWSER = new Set([...Object.keys(globals.browser), ...Object.keys(globals.es2021)]);
const parse = (code) => espree.parse(code, { ecmaVersion: 2023, sourceType: 'script', range: true, loc: true });

const files = order.map((name) => {
  const code = fs.readFileSync(path.join(LEGACY, name + '.js'), 'utf8');
  const ast = parse(code);
  const decls = [];   // { name, start }
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') decls.push({ names: [node.id.name], start: node.range[0] });
    else if (node.type === 'VariableDeclaration') {
      const names = [];
      for (const d of node.declarations) collectPattern(d.id, names);
      decls.push({ names, start: node.range[0] });
    }
  }
  const windowNames = [...code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]);
  return { name, code, ast, decls, windowNames };
});

function collectPattern(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => collectPattern(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((e) => collectPattern(e, out));
  else if (p.type === 'AssignmentPattern') collectPattern(p.left, out);
  else if (p.type === 'RestElement') collectPattern(p.argument, out);
}

const owner = new Map();       // symbol -> file
const dupes = [];
for (const f of files) for (const d of f.decls) for (const n of d.names) {
  if (owner.has(n)) dupes.push({ name: n, first: owner.get(n), again: f.name });
  else owner.set(n, f.name);
}
const windowOwner = new Map();
for (const f of files) for (const n of f.windowNames) if (!windowOwner.has(n)) windowOwner.set(n, f.name);

const report = { order, dupes, files: {} };
fs.mkdirSync(OUT, { recursive: true });

for (const f of files) {
  const scopeManager = eslintScope.analyze(f.ast, { ecmaVersion: 2023, sourceType: 'script' });
  const globalScope = scopeManager.globalScope;
  const imports = new Map();   // file -> Set(names)
  const windowRefs = new Set(), unknown = new Set(), illegalWrites = [];
  let usesLeaflet = false;
  for (const ref of globalScope.through) {
    const n = ref.identifier.name;
    if (n === 'L') { usesLeaflet = true; continue; }
    const from = owner.get(n);
    if (from && from !== f.name) {
      if (!imports.has(from)) imports.set(from, new Set());
      imports.get(from).add(n);
      if (ref.isWrite()) illegalWrites.push({ name: n, from, line: ref.identifier.loc.start.line });
      continue;
    }
    if (from === f.name) continue;
    if (windowOwner.has(n)) { windowRefs.add(n); continue; }
    if (BROWSER.has(n)) continue;
    unknown.add(n);
  }

  const s = new MagicString(f.code);
  for (const d of f.decls) s.appendLeft(d.start, 'export ');
  const header = [];
  if (usesLeaflet) header.push("import L from 'leaflet';");
  for (const [from, names] of [...imports].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))) {
    header.push(`import { ${[...names].sort().join(', ')} } from './${from}.js';`);
  }
  if (header.length) s.prepend(header.join('\n') + '\n\n');

  report.files[f.name] = {
    exports: f.decls.flatMap((d) => d.names),
    imports: Object.fromEntries([...imports].map(([k, v]) => [k, [...v].sort()])),
    windowRefs: [...windowRefs].sort(),
    windowDefines: [...new Set(f.windowNames)].sort(),
    unknown: [...unknown].sort(),
    illegalWrites,
  };
  if (!check) fs.writeFileSync(path.join(OUT, f.name + '.js'), s.toString());
}

fs.mkdirSync(path.join(ROOT, 'tools', 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools', 'out', 'port-report.json'), JSON.stringify(report, null, 2));
const sum = Object.entries(report.files).map(([k, v]) =>
  `${k.padEnd(14)} exports ${String(v.exports.length).padStart(3)} · imports from ${Object.keys(v.imports).length} files` +
  (v.windowRefs.length ? ` · window-globals: ${v.windowRefs.join(',')}` : '') +
  (v.unknown.length ? ` · UNKNOWN: ${v.unknown.join(',')}` : '') +
  (v.illegalWrites.length ? ` · WRITES-TO-IMPORTS: ${v.illegalWrites.map((w) => w.name + '@' + w.line).join(',')}` : ''));
console.log(sum.join('\n'));
if (dupes.length) console.log('DUPLICATE top-level names:', JSON.stringify(dupes));
console.log(check ? 'port-legacy: check only' : `port-legacy: wrote ${files.length} modules to src/engine/`);
