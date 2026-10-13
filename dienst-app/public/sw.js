// Service Worker: App-Hülle offline verfügbar machen.
// Strategie: Netzwerk zuerst, bei fehlender Verbindung aus dem Cache.
// So kommen Updates sofort an, und die App startet trotzdem ohne Netz.
const CACHE = 'dienst-app-v2';
const SHELL = [
  '/',
  '/index.html',
  '/config.js',
  '/css/styles.css',
  '/js/core.js',
  '/js/home.js',
  '/js/chat.js',
  '/js/plan.js',
  '/js/material.js',
  '/js/admin.js',
  '/js/main.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Supabase, CDN usw. nie anfassen
  if (url.pathname.startsWith('/.netlify/')) return;      // Functions nie cachen
  if (url.pathname === '/version.json') return;           // Versionsprüfung immer frisch

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
  );
});
