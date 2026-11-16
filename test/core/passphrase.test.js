import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../app/js/core/wordlist.js';
import { generatePassphrase, isStrongEnough, MIN_LENGTH } from '../../app/js/core/passphrase.js';

test('wordlist', () => {
  assert.equal(WORDS.length, 1296);
  assert.equal(new Set(WORDS).size, 1296);
  // The EFF list has one hyphenated word ('yo-yo'); hyphens are fine inside a space-separated phrase.
  for (const w of WORDS) assert.match(w, /^[a-z][a-z-]{2,4}$/);
});

test('generates five list words', () => {
  const words = generatePassphrase().split(' ');
  assert.equal(words.length, 5);
  for (const w of words) assert.ok(WORDS.includes(w), w);
});

test('is random', () => {
  const seen = new Set(Array.from({ length: 20 }, () => generatePassphrase()));
  assert.equal(seen.size, 20);
});

test('generated passes the strength check', () => {
  for (let i = 0; i < 50; i++) assert.equal(isStrongEnough(generatePassphrase()), true);
});

test('strength', () => {
  assert.equal(MIN_LENGTH, 20);
  assert.equal(isStrongEnough('short pass'), false);
  assert.equal(isStrongEnough('   ' + 'a'.repeat(19) + '  '), false);
  assert.equal(isStrongEnough('a'.repeat(20)), true);
});
