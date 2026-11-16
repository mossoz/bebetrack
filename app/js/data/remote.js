// Firestore adapter. It only ever sees encrypted records:
//   spaces/{spaceId}/events/{eventId} = { v, iv, ct, at: serverTimestamp() }
// In the browser, 'firebase/app' and 'firebase/firestore' resolve through the
// import map in index.html; in Node tests they resolve from node_modules.
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  CACHE_SIZE_UNLIMITED,
  connectFirestoreEmulator,
  collection,
  doc,
  setDoc,
  getDocsFromServer,
  getDocsFromCache,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

export function openDb({ config, name = '[DEFAULT]', emulator, persistent = true }) {
  const app = initializeApp(config, name);
  const localCache = persistent
    ? persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      })
    : memoryLocalCache();
  const db = initializeFirestore(app, { localCache });
  if (emulator) connectFirestoreEmulator(db, emulator.host, emulator.port);
  return db;
}

const events = (db, spaceId) => collection(db, 'spaces', spaceId, 'events');

function toRecord(snap) {
  const data = snap.data();
  return { id: snap.id, v: data.v, iv: data.iv, ct: data.ct, atMs: data.at ? data.at.toMillis() : null };
}

export async function checkSpace(db, spaceId) {
  try {
    await getDocsFromServer(query(events(db, spaceId), limit(1)));
    return true;
  } catch (e) {
    if (e.code === 'permission-denied') return false;
    throw e;
  }
}

export async function claimSpace(db, spaceId, spaceHash) {
  try {
    await setDoc(doc(db, 'meta', 'claim'), { h: spaceHash });
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
    if (await checkSpace(db, spaceId)) return 'joined';
    throw new Error('space-taken');
  }
  // Prove the rules accept this space before anyone logs into it.
  if (!(await checkSpace(db, spaceId))) throw new Error('claim-mismatch');
  return 'claimed';
}

export function writeRecord(db, spaceId, { id, v, iv, ct }) {
  return setDoc(doc(events(db, spaceId), id), { v, iv, ct, at: serverTimestamp() });
}

export async function loadCached(db, spaceId) {
  try {
    const snap = await getDocsFromCache(events(db, spaceId));
    return snap.docs.map(toRecord);
  } catch {
    return [];
  }
}

// onBatch(records, { synced, maxAtMs }): `records` are the added or changed
// entries. `synced` is true when the snapshot matches the server; only then is
// `maxAtMs` (the newest write time in it) safe to use as a sync cursor.
export function listen(db, spaceId, sinceMs, onBatch, onError) {
  const q = query(events(db, spaceId), where('at', '>', Timestamp.fromMillis(sinceMs)), orderBy('at'));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const records = snap
        .docChanges()
        .filter((c) => c.type !== 'removed')
        .map((c) => toRecord(c.doc));
      const synced = !snap.metadata.fromCache;
      let maxAtMs = sinceMs;
      if (synced) {
        for (const d of snap.docs) {
          const at = d.data().at;
          if (at && at.toMillis() > maxAtMs) maxAtMs = at.toMillis();
        }
      }
      if (records.length || synced) onBatch(records, { synced, maxAtMs });
    },
    onError,
  );
}
