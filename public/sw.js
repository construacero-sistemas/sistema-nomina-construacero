const CACHE = 'nomina-shell-v2'
const APP_SHELL = ['/', '/index.html', '/favicon.png', '/logo.png', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

// Estrategias:
// - Navegaciones (document): network-first → el usuario recibe el shell nuevo
//   en cuanto hay conexión y el despliegue nunca queda congelado. Sin red se
//   sirve la última copia cacheada (offline real).
// - Assets con hash (script/style/image/font): cache-first, son inmutables.
// - /api/*: JAMÁS se cachea (regla del proyecto).
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, copy))
      }
      return response
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html'))))
    return
  }

  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, copy))
      }
      return response
    })))
  }
})
