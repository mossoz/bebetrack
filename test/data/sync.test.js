import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCursor, startSync } from '../../app/js/data/sync.js';

test('nextCursor', () => {
  assert.equal(nextCursor(0, [{ atMs: 5 }, { atMs: null }, { atMs: 9 }]), 9);
  assert.equal(nextCursor(10, [{ atMs: 9 }]), 10);
  assert.equal(nextCursor(3, []), 3);
});

test('startSync loads the cache, then listens from the newest write', async () => {
  const ingested = [];
  const store = { ingest: async (records) => ingested.push(records.map((r) => r.id)) };
  const listens = [];
  let unsubscribed = 0;
  const listen = (sinceMs, onRecords, onError) => {
    listens.push({ sinceMs, onRecords, onError });
    return () => unsubscribed++;
  };
  const load = async () => [
    { id: 'a', atMs: 5 },
    { id: 'b', atMs: 9 },
  ];

  const sync = await startSync({ load, listen, store, onError: () => {} });
  assert.deepEqual(ingested, [['a', 'b']]);
  assert.equal(listens.length, 1);
  assert.equal(listens[0].sinceMs, 9);

  listens[0].onRecords([{ id: 'c', atMs: 12 }]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ingested.at(-1), ['c']);

  sync.restart();
  assert.equal(unsubscribed, 1);
  assert.equal(listens.length, 2);
  assert.equal(listens[1].sinceMs, 12);

  sync.stop();
  assert.equal(unsubscribed, 2);
});

test('listen errors go to onError', async () => {
  const errors = [];
  let captured;
  const listen = (sinceMs, onRecords, onError) => {
    captured = onError;
    return () => {};
  };
  await startSync({ load: async () => [], listen, store: { ingest: async () => {} }, onError: (e) => errors.push(e) });
  captured(new Error('boom'));
  assert.equal(errors.length, 1);
});
