import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch, decide } from '../scripts/should-follow.mjs';

const latest = (tag) => ({ ref: tag, why: `latest release ${tag}` });
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
  const resolved = { ref: 'abc123', why: 'picodeck.pin (the latest release, v0.4.0, predates the web build seam)' };
  assert.equal(decide({ resolved, release: release('v1.0.0', 'abc123') }).follow, false);
});

test('the first release is made by hand', () => {
  assert.equal(decide({ resolved: latest('v0.5.0'), release: null }).follow, false);
});

test('bumpPatch refuses a tag that is not vX.Y.Z', () => {
  assert.equal(bumpPatch('v1.9.9'), 'v1.9.10');
  assert.throws(() => bumpPatch('1.2'), /not vX\.Y\.Z/);
});
