import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch, decide, outputsOf, rebuiltFor, shouldFollow } from '../../scripts/should-follow.mjs';
import { github } from '../../scripts/picodeck-ref.mjs';
import { releaseNotes } from '../../scripts/version.mjs';

const WITH_SEAM = 'if(EMSCRIPTEN)\n  include(${PICODECK_WEB_DIR}/web.cmake)\n...\n    sim_native_api.c\n';
const WITHOUT = 'if(EMSCRIPTEN)\n  set(SIM_PLATFORM_SOURCES web/web_platform.c)\n';

// When each PicoDeck release was published, and when web-sim's latest
// release was (WEB_SIM_AT: after v0.5.0, before v0.6.0 and v0.7.0).
const AT = {
  'v0.4.0': '2026-08-01T10:00:00Z',
  'v0.5.0': '2026-09-01T10:00:00Z',
  'v0.6.0-rc.1': '2026-09-08T10:00:00Z',
  'v0.6.0': '2026-09-10T10:00:00Z',
  'v0.7.0': '2026-09-20T10:00:00Z',
};
const WEB_SIM_AT = '2026-09-02T10:00:00Z';

const latest = (tag) => ({ ref: tag, source: 'release', why: `latest release ${tag}` });
// PicoDeck's latest release, as the lookup returns it.
const pd = (tag, published_at = AT[tag]) => ({ tag_name: tag, published_at });
// web-sim's latest release (a GitHub API release object).
const release = (tag, built, published_at = WEB_SIM_AT) =>
  ({ tag_name: tag, body: `Built against PicoDeck ${built} (abcdef1).\n`, published_at });

test('a PicoDeck release published after web-sim\'s latest, at another ref, rebuilds it as the next patch release', () => {
  assert.deepEqual(
    { ...decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: release('v1.2.3', 'v0.5.0') }),
      why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
});

test('the outputs name the web-sim release to rebuild, and are all empty when not following', () => {
  assert.deepEqual(
    outputsOf(decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: release('v1.2.3', 'v0.5.0') })),
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3' });
  assert.deepEqual(
    outputsOf(decide({ resolved: latest('v0.5.0'), picodeck: pd('v0.5.0'), release: release('v1.2.3', 'v0.5.0') })),
    { follow: false, picodeck_ref: '', next: '', web_sim_ref: '' });
});

test('nothing to do when the latest web-sim release is built against it', () => {
  assert.equal(decide({ resolved: latest('v0.5.0'), picodeck: pd('v0.5.0'),
    release: release('v1.2.3', 'v0.5.0') }).follow, false);
  // Even when PicoDeck's release is the newer one (a hand release made
  // before it, against the same ref).
  const d = decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: release('v1.2.3', 'v0.6.0') });
  assert.equal(d.follow, false);
  assert.match(d.why, /already built against v0\.6\.0/);
});

test('an early web-sim release against a develop commit stays until PicoDeck publishes its next release', () => {
  // Released by hand against develop after v0.5.0 came out.
  const early = release('v1.3.0', 'develop', '2026-09-05T10:00:00Z');
  const d = decide({ resolved: latest('v0.5.0'), picodeck: pd('v0.5.0'), release: early });
  assert.equal(d.follow, false);
  assert.match(d.why, /v0\.5\.0 .*isn't newer than web-sim v1\.3\.0.*waiting for PicoDeck's next release/);
  assert.doesNotMatch(d.why, /predates/);
  // PicoDeck's next release is followed.
  const next = decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: early });
  assert.equal(next.follow, true);
  assert.equal(next.next, 'v1.3.1');
});

test('a web-sim release against an older PicoDeck (the latest is broken) stays until PicoDeck\'s next release', () => {
  const older = release('v1.3.0', 'v0.5.0', '2026-09-12T10:00:00Z');
  assert.equal(decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: older }).follow, false);
  assert.equal(decide({ resolved: latest('v0.7.0'), picodeck: pd('v0.7.0'), release: older }).follow, true);
});

test('a PicoDeck release published at the same second as web-sim\'s is not newer, and the why says so accurately', () => {
  const d = decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0', WEB_SIM_AT),
    release: release('v1.2.3', 'v0.5.0') });
  assert.equal(d.follow, false);
  // "predates" would be false for equal timestamps.
  assert.match(d.why, /isn't newer than web-sim v1\.2\.3/);
  assert.doesNotMatch(d.why, /predates/);
});

test('a missing or unparseable date is an error, never a silent follow', () => {
  // (Passing undefined to pd()/release() would pick their default date.)
  const noDate = { ...release('v1.2.3', 'v0.5.0') };
  delete noDate.published_at;
  const cases = [
    [{ tag_name: 'v0.6.0' }, release('v1.2.3', 'v0.5.0'), /PicoDeck release v0\.6\.0 has no valid published_at \(undefined\)/],
    [pd('v0.6.0', null), release('v1.2.3', 'v0.5.0'), /PicoDeck release v0\.6\.0 has no valid published_at \(null\)/],
    [pd('v0.6.0', 'yesterday'), release('v1.2.3', 'v0.5.0'), /PicoDeck release v0\.6\.0 has no valid published_at \("yesterday"\)/],
    [pd('v0.6.0'), noDate, /web-sim release v1\.2\.3 has no valid published_at \(undefined\)/],
    [pd('v0.6.0'), release('v1.2.3', 'v0.5.0', '2026-02-30T10:00:00Z'), /web-sim release v1\.2\.3 has no valid published_at/],
    [pd('v0.6.0'), release('v1.2.3', 'v0.5.0', '2026-13-45T99:00:00Z'), /web-sim release v1\.2\.3 has no valid published_at/],
    [pd('v0.6.0'), release('v1.2.3', 'v0.5.0', '2026-09-02'), /web-sim release v1\.2\.3 has no valid published_at/],
  ];
  for (const [picodeck, rel, message] of cases) {
    assert.throws(() => decide({ resolved: latest('v0.6.0'), picodeck, release: rel }), message);
  }
});

test('PicoDeck\'s release lookup must be the release the ref was resolved from', () => {
  assert.throws(() => decide({ resolved: latest('v0.6.0'), picodeck: null, release: release('v1.2.3', 'v0.5.0') }),
    /PicoDeck's latest release lookup \(none\) is not the resolved v0\.6\.0/);
  assert.throws(() => decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.7.0'), release: release('v1.2.3', 'v0.5.0') }),
    /PicoDeck's latest release lookup \(v0\.7\.0\) is not the resolved v0\.6\.0/);
});

test('nothing to do while PicoDeck has no release with the seam', () => {
  const resolved = { ref: 'abc123', source: 'pin',
    why: 'picodeck.pin (the latest release, v0.4.0, predates the web build seam)' };
  // Built against a DIFFERENT ref than resolved.ref: without the source guard, decide
  // would fall through to "follow: true" here instead of stopping at "no seam yet".
  assert.equal(decide({ resolved, picodeck: pd('v0.4.0'), release: release('v1.0.0', 'v0.4.0', AT['v0.4.0']) }).follow,
    false);
});

test('the first release is made by hand', () => {
  assert.equal(decide({ resolved: latest('v0.5.0'), picodeck: pd('v0.5.0'), release: null }).follow, false);
});

test('a release whose notes do not record a PicoDeck ref says so, not "built against null"', () => {
  const r = { tag_name: 'v1.2.3', body: 'No ref recorded here.\n', published_at: WEB_SIM_AT };
  const d = decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'), release: r });
  assert.equal(d.follow, true);
  assert.doesNotMatch(d.why, /built against null/);
  assert.match(d.why, /v1\.2\.3.*notes don't record a PicoDeck ref.*PicoDeck released v0\.6\.0/);
});

// A follow release: web-sim's latest release as follow-picodeck.yml
// publishes it (publish.sh --rebuilt: releaseNotes with rebuilt), rebuilt
// for PicoDeck `forRef`.
const followRelease = (tag, forRef, published_at) => ({
  tag_name: tag, published_at,
  body: releaseNotes({ picodeck: { ref: forRef, commit: 'abcdef1234' }, apps: { builtin: [], store: [] } },
    { rebuilt: true }),
});
// A follow release for v0.6.0 whose build ran while PicoDeck published
// v0.7.0: published after v0.7.0, but built for the release before it.
const OVERTAKEN = followRelease('v1.2.4', 'v0.6.0', '2026-09-20T10:30:00Z');

test('rebuiltFor reads the PicoDeck ref a follow release was rebuilt for; null for any other release', () => {
  assert.equal(rebuiltFor(OVERTAKEN), 'v0.6.0');
  assert.equal(rebuiltFor({ ...OVERTAKEN, body: OVERTAKEN.body.replaceAll('\n', '\r\n') }), 'v0.6.0');
  assert.equal(rebuiltFor(release('v1.2.3', 'v0.5.0')), null);
  assert.equal(rebuiltFor({ tag_name: 'v1.2.3', body: null }), null);
  assert.equal(rebuiltFor(null), null);
});

test('a follow release overtaken mid-build follows: judged by the PicoDeck release it was rebuilt for', () => {
  const d = decide({ resolved: latest('v0.7.0'), picodeck: pd('v0.7.0'), release: OVERTAKEN, rebuiltRelease: pd('v0.6.0') });
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.7.0', next: 'v1.2.5', web_sim_ref: 'v1.2.4', why: undefined });
});

test('a follow release built for PicoDeck\'s current latest release does not follow', () => {
  const d = decide({ resolved: latest('v0.7.0'), picodeck: pd('v0.7.0'),
    release: followRelease('v1.2.5', 'v0.7.0', '2026-09-20T11:00:00Z') });
  assert.equal(d.follow, false);
  assert.equal(d.reason, 'built');
});

test('a follow release for a release newer than PicoDeck\'s latest does not follow, and says what it compared', () => {
  // (PicoDeck's latest flag moved back to v0.6.0 after a v0.7.0 follow.)
  const d = decide({ resolved: latest('v0.6.0'), picodeck: pd('v0.6.0'),
    release: followRelease('v1.2.5', 'v0.7.0', '2026-09-20T11:00:00Z'), rebuiltRelease: pd('v0.7.0') });
  assert.equal(d.follow, false);
  assert.equal(d.reason, 'not-newer');
  assert.match(d.why, /PicoDeck's latest release v0\.6\.0 \(published 2026-09-10T10:00:00Z\) isn't newer than PicoDeck v0\.7\.0 \(published 2026-09-20T10:00:00Z\), the release web-sim v1\.2\.5 was rebuilt for/);
});

test('a hand release against develop, published after PicoDeck\'s latest release, does not follow', () => {
  const hand = release('v1.3.0', 'develop', '2026-09-21T10:00:00Z');
  const d = decide({ resolved: latest('v0.7.0'), picodeck: pd('v0.7.0'), release: hand });
  assert.equal(d.follow, false);
  assert.equal(d.reason, 'not-newer');
  assert.match(d.why, /isn't newer than web-sim v1\.3\.0 \(published 2026-09-21T10:00:00Z, built against develop\)/);
});

test('a follow release judged without its PicoDeck release, or with the wrong one, is an error, never a follow', () => {
  for (const [rebuiltRelease, message] of [
    [undefined, /PicoDeck v0\.6\.0, which web-sim v1\.2\.4 was rebuilt for, wasn't found/],
    [null, /PicoDeck v0\.6\.0, which web-sim v1\.2\.4 was rebuilt for, wasn't found/],
    [pd('v0.5.0'), /the lookup of PicoDeck v0\.6\.0 .*returned v0\.5\.0/],
    [{ tag_name: 'v0.6.0' }, /PicoDeck release v0\.6\.0 has no valid published_at \(undefined\)/],
    [pd('v0.6.0', 'last week'), /PicoDeck release v0\.6\.0 has no valid published_at \("last week"\)/],
  ]) {
    assert.throws(() => decide({ resolved: latest('v0.7.0'), picodeck: pd('v0.7.0'), release: OVERTAKEN, rebuiltRelease }),
      message, JSON.stringify(rebuiltRelease));
  }
});

// picodeckRelease(tag): PicoDeck's release by tag (github.releaseByTag in the
// CLI), recording the tags looked up.
function releasesByTag(answer = async (tag) => pd(tag)) {
  const tags = [];
  return { tags, picodeckRelease: async (tag) => { tags.push(tag); return answer(tag); } };
}
const notCalled = async () => { throw new Error('should not be called'); };

test('shouldFollow follows a follow release overtaken mid-build, looking up the release it was rebuilt for', async () => {
  // The schedule (or a manual run): no dispatched tag.
  const gh = releasesByTag();
  const d = await shouldFollow({
    pin: 'abc123', picodeckLatest: async () => pd('v0.7.0'), cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => OVERTAKEN, picodeckRelease: gh.picodeckRelease,
  });
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.7.0', next: 'v1.2.5', web_sim_ref: 'v1.2.4', why: undefined });
  assert.deepEqual(gh.tags, ['v0.6.0']);
});

test('a dispatched PicoDeck release that a follow overtook mid-build is followed, not failed', async () => {
  const lag = lagging(['v0.7.0']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.7.0', picodeckLatest: lag.picodeckLatest, sleep: lag.sleep,
    cmakeAt: async () => WITH_SEAM, webSimLatest: async () => OVERTAKEN,
    picodeckRelease: releasesByTag().picodeckRelease,
  });
  assert.equal(d.follow, true);
  assert.equal(d.picodeck_ref, 'v0.7.0');
});

test('shouldFollow looks nothing up for a follow release built for the latest, or for a hand release', async () => {
  for (const webSim of [followRelease('v1.2.5', 'v0.7.0', '2026-09-20T11:00:00Z'),
    release('v1.3.0', 'develop', '2026-09-21T10:00:00Z')]) {
    const d = await shouldFollow({
      pin: 'abc123', picodeckLatest: async () => pd('v0.7.0'), cmakeAt: async () => WITH_SEAM,
      webSimLatest: async () => webSim, picodeckRelease: notCalled,
    });
    assert.equal(d.follow, false, webSim.tag_name);
  }
});

test('a failed lookup of the release a follow was rebuilt for rejects, never follows', async () => {
  const run = (picodeckRelease, webSim = OVERTAKEN) => shouldFollow({
    pin: 'abc123', picodeckLatest: async () => pd('v0.7.0'), cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => webSim, picodeckRelease,
  });
  await assert.rejects(run(async () => { throw new Error('release v0.6.0: HTTP 503'); }), /HTTP 503/);
  await assert.rejects(run(async () => null), /PicoDeck v0\.6\.0, which web-sim v1\.2\.4 was rebuilt for, wasn't found/);
  await assert.rejects(run(async (tag) => pd(tag, null)), /PicoDeck release v0\.6\.0 has no valid published_at/);
  // A rebuilt ref that isn't a release tag never reaches the lookup (it goes into a URL).
  const gh = releasesByTag();
  await assert.rejects(run(gh.picodeckRelease, followRelease('v1.2.4', 'x/../y', OVERTAKEN.published_at)),
    /web-sim v1\.2\.4's notes say it was rebuilt for PicoDeck "x\/\.\.\/y", which is not a release tag/);
  assert.deepEqual(gh.tags, []);
});

test('bumpPatch refuses a tag that is not vX.Y.Z', () => {
  assert.equal(bumpPatch('v1.9.9'), 'v1.9.10');
  assert.throws(() => bumpPatch('1.2'), /not vX\.Y\.Z/);
});

test('an API failure never means follow: the PicoDeck lookup rejecting', async () => {
  await assert.rejects(shouldFollow({
    pin: 'abc123',
    picodeckLatest: async () => { throw new Error('latest release: HTTP 503'); },
    cmakeAt: async () => { throw new Error('should not be called'); },
    webSimLatest: async () => { throw new Error('should not be called'); },
  }), /HTTP 503/);
});

test('an API failure never means follow: cmakeAt rejecting', async () => {
  await assert.rejects(shouldFollow({
    pin: 'abc123',
    picodeckLatest: async () => pd('v0.6.0'),
    cmakeAt: async () => { throw new Error('cmake fetch failed: HTTP 500'); },
    webSimLatest: async () => { throw new Error('should not be called'); },
  }), /cmake fetch failed/);
});

test('shouldFollow follows when PicoDeck released a newer seam build', async () => {
  const d = await shouldFollow({
    pin: 'abc123',
    picodeckLatest: async () => pd('v0.6.0'),
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
});

test('shouldFollow decides on the dates the lookups return: an older PicoDeck release is not followed', async () => {
  const d = await shouldFollow({
    pin: 'abc123',
    picodeckLatest: async () => pd('v0.6.0'),
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.3.0', 'develop', '2026-09-15T10:00:00Z'),
  });
  assert.equal(d.follow, false);
  assert.match(d.why, /waiting for PicoDeck's next release/);
});

test('shouldFollow does not follow while the latest release predates the seam', async () => {
  const d = await shouldFollow({
    pin: 'abc123',
    picodeckLatest: async () => pd('v0.4.0'),
    cmakeAt: async () => WITHOUT,
    webSimLatest: async () => release('v1.0.0', 'abc123'),
  });
  assert.equal(d.follow, false);
});

// PicoDeck's release.yml dispatches its tag (EXPECT_PICODECK_TAG): GitHub's
// releases/latest may still name the previous release for a while after it.
// latestTags: the tags successive picodeckLatest() reads return (the last one
// repeats), each with its AT date.
function lagging(latestTags) {
  const reads = [];
  const sleeps = [];
  return {
    reads, sleeps,
    picodeckLatest: async () => { reads.push(1); return pd(latestTags[Math.min(reads.length, latestTags.length) - 1]); },
    sleep: async (ms) => { sleeps.push(ms); },
  };
}

test('a stale latest release that catches up with the dispatched tag is followed', async () => {
  const gh = lagging(['v0.5.0', 'v0.5.0', 'v0.6.0']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.deepEqual({ ...d, why: undefined },
    { follow: true, picodeck_ref: 'v0.6.0', next: 'v1.2.4', web_sim_ref: 'v1.2.3', why: undefined });
  assert.deepEqual(gh.sleeps, [10_000, 10_000]);
  assert.equal(gh.reads.length, 3);
});

test('a dispatched release that isn\'t newer than web-sim\'s latest fails visibly, not skipped quietly', async () => {
  // A web-sim release landed after the dispatched PicoDeck release (by hand,
  // against develop): following silently would skip v0.6.0 until PicoDeck's
  // next release, so the dispatched run fails, saying why. Decided on the
  // dispatched release's own date: latest is read once by the wait.
  const gh = lagging(['v0.6.0']);
  await assert.rejects(shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.3.0', 'develop', '2026-09-15T10:00:00Z'),
  }), (err) => {
    assert.match(err.message, /the dispatched PicoDeck v0\.6\.0 \(published 2026-09-10T10:00:00Z\) isn't newer than web-sim's latest release v1\.3\.0 \(published 2026-09-15T10:00:00Z\)/);
    assert.match(err.message, /not following it/);
    return true;
  });
  assert.equal(gh.reads.length, 1);
});

test('without a dispatched tag (the schedule, a manual run), a PicoDeck release that isn\'t newer is just not followed', async () => {
  for (const expectTag of [undefined, '']) {
    const d = await shouldFollow({
      pin: 'abc123', expectTag, picodeckLatest: async () => pd('v0.6.0'),
      cmakeAt: async () => WITH_SEAM,
      webSimLatest: async () => release('v1.3.0', 'develop', '2026-09-15T10:00:00Z'),
    });
    assert.equal(d.follow, false);
    assert.match(d.why, /waiting for PicoDeck's next release/);
  }
});

test('a dispatched release web-sim is already built against is not followed, and is not an error', async () => {
  const gh = lagging(['v0.6.0']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.3.0', 'v0.6.0', '2026-09-15T10:00:00Z'),
  });
  assert.equal(d.follow, false);
  assert.match(d.why, /already built against v0\.6\.0/);
});

test('a latest release that never reaches the dispatched tag fails, naming both tags', async () => {
  const gh = lagging(['v0.5.0']);
  await assert.rejects(shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => { throw new Error('should not be called'); },
  }), (err) => /latest release is v0\.5\.0, not the dispatched v0\.6\.0/.test(err.message));
  assert.equal(gh.reads.length, 6);
  assert.deepEqual(gh.sleeps, Array(5).fill(10_000));
});

test('a latest release that moves PAST the dispatched tag fails with wording that is still true', async () => {
  // Two PicoDeck releases close together: latest never equals v0.6.0 because
  // it jumped straight to v0.7.0. "still v0.6.0" would be false here.
  const gh = lagging(['v0.5.0', 'v0.7.0']);
  await assert.rejects(shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => { throw new Error('should not be called'); },
  }), (err) => {
    assert.doesNotMatch(err.message, /still v0\.6\.0/);
    assert.match(err.message, /latest release is v0\.7\.0, not the dispatched v0\.6\.0/);
    return true;
  });
});

test('a latest release lookup that finds no release at all names "none"', async () => {
  const reads = [];
  await assert.rejects(shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0', sleep: async () => {},
    picodeckLatest: async () => { reads.push(1); return null; },
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => { throw new Error('should not be called'); },
  }), /latest release is none, not the dispatched v0\.6\.0/);
  assert.equal(reads.length, 6);
});

test('an expected tag that is not a plain release tag is refused before any lookup', async () => {
  for (const bad of ['main', '0.6.0', 'v0.6', 'v0.6.0 ', 'v0.6.0;echo', 'v0.6.0/x', '$(id)', 'v0.6.0\nv0.7.0']) {
    const gh = lagging(['v0.6.0']);
    await assert.rejects(shouldFollow({
      pin: 'abc123', expectTag: bad, picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
      cmakeAt: async () => WITH_SEAM,
      webSimLatest: async () => release('v1.2.3', 'v0.5.0'),
    }), /not a plain release tag/, JSON.stringify(bad));
    assert.equal(gh.reads.length, 0, JSON.stringify(bad));
  }
});

test('an expected tag may carry a pre-release or build suffix', async () => {
  const gh = lagging(['v0.6.0-rc.1']);
  const d = await shouldFollow({
    pin: 'abc123', expectTag: 'v0.6.0-rc.1', picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
    cmakeAt: async () => WITH_SEAM,
    webSimLatest: async () => release('v1.2.3', 'v0.5.0'),
  });
  assert.equal(d.picodeck_ref, 'v0.6.0-rc.1');
  assert.equal(d.follow, true);
  assert.deepEqual(gh.sleeps, []);
});

test('with no expected tag (the schedule, a manual run) latest is read once, without waiting', async () => {
  for (const expectTag of [undefined, '']) {
    const gh = lagging(['v0.5.0', 'v0.6.0']);
    const d = await shouldFollow({
      pin: 'abc123', expectTag, picodeckLatest: gh.picodeckLatest, sleep: gh.sleep,
      cmakeAt: async () => WITH_SEAM,
      webSimLatest: async () => release('v1.2.3', 'v0.5.0'),
    });
    assert.equal(d.follow, false);
    assert.match(d.why, /already built against v0\.5\.0/);
    assert.equal(gh.reads.length, 1);
    assert.deepEqual(gh.sleeps, []);
  }
});

// github.latestRelease(): PicoDeck's latest release, as the CLI looks it up
// (a stubbed fetch stands in for the GitHub API).
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const stubFetch = (status, body) => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return urls;
};

test('github.latestRelease gives the latest PicoDeck release\'s tag and published_at', async () => {
  const urls = stubFetch(200, { tag_name: 'v0.6.0', published_at: AT['v0.6.0'], body: 'notes', assets: [] });
  assert.deepEqual(await github.latestRelease(), { tag_name: 'v0.6.0', published_at: AT['v0.6.0'] });
  assert.deepEqual(urls, ['https://api.github.com/repos/PicoDeck/picodeck/releases/latest']);
  assert.equal(await github.latestTag(), 'v0.6.0');
});

test('github.releaseByTag gives a PicoDeck release\'s tag and published_at: null when there is none', async () => {
  const urls = stubFetch(200, { tag_name: 'v0.6.0', published_at: AT['v0.6.0'], body: 'notes', assets: [] });
  assert.deepEqual(await github.releaseByTag('v0.6.0'), { tag_name: 'v0.6.0', published_at: AT['v0.6.0'] });
  assert.deepEqual(urls, ['https://api.github.com/repos/PicoDeck/picodeck/releases/tags/v0.6.0']);
  stubFetch(404, { message: 'Not Found' });
  assert.equal(await github.releaseByTag('v0.6.0'), null);
  stubFetch(503, {});
  await assert.rejects(github.releaseByTag('v0.6.0'), /release v0\.6\.0: HTTP 503/);
});

test('github.latestRelease: no release is null, any other failure throws', async () => {
  stubFetch(404, { message: 'Not Found' });
  assert.equal(await github.latestRelease(), null);
  assert.equal(await github.latestTag(), null);
  stubFetch(503, {});
  await assert.rejects(github.latestRelease(), /latest release: HTTP 503/);
});
