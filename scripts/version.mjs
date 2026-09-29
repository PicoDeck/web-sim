// What went into a web-sim build: version.json in the release zip, and the
// release notes, whose "Built against PicoDeck <ref>" line
// scripts/should-follow.mjs reads back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The tag in a GitHub release-download URL ("v1.0.3"), or null.
export function releaseTag(url) {
  const m = /\/releases\/download\/([^/]+)\//.exec(url);
  return m ? m[1] : null;
}

// The "version" in a PicoDeck app's app.json, or null.
export function appVersion(picodeckDir, dir) {
  try {
    return JSON.parse(readFileSync(join(picodeckDir, 'apps', dir, 'app.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

// apps: apps.json's contents; builtinVersion(dir) gives a built-in app's version.
export function versionInfo({ webSim, picodeck, apps, builtinVersion }) {
  return {
    web_sim: webSim,
    picodeck: { ref: picodeck.ref, commit: picodeck.commit },
    apps: {
      builtin: apps.builtin.map((dir) => ({ dir, version: builtinVersion(dir) })),
      store: apps.store.map((a) => ({ dir: a.dir, version: releaseTag(a.url) })),
    },
  };
}

export function releaseNotes(info) {
  const apps = [...info.apps.builtin, ...info.apps.store]
    .map((a) => `- ${a.dir} ${a.version ?? ''}`.trimEnd());
  return [
    `Built against PicoDeck ${info.picodeck.ref} (${info.picodeck.commit.slice(0, 7)}).`,
    '',
    'Apps:',
    ...apps,
    '',
  ].join('\n');
}
