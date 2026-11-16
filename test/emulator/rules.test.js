import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  collectionGroup,
  query,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

const SPACE = '0Syggp5DidotV1Je4Y7WkyFn9lxU375je2LC-F8KpMg';
const HASH = 'J52J0JZynZEbn-OojmGAIjU_ed7luTAKhIlmLeASMLE=';
const OTHER = 'N3kRFNK-jogeuGy7LQ00EJ84JYOeYvBLvpsuCRD5rpo';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const good = () => ({ v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVy', at: serverTimestamp() });

let env;
let db;
const event = (space = SPACE, id = ID) => doc(db, 'spaces', space, 'events', id);
const claim = () => doc(db, 'meta', 'claim');
const seedClaim = () =>
  env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'meta', 'claim'), { h: HASH }));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bebetrack',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  db = env.unauthenticatedContext().firestore();
});
after(() => env.cleanup());

test('claim can be created once', async () => {
  await assertSucceeds(setDoc(claim(), { h: HASH }));
  await assertFails(setDoc(claim(), { h: HASH }));
  await assertFails(setDoc(claim(), { h: 'oO7Ac7B9fGRu2gfJiHDiHMezU8GocjaMufNzVtZsWUQ=' }));
});

test('claim is never readable, updatable or deletable', async () => {
  await seedClaim();
  await assertFails(getDoc(claim()));
  await assertFails(setDoc(claim(), { h: HASH }));
  await assertFails(deleteDoc(claim()));
});

test('claim shape', async () => {
  await assertFails(setDoc(claim(), { h: 'short' }));
  await assertFails(setDoc(claim(), { h: HASH, x: 1 }));
  await assertFails(setDoc(claim(), { h: 42 }));
});

test('events need a claim', async () => {
  await assertFails(setDoc(event(), good()));
});

test('writes only to the claimed space', async () => {
  await seedClaim();
  await assertSucceeds(setDoc(event(), good()));
  await assertFails(setDoc(event(OTHER), good()));
});

test('reads only in the claimed space', async () => {
  await seedClaim();
  await assertSucceeds(getDoc(event()));
  await assertSucceeds(getDocs(query(collection(db, 'spaces', SPACE, 'events'), limit(5))));
  await assertFails(getDoc(event(OTHER)));
  await assertFails(getDocs(collection(db, 'spaces', OTHER, 'events')));
});

test('no listing spaces and no collection group queries', async () => {
  await seedClaim();
  await assertFails(getDocs(collection(db, 'spaces')));
  await assertFails(getDoc(doc(db, 'spaces', SPACE)));
  await assertFails(getDocs(collectionGroup(db, 'events')));
});

test('record shape is enforced', async () => {
  await seedClaim();
  const { at, ...noAt } = good();
  await assertFails(setDoc(event(), { ...good(), extra: 1 }));
  await assertFails(setDoc(event(), noAt));
  await assertFails(setDoc(event(), { ...good(), at: Timestamp.fromMillis(0) }));
  await assertFails(setDoc(event(), { ...good(), v: 2 }));
  await assertFails(setDoc(event(), { ...good(), iv: 'AAAAAAAAAAAAAAA' }));
  await assertFails(setDoc(event(), { ...good(), ct: '' }));
  await assertFails(setDoc(event(), { ...good(), ct: 'x'.repeat(4097) }));
  await assertSucceeds(setDoc(event(), { ...good(), ct: 'x'.repeat(4096) }));
  await assertFails(setDoc(event(SPACE, 'not-a-uuid'), good()));
});

test('updates allowed, deletes not', async () => {
  await seedClaim();
  await assertSucceeds(setDoc(event(), good()));
  await assertSucceeds(setDoc(event(), { ...good(), ct: 'bmV3' }));
  await assertFails(deleteDoc(event()));
});
