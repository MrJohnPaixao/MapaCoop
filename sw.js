// Service Worker — Mapa Cooperativa PWA
const CACHE_NAME = 'mapa-sicredi-v3';
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
  './icons/sicredi-horizontal-box-rgb.png',
  'https://fonts.googleapis.com/css2?family=Exo+2:wght@500;600;700&family=Nunito:wght@400;600;700&display=swap'
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
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => {
      if (e.request.destination === 'document') {
        return caches.match('./index.html');
      }
    }))
  );
});
