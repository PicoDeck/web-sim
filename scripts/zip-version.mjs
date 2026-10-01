#!/usr/bin/env node
// Prints a packaged zip's web_sim version, from its version.json (fflate, the
// same way notes.mjs reads it: no external unzip binary on the publish path).
//   node scripts/zip-version.mjs picodeck-web-sim.zip
// publish.sh uses this to refuse publishing a zip whose web_sim disagrees
// with the tag being published.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readVersionJson } from './notes.mjs';

export function webSimVersion(bytes) {
  const info = readVersionJson(bytes);
  if (!info.web_sim) throw new Error("the zip's version.json has no web_sim");
  return info.web_sim;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const zipPath = process.argv[2] ?? 'picodeck-web-sim.zip';
  try { process.stdout.write(webSimVersion(readFileSync(zipPath))); }
  catch (err) { console.error(`zip-version: ${err.message}`); process.exit(1); }
}
