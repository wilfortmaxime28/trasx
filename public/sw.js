// TrasX Service Worker for PWA support
const CACHE_NAME = 'trasx-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/css/styles.css',
  '/js/client.js',
  '/assets/avatar_placeholder.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Pre-caching assets skipped/failed:', err.message);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network first, falling back to cache
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and standard HTTP schemes
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  event.respondWith(
    fetch(event.request).then((response) => {
      // Cache dynamic pages if successful
      if (response && response.status === 200 && response.type === 'basic') {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone).catch(() => {});
        });
      }
      return response;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
