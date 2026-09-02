const MOVEMENT_TYPES = new Set(['ingreso', 'egreso'])
const CURRENCIES = new Set(['USD', 'VES', 'EUR', 'USDT'])
const RATE_SOURCES = new Set(['BCV', 'EURO', 'USDT', 'MANUAL', 'FIJA'])
// Límites alineados con NUMERIC(18,6), NUMERIC(24,8) y el total NUMERIC(24,6).
// También mantienen los cálculos dentro de la precisión segura de Number.
const MAX_AMOUNT = 1_000_000_000
const MAX_RATE = 1_000_000
const MAX_RANGE_DAYS = 366

export const DEFAULT_CATEGORIES = [
  { nombre: 'Ventas', tipo: 'ingreso' },
  { nombre: 'Servicios', tipo: 'ingreso' },
  { nombre: 'Otros ingresos', tipo: 'ingreso' },
  { nombre: 'Nómina', tipo: 'egreso' },
  { nombre: 'Comisiones', tipo: 'egreso' },
  { nombre: 'Proveedores', tipo: 'egreso' },
  { nombre: 'Servicios públicos', tipo: 'egreso' },
  { nombre: 'Transporte', tipo: 'egreso' },
  { nombre: 'Impuestos', tipo: 'egreso' },
  { nombre: 'Otros gastos', tipo: 'egreso' },
]

export function roundMoney(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateDateRange(desde, hasta) {
  if (!isValidIsoDate(desde) || !isValidIsoDate(hasta)) {
    throw new RangeError('Rango de fechas inválido')
  }
  const start = new Date(`${desde}T12:00:00Z`)
  const end = new Date(`${hasta}T12:00:00Z`)
  const days = Math.round((end - start) / 86400000)
  if (days < 0 || days > MAX_RANGE_DAYS) {
    throw new RangeError('El rango debe estar entre 0 y 366 días')
  }
  return { desde, hasta }
}

export function normalizeMovement(input = {}) {
  const tipo = String(input.tipo || '').trim().toLowerCase()
  const moneda = String(input.moneda || '').trim().toUpperCase()
  const categoria = String(input.categoria || '').trim()
  const concepto = String(input.concepto || '').trim()
  const monto = Number(input.monto)
  const tasaVes = moneda === 'VES' ? 1 : Number(input.tasaVes ?? input.tasa_ves)
  const tasaUsdInput = input.tasaUsdVes ?? input.tasa_usd_ves
  const tasaUsdVes = moneda === 'USD'
    ? tasaVes
    : (tasaUsdInput == null || tasaUsdInput === '' ? null : Number(tasaUsdInput))
  const fuenteTasa = moneda === 'VES' ? 'FIJA' : String(input.fuenteTasa ?? input.fuente_tasa ?? '').trim().toUpperCase()
  const fecha = String(input.fecha || '')
  const referencia = input.referencia == null ? null : String(input.referencia).trim()
  const observaciones = input.observaciones == null ? null : String(input.observaciones).trim()
  const metodoPago = input.metodoPago == null ? null : String(input.metodoPago).trim()
  const cuentaOrigen = input.cuentaOrigen == null ? null : String(input.cuentaOrigen).trim()
  const partesInput = Array.isArray(input.partes) ? input.partes : null
  const partes = partesInput == null ? null : normalizePartes(partesInput, monto)
  const idempotencyKey = String(input.idempotencyKey ?? input.idempotency_key ?? '').trim()

  if (!MOVEMENT_TYPES.has(tipo)) throw new RangeError('tipo debe ser ingreso o egreso')
  if (!CURRENCIES.has(moneda)) throw new RangeError('moneda financiera inválida')
  if (!categoria || categoria.length > 80) throw new RangeError('categoría obligatoria o demasiado larga')
  // El motivo/concepto es obligatorio y debe ser descriptivo: sin él no se puede
  // saber al final de mes de dónde provienen los ingresos y los egresos.
  if (!concepto || concepto.length < 3 || concepto.length > 180) {
    throw new RangeError('concepto (motivo) obligatorio: mínimo 3 caracteres, máximo 180')
  }
  if (!isValidIsoDate(fecha)) throw new RangeError('fecha inválida')
  if (!Number.isFinite(monto) || monto <= 0 || monto > MAX_AMOUNT) throw new RangeError('monto inválido')
  if (!Number.isFinite(tasaVes) || tasaVes <= 0 || tasaVes > MAX_RATE) throw new RangeError('tasa VES inválida')
  if (tasaUsdVes != null && (!Number.isFinite(tasaUsdVes) || tasaUsdVes <= 0 || tasaUsdVes > MAX_RATE)) {
    throw new RangeError('tasa USD→VES inválida')
  }
  if (!RATE_SOURCES.has(fuenteTasa)) throw new RangeError('fuente de tasa inválida')
  if (fuenteTasa === 'MANUAL' && !input.observacionTasa?.toString().trim()) {
    throw new RangeError('Una tasa manual requiere observación')
  }
  if (referencia && referencia.length > 160) throw new RangeError('referencia demasiado larga')
  if (observaciones && observaciones.length > 1000) throw new RangeError('observaciones demasiado largas')
  if (metodoPago && metodoPago.length > 60) throw new RangeError('método de pago demasiado largo')
  if (cuentaOrigen && cuentaOrigen.length > 80) throw new RangeError('cuenta de origen demasiado larga')
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new RangeError('idempotencyKey inválida')
  }

  return {
    tipo,
    moneda,
    categoria,
    concepto,
    fecha,
    monto: roundMoney(monto),
    tasa_ves: roundMoney(tasaVes),
    tasa_usd_ves: tasaUsdVes == null ? null : roundMoney(tasaUsdVes),
    fuente_tasa: fuenteTasa,
    observacion_tasa: input.observacionTasa ? String(input.observacionTasa).trim().slice(0, 300) : null,
    referencia,
    observaciones,
    metodo_pago: metodoPago,
    cuenta_origen: cuentaOrigen,
    partes,
    idempotency_key: idempotencyKey,
  }
}

/**
 * Valida y normaliza los tramos (partes) de un movimiento.
 * - Cada tramo debe tener monto > 0.
 * - La suma de los tramos debe coincidir con el monto total (tolerancia mínima).
 * - Se acepta una referencia opcional por tramo.
 * Devuelve null si no hay tramos.
 */
function normalizePartes(partes, montoTotal) {
  if (partes.length === 0) return null
  const total = Number(montoTotal)
  let suma = 0
  const out = partes.map(parte => {
    const monto = Number(parte?.monto)
    if (!Number.isFinite(monto) || monto <= 0 || monto > MAX_AMOUNT) {
      throw new RangeError('monto de tramo inválido')
    }
    suma += monto
    const ref = parte?.referencia == null ? null : String(parte.referencia).trim()
    if (ref && ref.length > 160) throw new RangeError('referencia de tramo demasiado larga')
    return {
      monto: roundMoney(monto),
      moneda: parte?.moneda ? String(parte.moneda).trim().toUpperCase() : null,
      referencia: ref,
      metodo_pago: parte?.metodoPago ? String(parte.metodoPago).trim() : null,
      cuenta_origen: parte?.cuentaOrigen ? String(parte.cuentaOrigen).trim() : null,
    }
  })
  // Tolerancia de 1 centavo por redondeo
  if (Math.abs(suma - total) > 0.01) {
    throw new RangeError('La suma de los tramos debe igualar el monto total')
  }
  return out
}

export function normalizeCategory(input = {}) {
  const nombre = String(input.nombre || '').trim()
  const tipo = String(input.tipo || 'ambos').trim().toLowerCase()
  if (!nombre || nombre.length > 80) throw new RangeError('nombre de categoría obligatorio o demasiado largo')
  if (!['ingreso', 'egreso', 'ambos'].includes(tipo)) throw new RangeError('tipo de categoría inválido')
  return { nombre, tipo }
}

export function normalizeReportQuery(url) {
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  validateDateRange(desde, hasta)
  const tipo = url.searchParams.get('tipo') || null
  const moneda = url.searchParams.get('moneda')?.toUpperCase() || null
  const categoria = url.searchParams.get('categoria') || null
  const limit = clampInteger(url.searchParams.get('limit'), 50, 1, 100)
  const offset = clampInteger(url.searchParams.get('offset'), 0, 0, 100000)
  if (tipo && !MOVEMENT_TYPES.has(tipo)) throw new RangeError('tipo de filtro inválido')
  if (moneda && !CURRENCIES.has(moneda)) throw new RangeError('moneda de filtro inválida')
  if (categoria && categoria.length > 80) throw new RangeError('categoría de filtro inválida')
  return { desde, hasta, tipo, moneda, categoria, limit, offset }
}

function clampInteger(value, fallback, min, max) {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new RangeError('paginación inválida')
  return parsed
}

export function summarizeRows(rows = []) {
  const summary = {
    ingresos_ves: 0,
    egresos_ves: 0,
    balance_ves: 0,
    ingresos_usd: 0,
    egresos_usd: 0,
    balance_usd: 0,
    movimientos: 0,
    movimientos_sin_usd: 0,
    categorias: [],
  }
  const categories = new Map()
  for (const row of rows) {
    const totalVes = Number(row.total_ves) || 0
    const totalUsd = Number(row.total_usd) || 0
    const key = `${row.tipo}:${row.categoria}`
    const item = categories.get(key) || { tipo: row.tipo, categoria: row.categoria, total_ves: 0, total_usd: 0, movimientos: 0 }
    item.total_ves = roundMoney(item.total_ves + totalVes)
    item.total_usd = roundMoney(item.total_usd + totalUsd)
    item.movimientos += Number(row.movimientos) || 0
    categories.set(key, item)
    summary.movimientos += Number(row.movimientos) || 0
    summary.movimientos_sin_usd += Number(row.movimientos_sin_usd) || 0
    if (row.tipo === 'ingreso') {
      summary.ingresos_ves = roundMoney(summary.ingresos_ves + totalVes)
      summary.ingresos_usd = roundMoney(summary.ingresos_usd + totalUsd)
    }
    if (row.tipo === 'egreso') {
      summary.egresos_ves = roundMoney(summary.egresos_ves + totalVes)
      summary.egresos_usd = roundMoney(summary.egresos_usd + totalUsd)
    }
  }
  summary.balance_ves = roundMoney(summary.ingresos_ves - summary.egresos_ves)
  summary.balance_usd = roundMoney(summary.ingresos_usd - summary.egresos_usd)
  summary.categorias = [...categories.values()].sort((a, b) => b.total_usd - a.total_usd)
  return summary
}

export function movementResponse(row) {
  if (!row) return null
  return {
    id: row.id,
    fecha: row.fecha,
    tipo: row.tipo,
    categoria: row.categoria,
    concepto: row.concepto,
    monto: Number(row.monto),
    moneda: row.moneda,
    tasa_ves: Number(row.tasa_ves),
    tasa_usd_ves: row.tasa_usd_ves == null ? null : Number(row.tasa_usd_ves),
    monto_ves: Number(row.monto_ves),
    fuente_tasa: row.fuente_tasa,
    observacion_tasa: row.observacion_tasa,
    referencia: row.referencia,
    observaciones: row.observaciones,
    metodo_pago: row.metodo_pago ?? null,
    cuenta_origen: row.cuenta_origen ?? null,
    partes: row.partes ? (typeof row.partes === 'string' ? JSON.parse(row.partes) : row.partes) : null,
    estado: row.estado,
    creado_en: row.creado_en,
    anulado_en: row.anulado_en,
    motivo_anulacion: row.motivo_anulacion,
  }
}
