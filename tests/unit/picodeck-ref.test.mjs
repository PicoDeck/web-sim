import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { output, readPin, resolveRef, validateRef } from '../../scripts/picodeck-ref.mjs';

const WITH_SEAM = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n...\n    sim_native_api.c\n';
const SEAM_BEFORE_NATIVE = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n';
const WITHOUT = 'if(EMSCRIPTEN)\n  set(SIM_PLATFORM_SOURCES web/web_platform.c)\n';
const repo = (tag, cmake) => ({ latestTag: async () => tag, cmakeAt: async () => cmake });

test('an explicit ref wins', async () => {
  assert.deepEqual(await resolveRef({ explicit: 'develop', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) }),
    { ref: 'develop', source: 'requested', why: 'requested' });
});

test('the latest release, when it has the web build seam', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) });
  assert.equal(r.ref, 'v0.5.0');
  assert.equal(r.source, 'release');
  assert.match(r.why, /^latest release/);
});

test('the pin, while the latest release predates the seam', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc123', ...repo('v0.4.0', WITHOUT) });
  assert.equal(r.ref, 'abc123');
  assert.equal(r.source, 'pin');
  assert.match(r.why, /v0\.4\.0, predates the web build seam/);
});

test('the pin, while the latest release has the seam but not native apps', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc123', ...repo('v0.5.1', SEAM_BEFORE_NATIVE) });
  assert.equal(r.ref, 'abc123');
  assert.equal(r.source, 'pin');
});

test('the pin, when PicoDeck has no release at all', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc123', ...repo(null, '') });
  assert.equal(r.ref, 'abc123');
  assert.equal(r.source, 'pin');
});

test('no seam and no pin is an error, not a guess', async () => {
  await assert.rejects(resolveRef({ explicit: '', pin: '', ...repo('v0.4.0', WITHOUT) }), /picodeck\.pin is empty/);
});

test('readPin skips comments and blank lines', () => {
  assert.equal(readPin('# PicoDeck commit with the seam\n\n  5cd3ec1 \n'), '5cd3ec1');
  assert.equal(readPin('# nothing\n'), '');
});

test('validateRef accepts a plain branch, tag or SHA', () => {
  for (const ref of ['develop', 'v0.5.0', 'release/v1.0', '5cd3ec1', '0123456789abcdef0123456789abcdef01234567']) {
    assert.equal(validateRef(ref), ref);
  }
});

test('validateRef rejects whitespace, newlines, .., a leading -, and chars git forbids', () => {
  for (const bad of ['a b', 'a\tb', 'a\nb', 'v1..v2', '-rf', '-', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '']) {
    assert.throws(() => validateRef(bad), undefined, JSON.stringify(bad));
  }
});

test('resolveRef validates an explicit ref before using it', async () => {
  await assert.rejects(resolveRef({ explicit: '-x', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) }),
    /ref/);
  await assert.rejects(resolveRef({ explicit: 'a..b', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) }),
    /ref/);
});

test('output writes key=value lines to stdout and appends them to $GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'output-'));
  const file = join(dir, 'gh_output');
  writeFileSync(file, 'existing=1\n');
  const prevEnv = process.env.GITHUB_OUTPUT;
  const prevWrite = process.stdout.write.bind(process.stdout);
  let written = '';
  let appended;
  process.stdout.write = (chunk) => { written += chunk; return true; };
  try {
    process.env.GITHUB_OUTPUT = file;
    output({ ref: 'v1.0.0', source: 'release' });
    appended = readFileSync(file, 'utf8');
  } finally {
    process.stdout.write = prevWrite;
    if (prevEnv === undefined) delete process.env.GITHUB_OUTPUT; else process.env.GITHUB_OUTPUT = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(written, 'ref=v1.0.0\nsource=release\n');
  assert.equal(appended, 'existing=1\nref=v1.0.0\nsource=release\n');
});
