// In-memory store of decrypted events. Saves are applied locally first (so the
// screen updates straight away, even offline), then encrypted and handed to
// `write`, which queues them for the server.
import { encryptEvent, decryptEvent } from '../core/crypto.js';
import { merge, isValidEvent } from '../core/events.js';

export class EventStore {
  #key;
  #write;
  #now;
  #events = new Map();
  #listeners = new Set();

  constructor({ key, write, now = Date.now }) {
    this.#key = key;
    this.#write = write;
    this.#now = now;
  }

  all() {
    return [...this.#events.values()].filter((e) => !e.deleted);
  }

  get(id) {
    return this.#events.get(id);
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.#listeners) fn();
  }

  async ingest(records) {
    let changed = false;
    for (const record of records) {
      let event;
      try {
        event = await decryptEvent(this.#key, record);
      } catch {
        console.warn('bebetrack: skipped a record that could not be decrypted', record.id);
        continue;
      }
      if (!isValidEvent(event)) {
        console.warn('bebetrack: skipped an invalid event', record.id);
        continue;
      }
      const current = this.#events.get(event.id);
      const next = merge(current, event);
      if (next !== current) {
        this.#events.set(event.id, next);
        changed = true;
      }
    }
    if (changed) this.#notify();
  }

  async save(event) {
    const previous = this.#events.get(event.id);
    const saved = { ...event, updatedAt: Math.max(this.#now(), (previous?.updatedAt ?? 0) + 1) };
    this.#events.set(saved.id, saved);
    this.#notify();
    const record = await encryptEvent(this.#key, saved);
    // Not awaited: Firestore resolves a write only once the server has it,
    // which never happens while offline. The SDK queues it meanwhile.
    try {
      Promise.resolve(this.#write(record)).catch((e) => console.warn('bebetrack: write failed', e));
    } catch (e) {
      console.warn('bebetrack: write failed', e);
    }
    return { previous, saved };
  }

  remove(id) {
    return this.save({ ...this.#events.get(id), deleted: true });
  }

  undo({ previous, saved }) {
    return previous ? this.save(previous) : this.remove(saved.id);
  }
}
