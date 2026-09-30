// scripts/publish.sh against a fake gh (first on PATH): FAKE_GH picks what
// GitHub reports, and the fake records each call's arguments to FAKE_GH_LOG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, packageBuild } from '../scripts/package.mjs';

const PUBLISH = fileURLToPath(new URL('../scripts/publish.sh', import.meta.url));
const INFO = { web_sim: 'v1.0.1', picodeck: { ref: 'v0.6.0', commit: 'abcdef1234' }, apps: { builtin: [], store: [] } };
const TARGET = '0123456789abcdef0123456789abcdef01234567';

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

// A scratch directory holding picodeck-web-sim.zip (made as
// test/package.test.mjs makes one) and the fake gh in bin/.
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  const build = join(dir, 'build');
  spawnSync('mkdir', ['-p', build, join(dir, 'bin')]);
  for (const file of Object.values(FILES)) writeFileSync(join(build, file), file);
  writeFileSync(join(dir, 'picodeck-web-sim.zip'), packageBuild({ build, info: INFO }));
  writeFileSync(join(dir, 'bin', 'gh'), FAKE_GH);
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
  return dir;
}

function publish(state, ...args) {
  const dir = scratch();
  const log = join(dir, 'gh.log');
  const r = spawnSync('bash', [PUBLISH, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_GH: state, FAKE_GH_LOG: log },
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { status: r.status, stderr: r.stderr, calls };
}

const creates = (calls) => calls.filter((c) => c[0] === 'release' && c[1] === 'create');

test('no tag: prints the usage and calls nothing', () => {
  const r = publish('fresh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: scripts\/publish\.sh <tag> \[<target commit>\]/);
  assert.deepEqual(r.calls, []);
});

test('an existing release is never overwritten', () => {
  const r = publish('release', 'v1.0.1');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /release v1\.0\.1 already exists/);
  assert.deepEqual(creates(r.calls), []);
});

test('with a target, an existing tag is refused (gh would ignore --target)', () => {
  const r = publish('tag', 'v1.0.1', TARGET);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tag v1\.0\.1 already exists/);
  assert.deepEqual(creates(r.calls), []);
});

test('a lookup that fails for another reason publishes nothing', () => {
  for (const args of [['v1.0.1'], ['v1.0.1', TARGET]]) {
    const r = publish('error', ...args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 503/);
    assert.deepEqual(creates(r.calls), []);
  }
});

test('a pushed tag (no target) publishes its release on that tag', () => {
  const r = publish('tag', 'v1.0.1');
  assert.equal(r.status, 0, r.stderr);
  const [create, ...more] = creates(r.calls);
  assert.deepEqual(more, []);
  const notes = create[create.indexOf('--notes') + 1];
  assert.deepEqual(create, ['release', 'create', 'v1.0.1', 'picodeck-web-sim.zip',
    '--title', 'v1.0.1', '--notes', notes]);
  assert.match(notes, /^Built against PicoDeck v0\.6\.0 \(abcdef1\)\.\n/);
  assert.doesNotMatch(notes, /Rebuilt for/);
});

test('a follow release creates the tag on the target commit, with the Rebuilt for line', () => {
  const r = publish('fresh', 'v1.0.1', TARGET);
  assert.equal(r.status, 0, r.stderr);
  const [create, ...more] = creates(r.calls);
  assert.deepEqual(more, []);
  const notes = create[create.indexOf('--notes') + 1];
  assert.deepEqual(create, ['release', 'create', 'v1.0.1', 'picodeck-web-sim.zip',
    '--title', 'v1.0.1', '--notes', notes, '--target', TARGET]);
  assert.match(notes, /^Built against PicoDeck v0\.6\.0 \(abcdef1\)\.\nRebuilt for PicoDeck v0\.6\.0\.\n/);
});
