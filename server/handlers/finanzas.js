// server/handlers/finanzas.js
// Libro financiero: ingresos, egresos, categorías y reportes agregados.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireAdmin } from '../lib/permissions.js'
import {
  DEFAULT_CATEGORIES,
  normalizeCategory,
  normalizeMovement,
  normalizeReportQuery,
  movementResponse,
  summarizeRows,
} from '../lib/finanzasUtils.js'

const MOVEMENT_SELECT = [
  'id', 'fecha', 'tipo', 'categoria', 'concepto', 'monto', 'moneda',
  'tasa_ves', 'monto_ves', 'fuente_tasa', 'observacion_tasa',
  'referencia', 'observaciones', 'estado', 'creado_en', 'anulado_en',
  'motivo_anulacion', 'metodo_pago', 'cuenta_origen', 'partes',
].join(',')

function adminContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireAdmin(result.operador, request)
    if (denied) return { error: denied }
    if (!isValidUuid(result.operador.cuenta_id)) {
      return { error: jsonError('Cuenta inválida', 403, request) }
    }
    return result
  })
}

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

function queryValue(value) {
  return encodeURIComponent(String(value))
}

async function readBody(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

async function readExistingByKey(env, accountId, key) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(accountId)}` +
      `&idempotency_key=eq.${queryValue(key)}&select=${MOVEMENT_SELECT}&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return { error: true, row: null }
  const [row] = await response.json()
  return { error: false, row: row || null }
}

async function readMovement(env, accountId, id) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(id)}` +
      `&${accountFilter(accountId)}&select=${MOVEMENT_SELECT}&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return { error: true, row: null }
  const [row] = await response.json()
  return { error: false, row: row || null }
}

function publicRows(rows) {
  return (rows || []).map(movementResponse)
}

export async function handleGetFinanzasMovimientos(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error

  const url = new URL(request.url)
  let filters
  try {
    filters = normalizeReportQuery(url)
  } catch (error) {
    return jsonError(error.message || 'Filtros inválidos', 400, request)
  }

  const parts = [
    accountFilter(context.operador.cuenta_id),
    `fecha=gte.${queryValue(filters.desde)}`,
    `fecha=lte.${queryValue(filters.hasta)}`,
    filters.tipo ? `tipo=eq.${queryValue(filters.tipo)}` : '',
    filters.moneda ? `moneda=eq.${queryValue(filters.moneda)}` : '',
    filters.categoria ? `categoria=eq.${queryValue(filters.categoria)}` : '',
    url.searchParams.get('mostrarAnulados') === 'true' ? '' : 'estado=eq.activo',
  ].filter(Boolean).join('&')

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${parts}` +
      `&select=${MOVEMENT_SELECT}&order=fecha.desc,creado_en.desc&limit=${filters.limit}&offset=${filters.offset}`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return jsonError('No se pudieron cargar los movimientos', 500, request)
  const rows = await response.json()
  return json({
    movimientos: publicRows(rows),
    paginacion: { limit: filters.limit, offset: filters.offset, recibidos: rows.length },
    filtros: filters,
  }, 200, request)
}

export async function handleCrearFinanzasMovimiento(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  let movement
  try {
    movement = normalizeMovement(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Movimiento inválido', 400, request)
  }

  const existing = await readExistingByKey(env, context.operador.cuenta_id, movement.idempotency_key)
  if (existing.error) return jsonError('No se pudo comprobar la idempotencia', 500, request)
  if (existing.row) {
    return json({ ok: true, idempotente: true, movimiento: movementResponse(existing.row) }, 200, request)
  }

  const fuenteTasaDb = movement.fuente_tasa === 'FIJA' ? 'BCV' : (movement.fuente_tasa || 'BCV')
  const payload = {
    cuenta_id: context.operador.cuenta_id,
    fecha: movement.fecha,
    tipo: movement.tipo,
    categoria: movement.categoria,
    concepto: movement.concepto,
    monto: movement.monto,
    moneda: movement.moneda,
    tasa_ves: movement.tasa_ves,
    // tasa_usd_ves se inserta solo cuando la columna existe (migración 224)
    ...(movement.tasa_usd_ves != null ? { tasa_usd_ves: movement.tasa_usd_ves } : {}),
    fuente_tasa: fuenteTasaDb,
    observacion_tasa: movement.observacion_tasa,
    referencia: movement.referencia,
    observaciones: movement.observaciones,
    idempotency_key: movement.idempotency_key,
    creado_por: context.operador.id,
    // Método de pago, cuenta de origen y tramos — solo si vienen definidos (columnas migración 226).
    ...(movement.metodo_pago ? { metodo_pago: movement.metodo_pago } : {}),
    ...(movement.cuenta_origen ? { cuenta_origen: movement.cuenta_origen } : {}),
    ...(movement.partes ? { partes: movement.partes } : {}),
  }

  // Si es en Bolívares y no vino tasa_usd_ves, recuperar la última tasa para no dejarla nula
  if (payload.moneda === 'VES' && payload.tasa_usd_ves == null) {
    try {
      const snapRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?cuenta_id=eq.${encodeURIComponent(context.operador.cuenta_id)}&order=fecha.desc&limit=1&select=bcv`,
        { headers: serviceHeaders(env, 'return=minimal') },
      )
      if (snapRes.ok) {
        const [snap] = await snapRes.json().catch(() => [])
        if (Number(snap?.bcv) > 0) payload.tasa_usd_ves = Number(snap.bcv)
      }
    } catch {
      // Continuar con payload actual si falla el snapshot
    }
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const detail = await response.text()
    const detailLower = detail.toLowerCase()
    if (detailLower.includes('idempot') || detailLower.includes('unique')) {
      const retry = await readExistingByKey(env, context.operador.cuenta_id, movement.idempotency_key)
      if (retry.row) return json({ ok: true, idempotente: true, movimiento: movementResponse(retry.row) }, 200, request)
      return jsonError('Movimiento duplicado', 409, request)
    }

    // Fallback retry sin columnas aún no aplicadas (tasa_usd_ves migración 224 y
    // metodo_pago / cuenta_origen / partes migración 226) si la base no las tiene.
    const FALLBACK_KEYS = ['tasa_usd_ves', 'metodo_pago', 'cuenta_origen', 'partes']
    if (FALLBACK_KEYS.some(key => payload[key] != null)) {
      const fallbackPayload = { ...payload }
      FALLBACK_KEYS.forEach(key => delete fallbackPayload[key])
      const fallbackRes = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
        method: 'POST',
        headers: serviceHeaders(env),
        body: JSON.stringify(fallbackPayload),
      })
      if (fallbackRes.ok) {
        const [fbRow] = await fallbackRes.json()
        return json({ ok: true, idempotente: false, movimiento: movementResponse(fbRow) }, 201, request)
      }
    }

    return jsonError(detail || 'No se pudo registrar el movimiento', 500, request)
  }

  const [row] = await response.json()
  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'MOVIMIENTO_CREADO',
    entidadTipo: 'finanzas_movimientos',
    entidadId: row?.id || null,
    meta: { tipo: movement.tipo, moneda: movement.moneda, monto: movement.monto },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, idempotente: false, movimiento: movementResponse(row) }, 201, request)
}

export async function handleAnularFinanzasMovimiento(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  const motivo = String(parsed.body?.motivo || '').trim()
  const key = String(parsed.body?.idempotencyKey || parsed.body?.idempotency_key || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (motivo.length < 3 || motivo.length > 300) return jsonError('motivo inválido', 400, request)
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) return jsonError('idempotencyKey inválida', 400, request)

  const current = await readMovement(env, context.operador.cuenta_id, id)
  if (current.error) return jsonError('No se pudo leer el movimiento', 500, request)
  if (!current.row) return jsonError('Movimiento no encontrado', 404, request)
  if (current.row.estado === 'anulado') {
    return json({ ok: true, idempotente: true, movimiento: movementResponse(current.row) }, 200, request)
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}&estado=eq.activo`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({
        estado: 'anulado',
        anulado_en: new Date().toISOString(),
        anulado_por: context.operador.id,
        motivo_anulacion: motivo,
        anulacion_idempotency_key: key,
      }),
    },
  )
  if (!response.ok) return jsonError('No se pudo anular el movimiento', 409, request)
  const [row] = await response.json()
  if (!row) return jsonError('Movimiento no encontrado o ya anulado', 409, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'MOVIMIENTO_ANULADO',
    entidadTipo: 'finanzas_movimientos',
    entidadId: row.id,
    meta: { motivo },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, idempotente: false, movimiento: movementResponse(row) }, 200, request)
}

// POST /api/finanzas/movimientos/revertir-anulacion
// Reversibilidad: un movimiento anulado vuelve a estado activo. El POST de
// anulación nunca borra, así que restaurar es seguro: se limpian los campos de
// auditoría de la anulación (el CHECK de la tabla lo exige en estado activo)
// y se deja constancia en auditoría. Idempotente si ya está activo.
export async function handleRevertirAnulacionMovimiento(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const current = await readMovement(env, context.operador.cuenta_id, id)
  if (current.error) return jsonError('No se pudo leer el movimiento', 500, request)
  if (!current.row) return jsonError('Movimiento no encontrado', 404, request)
  if (current.row.estado === 'activo') {
    return json({ ok: true, idempotente: true, movimiento: movementResponse(current.row) }, 200, request)
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}&estado=eq.anulado`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      // El CHECK (estado='activo' AND anulado_en IS NULL ...) exige limpiar
      // los campos de anulación al revertir; motivo_anulacion se conserva en
      // el log de auditoría, no en la fila.
      body: JSON.stringify({
        estado: 'activo',
        anulado_en: null,
        anulado_por: null,
        motivo_anulacion: null,
        anulacion_idempotency_key: null,
      }),
    },
  )
  if (!response.ok) return jsonError('No se pudo revertir la anulación', 409, request)
  const [row] = await response.json()
  if (!row) return jsonError('Movimiento no encontrado o ya activo', 409, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'MOVIMIENTO_REVERTIDO',
    entidadTipo: 'finanzas_movimientos',
    entidadId: row.id,
    meta: { motivo_anulacion_anterior: current.row.motivo_anulacion || null },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, idempotente: false, movimiento: movementResponse(row) }, 200, request)
}

// POST /api/finanzas/categorias/eliminar
// Baja LÓGICA (activo=false): la categoría deja de ofrecerse en nuevos
// movimientos pero el historial conserva su nombre y se puede restaurar.
// Las predeterminadas del sistema no se pueden eliminar (siempre aparecen).
export async function handleEliminarFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}&select=id,nombre,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar la categoría', 500, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Categoría no encontrada', 404, request)
  const esPredeterminada = DEFAULT_CATEGORIES.some(c => c.nombre.toLowerCase() === String(row.nombre).toLowerCase())
  if (esPredeterminada) return jsonError('Las categorías predeterminadas no se pueden eliminar', 400, request)
  if (!row.activo) return json({ ok: true, idempotente: true, id }, 200, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo: false }),
    },
  )
  if (!response.ok) return jsonError('No se pudo eliminar la categoría', 500, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_ELIMINADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: id,
    meta: { logico: true, nombre: row.nombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id, nombre: row.nombre }, 200, request)
}

// POST /api/finanzas/categorias/restaurar
// Reversibilidad: reactiva una categoría dada de baja (activo=false → true).
export async function handleRestaurarFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo: true }),
    },
  )
  if (!response.ok) return jsonError('No se pudo restaurar la categoría', 500, request)
  const [row] = await response.json().catch(() => [])
  if (!row) return jsonError('Categoría no encontrada', 404, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_RESTAURADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: id,
    meta: { nombre: row.nombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, categoria: row }, 200, request)
}

export async function handleGetFinanzasResumen(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const url = new URL(request.url)
  let filters
  try {
    filters = normalizeReportQuery(url)
  } catch (error) {
    return jsonError(error.message || 'Filtros inválidos', 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/finanzas_resumen`, {
    method: 'POST',
    headers: serviceHeaders(env, 'return=minimal'),
    body: JSON.stringify({
      p_cuenta_id: context.operador.cuenta_id,
      p_desde: filters.desde,
      p_hasta: filters.hasta,
      p_moneda: filters.moneda,
      p_tipo: filters.tipo,
      p_categoria: filters.categoria,
    }),
  })
  if (!response.ok) return jsonError('No se pudo calcular el resumen financiero', 500, request)
  const rows = await response.json()
  return json({ resumen: summarizeRows(rows), filtros: filters }, 200, request)
}

export async function handleGetFinanzasCategorias(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?${accountFilter(context.operador.cuenta_id)}` +
      '&activo=eq.true&select=id,nombre,tipo,activo&order=nombre.asc&limit=100',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return jsonError('No se pudieron cargar las categorías', 500, request)
  const stored = await response.json()
  const names = new Set(stored.map(category => category.nombre.toLowerCase()))
  const defaults = DEFAULT_CATEGORIES
    .filter(category => !names.has(category.nombre.toLowerCase()))
    .map(category => ({ ...category, id: null, activo: true, predeterminada: true }))

  // Papelera: categorías dadas de baja, recuperables desde el gestor.
  const eliminadasRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?${accountFilter(context.operador.cuenta_id)}` +
      '&activo=eq.false&select=id,nombre,tipo,activo&order=nombre.asc&limit=50',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  const eliminadas = eliminadasRes.ok ? await eliminadasRes.json() : []

  // Conteo de movimientos históricos por categoría (Opción A: preservación contable)
  const movsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(context.operador.cuenta_id)}` +
      '&select=categoria',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  const movRows = movsRes.ok ? await movsRes.json().catch(() => []) : []
  const conteos = {}
  if (Array.isArray(movRows)) {
    for (const m of movRows) {
      if (m.categoria) {
        const k = String(m.categoria).toLowerCase().trim()
        conteos[k] = (conteos[k] || 0) + 1
      }
    }
  }

  const mapConConteos = list => list.map(c => ({
    ...c,
    movimientos_count: conteos[String(c.nombre || '').toLowerCase().trim()] || 0,
  }))

  return json({
    categorias: mapConConteos([...stored, ...defaults]),
    eliminadas: mapConConteos(Array.isArray(eliminadas) ? eliminadas : []),
  }, 200, request)
}

export async function handleCrearFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error
  let category
  try {
    category = normalizeCategory(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Categoría inválida', 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_categorias`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({
      cuenta_id: context.operador.cuenta_id,
      nombre: category.nombre,
      tipo: category.tipo,
      creado_por: context.operador.id,
    }),
  })
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    return jsonError(detail.includes('unique') ? 'La categoría ya existe' : 'No se pudo crear la categoría', detail.includes('unique') ? 409 : 500, request)
  }
  const [row] = await response.json()
  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id, usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol, cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS', accion: 'CATEGORIA_CREADA', entidadTipo: 'finanzas_categorias',
    entidadId: row?.id || null, meta: { tipo: category.tipo }, ip: context.ip,
  }).catch(() => {})
  return json({ ok: true, categoria: row }, 201, request)
}

// Re-asignación masiva: fija cuenta_origen (cuenta de custodia) en movimientos
// activos. La UI lo usa para clasificar los movimientos "sin cuenta asignada".
// Nunca toca movimientos anulados ni de otra cuenta_id.
export async function handleReasignarCuentaMovimientos(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const ids = Array.isArray(parsed.body?.ids) ? parsed.body.ids.map(v => String(v).trim()).filter(Boolean) : []
  const cuentaOrigen = String(parsed.body?.cuenta_origen || '').trim()

  if (ids.length === 0) return jsonError('Debes indicar al menos un movimiento', 400, request)
  if (ids.length > 100) return jsonError('Máximo 100 movimientos por lote', 400, request)
  if (!ids.every(isValidUuid)) return jsonError('Hay ids de movimiento inválidos', 400, request)
  if (!cuentaOrigen) return jsonError('cuenta_origen es obligatorio', 400, request)
  if (cuentaOrigen.length > 120) return jsonError('cuenta_origen demasiado largo', 400, request)

  const inList = `id=in.(${ids.map(queryValue).join(',')})`
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${inList}` +
      `&${accountFilter(context.operador.cuenta_id)}&estado=eq.activo`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ cuenta_origen: cuentaOrigen }),
    },
  )
  if (!response.ok) return jsonError('No se pudo reasignar los movimientos', 500, request)
  const updated = await response.json().catch(() => [])

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id, usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol, cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS', accion: 'MOVIMIENTOS_REASIGNADOS', entidadTipo: 'finanzas_movimientos',
    entidadId: null, meta: { total: ids.length, actualizados: Array.isArray(updated) ? updated.length : 0, cuenta_origen: cuentaOrigen },
    ip: context.ip,
  }).catch(() => {})

  return json({
    ok: true,
    actualizados: Array.isArray(updated) ? updated.length : 0,
  }, 200, request)
}
