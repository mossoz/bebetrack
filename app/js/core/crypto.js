// End-to-end encryption for Bebetrack.
//
// Both phones turn the shared passphrase into the same two secrets: an AES-GCM
// key that encrypts every event, and the ID of the shared storage space. The
// passphrase itself never leaves the phone.
//
// WARNING: never change PBKDF2_ITERATIONS, SALT or the byte layout after launch.
// Doing so derives a different key and space ID, which orphans all existing data.

export const PBKDF2_ITERATIONS = 600000;
export const SALT = 'bebetrack.v1';
export const RECORD_VERSION = 1;

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizePassphrase(passphrase) {
  return passphrase.normalize('NFKC').trim().toLowerCase().split(/\s+/).join(' ');
}

export async function importKey(keyB64) {
  return crypto.subtle.importKey('raw', fromBase64(keyB64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function deriveSecrets(passphrase, { iterations = PBKDF2_ITERATIONS } = {}) {
  const base = await crypto.subtle.importKey(
    'raw',
    utf8.encode(normalizePassphrase(passphrase)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: utf8.encode(SALT), iterations },
      base,
      512,
    ),
  );
  const keyB64 = toBase64(bits.slice(0, 32));
  const spaceId = toBase64Url(bits.slice(32, 64));
  // The claim record stores this hash. Firestore rules compute
  // hashing.sha256(spaceId).toBase64(), which is base64url *with* padding.
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(spaceId));
  const spaceHash = toBase64(new Uint8Array(digest)).replace(/\+/g, '-').replace(/\//g, '_');
  return { key: await importKey(keyB64), keyB64, spaceId, spaceHash };
}

export async function encryptEvent(key, event) {
  const { id, ...body } = event;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8.encode(id) },
    key,
    utf8.encode(JSON.stringify(body)),
  );
  return { id, v: RECORD_VERSION, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function decryptEvent(key, record) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(record.iv), additionalData: utf8.encode(record.id) },
    key,
    fromBase64(record.ct),
  );
  return { ...JSON.parse(utf8Decoder.decode(plain)), id: record.id };
}
