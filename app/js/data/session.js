// What this phone remembers: the passphrase (so nobody retypes it at night, and
// so Settings can show it for a new phone), the derived key, and the unit.
const SESSION_KEY = 'bebetrack.session';
const UNIT_KEY = 'bebetrack.unit';
const CURSOR_KEY = 'bebetrack.cursor';

export function createSession(storage = globalThis.localStorage) {
  const read = (k) => {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      storage.setItem(k, v);
    } catch {
      // Storage blocked or full: the app still works for this visit.
    }
  };

  return {
    load() {
      try {
        const s = JSON.parse(read(SESSION_KEY));
        if (s?.v === 1 && typeof s.passphrase === 'string' && typeof s.keyB64 === 'string' && typeof s.spaceId === 'string') {
          return { passphrase: s.passphrase, keyB64: s.keyB64, spaceId: s.spaceId };
        }
      } catch {
        // fall through
      }
      return null;
    },
    save({ passphrase, keyB64, spaceId }) {
      write(SESSION_KEY, JSON.stringify({ v: 1, passphrase, keyB64, spaceId }));
    },
    clear() {
      try {
        storage.removeItem(SESSION_KEY);
        storage.removeItem(CURSOR_KEY);
      } catch {
        // nothing to do
      }
    },
    // The newest server write time this phone has fully caught up to.
    loadCursor(spaceId) {
      try {
        const c = JSON.parse(read(CURSOR_KEY));
        return c?.spaceId === spaceId && Number.isFinite(c.ms) ? c.ms : 0;
      } catch {
        return 0;
      }
    },
    saveCursor(spaceId, ms) {
      write(CURSOR_KEY, JSON.stringify({ spaceId, ms }));
    },
    loadUnit() {
      return read(UNIT_KEY) === 'oz' ? 'oz' : 'ml';
    },
    saveUnit(unit) {
      write(UNIT_KEY, unit === 'oz' ? 'oz' : 'ml');
    },
  };
}
