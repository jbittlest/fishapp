/* Load legacy (pre-module) scripts and return the named top-level consts/functions they define.
   The legacy files are classic scripts with top-level `const`s, so they are concatenated (in
   the order index.html loads them) and evaluated in a Function body that returns them. Used to
   characterise the port against the original code. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * @param {string|string[]} files  path(s) under legacy/js, e.g. 'knot-diagrams.js'
 * @param {string[]} names  top-level identifiers to return
 * @param {string} [prelude]  code run first (stand-ins for globals the scripts read)
 * @returns {Record<string, any>}
 */
export function loadLegacy(files, names, prelude = '') {
  const list = Array.isArray(files) ? files : [files];
  const src = list.map((f) => readFileSync(resolve(root, 'legacy/js', f), 'utf8')).join('\n;\n');
  return new Function(prelude + '\n' + src + '\n;return {' + names.join(',') + '};')();
}
