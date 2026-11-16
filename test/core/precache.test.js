// The service worker precaches the whole app so it opens with no signal.
// This keeps its PRECACHE list in step with the files that actually exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const FIREBASE_APP = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
const FIREBASE_FIRESTORE = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

function precacheList() {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js defines const PRECACHE = [ ... ];');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function appFiles(dir = APP) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const full = join(dir, d.name);
    return d.isDirectory() ? appFiles(full) : ['./' + relative(APP, full)];
  });
}

test('every app file is precached', () => {
  const listed = new Set(precacheList());
  for (const file of appFiles()) {
    if (file === './sw.js') continue;
    assert.ok(listed.has(file), `${file} is missing from PRECACHE in app/sw.js`);
  }
});

test('every precached local path exists', () => {
  for (const entry of precacheList()) {
    if (!entry.startsWith('./')) continue;
    assert.ok(existsSync(join(APP, entry)), `${entry} is in PRECACHE but not on disk`);
  }
});

test('the pinned Firebase modules are precached', () => {
  const listed = precacheList();
  assert.ok(listed.includes(FIREBASE_APP));
  assert.ok(listed.includes(FIREBASE_FIRESTORE));
});

test('index.html maps the same Firebase URLs', () => {
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  assert.ok(html.includes(`"firebase/app": "${FIREBASE_APP}"`));
  assert.ok(html.includes(`"firebase/firestore": "${FIREBASE_FIRESTORE}"`));
});
