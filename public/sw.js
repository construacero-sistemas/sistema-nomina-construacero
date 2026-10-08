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

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return
  if (request.mode === 'navigate') {
    // Red primero: tras un deploy el shell debe venir fresco del servidor;
    // el caché solo cubre sin conexión. Servir el shell cacheado era la causa
    // del bucle "MIME text/html": HTML viejo → hashes viejos → fallback HTML.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(CACHE)
        await cache.put('/index.html', fresh.clone())
        return fresh
      } catch {
        const cache = await caches.open(CACHE)
        return (await cache.match('/index.html')) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
    })())
    return
  }
  const allowed = APP_SHELL.includes(url.pathname) || /^\/assets\/[^/]+\.(?:js|css|woff2?|png|svg|webp)$/.test(url.pathname)
  if (!allowed) return
  const response = caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request))
  event.respondWith(response)
  event.waitUntil(response.then(async fetched => {
    if (fetched.ok && fetched.type !== 'opaque') {
      // Detectar si un asset JS/CSS sirvió HTML (stale hash tras deploy).
      // Si el contenido es text/html cuando esperábamos script/style, destruir
      // este SW obsoleto y recargar la pestaña para obtener la versión nueva.
      // El usuario no necesita borrar caché manualmente.
      const ct = fetched.headers.get('content-type') || ''
      if (/\.(?:js|mjs|css)$/.test(url.pathname) && ct.includes('text/html')) {
        event.waitUntil((async () => {
          // Borrar todas las caches de esta app
          const keys = await caches.keys()
          await Promise.all(keys.filter(k => k.startsWith('nomina-shell-')).map(k => caches.delete(k)))
          // Desregistrar este SW para que la próxima carga instale el nuevo
          await self.registration.unregister()
          // Forzar reload en todas las pestañas controladas
          const clients = await self.clients.matchAll({ type: 'window' })
          clients.forEach(client => client.navigate(client.url))
        })())
        return
      }
      const cache = await caches.open(CACHE)
      await cache.put(request, fetched.clone())
    }
  }).catch(() => undefined))
})
