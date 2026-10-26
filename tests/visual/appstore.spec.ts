/* App Store Connect screenshots from the production build, at the required pixel sizes:
 *   iPhone 6.9"  1320 × 2868  (440 × 956 CSS px @3x)
 *   iPad 13"     2064 × 2752  (1032 × 1376 CSS px @2x)
 * Run: npx playwright test -c playwright.shots.config.ts tests/visual/appstore.spec.ts
 * Output: FishApp-iOS/AppStoreScreenshots/{iphone-6.9,ipad-13}/NN-name.png */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'C:/Users/jbitt/OneDrive/Desktop/Projects/FishApp-iOS/AppStoreScreenshots';
const SIZES = [
  { dir: 'iphone-6.9', viewport: { width: 440, height: 956 }, dpr: 3, mobile: true },
  { dir: 'ipad-13', viewport: { width: 1032, height: 1376 }, dpr: 2, mobile: true },
];

test.use({ channel: 'chrome' });

for (const s of SIZES) {
  test.describe(s.dir, () => {
    test.use({ viewport: s.viewport, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: true });

    test(`screens ${s.dir}`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'run once (size is set here, not by the project)');
      fs.mkdirSync(path.join(OUT, s.dir), { recursive: true });
      const shot = async (n: string, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(OUT, s.dir, n + '.png') }); };
      const tab = (name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();

      await page.addInitScript(() => {
        try {
          localStorage.setItem('fishapp.ack', 'v1');
          localStorage.setItem('fishapp.theme', 'day');
          localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 13 }));
          localStorage.setItem('fishapp.layers', JSON.stringify({ base: 'ocean', enc: true, seamark: true, reefs: true, mpa: true }));
        } catch {}
      });
      await page.goto('/');
      await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator('.shell-hud')).toContainText(/GPS/, { timeout: 20_000 });
      await page.waitForTimeout(4000);

      // 1 — navigating to a spot
      const box = (await page.locator('#map').boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.32, box.y + box.height * 0.6);
      await expect(page.locator('.shell-card')).toBeVisible({ timeout: 10_000 });
      await shot('02-inspect', 4000);
      await page.locator('.shell-card').getByRole('button', { name: /Navigate/ }).first().click();
      await shot('01-goto', 3500);

      // 3 — weather 10-day
      await tab('Weather');
      await page.getByRole('tab', { name: /10-Day/ }).click().catch(() => {});
      await shot('03-weather', 4500);
      // 4 — tides
      await tab('Tides');
      await shot('04-tides', 5000);
      // 5 — First Mate (offline answer)
      await tab('More');
      await page.locator('.more-tile', { hasText: 'First Mate' }).first().click();
      const input = page.locator('.ui-sheet textarea');
      await input.fill('Is it too rough today?');
      await input.press('Enter');
      const dont = page.getByRole('button', { name: /Don.t allow/ });
      if (await dont.count()) await dont.click();
      await shot('05-first-mate', 4000);
      // 6 — night chart
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Map layers' }).click();
      await page.getByRole('tab', { name: 'Night' }).click();
      await page.keyboard.press('Escape');
      await shot('06-night', 3000);
    });
  });
}
