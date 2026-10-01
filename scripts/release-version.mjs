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
// Prints version= (and appends it to $GITHUB_OUTPUT in CI). Read-only
// lookups (GITHUB_TOKEN needs only contents: read); a failed lookup is an
// error, never a pass. A pushed tag (release.yml's other path) isn't checked
// here: its tag exists by definition.
import { fileURLToPath } from 'node:url';
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

// latestTag(), tagExists(tag): the lookups (webSim in the CLI). The format
// is checked first, before any lookup: the version goes into a URL.
export async function checkRelease({ version, latestTag, tagExists }) {
  parse(version, 'version');
  const [latest, exists] = await Promise.all([latestTag(), tagExists(version)]);
  return checkVersion({ version, latest, tagExists: exists });
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
  checkRelease({ version: process.argv[2], ...webSim })
    .then((version) => output({ version }))
    .catch((err) => { console.error(`${error}release-version: ${err.message}`); process.exit(1); });
}
