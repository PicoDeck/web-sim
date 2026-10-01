import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch, decide, outputsOf, shouldFollow } from '../scripts/should-follow.mjs';

const WITH_SEAM = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n';
const WITHOUT = 'if(EMSCRIPTEN)\n  set(SIM_PLATFORM_SOURCES web/web_platform.c)\n';

const latest = (tag) => ({ ref: tag, source: 'release', why: `latest release ${tag}` });
const release = (tag, built) => ({ tag_name: tag, body: `Built against PicoDeck ${built} (abcdef1).\n` });

test('a newer PicoDeck release rebuilds the latest web-sim release as the next patch release', () => {
  assert.deepEqual(
    { ...decide({ resolved: latest('v0.6.0'), release: release('v1.2.3', 'v0.5.0') }), why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
});

test('the outputs name the web-sim release to rebuild, and are all empty when not following', () => {
  assert.deepEqual(outputsOf(decide({ resolved: latest('v0.6.0'), release: release('v1.2.3', 'v0.5.0') })),
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3' });
  assert.deepEqual(outputsOf(decide({ resolved: latest('v0.5.0'), release: release('v1.2.3', 'v0.5.0') })),
    { follow: false, picodeck_ref: '', next: '', web_sim_ref: '' });
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
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
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

// PicoDeck's release.yml dispatches its tag (EXPECT_PICODECK_TAG): GitHub's
// releases/latest may still name the previous release for a while after it.
// latestTags: what successive latestTag() reads return (the last one repeats).
function lagging(latestTags) {
  const reads = [];
  const sleeps = [];
  return {
    reads, sleeps,
    latestTag: async () => { reads.push(1); return latestTags[Math.min(reads.length, latestTags.length) - 1]; },
    sleep: async (ms) => { sleeps.push(ms); },
  };
}

test('a stale latest release that catches up with the dispatched tag is followed', async () => {
  const gh = lagging(['v0.5.0', 'v0.5.0', 'v0.6.0']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', latestTag: gh.latestTag, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    latestRelease: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
  assert.deepEqual(gh.sleeps, [10_000, 10_000]);
});

test('a latest release that never reaches the dispatched tag fails, naming both tags', async () => {
  const gh = lagging(['v0.5.0']);
  await assert.rejects(shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', latestTag: gh.latestTag, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    latestRelease: async () => { throw new Error('should not be called'); },
  }), (err) => /v0\.5\.0/.test(err.message) && /v0\.6\.0/.test(err.message));
  assert.equal(gh.reads.length, 6);
  assert.deepEqual(gh.sleeps, Array(5).fill(10_000));
});

test('an expected tag that is not a plain release tag is refused before any lookup', async () => {
  for (const bad of ['main', '0.6.0', 'v0.6', 'v0.6.0 ', 'v0.6.0;echo', 'v0.6.0/x', '$(id)', 'v0.6.0\nv0.7.0']) {
    const gh = lagging(['v0.6.0']);
    await assert.rejects(shouldFollow({
      pin: 'abc123', expectTag: bad, latestTag: gh.latestTag, sleep: gh.sleep,
      cmakeAt: async () => WITH_SEAM,
      latestRelease: async () => release('v1.2.3', 'v0.5.0'),
    }), /not a plain release tag/, JSON.stringify(bad));
    assert.equal(gh.reads.length, 0, JSON.stringify(bad));
  }
});

test('an expected tag may carry a pre-release or build suffix', async () => {
  const gh = lagging(['v0.6.0-rc.1']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0-rc.1', latestTag: gh.latestTag, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    latestRelease: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.equal(d.picodeck_ref, 'v0.6.0-rc.1');
  assert.deepEqual(gh.sleeps, []);
});

test('with no expected tag (the schedule, a manual run) latest is read once, without waiting', async () => {
  for (const expectTag of [undefined, '']) {
    const gh = lagging(['v0.5.0', 'v0.6.0']);
    const d = await shouldFollow({
      pin: 'abc123', expectTag, latestTag: gh.latestTag, sleep: gh.sleep,
      cmakeAt: async () => WITH_SEAM,
      latestRelease: async () => release('v1.2.3', 'v0.5.0'),
    });
    assert.equal(d.follow, false);
    assert.match(d.why, /already built against v0\.5\.0/);
    assert.equal(gh.reads.length, 1);
    assert.deepEqual(gh.sleeps, []);
  }
});
