#!/usr/bin/env node
// Whether web-sim should publish a release for a new PicoDeck release: when
// PicoDeck's latest release has the web build seam, web-sim's latest release
// was built against another ref, and PicoDeck published that release after
// web-sim published its latest. The rule is event-based: a web-sim release
// made by hand against a develop commit (or an older PicoDeck, while the
// latest one breaks the web build) stays until PicoDeck's next release.
// Prints follow=, picodeck_ref=, next= (the next patch version) and
// web_sim_ref= (web-sim's latest release tag: a follow release rebuilds that
// release's commit, never unreleased work on main), and appends them to
// $GITHUB_OUTPUT in CI. All but follow are empty when it is false.
//
// An API or network failure must never read as "follow": resolveRef and the
// release lookups are never wrapped in a catch-all here, so a lookup error
// rejects shouldFollow() and the CLI exits 1 instead of publishing. Nor may
// a missing or malformed published_at: decide() throws on one.
//
// PicoDeck's release.yml sends its tag with picodeck-release
// (client_payload.tag, EXPECT_PICODECK_TAG here). Just after a release,
// GitHub's releases/latest can still name the previous one, which would read
// as "nothing new" and quietly not follow; so with an expected tag this first
// re-reads latest until it names that tag, and fails if it never does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { github, output, readPin, resolveRef } from './picodeck-ref.mjs';

export const WEB_SIM_REPO = 'PicoDeck/web-sim';

// A plain release tag: vX.Y.Z, optionally with a pre-release or build suffix.
export const PLAIN_TAG = /^v\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/;
// How long to wait for releases/latest to name the dispatched tag: reads, and
// the pause between two of them.
export const LATEST_TRIES = 6;
export const LATEST_WAIT_MS = 10_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Re-reads picodeckLatest() until its tag is `expected`, up to LATEST_TRIES
// times with sleep(LATEST_WAIT_MS) between reads, and returns that release;
// rejects naming both tags if it never is.
export async function waitForLatest({ expected, picodeckLatest, sleep = pause }) {
  let tag = null;
  for (let i = 0; i < LATEST_TRIES; i++) {
    if (i > 0) await sleep(LATEST_WAIT_MS);
    const latest = await picodeckLatest();
    tag = latest?.tag_name ?? null;
    if (tag === expected) return latest;
  }
  throw new Error(`PicoDeck released ${expected}, but after ${LATEST_TRIES} reads `
    + `${LATEST_WAIT_MS / 1000} s apart its latest release is ${tag ?? 'none'}, not the dispatched ${expected}`);
}

export function bumpPatch(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  if (!m) throw new Error(`web-sim release tag ${tag} is not vX.Y.Z`);
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// The PicoDeck ref a web-sim release was built against, from its notes.
export function builtAgainst(release) {
  return /Built against PicoDeck (\S+) \(/.exec(release?.body ?? '')?.[1] ?? null;
}

// GitHub's timestamp form (2026-09-30T12:34:56Z): anything else, or a date
// that doesn't exist, is an error rather than a guess.
const GITHUB_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function publishedAt(what, release) {
  const at = release?.published_at;
  const ms = typeof at === 'string' && GITHUB_TIME.test(at) ? Date.parse(at) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== at.slice(0, 10)) {
    throw new Error(`${what} ${release?.tag_name} has no valid published_at (${JSON.stringify(at)})`);
  }
  return ms;
}

// resolved: resolveRef()'s result with no explicit ref; picodeck: PicoDeck's
// latest release ({ tag_name, published_at }, the one resolved.ref came
// from); release: web-sim's latest release (GitHub API object) or null.
// Pure: no lookups. Tells a real new release apart from a fallback by
// resolved.source (never by parsing why): a resolveRef lookup failure must
// reach here as a rejection, not as a "no seam" why text that would compare
// equal to the fallback case. Follows only a PicoDeck release published
// after web-sim's latest release: one published before it was normally
// already out when that release was built, so it chose its ref on purpose.
// (Not if PicoDeck released while that build ran: its ref was resolved
// first. That release is then followed at PicoDeck's next release.)
export function decide({ resolved, picodeck, release }) {
  if (resolved.source !== 'release') {
    return { follow: false, why: `no PicoDeck release with the web build seam yet (${resolved.why})` };
  }
  if (!release) return { follow: false, why: 'web-sim has no release yet: publish v1.0.0 by hand' };
  const built = builtAgainst(release);
  if (built === resolved.ref) {
    return { follow: false, why: `${release.tag_name} is already built against ${resolved.ref}` };
  }
  if (picodeck?.tag_name !== resolved.ref) {
    throw new Error(`PicoDeck's latest release lookup (${picodeck?.tag_name ?? 'none'}) `
      + `is not the resolved ${resolved.ref}`);
  }
  const picodeckAt = publishedAt('PicoDeck release', picodeck);
  const webSimAt = publishedAt('web-sim release', release);
  if (picodeckAt <= webSimAt) {
    return { follow: false,
      why: `PicoDeck's latest release ${resolved.ref} (published ${picodeck.published_at}) predates web-sim `
        + `${release.tag_name} (published ${release.published_at}, built against ${built ?? 'an unrecorded ref'}): `
        + "waiting for PicoDeck's next release" };
  }
  const builtWhy = built ? ` was built against ${built}` : "'s notes don't record a PicoDeck ref";
  return { follow: true, picodeck_ref: resolved.ref, next: bumpPatch(release.tag_name),
    web_sim_ref: release.tag_name,
    why: `${release.tag_name}${builtWhy}; PicoDeck released ${resolved.ref}` };
}

// The CLI's outputs for a decision: every key present, empty when unset.
export function outputsOf(d) {
  return { follow: d.follow, picodeck_ref: d.picodeck_ref ?? '', next: d.next ?? '',
    web_sim_ref: d.web_sim_ref ?? '' };
}

// web-sim's latest release (GitHub API object), or null when it has none.
export async function latestWebSimRelease() {
  const headers = { 'User-Agent': 'picodeck-web-sim' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${WEB_SIM_REPO}/releases/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`web-sim latest release: HTTP ${res.status}`);
  return res.json();
}

// picodeckLatest: PicoDeck's latest release lookup ({ tag_name,
// published_at } or null; github.latestRelease in the CLI). pin, cmakeAt:
// resolveRef()'s other inputs (no explicit ref: this is always "what would
// CI build today"), with latestTag answered from the one picodeckLatest()
// read, so the tag and its date come from the same release. webSimLatest:
// web-sim's latest release lookup, only consulted once resolveRef succeeds.
// expectTag: the tag PicoDeck dispatched, or empty (the schedule, a manual
// run) to read latest once; sleep: waitForLatest's pause (tests pass one
// that returns at once). No catch-all: any rejection here propagates,
// uncaught.
export async function shouldFollow({ pin, picodeckLatest, cmakeAt, webSimLatest, expectTag = '', sleep }) {
  let latest;
  if (expectTag) {
    if (!PLAIN_TAG.test(expectTag)) {
      throw new Error(`the dispatched PicoDeck tag ${JSON.stringify(expectTag)} is not a plain release tag (vX.Y.Z)`);
    }
    latest = await waitForLatest({ expected: expectTag, picodeckLatest, sleep });  // the dispatched release
  } else {
    latest = await picodeckLatest();
  }
  const resolved = await resolveRef({ explicit: '', pin, latestTag: async () => latest?.tag_name ?? null, cmakeAt });
  const release = await webSimLatest();
  return decide({ resolved, picodeck: latest, release });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pin = readPin(readFileSync(new URL('../picodeck.pin', import.meta.url), 'utf8'));
  shouldFollow({ pin, picodeckLatest: github.latestRelease, cmakeAt: github.cmakeAt,
    webSimLatest: latestWebSimRelease, expectTag: process.env.EXPECT_PICODECK_TAG ?? '' })
    .then((d) => {
      console.error(`should-follow: ${d.why}`);
      output(outputsOf(d));
    })
    .catch((err) => { console.error(`should-follow: ${err.message}`); process.exit(1); });
}
