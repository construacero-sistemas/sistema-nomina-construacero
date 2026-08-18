const MONEDAS = new Set(['USD', 'EUR', 'USDT', 'VES'])
const cache = new Map()

export function normalizarTasa(input = {}) {
  const monedaOrigen = String(input.monedaOrigen || input.moneda_origen || '').toUpperCase()
  const valor = Number(input.valor)
  const fuente = String(input.fuente || '').trim()
  if (!MONEDAS.has(monedaOrigen) || monedaOrigen === 'VES') throw new RangeError('moneda de tasa inválida')
  if (!Number.isFinite(valor) || valor <= 0) throw new RangeError('valor de tasa inválido')
  if (!fuente) throw new RangeError('fuente de tasa obligatoria')
  return { moneda_origen: monedaOrigen, moneda_destino: 'VES', valor, fuente }
}

export function cachearTasa(tasa, ttlMs = 5 * 60 * 1000, now = Date.now()) {
  const normalizada = normalizarTasa(tasa)
  cache.set(normalizada.moneda_origen, { tasa: normalizada, expira: now + ttlMs })
  return normalizada
}

export function obtenerTasaCache(monedaOrigen, now = Date.now()) {
  const entrada = cache.get(String(monedaOrigen || '').toUpperCase())
  if (!entrada || entrada.expira <= now) return null
  return entrada.tasa
}

export function limpiarCacheTasas() { cache.clear() }
