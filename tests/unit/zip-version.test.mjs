import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { webSimVersion } from '../../scripts/zip-version.mjs';

const zipWith = (entries) => zipSync(Object.fromEntries(
  Object.entries(entries).map(([name, content]) => [name, strToU8(content)])));

test('webSimVersion reads web_sim out of the zip\'s version.json', () => {
  const zip = zipWith({ 'version.json': JSON.stringify({ web_sim: 'v1.0.1' }) });
  assert.equal(webSimVersion(zip), 'v1.0.1');
});

test('a zip with no version.json gives a clear error', () => {
  const zip = zipWith({ 'other.txt': 'x' });
  assert.throws(() => webSimVersion(zip), /the zip has no version\.json/);
});

test('a version.json that is not valid JSON gives a clear error', () => {
  const zip = zipWith({ 'version.json': '{not json' });
  assert.throws(() => webSimVersion(zip), /version\.json is not valid JSON/);
});

test('a version.json with no web_sim field gives a clear error', () => {
  const zip = zipWith({ 'version.json': JSON.stringify({ picodeck: { ref: 'v0.5.0' } }) });
  assert.throws(() => webSimVersion(zip), /version\.json has no web_sim/);
});
