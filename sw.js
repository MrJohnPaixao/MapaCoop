// Service Worker — MapaCoop Lu System PWA
const CACHE_NAME  = 'mapacoop-lusystem-v7';
const TILES_CACHE = 'mapacoop-tiles-v1';
const KEEP_CACHES = [CACHE_NAME, TILES_CACHE];

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/map.js',
  './js/ui.js',
  './lib/maplibre-gl.js',
  './lib/maplibre-gl.css',
  './data/municipios.json',
  './data/estados.json',
  './manifest.json',
  './icons/lu-moon.svg',
  './icons/MapaCoop-icon.svg',
  './icons/MapaCoop-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800&family=Exo+2:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Nunito:wght@400;600;700&display=swap'
];

// Estilo CARTO dark-matter: manifests + sprite + glyphs base (acentos PT-BR)
// pré-cacheados no install. Tiles vetoriais (.mvt) ficam de fora — são
// cacheados sob demanda (cache-as-you-go) à medida que o usuário navega.
const PRECACHE_TILE_ASSETS = [
  'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json',
  'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.json',
  'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.png',
  'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite@2x.json',
  'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite@2x.png',
  'https://tiles.basemaps.cartocdn.com/fonts/Noto%20Sans%20Regular/0-255.pbf'
];

self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)),
      caches.open(TILES_CACHE).then(cache =>
        Promise.all(PRECACHE_TILE_ASSETS.map(url =>
          fetch(url)
            .then(res => { if (res.ok) return cache.put(url, res); })
            .catch(() => {}) // CARTO fora do ar no install não deve quebrar o SW
        ))
      )
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !KEEP_CACHES.includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Tiles, estilo, sprite e glyphs do CARTO — cache-as-you-go
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    e.respondWith(
      caches.open(TILES_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(response => {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

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
