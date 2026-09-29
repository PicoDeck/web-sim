#!/usr/bin/env node
// Whether web-sim should publish a release for a new PicoDeck release: when
// PicoDeck's latest release has the web build seam and web-sim's latest
// release was built against an older one. Prints follow=, picodeck_ref= and
// next= (the next patch version), and appends them to $GITHUB_OUTPUT in CI.
//
// An API or network failure must never read as "follow": resolveRef and the
// web-sim release lookup are never wrapped in a catch-all here, so a lookup
// error rejects shouldFollow() and the CLI exits 1 instead of publishing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { github, output, readPin, resolveRef } from './picodeck-ref.mjs';

export const WEB_SIM_REPO = 'PicoDeck/web-sim';

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
  if (builtAgainst(release) === resolved.ref) {
    return { follow: false, why: `${release.tag_name} is already built against ${resolved.ref}` };
  }
  return { follow: true, picodeck_ref: resolved.ref, next: bumpPatch(release.tag_name),
    why: `${release.tag_name} was built against ${builtAgainst(release)}; PicoDeck released ${resolved.ref}` };
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
// release lookup, only consulted once resolveRef succeeds. No catch-all: any
// rejection here propagates, uncaught.
export async function shouldFollow({ pin, latestTag, cmakeAt, latestRelease }) {
  const resolved = await resolveRef({ explicit: '', pin, latestTag, cmakeAt });
  const release = await latestRelease();
  return decide({ resolved, release });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pin = readPin(readFileSync(new URL('../picodeck.pin', import.meta.url), 'utf8'));
  shouldFollow({ pin, latestTag: github.latestTag, cmakeAt: github.cmakeAt, latestRelease: latestWebSimRelease })
    .then((d) => {
      console.error(`should-follow: ${d.why}`);
      output({ follow: d.follow, picodeck_ref: d.picodeck_ref ?? '', next: d.next ?? '' });
    })
    .catch((err) => { console.error(`should-follow: ${err.message}`); process.exit(1); });
}
