// Two "phones" against the emulator, with the real sync loop and store.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp } from 'firebase/app';
import {
  disableNetwork,
  enableNetwork,
  waitForPendingWrites,
  terminate,
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { openDb, claimSpace, writeRecord, loadCached, listen } from '../../app/js/data/remote.js';
import { startSync } from '../../app/js/data/sync.js';
import { EventStore } from '../../app/js/data/store.js';
import { deriveSecrets } from '../../app/js/core/crypto.js';
import { makeDiaper } from '../../app/js/core/events.js';

const SPACE = '0Syggp5DidotV1Je4Y7WkyFn9lxU375je2LC-F8KpMg';
const HASH = 'J52J0JZynZEbn-OojmGAIjU_ed7luTAKhIlmLeASMLE=';
const CONFIG = { projectId: 'demo-bebetrack', apiKey: 'demo', appId: 'demo' };
const EMULATOR = { host: '127.0.0.1', port: 8080 };
const { key } = await deriveSecrets('acid acorn acre', { iterations: 1000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let open = [];
let n = 0;
const client = () => {
  const db = openDb({ config: CONFIG, name: `sync-${++n}`, emulator: EMULATOR, persistent: false });
  open.push(db);
  return db;
};
const memoryCursor = () => {
  let ms = 0;
  return { get: () => ms, set: (v) => (ms = v) };
};
const syncFor = (db, store, cursor = memoryCursor()) =>
  startSync({
    load: () => loadCached(db, SPACE),
    listen: (since, onBatch, onError) => listen(db, SPACE, since, onBatch, onError),
    store,
    cursor,
    onError: () => {},
  });

async function until(check, ms = 8000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(25);
  }
  return true;
}

beforeEach(async () => {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-bebetrack/databases/(default)/documents', {
    method: 'DELETE',
  });
});

afterEach(async () => {
  for (const db of open) {
    await terminate(db);
    await deleteApp(db.app);
  }
  open = [];
});

test("reconnecting never skips the other phone's entries", async () => {
  // Phone A goes offline and logs one entry; phone B logs a backlog meanwhile.
  // When A reconnects, its own write is acknowledged before B's backlog arrives.
  // A then reopens the app (restart). It must still get every entry from B.
  for (let run = 0; run < 3; run++) {
    await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-bebetrack/databases/(default)/documents', {
      method: 'DELETE',
    });
    const A = client();
    const B = client();
    await claimSpace(B, SPACE, HASH);
    const seen = new Set();
    const store = { ingest: async (records) => records.forEach((r) => seen.add(r.id)) };
    const first = crypto.randomUUID();
    await writeRecord(B, SPACE, { id: first, v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVy' });
    const sync = await syncFor(A, store);
    assert.ok(await until(() => seen.has(first)), 'A sees the first entry');

    await disableNetwork(A);
    const backlog = [];
    for (let i = 0; i < 3; i++) {
      const batch = writeBatch(B);
      for (let j = 0; j < 100; j++) {
        const id = crypto.randomUUID();
        backlog.push(id);
        batch.set(doc(B, 'spaces', SPACE, 'events', id), {
          v: 1,
          iv: 'AAAAAAAAAAAAAAAA',
          ct: 'Y2lwaGVy'.repeat(400),
          at: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    const own = crypto.randomUUID();
    writeRecord(A, SPACE, { id: own, v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'b3du' });
    await enableNetwork(A);
    await until(() => seen.has(own));
    sync.restart();
    await until(() => backlog.every((id) => seen.has(id)), 6000);
    const missing = backlog.filter((id) => !seen.has(id)).length;
    sync.stop();
    assert.equal(missing, 0, `run ${run}: A never received ${missing} of B's ${backlog.length} entries`);
  }
});

test('concurrent edits converge on the newer one', async () => {
  const dbA = client();
  const dbB = client();
  await claimSpace(dbA, SPACE, HASH);
  let tA = 0;
  let tB = 0;
  const A = new EventStore({ key, write: (r) => writeRecord(dbA, SPACE, r), now: () => tA });
  const B = new EventStore({ key, write: (r) => writeRecord(dbB, SPACE, r), now: () => tB });
  const syncA = await syncFor(dbA, A);
  const syncB = await syncFor(dbB, B);

  tA = 50;
  const { saved } = await A.save(makeDiaper('wet', 1000));
  assert.ok(await until(() => B.get(saved.id)), 'B sees the entry');

  await disableNetwork(dbA);
  tA = 100;
  await A.remove(saved.id); // A deletes it with no signal...
  tB = 200;
  await B.save({ ...B.get(saved.id), diaper: 'both' }); // ...while B edits it later, online
  await waitForPendingWrites(dbB);
  await enableNetwork(dbA);
  await waitForPendingWrites(dbA);

  const settled = (e) => e && !e.deleted && e.diaper === 'both' && e.updatedAt === 200;
  assert.ok(await until(() => settled(A.get(saved.id)) && settled(B.get(saved.id))), 'both phones show the newer edit');
  await sleep(500);
  await waitForPendingWrites(dbA);
  await waitForPendingWrites(dbB);
  syncA.stop();
  syncB.stop();

  // A third phone reading straight from the server sees the newer edit too.
  const C = new EventStore({ key, write: () => {} });
  const dbC = client();
  const syncC = await syncFor(dbC, C);
  assert.ok(await until(() => C.get(saved.id)), 'C sees the entry');
  syncC.stop();
  assert.equal(settled(C.get(saved.id)), true, 'the server holds the newer edit');
});
