#!/usr/bin/env node
// Which PicoDeck ref a web-sim build compiles: the ref given on the command
// line (a tag, branch or commit); else PicoDeck's latest release, if it has
// the web build seam (PICODECK_WEB_DIR in simulator/CMakeLists.txt); else the
// commit in picodeck.pin. Prints ref= and why= lines, and appends them to
// $GITHUB_OUTPUT in CI.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = 'PicoDeck/picodeck';
export const SEAM = 'PICODECK_WEB_DIR';

// latestTag() gives the latest release tag or null; cmakeAt(ref) gives that
// ref's simulator/CMakeLists.txt. source is 'requested', 'release' or 'pin':
// should-follow.mjs's decide() tells a real new release apart from a fallback
// by source, never by parsing why.
// A command-line ref (a branch, tag or commit SHA) is safe to hand to git and
// to GitHub's API: reject what git's own ref-name rules forbid, plus a
// leading '-' (so it can never be read as an option).
const FORBIDDEN_REF_CHARS = /[\s~^:?*[\\]/;
export function validateRef(ref) {
  if (!ref) throw new Error('ref is empty');
  if (ref.startsWith('-')) throw new Error(`ref ${JSON.stringify(ref)} starts with '-' (looks like an option)`);
  if (ref.includes('..')) throw new Error(`ref ${JSON.stringify(ref)} contains '..'`);
  if (FORBIDDEN_REF_CHARS.test(ref)) {
    throw new Error(`ref ${JSON.stringify(ref)} contains a character git forbids in ref names`);
  }
  return ref;
}

export async function resolveRef({ explicit, pin, latestTag, cmakeAt }) {
  if (explicit) return { ref: validateRef(explicit), source: 'requested', why: 'requested' };
  const tag = await latestTag();
  if (tag && (await cmakeAt(tag)).includes(SEAM)) return { ref: tag, source: 'release', why: `latest release ${tag}` };
  if (!pin) throw new Error(`the latest release (${tag ?? 'none'}) predates the web build seam and picodeck.pin is empty`);
  return { ref: pin, source: 'pin',
    why: `picodeck.pin (the latest release, ${tag ?? 'none'}, predates the web build seam)` };
}

// The first non-comment line of picodeck.pin.
export function readPin(text) {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
}

async function get(url) {
  const headers = { 'User-Agent': 'picodeck-web-sim' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(url, { headers });
}

// PicoDeck's latest release: { tag_name, published_at }, or null when it has
// none. should-follow.mjs needs the date (it follows only a PicoDeck release
// published after web-sim's latest); resolveRef needs only the tag.
async function latestRelease() {
  const res = await get(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`latest release: HTTP ${res.status}`);
  const { tag_name, published_at } = await res.json();
  return { tag_name, published_at };
}

// A PicoDeck release by its tag: { tag_name, published_at }, or null when
// there is none. should-follow.mjs judges a follow release by the date of the
// PicoDeck release it was rebuilt for.
async function releaseByTag(tag) {
  const res = await get(`https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`release ${tag}: HTTP ${res.status}`);
  const { tag_name, published_at } = await res.json();
  return { tag_name, published_at };
}

export const github = {
  latestRelease,
  releaseByTag,
  async latestTag() {
    return (await latestRelease())?.tag_name ?? null;
  },
  async cmakeAt(ref) {
    const res = await get(`https://raw.githubusercontent.com/${REPO}/${ref}/simulator/CMakeLists.txt`);
    if (!res.ok) throw new Error(`${ref} simulator/CMakeLists.txt: HTTP ${res.status}`);
    return res.text();
  },
};

export function output(pairs) {
  const text = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pin = readPin(readFileSync(new URL('../picodeck.pin', import.meta.url), 'utf8'));
  resolveRef({ explicit: process.argv[2] || '', pin, ...github })
    .then((r) => output({ ref: r.ref, source: r.source, why: r.why }))
    .catch((err) => { console.error(`picodeck-ref: ${err.message}`); process.exit(1); });
}
