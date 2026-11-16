// Offline support. Each deploy stamps BUILD, so the browser installs a fresh
// worker that precaches the new version in one go, then drops the old cache.
// Only the app's own files are served from the cache; Firestore traffic is
// left alone.
const BUILD = '__BUILD__';
const CACHE = `bebetrack-${BUILD}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/config.js',
  './js/version.js',
  './js/core/crypto.js',
  './js/core/days.js',
  './js/core/events.js',
  './js/core/format.js',
  './js/core/passphrase.js',
  './js/core/status.js',
  './js/core/wordlist.js',
  './js/data/remote.js',
  './js/data/session.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/setup.js',
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js',
];

const PRECACHED = new Set(PRECACHE.map((path) => new URL(path, self.location).href));
const INDEX = new URL('./index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          PRECACHE.map((path) =>
            path.startsWith('https://') ? new Request(path, { mode: 'cors' }) : new Request(path, { cache: 'reload' }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bebetrack-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(caches.match(INDEX).then((hit) => hit || fetch(request)));
    return;
  }

  const href = url.origin + url.pathname;
  if (!PRECACHED.has(href)) return;
  event.respondWith(caches.match(href).then((hit) => hit || fetch(request)));
});
