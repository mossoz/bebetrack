import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSync } from '../../app/js/data/sync.js';

function harness({ cached = [], stored = 0 } = {}) {
  const ingested = [];
  const store = { ingest: async (records) => ingested.push(records.map((r) => r.id)) };
  const listens = [];
  let unsubscribed = 0;
  const listen = (sinceMs, onBatch, onError) => {
    listens.push({ sinceMs, onBatch, onError });
    return () => unsubscribed++;
  };
  let saved = stored;
  const cursor = { get: () => saved, set: (ms) => (saved = ms) };
  return { ingested, store, listens, cursor, listen, load: async () => cached, unsubscribed: () => unsubscribed, saved: () => saved };
}

const tick = () => new Promise((r) => setImmediate(r));

test('starts from the saved cursor, not from what the cache holds', async () => {
  // The cache can hold this phone's own acknowledged write before the other
  // phone's earlier writes have arrived, so its newest `at` is not safe.
  const h = harness({ cached: [{ id: 'a', atMs: 5 }, { id: 'b', atMs: 9 }], stored: 3 });
  await startSync({ load: h.load, listen: h.listen, store: h.store, cursor: h.cursor, onError: () => {} });
  assert.deepEqual(h.ingested, [['a', 'b']]);
  assert.equal(h.listens[0].sinceMs, 3);
});

test('an empty cache starts from zero', async () => {
  const h = harness({ cached: [], stored: 50 });
  await startSync({ load: h.load, listen: h.listen, store: h.store, cursor: h.cursor, onError: () => {} });
  assert.equal(h.listens[0].sinceMs, 0);
});

test('only server-synced batches move the cursor', async () => {
  const h = harness({ cached: [{ id: 'a', atMs: 5 }], stored: 5 });
  const sync = await startSync({ load: h.load, listen: h.listen, store: h.store, cursor: h.cursor, onError: () => {} });

  h.listens[0].onBatch([{ id: 'own', atMs: 40 }], { synced: false, maxAtMs: 40 });
  await tick();
  assert.deepEqual(h.ingested.at(-1), ['own']);
  assert.equal(h.saved(), 5);

  h.listens[0].onBatch([{ id: 'c', atMs: 12 }], { synced: true, maxAtMs: 40 });
  await tick();
  assert.deepEqual(h.ingested.at(-1), ['c']);
  assert.equal(h.saved(), 40);

  h.listens[0].onBatch([], { synced: true, maxAtMs: 30 });
  assert.equal(h.saved(), 40);

  sync.restart();
  assert.equal(h.unsubscribed(), 1);
  assert.equal(h.listens[1].sinceMs, 40);
  sync.stop();
  assert.equal(h.unsubscribed(), 2);
});

test('listen errors go to onError', async () => {
  const h = harness();
  const errors = [];
  await startSync({ load: h.load, listen: h.listen, store: h.store, cursor: h.cursor, onError: (e) => errors.push(e) });
  h.listens[0].onError(new Error('boom'));
  assert.equal(errors.length, 1);
});
