// scripts/release-version.mjs: release.yml's check of a manual run's
// version (and of a pushed tag's) before the build, and follow-picodeck.yml's
// check of a follow release before it publishes.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFollow, checkRelease, checkVersion, compareVersions, webSim } from '../../scripts/release-version.mjs';

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

// A follow release (follow-picodeck.yml, just before publish.sh): `version`
// (next) rebuilds `rebuilt` (web_sim_ref), which must still be web-sim's
// latest release, and must still be greater than it.
test('a follow release passes while the release it rebuilt is still web-sim\'s latest', () => {
  assert.equal(checkFollow({ version: 'v1.0.2', rebuilt: 'v1.0.1', latest: 'v1.0.1', tagExists: false }), 'v1.0.2');
});

test('a follow release is refused when a newer web-sim release landed during the follow', () => {
  // A manual v1.1.0 published while the follow built v1.0.2: publishing
  // v1.0.2 now would make the lower version "latest".
  assert.throws(() => checkFollow({ version: 'v1.0.2', rebuilt: 'v1.0.1', latest: 'v1.1.0', tagExists: false }),
    /web-sim's latest release is now v1\.1\.0, not v1\.0\.1 \(the release this follow rebuilt\): not publishing v1\.0\.2 over it/);
  assert.throws(() => checkFollow({ version: 'v1.0.2', rebuilt: 'v1.0.1', latest: null, tagExists: false }),
    /web-sim's latest release is now none, not v1\.0\.1/);
});

test('a follow release must still be greater than the release it rebuilt, under a new tag', () => {
  assert.throws(() => checkFollow({ version: 'v1.0.1', rebuilt: 'v1.0.1', latest: 'v1.0.1', tagExists: false }),
    /v1\.0\.1 is not greater than web-sim's latest release v1\.0\.1/);
  assert.throws(() => checkFollow({ version: 'v1.0.2', rebuilt: 'v1.0.1', latest: 'v1.0.1', tagExists: true }),
    /tag v1\.0\.2 already exists/);
});

test('a follow\'s rebuilt release that is not vX.Y.Z is a clear error', () => {
  assert.throws(() => checkFollow({ version: 'v1.0.2', rebuilt: 'main', latest: 'v1.0.1', tagExists: false }),
    /the rebuilt release "main" is not vX\.Y\.Z/);
});

test('checkRelease with follows checks the follow, and refuses a malformed rebuilt tag before any lookup', async () => {
  assert.equal(await checkRelease({ version: 'v1.0.2', follows: 'v1.0.1', ...lookups() }), 'v1.0.2');
  await assert.rejects(checkRelease({ version: 'v1.0.2', follows: 'v1.0.1', ...lookups({ latest: 'v1.1.0' }) }),
    /latest release is now v1\.1\.0/);
  const gh = lookups();
  await assert.rejects(checkRelease({ version: 'v1.0.2', follows: 'v1.0.1/../x', ...gh }), /is not vX\.Y\.Z/);
  assert.deepEqual(gh.calls, []);
});

// A pushed tag (release.yml's push path, --pushed): its tag exists by
// definition, so only the version is checked: vX.Y.Z and greater than
// web-sim's latest release, or a mistyped lower tag would publish, become
// "latest" and roll picodeck.net back.
test('a pushed tag above web-sim\'s latest release passes, without the tag-exists lookup', async () => {
  const gh = lookups({ exists: true });  // the pushed tag exists: that must not matter
  assert.equal(await checkRelease({ version: 'v1.1.0', pushed: true, ...gh }), 'v1.1.0');
  assert.deepEqual(gh.calls, [['latestTag']]);
});

test('a pushed tag not greater than web-sim\'s latest release is refused', async () => {
  for (const version of ['v1.0.0', 'v1.0.1', 'v0.9.10']) {
    await assert.rejects(checkRelease({ version, pushed: true, ...lookups({ latest: 'v1.0.1' }) }),
      new RegExp(`${version.replaceAll('.', '\\.')} is not greater than web-sim's latest release v1\\.0\\.1`), version);
  }
});

test('a pushed tag with no web-sim release yet passes', async () => {
  assert.equal(await checkRelease({ version: 'v1.0.0', pushed: true, ...lookups({ latest: null }) }), 'v1.0.0');
});

test('a pushed tag that is not vX.Y.Z is refused before any lookup, and a failed lookup is an error', async () => {
  const gh = lookups();
  await assert.rejects(checkRelease({ version: 'v1.2', pushed: true, ...gh }), /version "v1\.2" is not vX\.Y\.Z/);
  assert.deepEqual(gh.calls, []);
  const fail = () => { throw new Error('HTTP 503'); };
  await assert.rejects(checkRelease({ version: 'v1.1.0', pushed: true, ...lookups({ latest: fail }) }), /HTTP 503/);
});

test('pushed and follows together are refused before any lookup', async () => {
  const gh = lookups();
  await assert.rejects(checkRelease({ version: 'v1.0.2', follows: 'v1.0.1', pushed: true, ...gh }),
    /--pushed and --follow can't be combined/);
  assert.deepEqual(gh.calls, []);
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

test('the CLI takes --follow <web_sim_ref>, and refuses a malformed one before any lookup', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'v1.0.2', '--follow', 'main'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^release-version: the rebuilt release "main" is not vX\.Y\.Z/);
  assert.equal(r.stdout, '');
});

test('an empty --follow is an error, not a fall back to the manual check', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'v1.0.2', '--follow', ''], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the rebuilt release "" is not vX\.Y\.Z/);
});

test('the CLI refuses an unknown option, a missing --follow value, --pushed with --follow, or not exactly one version', () => {
  for (const args of [['v1.0.2', '--folow', 'v1.0.1'], ['v1.0.2', '--follow'], ['v1.0.2', 'v1.0.3'], [],
    ['v1.0.2', '--pushed', '--follow', 'v1.0.1'], ['v1.0.2', '--pushed=yes']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '' },
    });
    assert.equal(r.status, 1, JSON.stringify(args));
    assert.match(r.stderr,
      /^release-version: .*\nusage: scripts\/release-version\.mjs <version> \[--follow <web-sim release> \| --pushed\]/,
      JSON.stringify(args));
    assert.equal(r.stdout, '', JSON.stringify(args));
  }
});

test('the CLI takes --pushed, and refuses a malformed pushed tag before any lookup', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'v1.2', '--pushed'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^::error::release-version: version "v1\.2" is not vX\.Y\.Z/);
  assert.equal(r.stdout, '');
});

test('the CLI refuses a malformed version with a clear error and writes no output', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'v1.2'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^::error::release-version: version "v1\.2" is not vX\.Y\.Z/);
  assert.equal(r.stdout, '');
});
