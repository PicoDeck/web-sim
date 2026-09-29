#!/usr/bin/env node
// Prints the release notes for a packaged zip, from its version.json.
//   node scripts/notes.mjs picodeck-web-sim.zip [--rebuilt]
// --rebuilt (a follow release) adds "Rebuilt for PicoDeck <ref>."; publish.sh
// passes it when it is given a target commit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { releaseNotes } from './version.mjs';

export function notesFromZip(bytes, opts = {}) {
  const files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === 'version.json' });
  if (!files['version.json']) throw new Error('the zip has no version.json');
  return releaseNotes(JSON.parse(strFromU8(files['version.json'])), opts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rebuilt = args.includes('--rebuilt');
  const zipPath = args.find((a) => a !== '--rebuilt') ?? 'picodeck-web-sim.zip';
  try { process.stdout.write(notesFromZip(readFileSync(zipPath), { rebuilt })); }
  catch (err) { console.error(`notes: ${err.message}`); process.exit(1); }
}
