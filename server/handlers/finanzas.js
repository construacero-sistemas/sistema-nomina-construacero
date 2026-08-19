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
  'motivo_anulacion',
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

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({
      cuenta_id: context.operador.cuenta_id,
      fecha: movement.fecha,
      tipo: movement.tipo,
      categoria: movement.categoria,
      concepto: movement.concepto,
      monto: movement.monto,
      moneda: movement.moneda,
      tasa_ves: movement.tasa_ves,
      fuente_tasa: movement.fuente_tasa,
      observacion_tasa: movement.observacion_tasa,
      referencia: movement.referencia,
      observaciones: movement.observaciones,
      idempotency_key: movement.idempotency_key,
      creado_por: context.operador.id,
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    if (detail.includes('idempot') || detail.includes('unique')) {
      const retry = await readExistingByKey(env, context.operador.cuenta_id, movement.idempotency_key)
      if (retry.row) return json({ ok: true, idempotente: true, movimiento: movementResponse(retry.row) }, 200, request)
      return jsonError('Movimiento duplicado', 409, request)
    }
    return jsonError('No se pudo registrar el movimiento', 500, request)
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
  return json({ categorias: [...stored, ...defaults] }, 200, request)
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
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_CREADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: row?.id || null,
    meta: { tipo: category.tipo },
    ip: context.ip,
  }).catch(() => {})
  return json({ ok: true, categoria: row }, 201, request)
}
