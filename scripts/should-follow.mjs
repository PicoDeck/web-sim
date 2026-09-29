#!/usr/bin/env node
// Whether web-sim should publish a release for a new PicoDeck release: when
// PicoDeck's latest release has the web build seam and web-sim's latest
// release was built against an older one. Prints follow=, picodeck_ref= and
// next= (the next patch version), and appends them to $GITHUB_OUTPUT in CI.
import { fileURLToPath } from 'node:url';
import { github, output, resolveRef } from './picodeck-ref.mjs';

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
// latest release (GitHub API object) or null.
export function decide({ resolved, release }) {
  if (!resolved.why.startsWith('latest release')) {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.all([resolveRef({ explicit: '', pin: '', ...github })
    .catch((err) => ({ ref: '', why: err.message })), latestWebSimRelease()])
    .then(([resolved, release]) => {
      const d = decide({ resolved, release });
      console.error(`should-follow: ${d.why}`);
      output({ follow: d.follow, picodeck_ref: d.picodeck_ref ?? '', next: d.next ?? '' });
    })
    .catch((err) => { console.error(`should-follow: ${err.message}`); process.exit(1); });
}
