// public/sw.js - Network-First Service Worker (Prevents Stale Cache)
const CACHE_NAME = 'chefpulse-pos-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key)) // Purge all old caches!
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Always let API calls and WebSockets pass through
  if (event.request.url.includes('/api/') || event.request.url.startsWith('ws')) {
    return;
  }

  // Network-First strategy: Always fetch fresh HTML/JS, fallback to cache if offline
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
