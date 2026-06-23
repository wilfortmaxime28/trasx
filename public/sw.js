// TrasX Service Worker v3 — Network-first with offline fallback
const CACHE_NAME = 'trasx-v3';
const OFFLINE_URL = '/';
const STATIC_ASSETS = [
  '/css/styles.css',
  '/js/client.js',
  '/assets/trasx-logo-mark.png',
  '/assets/avatar_placeholder.jpg'
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache skipped:', err.message);
      })
    )
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch — Network first, cache fallback ────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests on our origin
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  // Skip socket.io and API calls — always network
  const url = new URL(request.url);
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for static assets
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone).catch(() => {});
          });
        }
        return response;
      })
      .catch(async () => {
        // Try cache first
        const cached = await caches.match(request);
        if (cached) return cached;
        // Fallback to root for navigation requests
        if (request.mode === 'navigate') {
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) return offlinePage;
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});

// ── Listen for skip-waiting message from client ──────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
