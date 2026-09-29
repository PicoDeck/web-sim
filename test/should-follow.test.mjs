import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch, decide, shouldFollow } from '../scripts/should-follow.mjs';

const WITH_SEAM = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n';
const WITHOUT = 'if(EMSCRIPTEN)\n  set(SIM_PLATFORM_SOURCES web/web_platform.c)\n';

const latest = (tag) => ({ ref: tag, source: 'release', why: `latest release ${tag}` });
const release = (tag, built) => ({ tag_name: tag, body: `Built against PicoDeck ${built} (abcdef1).\n` });

test('a newer PicoDeck release means the next patch release', () => {
  assert.deepEqual(
    { ...decide({ resolved: latest('v0.6.0'), release: release('v1.2.3', 'v0.5.0') }), why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', why: undefined });
});

test('nothing to do when the latest web-sim release is built against it', () => {
  assert.equal(decide({ resolved: latest('v0.5.0'), release: release('v1.2.3', 'v0.5.0') }).follow, false);
});

test('nothing to do while PicoDeck has no release with the seam', () => {
  const resolved = { ref: 'abc123', source: 'pin',
    why: 'picodeck.pin (the latest release, v0.4.0, predates the web build seam)' };
  // Built against a DIFFERENT ref than resolved.ref: without the source guard, decide
  // would fall through to "follow: true" here instead of stopping at "no seam yet".
  assert.equal(decide({ resolved, release: release('v1.0.0', 'v0.4.0') }).follow, false);
});

test('the first release is made by hand', () => {
  assert.equal(decide({ resolved: latest('v0.5.0'), release: null }).follow, false);
});

test('bumpPatch refuses a tag that is not vX.Y.Z', () => {
  assert.equal(bumpPatch('v1.9.9'), 'v1.9.10');
  assert.throws(() => bumpPatch('1.2'), /not vX\.Y\.Z/);
});

test('an API failure never means follow: latestTag rejecting', async () => {
  await assert.rejects(shouldFollow({
    pin: 'abc123',
    latestTag: async () => { throw new Error('latest release: HTTP 503'); },
    cmakeAt: async () => { throw new Error('should not be called'); },
    latestRelease: async () => { throw new Error('should not be called'); },
  }), /HTTP 503/);
});

test('an API failure never means follow: cmakeAt rejecting', async () => {
  await assert.rejects(shouldFollow({
    pin: 'abc123',
    latestTag: async () => 'v0.6.0',
    cmakeAt: async () => { throw new Error('cmake fetch failed: HTTP 500'); },
    latestRelease: async () => { throw new Error('should not be called'); },
  }), /cmake fetch failed/);
});

test('shouldFollow follows when PicoDeck released a newer seam build', async () => {
  const d = await shouldFollow({
    pin: 'abc123',
    latestTag: async () => 'v0.6.0',
    cmakeAt: async () => WITH_SEAM,
    latestRelease: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.deepEqual({ ...d, why: undefined }, { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', why: undefined });
});

test('shouldFollow does not follow while the latest release predates the seam', async () => {
  const d = await shouldFollow({
    pin: 'abc123',
    latestTag: async () => 'v0.4.0',
    cmakeAt: async () => WITHOUT,
    latestRelease: async () => release('v1.0.0', 'abc123'),
  });
  assert.equal(d.follow, false);
});
