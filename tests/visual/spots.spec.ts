/* Visual QA for the spots group: Spots & tracks, the spot editor, spot / reef / MPA cards, the
 * map symbology, Offline charts, and the trolling-motor sheet + armed band.
 * Run against the dev server:
 *   npx playwright test -c playwright.shots.dev.config.ts tests/visual/spots.spec.ts
 * Output: tools/out/shots/spots/<project>-<theme>-<name>.png. Not an assertion suite. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tools/out/shots/spots');
fs.mkdirSync(OUT, { recursive: true });

type Theme = 'day' | 'sun' | 'night';
const THEMES: Theme[] = ['day', 'sun', 'night'];

async function boot(page: Page, theme: Theme, extra: Record<string, string> = {}) {
  await page.addInitScript(([t, x]) => {
    try {
      localStorage.setItem('fishapp.ack', 'v1');
      localStorage.setItem('fishapp.theme', t as string);
      localStorage.setItem('fishapp.view', JSON.stringify({ c: [33.7745, -118.4239], z: 12 }));
      for (const [k, v] of Object.entries(x as Record<string, string>)) localStorage.setItem(k, v);
    } catch { /* storage blocked */ }
  }, [theme, extra] as const);
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.shell-hud')).toContainText(/GPS ±/, { timeout: 30_000 });
  await page.waitForTimeout(2500);
}

const desk = () => test.info().project.name === 'desktop';

async function shot(page: Page, theme: Theme, name: string, wait = 900) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${test.info().project.name}-${theme}-${name}.png`) });
}

async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}
async function more(page: Page, tile: string) {
  if (!(await page.locator('.more-tile').first().isVisible().catch(() => false))) await tab(page, 'More');
  await page.locator('.more-tile', { hasText: tile }).first().click();
  await page.waitForTimeout(600);
}

/* Engine access through the module URLs the app actually loaded (HMR adds ?t= stamps, and a
   bare path would be a second, unconnected instance). String form so the test transform never
   rewrites the dynamic import. Usage inside a snippet: `await M('engine/gps.js')`. */
const M_DEF = `const M = (p) => {
  const hit = performance.getEntriesByType('resource').map((e) => e.name)
    .filter((n) => n.includes('/src/' + p) && !n.includes('import&'))
    .pop();
  return import(hit || ('/src/' + p));
};`;
async function run(page: Page, body: string) {
  return page.evaluate(`(async () => { ${M_DEF} ${body} })()`);
}
async function followOff(page: Page) {
  await run(page, `const g = await M('engine/gps.js'); const a = await M('engine/app.js');
    if (g.GPS.follow) a.toggleFollowByUser();`);
}
async function setView(page: Page, lat: number, lng: number, z: number) {
  await page.evaluate(`window._map.setView([${lat}, ${lng}], ${z}, { animate: false })`);
  await page.waitForTimeout(400);
}
async function pageXY(page: Page, lat: number, lng: number): Promise<{ x: number; y: number }> {
  return page.evaluate(`(() => {
    const p = window._map.latLngToContainerPoint([${lat}, ${lng}]);
    const r = window._map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  })()`);
}
async function dismissToast(page: Page) {
  await run(page, `(await M('services/ui.ts')).dismissToast();`);
}
async function closeAll(page: Page) {
  await run(page, `const u = await M('services/ui.ts'); u.closePanels(); u.closeCard();`);
  await page.waitForTimeout(300);
}
async function scrollSheetTo(page: Page, text: string | RegExp) {
  const el = page.locator('.ui-sheet__body').getByText(text).first();
  await el.evaluate((n) => n.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(250);
}
async function scrollSheet(page: Page, where: 'top' | 'bottom') {
  await page.locator('.ui-sheet__body').evaluate((n, w) => { n.scrollTop = w === 'top' ? 0 : n.scrollHeight; }, where);
  await page.waitForTimeout(250);
}

/** Fill the open spot modal and save it. */
async function fillSpot(page: Page, name: string, type: string, notes = '') {
  const m = page.locator('.ui-modal');
  await expect(m).toBeVisible();
  await m.locator('input').first().fill(name);
  await m.getByRole('radio', { name: type }).click();
  if (notes) await m.locator('textarea').fill(notes);
}
async function saveSpot(page: Page) {
  await page.locator('.ui-modal').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.ui-modal')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(400);
}
async function longPress(page: Page, lat: number, lng: number) {
  const p = await pageXY(page, lat, lng);
  if (desk()) await page.mouse.click(p.x, p.y, { button: 'right' });
  else {
    // a touch long-press reaches Leaflet as the browser's contextmenu event
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    }, p);
  }
  await expect(page.locator('.ui-modal')).toBeVisible({ timeout: 5000 });
}

const VIEW = { lat: 33.785, lng: -118.437, z: 13 };

for (const theme of THEMES) {
  test(`spots — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await followOff(page);
    await setView(page, VIEW.lat, VIEW.lng, VIEW.z);

    // empty Spots & tracks
    await more(page, 'Spots & tracks');
    await scrollSheet(page, 'top');
    await shot(page, theme, '01-spots-empty', 1500);
    await closeAll(page);

    // spot 1: the Mark tab (at the boat)
    await tab(page, 'Mark');
    await expect(page.locator('.ui-modal')).toBeVisible();
    await shot(page, theme, '02-modal-new', 500);
    await fillSpot(page, 'Kelp line north', 'Fishing spot', 'Calico bass on the outside edge at first light. Swimbait, 1 oz.');
    await shot(page, theme, '03-modal-new-filled', 300);
    await saveSpot(page);

    // spot 2 + 3: long-press on the chart
    await longPress(page, 33.800, -118.447);
    await fillSpot(page, 'Rock pile', 'Hazard', 'Breaks at low tide.');
    await shot(page, theme, '04-modal-hazard', 300);
    await saveSpot(page);
    await longPress(page, 33.791, -118.458);
    await fillSpot(page, 'Old barge — 62 ft', 'Wreck / structure');
    await saveSpot(page);

    // the list with three spots
    await more(page, 'Spots & tracks');
    await dismissToast(page);
    await shot(page, theme, '05-spots-three', 1200);
    await dismissToast(page);
    await page.getByRole('button', { name: /More actions for Old barge/ }).click();
    await page.locator('.spot-row.is-open').evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await shot(page, theme, '06-spots-row-open', 500);
    await scrollSheetTo(page, 'Nearest artificial reefs');
    await shot(page, theme, '07-reefs-list', 600);
    await scrollSheet(page, 'bottom');
    await shot(page, theme, '08-spots-bottom', 400);
    await closeAll(page);

    // three more types, so every glyph is on the chart; one long name to test the chip
    await longPress(page, 33.766, -118.449);
    await fillSpot(page, 'Lunada anchorage', 'Anchorage');
    await saveSpot(page);
    await longPress(page, 33.810, -118.442);
    await fillSpot(page, 'Horseshoe kelp outside edge at 90 ft', 'Ramp / dock');
    await saveSpot(page);
    await longPress(page, 33.776, -118.465);
    await fillSpot(page, 'Bait receiver', 'Other');
    await saveSpot(page);

    // markers + name chips on each base map
    for (const base of ['ocean', 'sat', 'street', 'bluetint']) {
      await run(page, `(await M('engine/layers.js')).setBase('${base}', true);`);
      await setView(page, 33.795, -118.437, 13);
      await shot(page, theme, `09-markers-${base}`, 3500);
    }
    // satellite with the NOAA chart overlay off: chips straight over imagery
    await run(page, `const l = await M('engine/layers.js'); l.setBase('sat', true); l.setOverlay('enc', false); l.setOverlay('seamark', false);`);
    await shot(page, theme, '09-markers-sat-bare', 3500);
    await run(page, `const l = await M('engine/layers.js'); l.setOverlay('enc', true); l.setOverlay('seamark', true);`);
    await run(page, `(await M('engine/layers.js')).setBase('ocean', true);`);
    await setView(page, VIEW.lat, VIEW.lng, VIEW.z);

    // spot card (tap the marker), then Edit
    await page.locator('.spot-mk', { hasText: 'Old barge' }).locator('.spot-mk__disc').click();
    await expect(page.locator('.shell-card')).toBeVisible();
    await shot(page, theme, '10-spot-card', 800);
    await page.locator('.shell-card').getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('.ui-modal')).toBeVisible();
    await shot(page, theme, '11-modal-edit', 500);
    await page.locator('.ui-modal').getByRole('button', { name: 'Cancel' }).click();
    await closeAll(page);

    // hazard card with notes
    await page.locator('.spot-mk', { hasText: 'Kelp line north' }).locator('.spot-mk__disc').click();
    await expect(page.locator('.shell-card')).toBeVisible();
    await shot(page, theme, '12-spot-card-notes', 800);
    await closeAll(page);

    // reef card: Palawan (Redondo)
    await setView(page, 33.8236, -118.4147, 14);
    await page.locator('.spot-reefmk-wrap[title="Palawan"]').first().click();
    await expect(page.locator('.shell-card')).toBeVisible();
    await shot(page, theme, '13-reef-card', 6000);
    await closeAll(page);

    // MPA cards: Point Vicente (no take) and Abalone Cove (limited)
    await setView(page, 33.712, -118.445, 12);
    let p = await pageXY(page, 33.712, -118.445);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.shell-card')).toBeVisible();
    await shot(page, theme, '14-mpa-notake', 1200);
    await closeAll(page);
    await setView(page, 33.712, -118.386, 12);
    p = await pageXY(page, 33.712, -118.386);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.shell-card')).toBeVisible();
    await shot(page, theme, '15-mpa-limited', 1200);
  });

  test(`download — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await followOff(page);
    await setView(page, 33.83, -118.40, 14);
    await more(page, 'Offline charts');
    await shot(page, theme, '20-dl-top', 1500);
    await scrollSheet(page, 'bottom');
    await shot(page, theme, '21-dl-bottom-empty', 600);
    await scrollSheet(page, 'top');

    await page.locator('.ui-sheet input').first().fill('Redondo ledge');
    await page.getByRole('radio', { name: /Maximum detail/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Download this area' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Download this area' }).click();
    await expect(page.locator('.dl-progress')).toBeVisible({ timeout: 8000 });
    await page.locator('.dl-progress').evaluate((n) => n.scrollIntoView({ block: 'center' }));
    // let the run get going so the shot shows a moving bar, not the 0 % start
    await page.waitForFunction(() => {
      const v = document.querySelector('.dl-progress__pct .ui-num__v');
      return !v || Number(v.textContent) >= 8;
    }, null, { timeout: 15_000 }).catch(() => {});
    await shot(page, theme, '22-dl-progress', 100);
    const cancel = page.locator('.dl-progress').getByRole('button', { name: /Cancel/ });
    if (await cancel.count()) {
      await cancel.click();
      await shot(page, theme, '23-dl-cancelling', 150);
    }
    await expect(page.locator('.dl-progress')).toHaveCount(0, { timeout: 60_000 });
    await dismissToast(page);
    await scrollSheet(page, 'bottom');
    await shot(page, theme, '24-dl-saved', 1500);
  });

  test(`motor — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await more(page, 'Trolling motor');
    await shot(page, theme, '30-motor-top', 1200);
    await scrollSheetTo(page, '2 · Safety');
    await shot(page, theme, '31-motor-safety', 400);
    await scrollSheetTo(page, '4 · Commands');
    await shot(page, theme, '32-motor-commands-empty', 400);
    await scrollSheet(page, 'bottom');
    await shot(page, theme, '33-motor-log', 400);
  });

  test(`motor armed — ${theme}`, async ({ page }) => {
    const profile = {
      service: '0000fe00-0000-1000-8000-00805f9b34fb', write: '0000fe01-0000-1000-8000-00805f9b34fb',
      notify: '0000fe02-0000-1000-8000-00805f9b34fb',
      frames: [
        { label: 'STOP', hex: 'a5 00 00', danger: false },
        { label: 'Spot-Lock on', hex: 'a5 01 01', danger: true },
        { label: 'Prop speed +1', hex: 'a5 02 01', danger: true },
        { label: 'Read battery', hex: 'a5 09', danger: false },
      ],
    };
    await boot(page, theme, { 'fishapp.motor.profile': JSON.stringify(profile) });
    await more(page, 'Trolling motor');
    await run(page, `(await M('engine/motor.js')).motorStore.setState({
      connected: true, deviceName: 'MK-Ulterra-4F2A', armed: true, deadmanRemainingS: 14 });`);
    await scrollSheetTo(page, '1 · Connection');
    await shot(page, theme, '34-motor-armed-connection', 600);
    await scrollSheetTo(page, '2 · Safety');
    await shot(page, theme, '35-motor-armed-safety', 400);
    await scrollSheetTo(page, '4 · Commands');
    await shot(page, theme, '36-motor-commands', 400);
    await closeAll(page);
    await shot(page, theme, '37-motor-band', 600);
    // no STOP command: the band says Disarm and to use the foot pedal
    await run(page, `(await M('engine/motor.js')).motorStore.setState({ hasStop: false, stopIndex: -1, legacyStopLabel: null });`);
    await shot(page, theme, '38-motor-band-nostop', 400);
    await run(page, `(await M('engine/motor.js')).motorStore.setState({ armed: false, connected: false, deadmanRemainingS: null });`);
  });
}
