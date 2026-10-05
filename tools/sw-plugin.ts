/* Generates dist/sw.js from src/sw/sw.template.js after every production build.

   SHELL = every file the build emitted + every file in public/, so the offline shell can never
   drift out of sync with what actually shipped (the old hand-maintained list once 404'd and
   bricked the install). CACHE = a hash over all of those files' contents, so any change at all
   yields a new worker and installed phones update — no version number to bump by hand. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

export function swManifest(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'fishapp-sw-manifest',
    apply: 'build',
    enforce: 'post', // after vite:build-html has emitted index.html into the bundle
    configResolved(c) { config = c; },
    generateBundle(_opts, bundle) {
      const hash = createHash('sha256');
      const emitted = Object.keys(bundle).filter((f) => !f.endsWith('.map')).sort();
      for (const f of emitted) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      const publicDir = config.publicDir;
      // dotfiles (.nojekyll) are hosting hints, not app files — never part of the offline shell
      const pub = walk(publicDir).filter((f) => f !== 'sw.js' && !path.basename(f).startsWith('.')).sort();
      for (const f of pub) { hash.update(f); hash.update(fs.readFileSync(path.join(publicDir, f))); }

      const shell = [...new Set(['./', './index.html', ...[...emitted, ...pub].map((f) => './' + f)])];
      const entryJs = emitted.filter((f) => {
        const item = bundle[f];
        return item.type === 'chunk' && item.isEntry;
      });
      const css = emitted.filter((f) => f.endsWith('.css'));
      const critical = ['./', './index.html', ...entryJs.map((f) => './' + f), ...css.map((f) => './' + f)];

      const template = fs.readFileSync(path.resolve(config.root, 'src/sw/sw.template.js'), 'utf8');
      const source = template
        .replace("'__CACHE__'", JSON.stringify('fishapp-' + hash.digest('hex').slice(0, 12)))
        .replace('__SHELL__', JSON.stringify(shell, null, 2))
        .replace('__CRITICAL__', JSON.stringify(critical));
      if (/__(CACHE|SHELL|CRITICAL)__/.test(source)) this.error('sw.template.js placeholders were not all replaced');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
