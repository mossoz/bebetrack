import { firebaseConfig, LOCAL_CONFIG, EMULATOR, isLocal, isConfigured } from './config.js';
import { importKey } from './core/crypto.js';
import { openDb, writeRecord, loadCached, listen } from './data/remote.js';
import { EventStore } from './data/store.js';
import { startSync } from './data/sync.js';
import { createSession } from './data/session.js';
import { renderSetup, renderNotConfigured } from './ui/setup.js';
import { renderHome } from './ui/home.js';
import { createSheets } from './ui/sheets.js';
import { createToast } from './ui/toast.js';
import { unlockChime } from './ui/chime.js';

const root = document.getElementById('app');
const session = createSession();

let db = null;
function getDb() {
  if (!db) {
    db = isLocal
      ? openDb({ config: LOCAL_CONFIG, emulator: EMULATOR })
      : openDb({ config: firebaseConfig });
  }
  return db;
}

async function start(saved) {
  const key = await importKey(saved.keyB64);
  const database = getDb();
  const { spaceId } = saved;
  const store = new EventStore({ key, write: (record) => writeRecord(database, spaceId, record) });
  if (isLocal) window.__bebetrack = { store };

  const onError = (e) => console.warn('bebetrack: sync problem', e);
  const sync = await startSync({
    load: () => loadCached(database, spaceId),
    listen: (since, onRecords, onListenError) => listen(database, spaceId, since, onRecords, onListenError),
    store,
    cursor: { get: () => session.loadCursor(spaceId), set: (ms) => session.saveCursor(spaceId, ms) },
    onError,
  });

  const toast = createToast(document.getElementById('toast'), store);
  unlockChime();
  let home = null;
  const openSheet = createSheets({
    dialog: document.getElementById('sheet'),
    store,
    session,
    toast,
    onUnitChange: () => home?.render(),
  });
  home = renderHome(root, { store, session, openSheet });

  // Coming back to the app: catch up with the server and refresh "2h ago" now,
  // not at the next 30-second tick.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sync.restart();
    home.render();
  });
}

function showSetup() {
  renderSetup(root, {
    db: getDb(),
    onReady(data) {
      session.save(data);
      start(data);
    },
  });
}

async function boot() {
  if (!isConfigured) {
    renderNotConfigured(root);
    return;
  }
  const saved = session.load();
  if (!saved) {
    showSetup();
    return;
  }
  try {
    await start(saved);
  } catch (e) {
    console.error('bebetrack: could not open the saved log', e);
    showSetup();
  }
}

if (!isLocal && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('bebetrack: no offline support', e));
}

boot();
