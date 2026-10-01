// scripts/release-version.mjs: release.yml's check of a manual run's
// version, before the build.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRelease, checkVersion, compareVersions, webSim } from '../../scripts/release-version.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/release-version.mjs', import.meta.url));

test('compareVersions orders vX.Y.Z numerically, not as text', () => {
  assert.ok(compareVersions('v1.10.0', 'v1.9.9') > 0);
  assert.ok(compareVersions('v2.0.0', 'v1.99.99') > 0);
  assert.ok(compareVersions('v1.0.2', 'v1.0.10') < 0);
  assert.equal(compareVersions('v1.2.3', 'v1.2.3'), 0);
});

test('a new version above web-sim\'s latest release passes', () => {
  assert.equal(checkVersion({ version: 'v1.1.0', latest: 'v1.0.1', tagExists: false }), 'v1.1.0');
  assert.equal(checkVersion({ version: 'v1.0.2', latest: 'v1.0.1', tagExists: false }), 'v1.0.2');
});

test('with no web-sim release yet, any new vX.Y.Z passes', () => {
  assert.equal(checkVersion({ version: 'v1.0.0', latest: null, tagExists: false }), 'v1.0.0');
});

test('a version that is not vX.Y.Z is refused', () => {
  for (const bad of ['1.2.0', 'v1.2', 'v1.2.0-rc1', 'v1.2.0 ', ' v1.2.0', '', 'main', 'v1.2.0\n', undefined]) {
    assert.throws(() => checkVersion({ version: bad, latest: 'v1.0.1', tagExists: false }),
      /version .* is not vX\.Y\.Z \(for example v1\.2\.0\)/, JSON.stringify(bad));
  }
});

test('a tag that already exists is refused', () => {
  assert.throws(() => checkVersion({ version: 'v1.2.0', latest: 'v1.0.1', tagExists: true }),
    /tag v1\.2\.0 already exists/);
});

test('a version not greater than web-sim\'s latest release is refused', () => {
  assert.throws(() => checkVersion({ version: 'v1.0.1', latest: 'v1.0.1', tagExists: false }),
    /v1\.0\.1 is not greater than web-sim's latest release v1\.0\.1/);
  assert.throws(() => checkVersion({ version: 'v1.0.0', latest: 'v1.0.1', tagExists: false }),
    /v1\.0\.0 is not greater than web-sim's latest release v1\.0\.1/);
  assert.throws(() => checkVersion({ version: 'v0.9.10', latest: 'v1.0.1', tagExists: false }),
    /not greater/);
});

test('a latest release whose tag is not vX.Y.Z is a clear error', () => {
  assert.throws(() => checkVersion({ version: 'v1.2.0', latest: 'nightly', tagExists: false }),
    /web-sim's latest release "nightly" is not vX\.Y\.Z/);
});

// Lookups that record their calls.
function lookups({ latest = 'v1.0.1', exists = false } = {}) {
  const calls = [];
  return {
    calls,
    latestTag: async () => { calls.push(['latestTag']); return typeof latest === 'function' ? latest() : latest; },
    tagExists: async (tag) => { calls.push(['tagExists', tag]); return typeof exists === 'function' ? exists() : exists; },
  };
}

test('checkRelease refuses a malformed version before any lookup (it goes into a URL)', async () => {
  for (const bad of ['v1.2.0/../x', 'main', '']) {
    const gh = lookups();
    await assert.rejects(checkRelease({ version: bad, ...gh }), /is not vX\.Y\.Z/);
    assert.deepEqual(gh.calls, [], JSON.stringify(bad));
  }
});

test('checkRelease looks up the version\'s tag and web-sim\'s latest release', async () => {
  const gh = lookups();
  assert.equal(await checkRelease({ version: 'v1.1.0', ...gh }), 'v1.1.0');
  assert.deepEqual(gh.calls.sort(), [['latestTag'], ['tagExists', 'v1.1.0']]);
  await assert.rejects(checkRelease({ version: 'v1.1.0', ...lookups({ exists: true }) }), /already exists/);
  await assert.rejects(checkRelease({ version: 'v1.0.0', ...lookups() }), /not greater/);
});

test('a failed lookup is an error, never a pass', async () => {
  const fail = () => { throw new Error('HTTP 503'); };
  await assert.rejects(checkRelease({ version: 'v1.1.0', ...lookups({ latest: fail }) }), /HTTP 503/);
  await assert.rejects(checkRelease({ version: 'v1.1.0', ...lookups({ exists: fail }) }), /HTTP 503/);
});

// webSim: the CLI's GitHub lookups (a stubbed fetch stands in for the API).
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const stubFetch = (status, body = {}) => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return urls;
};

test('webSim.tagExists: 200 is true, 404 is false, anything else throws', async () => {
  let urls = stubFetch(200, { ref: 'refs/tags/v1.0.1' });
  assert.equal(await webSim.tagExists('v1.0.1'), true);
  assert.deepEqual(urls, ['https://api.github.com/repos/PicoDeck/web-sim/git/ref/tags/v1.0.1']);
  urls = stubFetch(404, { message: 'Not Found' });
  assert.equal(await webSim.tagExists('v1.2.0'), false);
  stubFetch(503);
  await assert.rejects(webSim.tagExists('v1.2.0'), /tag v1\.2\.0: HTTP 503/);
});

test('webSim.latestTag: the latest release\'s tag, or null when there is none', async () => {
  stubFetch(200, { tag_name: 'v1.0.1', published_at: '2026-09-30T21:54:43Z' });
  assert.equal(await webSim.latestTag(), 'v1.0.1');
  stubFetch(404, { message: 'Not Found' });
  assert.equal(await webSim.latestTag(), null);
  stubFetch(500);
  await assert.rejects(webSim.latestTag(), /HTTP 500/);
});

test('the CLI refuses a malformed version with a clear error and writes no output', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'v1.2'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^::error::release-version: version "v1\.2" is not vX\.Y\.Z/);
  assert.equal(r.stdout, '');
});
