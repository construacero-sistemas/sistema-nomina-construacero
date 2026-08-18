// Cache de respuestas de lectura para reducir egress en instancias calientes.
// No sustituye React Query ni es una fuente de autorización: las claves incluyen
// URL, token (fingerprint), operador y origen; los POST limpian todo el caché.

const MAX_ENTRIES = 128
const MAX_ENTRY_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const MISS = Symbol('egress-cache-miss')

const entries = new Map()
let totalBytes = 0

function removeEntry(key) {
  const entry = entries.get(key)
  if (!entry) return
  totalBytes -= entry.bytes
  entries.delete(key)
}

function evictUntilFits(bytes) {
  while (
    entries.size >= MAX_ENTRIES ||
    totalBytes + bytes > MAX_TOTAL_BYTES
  ) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    removeEntry(oldest)
  }
}

export function getEgressCache(key) {
  const entry = entries.get(key)
  if (!entry) return MISS
  if (Date.now() >= entry.expiresAt) {
    removeEntry(key)
    return MISS
  }
  // LRU: una lectura reciente pasa al final del Map.
  entries.delete(key)
  entries.set(key, entry)
  return {
    status: entry.status,
    statusText: entry.statusText,
    contentType: entry.contentType,
    body: entry.body.slice(),
  }
}

export function isEgressCacheMiss(value) {
  return value === MISS
}

export function setEgressCache(key, value, ttlMs) {
  if (!key || !value?.body || ttlMs <= 0) return false
  const body = value.body instanceof Uint8Array
    ? value.body.slice()
    : new Uint8Array(value.body)
  const bytes = body.byteLength
  if (bytes > MAX_ENTRY_BYTES) return false

  removeEntry(key)
  evictUntilFits(bytes)
  entries.set(key, {
    status: value.status,
    statusText: value.statusText,
    contentType: value.contentType || 'application/json',
    body,
    bytes,
    expiresAt: Date.now() + ttlMs,
  })
  totalBytes += bytes
  return true
}

export function clearEgressCache() {
  entries.clear()
  totalBytes = 0
}

export function egressCacheStats() {
  return { entries: entries.size, bytes: totalBytes }
}

export async function egressRequestKey(request) {
  const material = [
    request.method,
    request.url,
    request.headers.get('Authorization') || '',
    request.headers.get('X-Operator-Id') || '',
    request.headers.get('Origin') || '',
  ].join('\u001f')

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(material),
    )
    return `http:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
  }

  // Node/V8 modernos y Workers tienen crypto.subtle. Este fallback solo evita
  // romper tests o runtimes embebidos sin crypto; nunca se persiste fuera de RAM.
  return `http:fallback:${material}`
}

export async function cacheResponse(key, response, ttlMs) {
  if (!response?.ok || response.headers.has('Set-Cookie')) return false
  const body = new Uint8Array(await response.clone().arrayBuffer())
  return setEgressCache(key, {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('Content-Type'),
    body,
  }, ttlMs)
}

export function responseFromEgressCache(entry) {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: { 'Content-Type': entry.contentType || 'application/json' },
  })
}
