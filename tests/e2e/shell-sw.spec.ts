/* The production service worker: the first visit installs the offline shell, and a relaunch with no
 * network boots the app from it — without a page error. (The worker's update check rejects when
 * sw.js can't be fetched; unhandled, that surfaced as an uncaught error on every offline launch.)
 * Every other e2e test blocks workers; this file allows them. */
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('relaunches offline from the service worker with no page errors', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline emulation of worker fetches is Chromium-only');
  await page.addInitScript(() => { try { localStorage.setItem('fishapp.ack', 'v1'); } catch { /* */ } });
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).length))).reduce((a, b) => a + b, 0));
  expect(cached).toBeGreaterThan(10);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('.shell-offline')).toBeVisible();      // the OFFLINE marker
  // a lazy panel chunk comes from the cache too
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.locator('.ui-sheet h2')).toHaveText('More');
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  expect(errors, errors.join('\n')).toEqual([]);
});
