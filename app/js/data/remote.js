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
    return 'claimed';
  } catch (e) {
    if (e.code !== 'permission-denied') throw e;
  }
  if (await checkSpace(db, spaceId)) return 'joined';
  throw new Error('space-taken');
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

export function listen(db, spaceId, sinceMs, onRecords, onError) {
  const q = query(events(db, spaceId), where('at', '>', Timestamp.fromMillis(sinceMs)), orderBy('at'));
  return onSnapshot(
    q,
    (snap) => {
      const records = snap
        .docChanges()
        .filter((c) => c.type !== 'removed')
        .map((c) => toRecord(c.doc));
      if (records.length) onRecords(records);
    },
    onError,
  );
}
