import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../../app/js/data/store.js';
import { deriveSecrets, encryptEvent, decryptEvent, toBase64, fromBase64 } from '../../app/js/core/crypto.js';
import { makeBottle, makeDiaper } from '../../app/js/core/events.js';

const secrets = await deriveSecrets('acid acorn acre', { iterations: 1000 });
const otherSecrets = await deriveSecrets('acid acorn acres', { iterations: 1000 });

function setup(start = 1000) {
  const writes = [];
  let now = start;
  const store = new EventStore({ key: secrets.key, write: (r) => writes.push(r), now: () => now });
  return { store, writes, setNow: (v) => (now = v) };
}

test('save adds, writes an encrypted record, and stamps updatedAt', async () => {
  const { store, writes } = setup(1000);
  const { previous, saved } = await store.save(makeBottle(90, 500));
  assert.equal(previous, undefined);
  assert.equal(saved.updatedAt, 1000);
  assert.deepEqual(store.all(), [saved]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, saved.id);
  assert.deepEqual(await decryptEvent(secrets.key, writes[0]), saved);
});

test('updatedAt is monotonic', async () => {
  const { store } = setup(1000);
  const a = (await store.save(makeBottle(90, 500))).saved;
  const b = (await store.save({ ...a, ml: 100 })).saved;
  assert.equal(a.updatedAt, 1000);
  assert.equal(b.updatedAt, 1001);
});

test('ingest applies newer and ignores a stale echo', async () => {
  const { store, setNow } = setup(10);
  const local = (await store.save(makeBottle(90, 500))).saved;
  await store.ingest([await encryptEvent(secrets.key, { ...local, ml: 30, updatedAt: 5 })]);
  assert.equal(store.get(local.id).ml, 90);
  setNow(20);
  await store.ingest([await encryptEvent(secrets.key, { ...local, ml: 120, updatedAt: 20 })]);
  assert.equal(store.get(local.id).ml, 120);
});

test('undecryptable records are skipped', async () => {
  const { store } = setup();
  const good = { ...makeDiaper('wet', 1), updatedAt: 1 };
  const foreign = await encryptEvent(otherSecrets.key, { ...makeDiaper('solid', 2), updatedAt: 1 });
  const corrupt = await encryptEvent(secrets.key, { ...makeDiaper('both', 3), updatedAt: 1 });
  const bytes = fromBase64(corrupt.ct);
  bytes[3] ^= 1;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await store.ingest([
      await encryptEvent(secrets.key, good),
      foreign,
      { ...corrupt, ct: toBase64(bytes) },
    ]);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(store.all().map((e) => e.id), [good.id]);
});

test('invalid decrypted events are skipped', async () => {
  const { store } = setup();
  const bad = { ...makeBottle(90, 1), type: 'pumping', updatedAt: 1 };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await store.ingest([await encryptEvent(secrets.key, bad)]);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(store.all(), []);
});

test('notifies once per changing ingest and not for no-ops', async () => {
  const { store } = setup();
  let calls = 0;
  store.subscribe(() => calls++);
  const a = await encryptEvent(secrets.key, { ...makeDiaper('wet', 1), updatedAt: 1 });
  const b = await encryptEvent(secrets.key, { ...makeDiaper('solid', 2), updatedAt: 1 });
  await store.ingest([a, b]);
  assert.equal(calls, 1);
  await store.ingest([a]);
  assert.equal(calls, 1);
  await store.ingest([]);
  assert.equal(calls, 1);
});

test('subscribe returns an unsubscribe function', async () => {
  const { store } = setup();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  off();
  await store.save(makeDiaper('wet', 1));
  assert.equal(calls, 0);
});

test('remove hides from all(), get still returns deleted', async () => {
  const { store } = setup();
  const { saved } = await store.save(makeDiaper('wet', 1));
  await store.remove(saved.id);
  assert.deepEqual(store.all(), []);
  assert.equal(store.get(saved.id).deleted, true);
});

test('undo a new entry deletes it', async () => {
  const { store } = setup();
  const result = await store.save(makeDiaper('wet', 1));
  await store.undo(result);
  assert.deepEqual(store.all(), []);
  assert.equal(store.get(result.saved.id).deleted, true);
});

test('undo an edit restores the previous fields with a higher updatedAt', async () => {
  const { store } = setup(1000);
  const v1 = (await store.save(makeBottle(90, 1))).saved;
  const edit = await store.save({ ...v1, ml: 120 });
  await store.undo(edit);
  const now = store.get(v1.id);
  assert.equal(now.ml, 90);
  assert.equal(now.updatedAt, 1002);
});

test('undo a delete brings it back', async () => {
  const { store } = setup();
  const { saved } = await store.save(makeDiaper('wet', 1));
  const removal = await store.remove(saved.id);
  await store.undo(removal);
  assert.deepEqual(store.all().map((e) => e.id), [saved.id]);
});

test('a newer local version is written back when the server holds an older one', async () => {
  const { store, writes } = setup(10);
  const local = (await store.save(makeBottle(90, 500))).saved;
  assert.equal(writes.length, 1);
  const olderOnServer = { ...(await encryptEvent(secrets.key, { ...local, ml: 30, updatedAt: 5 })), atMs: 123 };
  await store.ingest([olderOnServer]);
  assert.equal(store.get(local.id).ml, 90);
  assert.equal(writes.length, 2);
  assert.deepEqual(await decryptEvent(secrets.key, writes[1]), local);
});

test('no write-back for pending records or identical copies', async () => {
  const { store, writes } = setup(10);
  const local = (await store.save(makeBottle(90, 500))).saved;
  const pendingOlder = { ...(await encryptEvent(secrets.key, { ...local, ml: 30, updatedAt: 5 })), atMs: null };
  const sameOnServer = { ...(await encryptEvent(secrets.key, local)), atMs: 456 };
  await store.ingest([pendingOlder, sameOnServer]);
  assert.equal(writes.length, 1);
});
