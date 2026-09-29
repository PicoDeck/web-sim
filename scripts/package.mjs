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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { appVersion, versionInfo } from './version.mjs';

export const FILES = {
  'index.html': 'picodeck_simulator.html',
  'picodeck_simulator.js': 'picodeck_simulator.js',
  'picodeck_simulator.wasm': 'picodeck_simulator.wasm',
  'picodeck_simulator.data': 'picodeck_simulator.data',
  'shell.js': 'shell.js',
  'launcher.png': 'launcher.png',
};

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

// A checkout's tag when it sits exactly on one, else its short commit.
function refOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'describe', '--tags', '--exact-match'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return git(dir, 'rev-parse', '--short', 'HEAD');
  }
}

// The zip's entries: FILES from the build directory, plus version.json.
export function packageBuild({ build, info }) {
  const entries = {};
  for (const [name, file] of Object.entries(FILES)) {
    const path = join(build, file);
    if (!existsSync(path)) {
      const hint = file === 'launcher.png' ? ' (run make smoke first)' : ' (run make build first)';
      throw new Error(`${path} is missing${hint}`);
    }
    entries[name] = readFileSync(path);
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
  });
  writeFileSync(values.out, packageBuild({ build: values.build, info }));
  console.log(`${values.out}: web-sim ${info.web_sim}, PicoDeck ${info.picodeck.ref}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(`package: ${err.message}`); process.exit(1); }
}
