import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPin, resolveRef } from '../scripts/picodeck-ref.mjs';

const WITH_SEAM = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n';
const WITHOUT = 'if(EMSCRIPTEN)\n  set(SIM_PLATFORM_SOURCES web/web_platform.c)\n';
const repo = (tag, cmake) => ({ latestTag: async () => tag, cmakeAt: async () => cmake });

test('an explicit ref wins', async () => {
  assert.deepEqual(await resolveRef({ explicit: 'develop', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) }),
    { ref: 'develop', why: 'requested' });
});

test('the latest release, when it has the web build seam', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc', ...repo('v0.5.0', WITH_SEAM) });
  assert.equal(r.ref, 'v0.5.0');
  assert.match(r.why, /^latest release/);
});

test('the pin, while the latest release predates the seam', async () => {
  const r = await resolveRef({ explicit: '', pin: 'abc123', ...repo('v0.4.0', WITHOUT) });
  assert.equal(r.ref, 'abc123');
  assert.match(r.why, /v0\.4\.0, predates the web build seam/);
});

test('the pin, when PicoDeck has no release at all', async () => {
  assert.equal((await resolveRef({ explicit: '', pin: 'abc123', ...repo(null, '') })).ref, 'abc123');
});

test('no seam and no pin is an error, not a guess', async () => {
  await assert.rejects(resolveRef({ explicit: '', pin: '', ...repo('v0.4.0', WITHOUT) }), /picodeck\.pin is empty/);
});

test('readPin skips comments and blank lines', () => {
  assert.equal(readPin('# PicoDeck commit with the seam\n\n  5cd3ec1 \n'), '5cd3ec1');
  assert.equal(readPin('# nothing\n'), '');
});
