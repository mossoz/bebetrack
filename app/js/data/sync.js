// Sync loop: show what's cached on the phone, then listen only for writes newer
// than the cursor. Re-reading the whole history on every open would eat the
// free Firestore read quota.
//
// The cursor only moves on snapshots that are in sync with the server. A cached
// snapshot can already hold this phone's own acknowledged write while the other
// phone's earlier writes are still on their way; moving the cursor past them
// would skip them for good. The cursor is saved, not derived from the cache,
// for the same reason.

export async function startSync({ load, listen, store, cursor, onError }) {
  const cached = await load();
  await store.ingest(cached);
  // An empty cache (fresh install, or the browser cleared it) means read everything.
  let since = cached.length ? cursor.get() : 0;
  let unsubscribe = null;

  const subscribe = () => {
    unsubscribe = listen(
      since,
      (records, { synced, maxAtMs }) => {
        if (records.length) store.ingest(records).catch(onError);
        if (synced && maxAtMs > since) {
          since = maxAtMs;
          cursor.set(since);
        }
      },
      onError,
    );
  };
  subscribe();

  return {
    restart() {
      unsubscribe?.();
      subscribe();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
