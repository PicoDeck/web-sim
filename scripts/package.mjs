#!/usr/bin/env node
// Packages a release build into picodeck-web-sim.zip, the layout picodeck.net
// unzips into /try/ (PicoDeck/website scripts/fetch-release.mjs): the page as
// index.html, the simulator (.js, .wasm, .data), its glue shell.js,
// launcher.png (written by make smoke) and version.json.
//
//   node scripts/package.mjs --build build --picodeck ../picodeck --out picodeck-web-sim.zip
// WEB_SIM_VERSION and PICODECK_REF name the versions (default: each checkout's
// exact tag, else its short commit).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { appVersion, releaseTag, versionInfo } from './version.mjs';

export const FILES = {
  'index.html': 'picodeck_simulator.html',
  'picodeck_simulator.js': 'picodeck_simulator.js',
  'picodeck_simulator.wasm': 'picodeck_simulator.wasm',
  'picodeck_simulator.data': 'picodeck_simulator.data',
  'shell.js': 'shell.js',
  'launcher.png': 'launcher.png',
};

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// The test fixture apps' directory names (tests/fixtures/*, the Makefile's
// FIXTURES): a release build must never have one baked in under
// web_sd/apps/ — that means a test build (make test) got packaged instead of
// a release build (make build).
function fixtureAppNames() {
  try {
    return readdirSync(join(REPO_ROOT, 'tests', 'fixtures'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

// A store app's own version, from the app.json web.cmake extracted into the
// build at web_sd/apps/<dir>; null if the build doesn't have it (versionInfo
// then falls back to the app's release tag).
export function storeAppVersion(build, dir) {
  try {
    return JSON.parse(readFileSync(join(build, 'web_sd', 'apps', dir, 'app.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

// A checkout's tag when it sits exactly on one, else its short commit.
function refOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'describe', '--tags', '--exact-match'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return git(dir, 'rev-parse', '--short', 'HEAD');
  }
}

// The build outputs a launcher.png must be newer than: a code-only relink
// rewrites the .js and .wasm and leaves the .data alone.
export const SCREENSHOT_OF = ['picodeck_simulator.js', 'picodeck_simulator.wasm', 'picodeck_simulator.data'];

// The zip's entries: FILES from the build directory, plus version.json.
// Refuses a build that looks like a test build, not a release one: a fixture
// app baked into web_sd/apps/, or a launcher.png older than the newest of
// SCREENSHOT_OF (a stale screenshot from an earlier build).
export function packageBuild({ build, info, fixtures = fixtureAppNames() }) {
  for (const name of fixtures) {
    const path = join(build, 'web_sd', 'apps', name);
    if (existsSync(path)) {
      throw new Error(`${path} is a test fixture app: this looks like a test build `
        + '(make test), not a release build (make build)');
    }
  }
  const entries = {};
  for (const [name, file] of Object.entries(FILES)) {
    const path = join(build, file);
    if (!existsSync(path)) {
      const hint = file === 'launcher.png' ? ' (run make smoke first)' : ' (run make build first)';
      throw new Error(`${path} is missing${hint}`);
    }
    entries[name] = readFileSync(path);
  }
  const pngPath = join(build, FILES['launcher.png']);
  const newest = SCREENSHOT_OF.map((file) => join(build, file))
    .reduce((a, b) => (statSync(b).mtimeMs > statSync(a).mtimeMs ? b : a));
  if (statSync(pngPath).mtimeMs < statSync(newest).mtimeMs) {
    throw new Error(`${pngPath} is older than ${newest}: a stale screenshot from an earlier build `
      + '(run make smoke again)');
  }
  entries['version.json'] = strToU8(`${JSON.stringify(info, null, 2)}\n`);
  return zipSync(entries);
}

function main() {
  const { values } = parseArgs({ options: {
    build: { type: 'string', default: 'build' },
    picodeck: { type: 'string', default: '../picodeck' },
    out: { type: 'string', default: 'picodeck-web-sim.zip' },
  } });
  const here = fileURLToPath(new URL('..', import.meta.url));
  const apps = JSON.parse(readFileSync(join(here, 'apps.json'), 'utf8'));
  const info = versionInfo({
    webSim: process.env.WEB_SIM_VERSION || refOf(here),
    picodeck: {
      ref: process.env.PICODECK_REF || refOf(values.picodeck),
      commit: git(values.picodeck, 'rev-parse', 'HEAD'),
    },
    apps,
    builtinVersion: (dir) => appVersion(values.picodeck, dir),
    storeVersion: (a) => storeAppVersion(values.build, a.dir) ?? releaseTag(a.url),
  });
  writeFileSync(values.out, packageBuild({ build: values.build, info }));
  console.log(`${values.out}: web-sim ${info.web_sim}, PicoDeck ${info.picodeck.ref}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(`package: ${err.message}`); process.exit(1); }
}
