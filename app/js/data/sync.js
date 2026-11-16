// Sync loop: show what's cached on the phone, then listen only for writes newer
// than the newest one we already have. Re-reading the whole history on every
// open would eat the free Firestore read quota.

export function nextCursor(prevMs, records) {
  let cursor = prevMs;
  for (const r of records) if (r.atMs !== null && r.atMs > cursor) cursor = r.atMs;
  return cursor;
}

export async function startSync({ load, listen, store, onError }) {
  const cached = await load();
  await store.ingest(cached);
  let cursor = nextCursor(0, cached);
  let unsubscribe = null;

  const subscribe = () => {
    unsubscribe = listen(
      cursor,
      (records) => {
        cursor = nextCursor(cursor, records);
        store.ingest(records).catch(onError);
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
