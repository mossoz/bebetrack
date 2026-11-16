// What this phone remembers: the passphrase (so nobody retypes it at night, and
// so Settings can show it for a new phone), the derived key, and the unit.
const SESSION_KEY = 'bebetrack.session';
const UNIT_KEY = 'bebetrack.unit';

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
      } catch {
        // nothing to do
      }
    },
    loadUnit() {
      return read(UNIT_KEY) === 'oz' ? 'oz' : 'ml';
    },
    saveUnit(unit) {
      write(UNIT_KEY, unit === 'oz' ? 'oz' : 'ml');
    },
  };
}
