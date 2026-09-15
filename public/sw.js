const VERSION = '__BUILD_ID__'
const CACHE = `nomina-shell-${VERSION}`
const APP_SHELL = ['/', '/index.html', '/favicon.png', '/logo.png', '/manifest.webmanifest' /* BUILD_ASSETS */]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)))
  // No skipWaiting automático: la versión espera a que se cierren las pestañas
  // anteriores, sin recargar formularios o pagos cuyo resultado es incierto.
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith('nomina-shell-') && name !== CACHE).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return
  if (request.mode === 'navigate') {
    // Shell de la versión activa: sus assets fueron precargados en install.
    // Los datos protegidos no están en este caché ni se habilitan sin sesión.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match('/index.html')) || fetch(request)))
    return
  }
  const allowed = APP_SHELL.includes(url.pathname) || /^\/assets\/[^/]+\.(?:js|css|woff2?|png|svg|webp)$/.test(url.pathname)
  if (!allowed) return
  const response = caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request))
  event.respondWith(response)
  event.waitUntil(response.then(async fetched => {
    if (fetched.ok && fetched.type !== 'opaque') {
      const cache = await caches.open(CACHE)
      await cache.put(request, fetched.clone())
    }
  }).catch(() => undefined))
})
