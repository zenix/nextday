const CACHE_NAME = 'nextday-v3';
// Deliberately does NOT precache '/' or '/index.html': the app now sits
// behind auth, so caching the dashboard shell (or a 401/redirect response
// for it) could serve stale or wrong content to a logged-out visitor.
// Only the truly static, non-auth-gated assets are precached.
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => console.error('Cache addAll failed:', err))
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Never cache API calls (must always be fresh) or the login page (never
  // want to serve a stale/cached login form instead of hitting the server).
  if (event.request.method !== 'GET' || url.includes('/api/') || url.includes('/login.html')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache genuinely successful responses — never a 401, a
        // redirect to the login page, or an error page.
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
