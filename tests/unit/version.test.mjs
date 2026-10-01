import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appVersion, releaseNotes, releaseTag, versionInfo } from '../../scripts/version.mjs';
import { builtAgainst } from '../../scripts/should-follow.mjs';

const APPS = {
  builtin: ['snake'],
  store: [{ dir: 'blockexe', url: 'https://github.com/PicoDeck/blockexe/releases/download/v1.0.3/x.zip', sha256: 'aa' }],
};

test('releaseTag reads the tag out of a release-download URL', () => {
  assert.equal(releaseTag('https://github.com/o/r/releases/download/v1.0.3/a.zip'), 'v1.0.3');
  assert.equal(releaseTag('https://example.test/a.zip'), null);
});

test('appVersion reads a PicoDeck app.json, or null', () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-'));
  mkdirSync(join(root, 'apps', 'snake'), { recursive: true });
  writeFileSync(join(root, 'apps', 'snake', 'app.json'), '{"version":"1.2.0"}');
  assert.equal(appVersion(root, 'snake'), '1.2.0');
  assert.equal(appVersion(root, 'missing'), null);
});

test('versionInfo records the versions of everything in the build', () => {
  const info = versionInfo({ webSim: 'v1.0.0', picodeck: { ref: 'v0.5.0', commit: 'abcdef1234' },
    apps: APPS, builtinVersion: () => '1.2.0' });
  assert.deepEqual(info, {
    web_sim: 'v1.0.0',
    picodeck: { ref: 'v0.5.0', commit: 'abcdef1234' },
    apps: { builtin: [{ dir: 'snake', version: '1.2.0' }], store: [{ dir: 'blockexe', version: 'v1.0.3' }] },
  });
});

test('the notes say what PicoDeck the release was built against, readably back', () => {
  const info = versionInfo({ webSim: 'v1.0.0', picodeck: { ref: 'v0.5.0', commit: 'abcdef1234' },
    apps: APPS, builtinVersion: () => '1.2.0' });
  const notes = releaseNotes(info);
  assert.match(notes, /^Built against PicoDeck v0\.5\.0 \(abcdef1\)\./);
  assert.match(notes, /- blockexe v1\.0\.3/);
  assert.equal(builtAgainst({ body: notes }), 'v0.5.0');
  assert.doesNotMatch(notes, /Rebuilt for/);
});

test('a follow release says it was rebuilt for the new PicoDeck ref', () => {
  const info = versionInfo({ webSim: 'v1.0.0', picodeck: { ref: 'v0.6.0', commit: 'abcdef1234' },
    apps: APPS, builtinVersion: () => '1.2.0' });
  const notes = releaseNotes(info, { rebuilt: true });
  assert.match(notes, /^Built against PicoDeck v0\.6\.0 \(abcdef1\)\.\nRebuilt for PicoDeck v0\.6\.0\.\n/);
  assert.equal(builtAgainst({ body: notes }), 'v0.6.0');
});
