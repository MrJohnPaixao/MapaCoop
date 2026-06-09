// Service Worker — MapaCoop Lu System PWA
const CACHE_NAME = 'mapacoop-lusystem-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/map.js',
  './js/ui.js',
  './data/municipios.json',
  './data/brasil.json',
  './manifest.json',
  './icons/lu-moon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800&family=Exo+2:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Nunito:wght@400;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return response;
      }).catch(() =>
        caches.match(e.request).then(cached => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
