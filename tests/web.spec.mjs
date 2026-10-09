// Browser tests for the built page (see playwright.config.mjs). Tests tagged
// @release run against release builds too (make smoke) and one of them writes
// launcher.png; the rest need the test build's fixture apps (make test).
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const PAGE = '/picodeck_simulator.html';
const BUILD = process.env.WEB_SIM_BUILD || 'build-test';
const APPS = JSON.parse(readFileSync(new URL('../apps.json', import.meta.url), 'utf8'));
const ALL_APPS = [...APPS.builtin, ...APPS.store.map((a) => a.dir)];
const FIXTURE_DATA = '/sd/data/net.picodeck.webtest';
const BUSY_DATA = '/sd/data/net.picodeck.webbusy';
const NATIVE_DATA = '/sd/data/net.picodeck.webnative';
// The test build's fixture apps (tests/fixtures/, the Makefile's FIXTURES).
const FIXTURE_APPS = ['web_test', 'web_busy', 'web_native', 'web_native_bad', 'web_native_nowasm'];
// PicoDeck's launcher writes /system/running.txt when it starts an app and
// deletes it when the app returns (RUNNING_PATH in PicoDeck's
// src/os/crashlog.c): here, on the SD image mounted at /sd.
const RUNNING = '/sd/system/running.txt';

// Runs in the page: the screen as the display shows it (320x320 RGB565).
function screenOf() {
  const base = Module._web_screen() >> 1;
  return Array.from(Module.HEAPU16.subarray(base, base + 320 * 320));
}

function fileText(path) {
  try { return FS.readFile(path, { encoding: 'utf8' }); } catch (e) { return null; }
}

function fileExists(path) {
  try { FS.stat(path); return true; } catch (e) { return false; }
}

// Waits until a path exists in the mounted FS (shared by the fixture tests
// and the per-app "still running" wait: three tests used to repeat this as
// an inline page.waitForFunction closure).
function waitForFile(page, path, options) {
  return page.waitForFunction(fileExists, path, options);
}

// The screen as the display shows it isn't blank: more than 8 distinct
// colours. Self-contained (no outside references) so it can run as a
// page.waitForFunction predicate.
function screenNotBlank() {
  if (typeof Module === 'undefined' || !Module._web_screen || !Module.HEAPU16) return false;
  const base = Module._web_screen() >> 1;
  return new Set(Module.HEAPU16.subarray(base, base + 320 * 320)).size > 8;
}

// The launcher logs this once it has scanned /apps (src/os/launcher.c,
// printf("[LAUNCHER] Found %d apps")), whether or not it then auto-launches
// an app: page/shell.js routes stdout to console.log.
const LAUNCHER_FOUND_RE = /\[LAUNCHER\] Found \d+ apps/;
// What the launcher prints when ?app= (--launch) names no app it has, after
// "[LAUNCHER] Found N apps" and before it draws the launcher
// (src/os/launcher.c, launcher_run): "[LAUNCHER] Failed to auto-launch: <app>".
const autoLaunchFailed = (app) => `[LAUNCHER] Failed to auto-launch: ${app}`;
// What a Lua error prints to the console too (src/os/crashlog.c's
// crashlog_write, always called by lua_bridge_show_error / a launch
// failure): "[LUA ERROR] <app>: <context>: <message> (<heap>)".
const LUA_ERROR_RE = /\[LUA ERROR\]/;

// The launcher has started: its boot line reached the console and the
// screen has drawn something. No pixel-colour dependency, so a launcher
// restyle can't break this the way reading a specific selection-bar colour
// could.
async function waitForLauncher(page, consoleLines, timeout = 30_000) {
  await page.waitForFunction(screenNotBlank, null, { timeout });
  await expect.poll(() => consoleLines.some((l) => LAUNCHER_FOUND_RE.test(l)),
    { timeout: 5000, message: 'the "[LAUNCHER] Found N apps" console line never arrived' }).toBe(true);
}

async function boot(page, query = '') {
  const errors = [];
  const consoleLines = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => consoleLines.push(msg.text()));
  // Never let a test depend on the live site: page/shell.html loads
  // brand.css and a font from picodeck.net.
  await page.route('https://picodeck.net/**',
    (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
  await page.goto(PAGE + query);
  await page.waitForFunction(() => typeof Module !== 'undefined'
    && typeof Module._web_screen === 'function' && Module.HEAPU16, null, { timeout: 30_000 });
  return { errors, consoleLines };
}

const distinctColours = (pixels) => new Set(pixels).size;

// The screen once it has settled: two reads about 250 ms apart that are the
// same. waitForLauncher's console line comes before the launcher's first
// draw, so a build that yields in between (say while a boot splash is up)
// would otherwise be captured mid-change. Fails if it never settles.
async function stableScreen(page, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let before = await page.evaluate(screenOf);
  for (;;) {
    await page.waitForTimeout(250);
    const now = await page.evaluate(screenOf);
    if (now.every((p, i) => p === before[i])) return now;
    if (Date.now() > deadline) throw new Error(`the screen never held still for 250 ms within ${timeout / 1000} s`);
    before = now;
  }
}

// The page's test hooks (platform/web_platform.c): queue an app launch as the
// launcher's ?app= does, and ask the running app to exit as the dev `exit`
// command does.
const launch = (page, app) => page.evaluate((a) => Module.ccall('web_launch', null, ['string'], [a]), app);
const exitApp = (page) => page.evaluate(() => Module.ccall('web_exit_app', null, [], []));

// Waits until a file in the mounted FS holds exactly `text`.
function waitForText(page, path, text, options) {
  return page.waitForFunction((args) => {
    try { return FS.readFile(args[0], { encoding: 'utf8' }) === args[1]; } catch (e) { return false; }
  }, [path, text], options);
}

function waitForNoFile(page, path, options) {
  return page.waitForFunction((p) => { try { FS.stat(p); return false; } catch (e) { return true; } },
    path, options);
}

test('boots to the launcher and captures it @release', async ({ page }) => {
  const { errors, consoleLines } = await boot(page);
  await waitForLauncher(page, consoleLines);
  const pixels = await stableScreen(page);
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
    const { errors, consoleLines } = await boot(page, `?app=${app}`);
    // Wait until the launcher has started the app, then give it time to load
    // and draw: it must still be running (running.txt is gone once the
    // launcher is back, so this doesn't depend on any screen pixel).
    await waitForFile(page, RUNNING, { timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect(await page.evaluate(fileExists, RUNNING)).toBe(true);
    expect(await page.evaluate(fileText, '/sd/system/error.log')).toBeNull();
    expect(consoleLines.some((l) => LUA_ERROR_RE.test(l)), consoleLines.join('\n')).toBe(false);
    expect(distinctColours(await page.evaluate(screenOf))).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
}

test('a release build carries no test fixture @release', async ({ page }) => {
  test.skip(BUILD === 'build-test', 'the test build bundles the fixtures on purpose');
  await boot(page);
  for (const app of FIXTURE_APPS) {
    expect(await page.evaluate(fileExists, `/sd/apps/${app}`), app).toBe(false);
  }
});

test('an unknown ?app= boots to the launcher @release', async ({ page }) => {
  const app = 'no-such-app';
  const { errors, consoleLines } = await boot(page, `?app=${app}`);
  await waitForLauncher(page, consoleLines);
  // "Found N apps" comes before the launch attempt, so on its own it doesn't
  // show the page got back to the launcher: the attempt must have failed
  // (not hung or started something) and no app may be running.
  await expect.poll(() => consoleLines.includes(autoLaunchFailed(app)),
    { timeout: 10_000, message: `the "${autoLaunchFailed(app)}" console line never arrived` }).toBe(true);
  expect(await page.evaluate(fileExists, RUNNING), 'an app is running').toBe(false);
  expect(errors).toEqual([]);
});

test('the page still runs without IndexedDB (saves stay in memory) @release', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
  });
  const { errors, consoleLines } = await boot(page);
  await waitForLauncher(page, consoleLines);
  // The first save sync fails (no usable IndexedDB) and must not then retry
  // every 2 s for the rest of the session (platform/web_platform.c,
  // web_fs_init_js): at most one warning in a 5 s window.
  await page.waitForTimeout(5000);
  const warnings = consoleLines.filter((l) => /\[WEB\] save sync failed/.test(l));
  expect(warnings.length, consoleLines.join('\n')).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test.describe('with the fixture apps', () => {
  test.skip(() => BUILD !== 'build-test', 'needs the test build (make test)');

  test('keys reach the app', async ({ page }) => {
    await boot(page, '?app=web_test');
    await waitForFile(page, `${FIXTURE_DATA}/boots.txt`, { timeout: 30_000 });
    await page.locator('#canvas').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => { try { return FS.readFile(p, { encoding: 'utf8' }) === '1'; }
      catch (e) { return false; } }, `${FIXTURE_DATA}/enter.txt`, { timeout: 10_000 });
  });

  test('saved data survives a reload', async ({ page }) => {
    await boot(page, '?app=web_test');
    await waitForFile(page, `${FIXTURE_DATA}/boots.txt`, { timeout: 30_000 });
    const first = Number(await page.evaluate(fileText, `${FIXTURE_DATA}/boots.txt`));
    // Saves are written back to IndexedDB every 2 s and when the page hides.
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForFunction((args) => {
      try { return Number(FS.readFile(args[0], { encoding: 'utf8' })) === args[1]; }
      catch (e) { return false; }
    }, [`${FIXTURE_DATA}/boots.txt`, first + 1], { timeout: 30_000 });
  });

  // web_busy spins in a pure Lua loop (no sleep, flush or input poll): the
  // tab must still get its event loop back, or the page freezes for good.
  test('a Lua loop that never yields leaves the page responsive', async ({ page }) => {
    const { errors } = await boot(page, '?app=web_busy');
    await waitForFile(page, `${BUSY_DATA}/started.txt`, { timeout: 30_000 });
    // Wait in the test, not with page.waitForTimeout: on a frozen page every
    // page call hangs (the trace snapshots the page after each one). The
    // fixture sleeps 500 ms after its marker, then spins: by now it spins.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(1500);
    // An animation frame needs the page's event loop, which a tab that never
    // yields never runs: bound each wait, as page.evaluate has no timeout.
    for (let i = 0; i < 3; i++) {
      const frame = page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true))));
      frame.catch(() => {});  // a frozen page rejects it when the test closes it
      expect(await Promise.race([frame, sleep(3000).then(() => false)]),
        'no animation frame within 3 s: the busy Lua loop froze the tab').toBe(true);
    }
    // Still the busy app spinning, not a Lua error or the launcher.
    expect(await page.evaluate(fileExists, RUNNING)).toBe(true);
    expect(await page.evaluate(fileText, '/sd/system/error.log')).toBeNull();
    expect(errors).toEqual([]);
  });

  // web_native (tests/fixtures/web_native/main.c) is a compiled-in native app:
  // platform/web_native.c loads its main.wasm and hands it PicoDeck's g_api.
  test('a native app runs from its main.wasm and uses the API tables', async ({ page }) => {
    const { errors, consoleLines } = await boot(page, '?app=web_native');
    await waitForText(page, `${NATIVE_DATA}/ready.txt`, '1', { timeout: 30_000 });
    const read = (name) => page.evaluate(fileText, `${NATIVE_DATA}/${name}`);
    expect(await read('launches.txt')).toBe('1');
    expect(await read('runs.txt')).toBe('1');
    expect(await read('jumped.txt')).toBe('7');
    expect(await read('audio.txt')).toBe('ticked');
    expect(await read('libc_abs.txt')).toBe('ok');
    expect(await read('libc_rel.txt')).toBe('ok');
    // Green from the drawing call; red from the raw panel-order rows 100-199.
    const screen = await page.evaluate(screenOf);
    expect(screen[50 * 320 + 160].toString(16)).toBe('7e0');
    expect(screen[150 * 320 + 160].toString(16)).toBe('f800');
    expect(consoleLines.some((l) => /\[APP\] WEBNATIVE ready 1/.test(l)), consoleLines.join('\n')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a native app exits, and every relaunch starts clean', async ({ page }) => {
    const { errors, consoleLines } = await boot(page, '?app=web_native');
    await waitForText(page, `${NATIVE_DATA}/ready.txt`, '1', { timeout: 30_000 });
    for (let n = 2; n <= 5; n++) {
      // Alternate the two ways out: the exit request (shouldExit) and Esc.
      if (n % 2 === 0) {
        await exitApp(page);
      } else {
        await page.locator('#canvas').focus();
        await page.keyboard.press('Escape');
      }
      await waitForNoFile(page, RUNNING, { timeout: 15_000 });
      await launch(page, 'web_native');
      await waitForText(page, `${NATIVE_DATA}/ready.txt`, String(n), { timeout: 30_000 });
      expect(await page.evaluate(fileText, `${NATIVE_DATA}/runs.txt`), `launch ${n}`).toBe('1');
    }
    // The fixture returns with its audio callback still registered: the OS
    // must clear it, and the page must keep running at the launcher.
    await exitApp(page);
    await waitForNoFile(page, RUNNING, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    await page.waitForFunction(screenNotBlank, null, { timeout: 10_000 });
    expect(errors).toEqual([]);
    expect(consoleLines.some((l) => /RuntimeError/.test(l)), consoleLines.join('\n')).toBe(false);
    // The fixture sets system_clock_khz: the launcher's clock change at each
    // launch and exit pauses Core 1, which must ack rather than time out.
    expect(consoleLines.some((l) => /\[LAUNCHER\] Changing clock/.test(l))).toBe(true);
    expect(consoleLines.some((l) => /Core 1 pause timeout/.test(l)), consoleLines.join('\n')).toBe(false);
  });

  test('a native app with a broken main.wasm returns to the launcher', async ({ page }) => {
    const { errors, consoleLines } = await boot(page, '?app=web_native_bad');
    await expect.poll(() => consoleLines.some((l) => /\[WEB\] Web Native Bad: main\.wasm failed to load/.test(l)),
      { timeout: 30_000, message: consoleLines.join('\n') }).toBe(true);
    await page.locator('#canvas').focus();
    await page.keyboard.press('Escape');  // dismiss the launcher's error screen, if any
    await waitForNoFile(page, RUNNING, { timeout: 15_000 });
    await page.waitForFunction(screenNotBlank, null, { timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test('a native app without a main.wasm is refused, not run', async ({ page }) => {
    const { errors, consoleLines } = await boot(page, '?app=web_native_nowasm');
    await expect.poll(() => consoleLines.some((l) => /\[WEB\] Web Native No Wasm has no browser build/.test(l)),
      { timeout: 30_000, message: consoleLines.join('\n') }).toBe(true);
    await page.locator('#canvas').focus();
    await page.keyboard.press('Escape');
    await waitForNoFile(page, RUNNING, { timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});

// DOOM (PicoDeck/doom's main.wasm): in a release build once apps.json lists
// it, in a test build when made with DOOM=<a Doom checkout> (make test).
// It draws rows 60-259 (dg_picodeck.c, DOOM_Y_OFFSET).
function doomDrawn() {
  if (typeof Module === 'undefined' || !Module._web_screen || !Module.HEAPU16) return false;
  const base = Module._web_screen() >> 1;
  return new Set(Module.HEAPU16.subarray(base + 60 * 320, base + 260 * 320)).size > 16;
}

test('DOOM plays, exits to the launcher and starts again @release', async ({ page }) => {
  const { errors, consoleLines } = await boot(page);
  await waitForLauncher(page, consoleLines);
  test.skip(!(await page.evaluate(fileExists, '/sd/apps/doom/main.wasm')), 'no DOOM in this build');
  for (const round of [1, 2]) {
    await launch(page, 'doom');
    await waitForFile(page, RUNNING, { timeout: 30_000 });
    await page.waitForFunction(doomDrawn, null, { timeout: 60_000 });
    await exitApp(page);
    await waitForNoFile(page, RUNNING, { timeout: 15_000 });
    expect(consoleLines.filter((l) => /\[WEB\] DOOM returned/.test(l)).length, `round ${round}`).toBe(round);
  }
  expect(consoleLines.some((l) => /\[APP\] DOOM: Exiting/.test(l)), consoleLines.join('\n')).toBe(true);
  // DOOM sets system_clock_khz: no stall waiting for Core 1 at launch or exit.
  expect(consoleLines.some((l) => /Core 1 pause timeout/.test(l)), consoleLines.join('\n')).toBe(false);
  expect(errors).toEqual([]);
});
