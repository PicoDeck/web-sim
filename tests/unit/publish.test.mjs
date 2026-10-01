// scripts/publish.sh against a fake gh (first on PATH): FAKE_GH picks what
// GitHub reports, and the fake records each call's arguments to FAKE_GH_LOG.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, packageBuild } from '../../scripts/package.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const INFO = { web_sim: 'v1.0.1', picodeck: { ref: 'v0.6.0', commit: 'abcdef1234' }, apps: { builtin: [], store: [] } };
const TARGET = '0123456789abcdef0123456789abcdef01234567';

// Every scratch(), removed once all tests in this file have run.
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true }); });

// FAKE_GH: 'fresh' (no release, no tag), 'tag' (the tag exists, no release),
// 'release' (the release exists) or 'error' (every lookup fails with HTTP 503).
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
const state = process.env.FAKE_GH;
const fail = (msg) => { process.stderr.write(msg + '\\n'); process.exit(1); };
if (state === 'error' && (args[1] === 'view' || args[0] === 'api')) fail('HTTP 503: Service Unavailable');
if (args[0] === 'release' && args[1] === 'view') {
  if (state === 'release') { process.stdout.write('title: ' + args[2] + '\\n'); process.exit(0); }
  fail('release not found');
}
if (args[0] === 'api') {
  if (state === 'tag' || state === 'release') { process.stdout.write('{"ref":"refs/tags/x"}\\n'); process.exit(0); }
  fail('gh: Not Found (HTTP 404)');
}
if (args[0] === 'release' && args[1] === 'create') process.exit(0);
fail('fake gh: unexpected call ' + JSON.stringify(args));
`;

// A scratch "repo root": picodeck-web-sim.zip, a scripts/ copy (publish.sh
// resolves its own path, so it must find the zip as a sibling of a real
// scripts/ dir, not rely on cwd), a node_modules symlink (so the copied
// notes.mjs can still resolve fflate) and the fake gh in bin/.
function scratch(info = INFO) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  tmpDirs.push(dir);
  const build = join(dir, 'build');
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(build, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  for (const file of Object.values(FILES)) writeFileSync(join(build, file), file);
  writeFileSync(join(dir, 'picodeck-web-sim.zip'), packageBuild({ build, info }));
  for (const name of ['publish.sh', 'notes.mjs', 'version.mjs', 'zip-version.mjs']) {
    writeFileSync(join(scriptsDir, name), readFileSync(join(SCRIPTS_DIR, name)));
  }
  chmodSync(join(scriptsDir, 'publish.sh'), 0o755);
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'bin', 'gh'), FAKE_GH);
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
  return dir;
}

// cwd defaults to the scratch root (as a pushed-tag CI run would see it); pass
// one elsewhere to prove publish.sh does not depend on it. info overrides the
// zip's version.json (for the version-mismatch test).
function publish(state, args, { cwd, info } = {}) {
  const dir = scratch(info);
  const log = join(dir, 'gh.log');
  const zip = join(dir, 'picodeck-web-sim.zip');
  const r = spawnSync('bash', [join(dir, 'scripts', 'publish.sh'), ...args], {
    cwd: cwd ?? dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_GH: state, FAKE_GH_LOG: log },
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { status: r.status, stderr: r.stderr, calls, zip };
}

const creates = (calls) => calls.filter((c) => c[0] === 'release' && c[1] === 'create');

test('no tag: prints the usage and calls nothing', () => {
  const r = publish('fresh', []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: scripts\/publish\.sh <tag> \[<target commit>\]/);
  assert.deepEqual(r.calls, []);
});

test('an existing release is never overwritten', () => {
  const r = publish('release', ['v1.0.1']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /release v1\.0\.1 already exists/);
  assert.deepEqual(creates(r.calls), []);
});

test('with a target, an existing tag is refused (gh would ignore --target)', () => {
  const r = publish('tag', ['v1.0.1', TARGET]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tag v1\.0\.1 already exists/);
  assert.deepEqual(creates(r.calls), []);
});

test('a lookup that fails for another reason publishes nothing', () => {
  for (const args of [['v1.0.1'], ['v1.0.1', TARGET]]) {
    const r = publish('error', args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 503/);
    assert.deepEqual(creates(r.calls), []);
  }
});

test('a pushed tag (no target) publishes its release on that tag', () => {
  const r = publish('tag', ['v1.0.1']);
  assert.equal(r.status, 0, r.stderr);
  const [create, ...more] = creates(r.calls);
  assert.deepEqual(more, []);
  const notes = create[create.indexOf('--notes') + 1];
  assert.deepEqual(create, ['release', 'create', 'v1.0.1', r.zip,
    '--title', 'v1.0.1', '--notes', notes]);
  assert.match(notes, /^Built against PicoDeck v0\.6\.0 \(abcdef1\)\.\n/);
  assert.doesNotMatch(notes, /Rebuilt for/);
});

test('a follow release creates the tag on the target commit, with the Rebuilt for line', () => {
  const r = publish('fresh', ['v1.0.1', TARGET]);
  assert.equal(r.status, 0, r.stderr);
  const [create, ...more] = creates(r.calls);
  assert.deepEqual(more, []);
  const notes = create[create.indexOf('--notes') + 1];
  assert.deepEqual(create, ['release', 'create', 'v1.0.1', r.zip,
    '--title', 'v1.0.1', '--notes', notes, '--target', TARGET]);
  assert.match(notes, /^Built against PicoDeck v0\.6\.0 \(abcdef1\)\.\nRebuilt for PicoDeck v0\.6\.0\.\n/);
});

test('works from another directory: the zip is resolved from the script path, not cwd', () => {
  const r = publish('tag', ['v1.0.1'], { cwd: tmpdir() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(creates(r.calls).length, 1);
});

test('a version mismatch (the build forgot WEB_SIM_VERSION) is refused', () => {
  const r = publish('fresh', ['v1.0.2'], { info: { ...INFO, web_sim: 'v1.0.1' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /packaged as web_sim v1\.0\.1, not v1\.0\.2/);
  assert.deepEqual(r.calls, []);
});
