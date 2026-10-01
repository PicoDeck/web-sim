#!/usr/bin/env node
// Checks a manual release's version (release.yml's workflow_dispatch input)
// before the build, so a mistake fails in seconds, not after a full
// Emscripten build:
// - it must be vX.Y.Z;
// - its tag must not exist yet (publish.sh creates it on the dispatching
//   commit, and would refuse an existing one only after the build);
// - it must be greater than web-sim's latest release (gh release create
//   makes the new release "latest", so a lower version would replace a newer
//   one on picodeck.net and confuse the follow's next patch version).
//   node scripts/release-version.mjs v1.2.0
// With --follow <web-sim release> (follow-picodeck.yml, just before
// publish.sh) it checks a follow release instead: the release the follow
// rebuilt must still be web-sim's latest (a manual release that landed
// during the follow would otherwise be overtaken by the follow's lower
// version), and the version must still be new and greater than it.
//   node scripts/release-version.mjs v1.0.2 --follow v1.0.1
// Prints version= (and appends it to $GITHUB_OUTPUT in CI). Read-only
// lookups (GITHUB_TOKEN needs only contents: read); a failed lookup is an
// error, never a pass. A pushed tag (release.yml's other path) isn't checked
// here: its tag exists by definition.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { output } from './picodeck-ref.mjs';
import { latestWebSimRelease, WEB_SIM_REPO } from './should-follow.mjs';

const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;

function parse(version, what) {
  const m = typeof version === 'string' ? VERSION.exec(version) : null;
  if (!m) throw new Error(`${what} ${JSON.stringify(version)} is not vX.Y.Z (for example v1.2.0)`);
  return m.slice(1).map(Number);
}

// Like a sort comparator: < 0, 0 or > 0 as a is lower, equal or higher.
export function compareVersions(a, b) {
  const [x, y] = [parse(a, 'version'), parse(b, 'version')];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Pure. version: the requested version; latest: web-sim's latest release
// tag, or null when it has none; tagExists: whether the version's tag does.
// Returns the version, or throws saying why it can't be released.
export function checkVersion({ version, latest, tagExists }) {
  parse(version, 'version');
  if (tagExists) throw new Error(`tag ${version} already exists: pick a new version`);
  if (latest !== null && latest !== undefined) {
    parse(latest, "web-sim's latest release");
    if (compareVersions(version, latest) <= 0) {
      throw new Error(`${version} is not greater than web-sim's latest release ${latest}`);
    }
  }
  return version;
}

// Pure. A follow release: version (the follow's next) rebuilds `rebuilt`
// (its web_sim_ref), which must still be web-sim's latest release; then the
// same checks as checkVersion against it.
export function checkFollow({ version, rebuilt, latest, tagExists }) {
  parse(rebuilt, 'the rebuilt release');
  if (latest !== rebuilt) {
    throw new Error(`web-sim's latest release is now ${latest ?? 'none'}, not ${rebuilt} (the release this follow `
      + `rebuilt): not publishing ${version} over it`);
  }
  return checkVersion({ version, latest, tagExists });
}

// latestTag(), tagExists(tag): the lookups (webSim in the CLI); follows: a
// follow's web_sim_ref, or undefined for a manual release (an empty one is
// an error, never the manual check). The formats are checked first, before
// any lookup: the version goes into a URL.
export async function checkRelease({ version, follows, latestTag, tagExists }) {
  parse(version, 'version');
  if (follows !== undefined) parse(follows, 'the rebuilt release');
  const [latest, exists] = await Promise.all([latestTag(), tagExists(version)]);
  return follows !== undefined
    ? checkFollow({ version, rebuilt: follows, latest, tagExists: exists })
    : checkVersion({ version, latest, tagExists: exists });
}

export const webSim = {
  async latestTag() {
    return (await latestWebSimRelease())?.tag_name ?? null;
  },
  async tagExists(tag) {
    const headers = { 'User-Agent': 'picodeck-web-sim' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${WEB_SIM_REPO}/git/ref/tags/${tag}`, { headers });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`tag ${tag}: HTTP ${res.status}`);
    return true;
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // In Actions, an ::error:: line puts the reason on the run's summary.
  const error = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
  const usage = 'usage: scripts/release-version.mjs <version> [--follow <web-sim release>]';
  let args;
  try {
    args = parseArgs({ options: { follow: { type: 'string' } }, allowPositionals: true });
    if (args.positionals.length !== 1) throw new Error(`expected one version, got ${args.positionals.length}`);
  } catch (err) {
    console.error(`${error}release-version: ${err.message}\n${usage}`);
    process.exit(1);
  }
  checkRelease({ version: args.positionals[0], follows: args.values.follow, ...webSim })
    .then((version) => output({ version }))
    .catch((err) => { console.error(`${error}release-version: ${err.message}`); process.exit(1); });
}
