// TrasX Service Worker v7 — Network-first with offline fallback & Web Push
const CACHE_NAME = 'trasx-v10';
const OFFLINE_URL = '/';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/client.js',
  '/assets/trasx-logo-mark.png',
  '/assets/trasx-logo.png',
  '/assets/trasx-logo-mark-v2.png',
  '/assets/trasx-logo-mark-v3.png',
  '/assets/trasx-logo-mark-v4.png',
  '/assets/trasx-logo-mark-v5.png',
  '/assets/avatar_placeholder.jpg',
  '/assets/avatar_placeholder.svg',
  '/assets/platform-end-chime.mp3',
  '/manifest.json',
  'https://unpkg.com/lucide@latest'
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

// Helper to handle Range requests for offline assets (206 partial content)
async function handleRangeRequest(request, cachedResponse) {
  try {
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) return cachedResponse;

    const arrayBuffer = await cachedResponse.arrayBuffer();
    const bytes = /^bytes=(\d+)-(\d+)?$/g.exec(rangeHeader);
    if (bytes) {
      const start = parseInt(bytes[1], 10);
      const end = bytes[2] ? parseInt(bytes[2], 10) : arrayBuffer.byteLength - 1;
      const chunk = arrayBuffer.slice(start, end + 1);

      return new Response(chunk, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Range': `bytes ${start}-${end}/${arrayBuffer.byteLength}`,
          'Content-Length': chunk.byteLength,
          'Content-Type': cachedResponse.headers.get('Content-Type') || 'video/mp4',
          'Accept-Ranges': 'bytes'
        }
      });
    }
  } catch (err) {
    console.error('[SW] Range request handler failed:', err);
  }
  return cachedResponse;
}

// ── Fetch — Network first, cache fallback ────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Bypass service worker entirely for video and audio assets
  // This allows the browser to perform native HTTP 206 Range requests and chunked buffering directly from the server/CDN.
  const isVideoOrAudio = request.destination === 'video' || request.destination === 'audio' || 
                         url.pathname.endsWith('.mp4') || url.pathname.endsWith('.webm') || 
                         url.pathname.endsWith('.mp3') || url.pathname.endsWith('.wav');
  if (isVideoOrAudio) {
    return;
  }

  const isSameOrigin = request.url.startsWith(self.location.origin);
  const isAllowedCdn = url.hostname.includes('unpkg.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com');

  if (!isSameOrigin && !isAllowedCdn) return;

  // Skip socket.io and API calls — always network
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

  const isStaticOrAsset = 
    url.pathname.includes('/assets/') || 
    url.pathname.includes('/css/') || 
    url.pathname.includes('/js/') || 
    url.pathname.endsWith('.png') || 
    url.pathname.endsWith('.jpg') || 
    url.pathname.endsWith('.jpeg') || 
    url.pathname.endsWith('.svg') || 
    url.pathname.endsWith('.gif') || 
    url.pathname.endsWith('.ico') || 
    url.pathname.endsWith('.webp') || 
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticOrAsset) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone(); // Clone synchronously to prevent body-consumed error
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return networkResponse;
        }).catch(() => {});
        return cached || fetchPromise;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for static assets and allowed CDNs
        const isAllowedType = response.type === 'basic' || response.type === 'cors';
        if (response && response.status === 200 && isAllowedType) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone).catch(() => {});
          });
        }
        return response;
      })
      .catch(async () => {
        // Try cache first
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) {
          if (request.headers.has('range')) {
            return handleRangeRequest(request, cached);
          }
          return cached;
        }

        // Fallback to root for navigation requests
        if (request.mode === 'navigate') {
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) return offlinePage;
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});

// ── Push Notification Event ──────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'TrasX';
    const options = {
      body: data.body || '',
      icon: '/assets/trasx-logo-mark-v5.png',
      badge: '/assets/trasx-logo-mark-v5.png',
      vibrate: [100, 50, 100],
      sound: '/assets/platform-end-chime.mp3',
      data: {
        url: data.url || '/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('[SW] Error parsing push event data:', err);
    event.waitUntil(
      self.registration.showNotification('TrasX', {
        body: event.data.text() || 'Nouvelle notification',
        icon: '/assets/trasx-logo-mark-v5.png',
        badge: '/assets/trasx-logo-mark-v5.png',
        vibrate: [100, 50, 100]
      })
    );
  }
});

// ── Notification Click Event ──────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            if (focusedClient && 'navigate' in focusedClient) {
              return focusedClient.navigate(urlToOpen);
            }
          });
        }
      }
      // Open new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// ── Listen for skip-waiting message from client ──────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
