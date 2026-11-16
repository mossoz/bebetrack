import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../app/js/data/session.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const throwing = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

const SESSION = { passphrase: 'acid acorn acre', keyB64: 'abc=', spaceId: 'xyz' };

test('save and load round trip, clear forgets', () => {
  const s = createSession(memoryStorage());
  assert.equal(s.load(), null);
  s.save(SESSION);
  assert.deepEqual(s.load(), SESSION);
  s.clear();
  assert.equal(s.load(), null);
});

test('corrupt JSON reads as null', () => {
  const storage = memoryStorage();
  storage.setItem('bebetrack.session', '{nope');
  assert.equal(createSession(storage).load(), null);
});

test('a session with missing fields reads as null', () => {
  const storage = memoryStorage();
  storage.setItem('bebetrack.session', JSON.stringify({ v: 1, passphrase: 'x' }));
  assert.equal(createSession(storage).load(), null);
});

test('throwing storage never throws', () => {
  const s = createSession(throwing);
  assert.equal(s.load(), null);
  assert.equal(s.loadUnit(), 'ml');
  s.save(SESSION);
  s.saveUnit('oz');
  s.clear();
});

test('unit', () => {
  const s = createSession(memoryStorage());
  assert.equal(s.loadUnit(), 'ml');
  s.saveUnit('oz');
  assert.equal(s.loadUnit(), 'oz');
});

test('sync cursor is kept per space and cleared on leave', () => {
  const s = createSession(memoryStorage());
  assert.equal(s.loadCursor('space-1'), 0);
  s.saveCursor('space-1', 1234);
  assert.equal(s.loadCursor('space-1'), 1234);
  assert.equal(s.loadCursor('space-2'), 0);
  s.clear();
  assert.equal(s.loadCursor('space-1'), 0);
  assert.equal(createSession(throwing).loadCursor('space-1'), 0);
});
