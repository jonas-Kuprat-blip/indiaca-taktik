// Service Worker: macht die App komplett offline-fähig.
// Bei jeder Änderung an Dateien VERSION hochzählen, damit alte Caches gelöscht werden.
const VERSION = 'taktik-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/util.js',
  './js/model.js',
  './js/db.js',
  './js/store.js',
  './js/stroke.js',
  './js/render.js',
  './js/stage.js',
  './js/icons.js',
  './js/ui/dialogs.js',
  './js/ui/toolbar.js',
  './js/ui/palette.js',
  './js/ui/pagebar.js',
  './js/ui/notes.js',
  './js/ui/boards.js',
  './js/ui/selection.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: sofort aus dem Cache antworten, im Hintergrund aktualisieren.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
