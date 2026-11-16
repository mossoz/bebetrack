import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp } from 'firebase/app';
import { disableNetwork, enableNetwork, waitForPendingWrites, terminate } from 'firebase/firestore';
import {
  openDb,
  claimSpace,
  checkSpace,
  writeRecord,
  loadCached,
  listen,
} from '../../app/js/data/remote.js';

const SPACE = '0Syggp5DidotV1Je4Y7WkyFn9lxU375je2LC-F8KpMg';
const HASH = 'J52J0JZynZEbn-OojmGAIjU_ed7luTAKhIlmLeASMLE=';
const OTHER = 'N3kRFNK-jogeuGy7LQ00EJ84JYOeYvBLvpsuCRD5rpo';
const OTHER_HASH = 'oO7Ac7B9fGRu2gfJiHDiHMezU8GocjaMufNzVtZsWUQ=';
const CONFIG = { projectId: 'demo-bebetrack', apiKey: 'demo', appId: 'demo' };
const EMULATOR = { host: '127.0.0.1', port: 8080 };

let open = [];
let n = 0;
const client = () => {
  const db = openDb({ config: CONFIG, name: `client-${++n}`, emulator: EMULATOR, persistent: false });
  open.push(db);
  return db;
};
const record = (ct = 'Y2lwaGVy') => ({ id: crypto.randomUUID(), v: 1, iv: 'AAAAAAAAAAAAAAAA', ct });

function nextBatch(db, since) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no batch within 5s')), 5000);
    const stop = listen(db, SPACE, since, (records) => {
      if (!records.length) return; // a "now in sync" signal with no entries
      clearTimeout(timer);
      stop();
      resolve(records);
    }, reject);
  });
}

beforeEach(async () => {
  const res = await fetch(
    'http://127.0.0.1:8080/emulator/v1/projects/demo-bebetrack/databases/(default)/documents',
    { method: 'DELETE' },
  );
  assert.equal(res.ok, true);
});

afterEach(async () => {
  for (const db of open) {
    await terminate(db);
    await deleteApp(db.app);
  }
  open = [];
});

test('claim then join', async () => {
  const A = client();
  const B = client();
  assert.equal(await claimSpace(A, SPACE, HASH), 'claimed');
  assert.equal(await claimSpace(B, SPACE, HASH), 'joined');
  await assert.rejects(claimSpace(B, OTHER, OTHER_HASH), /space-taken/);
});

test('a claim the rules do not accept fails loudly', async () => {
  const A = client();
  // The hash belongs to a different space, so the rules will never let this space be read.
  await assert.rejects(claimSpace(A, SPACE, OTHER_HASH), /claim-mismatch/);
});

test('checkSpace', async () => {
  const A = client();
  await claimSpace(A, SPACE, HASH);
  assert.equal(await checkSpace(A, SPACE), true);
  assert.equal(await checkSpace(A, OTHER), false);
});

test('write on A arrives on B', async () => {
  const A = client();
  const B = client();
  await claimSpace(A, SPACE, HASH);
  const r1 = record();
  await writeRecord(A, SPACE, r1);
  const batch = await nextBatch(B, 0);
  const got = batch.find((r) => r.id === r1.id);
  assert.ok(got);
  assert.equal(typeof got.atMs, 'number');
  assert.equal(got.ct, r1.ct);
  assert.equal(got.v, 1);
  assert.equal(got.iv, r1.iv);
});

test('incremental sync', async () => {
  const A = client();
  const B = client();
  await claimSpace(A, SPACE, HASH);
  const r1 = record();
  const r2 = record();
  await writeRecord(A, SPACE, r1);
  await writeRecord(A, SPACE, r2);
  const first = await nextBatch(B, 0);
  assert.deepEqual(first.map((r) => r.id).sort(), [r1.id, r2.id].sort());
  const cursor = Math.max(...first.map((r) => r.atMs));

  const r3 = record();
  await writeRecord(A, SPACE, r3);
  await writeRecord(A, SPACE, { ...r1, ct: 'bmV3' });
  const second = await nextBatch(B, cursor);
  assert.deepEqual(second.map((r) => r.id).sort(), [r1.id, r3.id].sort());
  assert.equal(second.find((r) => r.id === r1.id).ct, 'bmV3');
});

test('offline write is cached and syncs later', async () => {
  const A = client();
  const B = client();
  await claimSpace(A, SPACE, HASH);
  await disableNetwork(A);
  const r4 = record();
  writeRecord(A, SPACE, r4); // not awaited: it resolves only once the server has it
  const cached = await loadCached(A, SPACE);
  const pending = cached.find((r) => r.id === r4.id);
  assert.ok(pending);
  assert.equal(pending.atMs, null);
  await enableNetwork(A);
  await waitForPendingWrites(A);
  const batch = await nextBatch(B, 0);
  assert.ok(batch.some((r) => r.id === r4.id));
});

test('listen marks server-synced snapshots and reports the newest write time', async () => {
  const A = client();
  const B = client();
  await claimSpace(A, SPACE, HASH);
  const r1 = record();
  await writeRecord(A, SPACE, r1);
  const meta = await new Promise((resolve, reject) => {
    const stop = listen(B, SPACE, 0, (records, m) => {
      if (!m.synced) return;
      stop();
      resolve({ ...m, ids: records.map((r) => r.id) });
    }, reject);
  });
  assert.equal(meta.synced, true);
  assert.deepEqual(meta.ids, [r1.id]);
  assert.equal(typeof meta.maxAtMs, 'number');
  assert.ok(meta.maxAtMs > 0);
});

test('loadCached on a fresh client returns []', async () => {
  assert.deepEqual(await loadCached(client(), SPACE), []);
});
