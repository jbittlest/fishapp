// @vitest-environment node
/* tools/deploy.mjs --dry changes nothing anywhere — the build folder included. The public pages are
 * generated into a throwaway copy, so the dry run still builds them and lists what a deploy would
 * copy, while the build itself (shared by everyone working in this tree) keeps the state it was
 * built from. Runs the real script against a stand-in build and a scratch git checkout. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
let dist, target;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)).map((f) => d.name + '/' + f) : [d.name]).sort();

beforeAll(() => {
  // a stand-in for a vite build: every name is one deploy.mjs manages
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-dry-dist-'));
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dist, 'index.html'));
  fs.writeFileSync(path.join(dist, 'sw.js'), '// worker\n');
  fs.cpSync(path.join(ROOT, 'public', 'icons'), path.join(dist, 'icons'), { recursive: true });
  for (const f of ['privacy.html', 'support.html', 'og.png']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(dist, f));

  // the deploy guard wants a checkout of jbittlest/fishapp on main with a commit; plumbing only
  // (no hooks, no identity or signing config needed)
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'fishapp-dry-target-'));
  const git = (args, input) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', input }).trim();
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/jbittlest/fishapp.git']);
  const tree = git(['hash-object', '-t', 'tree', '-w', '--stdin'], '');
  const commit = git(['hash-object', '-t', 'commit', '-w', '--stdin'],
    `tree ${tree}\nauthor t <t@example.test> 0 +0000\ncommitter t <t@example.test> 0 +0000\n\nfixture\n`);
  git(['update-ref', 'refs/heads/main', commit]);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
});
afterAll(() => {
  for (const d of [dist, target]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

describe('deploy --dry', () => {
  it('lists the web pages it would copy, and leaves the build and the target untouched', () => {
    const before = walk(dist);
    const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const res = spawnSync(process.execPath, ['tools/deploy.mjs', '--dry', '--dist', dist, '--target', target], { cwd: ROOT, encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    for (const name of ['get', 'places', 'site', 'sitemap.xml', 'robots.txt', 'index.html', 'og.png']) {
      expect(res.stdout).toContain('[dry] copy    ' + name + '\n');
    }
    expect(res.stdout).toMatch(/web pages: get\/, places\/ \(\d+ MPAs, \d+ reefs\)/);
    expect(res.stdout).toContain('deploy: dry run only — nothing changed');

    expect(walk(dist)).toEqual(before);                                    // no get/, places/, sitemap…
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe(index);   // head not filled
    expect(fs.readdirSync(target)).toEqual(['.git']);
    // the throwaway copy is gone too
    const dryCopy = res.stdout.match(/→ (\S*fishapp-deploy-dry-\S+)/);
    expect(dryCopy).not.toBeNull();
    expect(fs.existsSync(dryCopy[1])).toBe(false);
  }, 60000);
});
