// Service Worker: macht die App komplett offline-fähig.
// Bei jeder Änderung an Dateien VERSION hochzählen, damit alte Caches gelöscht werden.
const VERSION = 'taktik-v42';
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
  './js/anim.js',
  './js/phone.js',
  './js/library.js',
  './js/kader.js',
  './js/ui/roster.js',
  './js/ui/settings.js',
  './js/ui/squads.js',
  './js/icons.js',
  './js/ui/dialogs.js',
  './js/ui/toolbar.js',
  './js/ui/palette.js',
  './js/ui/pagebar.js',
  './js/ui/notes.js',
  './js/ui/boards.js',
  './js/ui/selection.js',
  './js/ui/stats.js',
  './js/gamestats.js',
  './js/alltime.js',
  './js/ui/profile.js',
  './js/hof.js',
  './js/rotation.js',
  './js/ui/rotbar.js',
  './js/ui/setup.js',
  './js/net.js',
  './js/ui/netbar.js',
  './js/net3d.js',
  './js/ui/hof.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './img/logo.jpg',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neue Version gespeichert wird
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Online: zuerst aus dem Netz (mit kurzer Zeitgrenze) → immer die aktuelle Version; offline: aus dem Cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
      if (!cached) return network;
      // schlechtes Netz: nach 2,5 s die gespeicherte Version nehmen (Netz aktualisiert den Cache trotzdem)
      const timeout = new Promise((r) => setTimeout(() => r(cached), 2500));
      return Promise.race([network.catch(() => cached), timeout]);
    })
  );
});

// Version für die Anzeige in den Einstellungen
self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ version: VERSION });
});
