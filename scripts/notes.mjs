#!/usr/bin/env node
// Prints the release notes for a packaged zip, from its version.json.
//   node scripts/notes.mjs picodeck-web-sim.zip
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { releaseNotes } from './version.mjs';

export function notesFromZip(bytes) {
  const files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === 'version.json' });
  if (!files['version.json']) throw new Error('the zip has no version.json');
  return releaseNotes(JSON.parse(strFromU8(files['version.json'])));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(notesFromZip(readFileSync(process.argv[2] ?? 'picodeck-web-sim.zip'))); }
  catch (err) { console.error(`notes: ${err.message}`); process.exit(1); }
}
