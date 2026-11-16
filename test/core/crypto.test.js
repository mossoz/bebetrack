import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PBKDF2_ITERATIONS,
  SALT,
  RECORD_VERSION,
  normalizePassphrase,
  deriveSecrets,
  importKey,
  encryptEvent,
  decryptEvent,
  toBase64,
  fromBase64,
} from '../../app/js/core/crypto.js';

const FAST = { iterations: 1000 };
const EVENT = { id: 'e1', type: 'bottle', start: 1000, end: 1000, ml: 90, deleted: false, updatedAt: 5 };

test('constants', () => {
  assert.equal(PBKDF2_ITERATIONS, 600000);
  assert.equal(SALT, 'bebetrack.v1');
  assert.equal(RECORD_VERSION, 1);
});

test('normalizePassphrase collapses typing differences', () => {
  assert.equal(normalizePassphrase('  Acid   Acorn\tacre '), 'acid acorn acre');
});

test('typed variations derive the same secrets', async () => {
  const a = await deriveSecrets('acid acorn acre', FAST);
  const b = await deriveSecrets('Acid  acorn acre ', FAST);
  assert.equal(a.spaceId, b.spaceId);
  assert.equal(a.keyB64, b.keyB64);
});

test('pinned vector, fast', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  assert.equal(s.keyB64, 'X4W9LSyWRu5zcL6snjMkx8CMuJuTMznm+WoFrsxArts=');
  assert.equal(s.spaceId, 'N3kRFNK-jogeuGy7LQ00EJ84JYOeYvBLvpsuCRD5rpo');
  assert.equal(s.spaceHash, 'oO7Ac7B9fGRu2gfJiHDiHMezU8GocjaMufNzVtZsWUQ=');
});

test('pinned vector, production iterations', async () => {
  const s = await deriveSecrets('acid acorn acre');
  assert.equal(s.keyB64, 'iN7ukmDQ8a2zBPoews0KEo2uhfM32W4XvTUVemCcMpk=');
  assert.equal(s.spaceId, '0Syggp5DidotV1Je4Y7WkyFn9lxU375je2LC-F8KpMg');
  assert.equal(s.spaceHash, 'J52J0JZynZEbn+OojmGAIjU/ed7luTAKhIlmLeASMLE=');
});

test('different passphrases differ', async () => {
  const a = await deriveSecrets('acid acorn acre', FAST);
  const b = await deriveSecrets('acid acorn acres', FAST);
  assert.notEqual(a.spaceId, b.spaceId);
  assert.notEqual(a.keyB64, b.keyB64);
});

test('spaceId format', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  assert.match(s.spaceId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fromBase64(s.keyB64).length, 32);
});

test('base64 helpers round trip', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test('round trip', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  const record = await encryptEvent(s.key, EVENT);
  assert.equal(record.v, 1);
  assert.equal(record.id, 'e1');
  assert.equal(record.iv.length, 16);
  assert.equal(typeof record.ct, 'string');
  assert.ok(!record.ct.includes('bottle'));
  const key2 = await importKey(s.keyB64);
  assert.deepEqual(await decryptEvent(key2, record), EVENT);
});

test('tampered ciphertext rejects', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  const record = await encryptEvent(s.key, EVENT);
  const bytes = fromBase64(record.ct);
  bytes[0] ^= 1;
  await assert.rejects(decryptEvent(s.key, { ...record, ct: toBase64(bytes) }));
});

test('swapped id rejects', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  const record = await encryptEvent(s.key, EVENT);
  await assert.rejects(decryptEvent(s.key, { ...record, id: 'e2' }));
});

test('wrong key rejects', async () => {
  const s = await deriveSecrets('acid acorn acre', FAST);
  const other = await deriveSecrets('acid acorn acres', FAST);
  const record = await encryptEvent(s.key, EVENT);
  await assert.rejects(decryptEvent(other.key, record));
});
