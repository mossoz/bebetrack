import { WORDS } from './wordlist.js';
import { normalizePassphrase } from './crypto.js';

export const MIN_LENGTH = 20;

// Largest multiple of the list size below 2^16, so `% WORDS.length` has no bias.
const LIMIT = Math.floor(65536 / WORDS.length) * WORDS.length;

function randomIndex() {
  const buf = new Uint16Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= LIMIT);
  return buf[0] % WORDS.length;
}

export function isStrongEnough(passphrase) {
  return normalizePassphrase(passphrase).length >= MIN_LENGTH;
}

export function generatePassphrase(count = 5) {
  for (;;) {
    const phrase = Array.from({ length: count }, () => WORDS[randomIndex()]).join(' ');
    if (isStrongEnough(phrase)) return phrase;
  }
}
