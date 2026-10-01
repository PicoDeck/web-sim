#!/usr/bin/env node
// Whether web-sim should publish a release for a new PicoDeck release: when
// PicoDeck's latest release has the web build seam and web-sim's latest
// release was built against an older one. Prints follow=, picodeck_ref=,
// next= (the next patch version) and web_sim_ref= (web-sim's latest release
// tag: a follow release rebuilds that release's commit, never unreleased work
// on main), and appends them to $GITHUB_OUTPUT in CI. All but follow are
// empty when it is false.
//
// An API or network failure must never read as "follow": resolveRef and the
// web-sim release lookup are never wrapped in a catch-all here, so a lookup
// error rejects shouldFollow() and the CLI exits 1 instead of publishing.
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

// Re-reads latestTag() until it is `expected`, up to LATEST_TRIES times with
// sleep(LATEST_WAIT_MS) between reads; rejects naming both tags if it never is.
export async function waitForLatest({ expected, latestTag, sleep = pause }) {
  let tag = null;
  for (let i = 0; i < LATEST_TRIES; i++) {
    if (i > 0) await sleep(LATEST_WAIT_MS);
    tag = await latestTag();
    if (tag === expected) return tag;
  }
  throw new Error(`PicoDeck released ${expected}, but its latest release is still `
    + `${tag ?? 'none'} after ${LATEST_TRIES} reads ${LATEST_WAIT_MS / 1000} s apart`);
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

// resolved: resolveRef()'s result with no explicit ref; release: web-sim's
// latest release (GitHub API object) or null. Tells a real new release apart
// from a fallback by resolved.source (never by parsing why): a resolveRef
// lookup failure must reach here as a rejection, not as a "no seam" why text
// that would compare equal to the fallback case.
export function decide({ resolved, release }) {
  if (resolved.source !== 'release') {
    return { follow: false, why: `no PicoDeck release with the web build seam yet (${resolved.why})` };
  }
  if (!release) return { follow: false, why: 'web-sim has no release yet: publish v1.0.0 by hand' };
  const built = builtAgainst(release);
  if (built === resolved.ref) {
    return { follow: false, why: `${release.tag_name} is already built against ${resolved.ref}` };
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

async function latestWebSimRelease() {
  const headers = { 'User-Agent': 'picodeck-web-sim' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${WEB_SIM_REPO}/releases/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`web-sim latest release: HTTP ${res.status}`);
  return res.json();
}

// pin, latestTag, cmakeAt: resolveRef()'s inputs (no explicit ref: this is
// always "what would CI build today"); latestRelease: web-sim's latest
// release lookup, only consulted once resolveRef succeeds. expectTag: the tag
// PicoDeck dispatched, or empty (the schedule, a manual run) to read latest
// once; sleep: waitForLatest's pause (tests pass one that returns at once).
// No catch-all: any rejection here propagates, uncaught.
export async function shouldFollow({ pin, latestTag, cmakeAt, latestRelease, expectTag = '', sleep }) {
  if (expectTag) {
    if (!PLAIN_TAG.test(expectTag)) {
      throw new Error(`the dispatched PicoDeck tag ${JSON.stringify(expectTag)} is not a plain release tag (vX.Y.Z)`);
    }
    const tag = await waitForLatest({ expected: expectTag, latestTag, sleep });
    latestTag = async () => tag;  // decide on the release that was dispatched
  }
  const resolved = await resolveRef({ explicit: '', pin, latestTag, cmakeAt });
  const release = await latestRelease();
  return decide({ resolved, release });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pin = readPin(readFileSync(new URL('../picodeck.pin', import.meta.url), 'utf8'));
  shouldFollow({ pin, latestTag: github.latestTag, cmakeAt: github.cmakeAt, latestRelease: latestWebSimRelease,
    expectTag: process.env.EXPECT_PICODECK_TAG ?? '' })
    .then((d) => {
      console.error(`should-follow: ${d.why}`);
      output(outputsOf(d));
    })
    .catch((err) => { console.error(`should-follow: ${err.message}`); process.exit(1); });
}
