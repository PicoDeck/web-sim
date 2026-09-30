// Browser tests for the built page (see playwright.config.mjs). Tests tagged
// @release run against release builds too (make smoke) and one of them writes
// launcher.png; the rest need the test build's fixture app (make test).
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const PAGE = '/picodeck_simulator.html';
const BUILD = process.env.WEB_SIM_BUILD || 'build-test';
const APPS = JSON.parse(readFileSync(new URL('../apps.json', import.meta.url), 'utf8'));
const ALL_APPS = [...APPS.builtin, ...APPS.store.map((a) => a.dir)];
const FIXTURE_DATA = '/sd/data/net.picodeck.webtest';
// PicoDeck's launcher writes /system/running.txt when it starts an app and
// deletes it when the app returns (RUNNING_PATH in PicoDeck's
// src/os/crashlog.c): here, on the SD image mounted at /sd.
const RUNNING = '/sd/system/running.txt';

// Runs in the page: the screen as the display shows it (320x320 RGB565).
function screenOf() {
  const base = Module._web_screen() >> 1;
  return Array.from(Module.HEAPU16.subarray(base, base + 320 * 320));
}

// The launcher's selection bar (launcher.c C_SEL_BG, RGB565 0x2A94) inside
// row 0: on screen once the launcher list is drawn with its first app selected.
function launcherShown() {
  if (typeof Module === 'undefined' || !Module._web_screen || !Module.HEAPU16) return false;
  const px = Module.HEAPU16[(Module._web_screen() >> 1) + 57 * 320 + 200];
  return px === 0x2a94 || px === 0x942a;
}

function fileText(path) {
  try { return FS.readFile(path, { encoding: 'utf8' }); } catch (e) { return null; }
}

function fileExists(path) {
  try { FS.stat(path); return true; } catch (e) { return false; }
}

async function boot(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE + query);
  await page.waitForFunction(() => typeof Module !== 'undefined'
    && typeof Module._web_screen === 'function' && Module.HEAPU16, null, { timeout: 30_000 });
  return errors;
}

const distinctColours = (pixels) => new Set(pixels).size;

test('boots to the launcher and captures it @release', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForFunction(launcherShown, null, { timeout: 30_000 });
  const pixels = await page.evaluate(screenOf);
  expect(distinctColours(pixels)).toBeGreaterThan(8);
  expect(errors).toEqual([]);
  // The home page's picture of the launcher, from the build under test.
  const png = new PNG({ width: 320, height: 320 });
  pixels.forEach((p, i) => {
    png.data[i * 4] = ((p >> 11) & 31) * 255 / 31;
    png.data[i * 4 + 1] = ((p >> 5) & 63) * 255 / 63;
    png.data[i * 4 + 2] = (p & 31) * 255 / 31;
    png.data[i * 4 + 3] = 255;
  });
  writeFileSync(join(BUILD, 'launcher.png'), PNG.sync.write(png));
});

for (const app of ALL_APPS) {
  test(`${app} starts without a Lua error @release`, async ({ page }) => {
    const errors = await boot(page, `?app=${app}`);
    // Wait until the launcher has started the app, then give it time to load
    // and draw: it must still be running, and the launcher must not be back.
    await page.waitForFunction(fileExists, RUNNING, { timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect(await page.evaluate(fileExists, RUNNING)).toBe(true);
    expect(await page.evaluate(fileText, '/sd/system/error.log')).toBeNull();
    expect(await page.evaluate(launcherShown)).toBe(false);
    expect(distinctColours(await page.evaluate(screenOf))).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
}

test('a release build carries no test fixture @release', async ({ page }) => {
  test.skip(BUILD === 'build-test', 'the test build bundles the fixture on purpose');
  await boot(page);
  const hasFixture = await page.evaluate(() => {
    try { FS.stat('/sd/apps/web_test'); return true; } catch (e) { return false; }
  });
  expect(hasFixture).toBe(false);
});

test('an unknown ?app= boots to the launcher @release', async ({ page }) => {
  const errors = await boot(page, '?app=no-such-app');
  await page.waitForFunction(launcherShown, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('the page still runs without IndexedDB (saves stay in memory) @release', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
  });
  const errors = await boot(page);
  await page.waitForFunction(launcherShown, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test.describe('with the fixture app', () => {
  test.skip(() => BUILD !== 'build-test', 'needs the test build (make test)');

  test('keys reach the app', async ({ page }) => {
    await boot(page, '?app=web_test');
    await page.waitForFunction((p) => { try { FS.stat(p); return true; } catch (e) { return false; } },
      `${FIXTURE_DATA}/boots.txt`, { timeout: 30_000 });
    await page.locator('#canvas').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => { try { return FS.readFile(p, { encoding: 'utf8' }) === '1'; }
      catch (e) { return false; } }, `${FIXTURE_DATA}/enter.txt`, { timeout: 10_000 });
  });

  test('saved data survives a reload', async ({ page }) => {
    await boot(page, '?app=web_test');
    await page.waitForFunction((p) => { try { FS.stat(p); return true; } catch (e) { return false; } },
      `${FIXTURE_DATA}/boots.txt`, { timeout: 30_000 });
    const first = Number(await page.evaluate(fileText, `${FIXTURE_DATA}/boots.txt`));
    // Saves are written back to IndexedDB every 2 s and when the page hides.
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForFunction((args) => {
      try { return Number(FS.readFile(args[0], { encoding: 'utf8' })) === args[1]; }
      catch (e) { return false; }
    }, [`${FIXTURE_DATA}/boots.txt`, first + 1], { timeout: 30_000 });
  });
});
