import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { FILES, packageBuild, storeAppVersion } from '../../scripts/package.mjs';
import { notesFromZip } from '../../scripts/notes.mjs';

const INFO = { web_sim: 'v1.0.0', picodeck: { ref: 'v0.5.0', commit: 'abcdef1234' }, apps: { builtin: [], store: [] } };

// Every fakeBuild(), removed once all tests in this file have run.
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true }); });

function fakeBuild() {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  tmpDirs.push(dir);
  for (const file of Object.values(FILES)) writeFileSync(join(dir, file), file);
  return dir;
}

test('the zip has the layout picodeck.net unzips into /try/', () => {
  const files = unzipSync(packageBuild({ build: fakeBuild(), info: INFO }));
  assert.deepEqual(Object.keys(files).sort(), ['index.html', 'launcher.png', 'picodeck_simulator.data',
    'picodeck_simulator.js', 'picodeck_simulator.wasm', 'shell.js', 'version.json']);
  assert.equal(strFromU8(files['index.html']), 'picodeck_simulator.html');
  assert.equal(JSON.parse(strFromU8(files['version.json'])).picodeck.ref, 'v0.5.0');
});

test('a build without launcher.png is refused with the fix', () => {
  const dir = fakeBuild();
  rmSync(join(dir, 'launcher.png'));
  assert.throws(() => packageBuild({ build: dir, info: INFO }), /launcher\.png is missing \(run make smoke first\)/);
});

test('notes come from the zip\'s version.json', () => {
  assert.match(notesFromZip(packageBuild({ build: fakeBuild(), info: INFO })), /^Built against PicoDeck v0\.5\.0/);
});

test('a build with a test fixture app baked in is refused (it looks like a test build)', () => {
  const dir = fakeBuild();
  mkdirSync(join(dir, 'web_sd', 'apps', 'web_test'), { recursive: true });
  assert.throws(() => packageBuild({ build: dir, info: INFO }), /web_test/);
});

// A time `s` seconds from now, for utimesSync.
const at = (s) => new Date(Date.now() + s * 1000);

test('a launcher.png older than picodeck_simulator.data is refused (a stale screenshot)', () => {
  const dir = fakeBuild();
  for (const file of Object.values(FILES)) utimesSync(join(dir, file), at(-120), at(-120));
  utimesSync(join(dir, 'launcher.png'), at(-60), at(-60));
  utimesSync(join(dir, 'picodeck_simulator.data'), at(-30), at(-30));
  assert.throws(() => packageBuild({ build: dir, info: INFO }),
    /launcher\.png is older than .*picodeck_simulator\.data: a stale screenshot/);
});

// A code-only relink rewrites the .js and .wasm but not the .data: the
// screenshot is judged against whichever build output is newest.
test('a launcher.png older than a relinked .js or .wasm is refused, even when newer than the .data', () => {
  for (const relinked of ['picodeck_simulator.js', 'picodeck_simulator.wasm']) {
    const dir = fakeBuild();
    for (const file of Object.values(FILES)) utimesSync(join(dir, file), at(-120), at(-120));
    utimesSync(join(dir, 'launcher.png'), at(-60), at(-60));  // after the .data ...
    utimesSync(join(dir, relinked), at(-30), at(-30));        // ... before the relink
    assert.throws(() => packageBuild({ build: dir, info: INFO }),
      new RegExp(`launcher\\.png is older than .*${relinked.replace('.', '\\.')}: a stale screenshot`), relinked);
  }
});

test('a launcher.png newer than all of the .js, .wasm and .data is packaged', () => {
  const dir = fakeBuild();
  for (const file of Object.values(FILES)) utimesSync(join(dir, file), at(-120), at(-120));
  utimesSync(join(dir, 'picodeck_simulator.wasm'), at(-90), at(-90));
  utimesSync(join(dir, 'launcher.png'), at(-60), at(-60));
  assert.ok(packageBuild({ build: dir, info: INFO }).length > 0);
});

test('storeAppVersion reads a store app\'s own app.json from the build, or null', () => {
  const dir = fakeBuild();
  mkdirSync(join(dir, 'web_sd', 'apps', 'blockexe'), { recursive: true });
  writeFileSync(join(dir, 'web_sd', 'apps', 'blockexe', 'app.json'), '{"version":"1.0.5"}');
  assert.equal(storeAppVersion(dir, 'blockexe'), '1.0.5');
  assert.equal(storeAppVersion(dir, 'missing'), null);
});
