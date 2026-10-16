// server/handlers/finanzas.js
// Libro financiero: ingresos, egresos, categorías y reportes agregados.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireCapacidad, capacidadesDe } from '../lib/permissions.js'
import { callFinancialRpc, financialErrorResponse } from '../lib/financialOperations.js'
import { clasificarCoincidenciasMovimiento, motivoCoincidenciaValido } from '../lib/financialDuplicates.js'
import { evaluarSaldoEgreso, mensajeSaldoInsuficiente, parseInsufficientFundsDetail } from '../lib/financialBalance.js'
import {
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
  // tasa_usd_ves alimenta el contravalor USD del listado (migración 224).
  'tasa_usd_ves', 'tasa_registrada_en', 'cuenta_custodia_id', 'operacion_id', 'motivo_coincidencia', 'idempotency_key',
].join(',')

function adminContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireCapacidad(result.operador, 'verFinanzas', request)
    if (denied) return { error: denied }
    if (!isValidUuid(result.operador.cuenta_id)) {
      return { error: jsonError('Cuenta inválida', 403, request) }
    }
    return result
  })
}

// Contexto para operaciones de ESCRITURA financiera (crear/anular/traspasar).
// El rol finanzas puede operar el libro aunque no vea saldos.
function operarContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireCapacidad(result.operador, 'operarFinanzas', request)
    if (denied) return { error: denied }
    if (!isValidUuid(result.operador.cuenta_id)) {
      return { error: jsonError('Cuenta inválida', 403, request) }
    }
    return result
  })
}

// Contexto exclusivo para el jefe/soporte (administrarSistema).
function jefeContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireCapacidad(result.operador, 'administrarSistema', request)
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

function insufficientFundsResponse(funds, moneda, request, prefix = '') {
  const known = Number.isFinite(funds.disponible) && Number.isFinite(funds.faltante)
  return json({
    error: prefix + (known ? mensajeSaldoInsuficiente(funds, moneda) : 'Saldo insuficiente en la cartera.'),
    code: 'FINANCIAL_INSUFFICIENT_FUNDS',
    ...(known ? { disponible: funds.disponible, faltante: funds.faltante, moneda } : {}),
  }, 409, request)
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

  try {
    const result = await callFinancialRpc(env, 'finanzas_movimientos_pagina', {
      p_cuenta_id: context.operador.cuenta_id, p_desde: filters.desde, p_hasta: filters.hasta,
      p_tipo: filters.tipo, p_categoria: filters.categoria, p_moneda: filters.moneda,
      p_cartera: url.searchParams.get('cartera') || null,
      p_anulados: url.searchParams.get('mostrarAnulados') === 'true',
      p_limite: filters.limit, p_offset: filters.offset, p_version: url.searchParams.get('versionLibro') || null,
    })
    return json({ ...result, movimientos: publicRows(result.movimientos), filtros: filters }, 200, request)
  } catch (error) {
    return financialErrorResponse(error, request)
  }
}

export async function handleCrearFinanzasMovimiento(request, env) {
  const context = await operarContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  let movement
  try {
    movement = normalizeMovement(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Movimiento inválido', 400, request)
  }

  const custodyId = parsed.body?.cuentaCustodiaId || parsed.body?.cuenta_custodia_id
  // Guardarraíl anti-huérfanos: toda alta exige cuenta de custodia válida,
  // activa y del tenant. Sin ella la partida queda fuera de los saldos y el
  // libro vuelve a reportar conciliación pendiente para toda la cuenta.
  if (custodyId == null || !isValidUuid(custodyId)) return jsonError('Selecciona la cuenta de origen/destino del movimiento', 400, request)
  const custodyResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_custodia?id=eq.${custodyId}&${accountFilter(context.operador.cuenta_id)}&activo=eq.true&select=id,nombre,moneda&limit=1`, { headers: serviceHeaders(env) })
  if (!custodyResponse.ok) return jsonError('No se pudo comprobar la cuenta de custodia', 503, request)
  const [custody] = await custodyResponse.json()
  if (!custody || custody.moneda !== movement.moneda) return jsonError('La cuenta no existe o su moneda no corresponde al movimiento', 400, request)
  movement.cuenta_origen = custody.nombre
  const motivoCoincidencia = String(parsed.body?.motivoCoincidencia || '').trim()
  if (motivoCoincidencia && !motivoCoincidenciaValido(motivoCoincidencia)) {
    return jsonError('El motivo para registrar una coincidencia debe tener entre 8 y 300 caracteres.', 400, request)
  }
  const existing = await readExistingByKey(env, context.operador.cuenta_id, movement.idempotency_key)
  if (existing.error) return jsonError('No se pudo comprobar la idempotencia', 500, request)
  if (existing.row) {
    return json({ ok: true, idempotente: true, movimiento: movementResponse(existing.row) }, 200, request)
  }
  const duplicatesResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(context.operador.cuenta_id)}` +
      `&cuenta_custodia_id=eq.${queryValue(custodyId)}&fecha=eq.${queryValue(movement.fecha)}` +
      `&tipo=eq.${queryValue(movement.tipo)}&moneda=eq.${queryValue(movement.moneda)}` +
      `&estado=eq.activo&select=id,fecha,tipo,concepto,monto,moneda,referencia,estado,idempotency_key&limit=100`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!duplicatesResponse.ok) return jsonError('No se pudo comprobar si existe un movimiento parecido. No se registró nada.', 503, request)
  const duplicateRows = await duplicatesResponse.json()
  const duplicateRowsExcludingRetry = duplicateRows.filter(row => row.idempotency_key !== movement.idempotency_key)
  const duplicateCheck = clasificarCoincidenciasMovimiento(movement, duplicateRowsExcludingRetry)
  if (duplicateCheck.exact) return json({
    error: 'Ya existe un movimiento activo con la misma referencia e importe el mismo día, cuenta, tipo y moneda.',
    code: 'FINANCIAL_DUPLICATE_EXACT',
    movimientoExistente: movementResponse(duplicateCheck.exact),
  }, 409, request)
  if (duplicateCheck.similar.length && !motivoCoincidencia) return json({
    error: 'Hay movimientos activos con el mismo concepto y referencia el mismo día, pero distinto importe. Confirma si es una operación diferente y escribe el motivo.',
    code: 'FINANCIAL_DUPLICATE_SIMILAR',
    coincidencias: duplicateCheck.similar.map(movementResponse),
  }, 409, request)
  if (movement.tipo === 'egreso') {
    let balances
    try {
      balances = await callFinancialRpc(env, 'finanzas_saldos', { p_cuenta_id: context.operador.cuenta_id })
    } catch {
      return jsonError('No se pudo comprobar el saldo de la cartera. No se registró nada.', 503, request)
    }
    if (balances.schemaVersion !== 1 || !Array.isArray(balances.cuentas)) {
      return jsonError('No se pudo comprobar el saldo de la cartera. No se registró nada.', 503, request)
    }
    const wallet = balances.cuentas.find(row => row.cuentaCustodiaId === custodyId)
    const saldo = Number(wallet?.saldoNativo)
    if (!wallet || !Number.isFinite(saldo)) return jsonError('No se pudo comprobar el saldo de la cartera. No se registró nada.', 503, request)
    const shortfall = evaluarSaldoEgreso(saldo, movement.monto)
    if (shortfall) return insufficientFundsResponse(shortfall, movement.moneda, request)
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
    ...(motivoCoincidencia ? { motivo_coincidencia: motivoCoincidencia } : {}),
    idempotency_key: movement.idempotency_key,
    creado_por: context.operador.id,
    // Método de pago, cuenta de origen y tramos — solo si vienen definidos (columnas migración 226).
    ...(movement.metodo_pago ? { metodo_pago: movement.metodo_pago } : {}),
    ...(movement.cuenta_origen ? { cuenta_origen: movement.cuenta_origen } : {}),
    ...(custodyId ? { cuenta_custodia_id: custodyId } : {}),
    ...(movement.partes ? { partes: movement.partes } : {}),
  }

  // Una conversión desconocida permanece desconocida; no tomar una tasa de
  // otro día ni fabricar paridad. Nuevos registros en custodia exigen snapshot.
  if (custodyId && payload.moneda !== 'USD' && !(payload.tasa_usd_ves > 0)) {
    return jsonError('Indica la tasa USD/VES aplicada a este movimiento.', 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.text()
    const detailLower = detail.toLowerCase()
    if (detail.includes('FINANCIAL_DUPLICATE_EXACT')) {
      return json({ error: 'Ya existe un movimiento activo con la misma referencia e importe el mismo día, cuenta, tipo y moneda.', code: 'FINANCIAL_DUPLICATE_EXACT' }, 409, request)
    }
    if (detail.includes('FINANCIAL_DUPLICATE_SIMILAR')) {
      return json({ error: 'Hay un movimiento activo con el mismo concepto y referencia el mismo día. Escribe una justificación para registrar otra operación.', code: 'FINANCIAL_DUPLICATE_SIMILAR' }, 409, request)
    }
    const funds = parseInsufficientFundsDetail(detail)
    if (funds) return insufficientFundsResponse(funds, funds.moneda || movement.moneda, request)
    if (detailLower.includes('idempot') || detailLower.includes('unique')) {
      const retry = await readExistingByKey(env, context.operador.cuenta_id, movement.idempotency_key)
      if (retry.row) return json({ ok: true, idempotente: true, movimiento: movementResponse(retry.row) }, 200, request)
      return jsonError('Movimiento duplicado', 409, request)
    }

    // Nunca perder metadatos para conseguir una escritura aparente: ante
    // esquema incompatible se requiere actualizar la base, no quitar campos.
    if (/PGRST20[24]|42703|column.*does not exist/i.test(detail)) {
      return json({ error: 'Es necesario actualizar la base antes de registrar movimientos.', code: 'FINANCIAL_UPDATE_REQUIRED' }, 503, request)
    }
    return jsonError('No se pudo registrar el movimiento. Conserva la operación y comprueba su estado.', 500, request)
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
  const context = await operarContext(request, env)
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
  if (current.row.operacion_id) return jsonError('Este movimiento pertenece a una operación vinculada. Gestiona su reversión desde el origen.', 409, request)
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
  if (!response.ok) {
    const funds = parseInsufficientFundsDetail(await response.text())
    if (funds) return insufficientFundsResponse(funds, funds.moneda || current.row.moneda, request, 'Anularlo dejaría la cartera en negativo. ')
    return jsonError('No se pudo anular el movimiento', 409, request)
  }
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
  const context = await operarContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const current = await readMovement(env, context.operador.cuenta_id, id)
  if (current.error) return jsonError('No se pudo leer el movimiento', 500, request)
  if (!current.row) return jsonError('Movimiento no encontrado', 404, request)
  if (current.row.operacion_id) return jsonError('Este movimiento pertenece a una operación vinculada. Gestiona su reversión desde el origen.', 409, request)
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
  if (!response.ok) {
    const funds = parseInsufficientFundsDetail(await response.text())
    if (funds) return insufficientFundsResponse(funds, funds.moneda || current.row.moneda, request, 'Restaurarlo dejaría la cartera en negativo. ')
    return jsonError('No se pudo revertir la anulación', 409, request)
  }
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

// POST /api/finanzas/movimientos/actualizar
// Edición directa de categoría, concepto y referencia (operadores financieros: jefe y finanzas).
export async function handleActualizarFinanzasMovimiento(request, env) {
  const context = await operarContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  const categoria = String(parsed.body?.categoria || '').trim()
  const concepto = String(parsed.body?.concepto || '').trim()
  const referencia = parsed.body?.referencia != null ? String(parsed.body.referencia).trim() : null
  const observaciones = parsed.body?.observaciones != null ? String(parsed.body.observaciones).trim() : null

  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (!categoria || categoria.length > 80) return jsonError('Categoría requerida (máx. 80 caracteres)', 400, request)
  if (!concepto || concepto.length > 180) return jsonError('Concepto requerido (máx. 180 caracteres)', 400, request)
  if (referencia && referencia.length > 160) return jsonError('Referencia demasiado larga (máx. 160 caracteres)', 400, request)
  if (observaciones && observaciones.length > 1000) return jsonError('Observaciones demasiado largas (máx. 1000 caracteres)', 400, request)

  const current = await readMovement(env, context.operador.cuenta_id, id)
  if (current.error) return jsonError('No se pudo leer el movimiento', 500, request)
  if (!current.row) return jsonError('Movimiento no encontrado', 404, request)
  if (current.row.estado === 'anulado') {
    return jsonError('No se puede editar un movimiento anulado', 409, request)
  }

  const patchData = {
    categoria,
    concepto,
    ...(referencia !== null ? { referencia: referencia || null } : {}),
    ...(observaciones !== null ? { observaciones: observaciones || null } : {}),
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}&estado=eq.activo`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify(patchData),
    },
  )
  if (!response.ok) return jsonError('No se pudo actualizar el movimiento', 409, request)
  const [row] = await response.json()
  if (!row) return jsonError('Movimiento no encontrado o no modificable', 409, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'MOVIMIENTO_ACTUALIZADO',
    entidadTipo: 'finanzas_movimientos',
    entidadId: row.id,
    meta: { categoria, concepto, referencia },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, movimiento: movementResponse(row) }, 200, request)
}

// POST /api/finanzas/categorias/eliminar
// Baja LÓGICA (activo=false): la categoría deja de ofrecerse en nuevos
// movimientos pero el historial conserva su nombre y se puede restaurar.
// Las predeterminadas del sistema no se pueden eliminar (siempre aparecen).
// Handlers de categorías extraídos a finanzas.categorias.js (guardrail de líneas).
export {
  handleEliminarFinanzasCategoria,
  handleRestaurarFinanzasCategoria,
  handleGetFinanzasCategorias,
  handleCrearFinanzasCategoria,
} from './finanzas.categorias.js'

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

  // Regla de negocio: el rol finanzas opera el libro pero NUNCA ve acumulados.
  // El secreto se guarda en el servidor: el JSON ni siquiera incluye los KPIs.
  const puedeVerSaldos = capacidadesDe(context.operador).verSaldos
  if (!puedeVerSaldos) {
    return json({ resumen: null, corte: null, versionLibro: null, filtros: filters, ocultoPorRol: true }, 200, request)
  }

  try {
    const result = await callFinancialRpc(env, 'finanzas_resumen_consistente', {
      p_cuenta_id: context.operador.cuenta_id, p_desde: filters.desde, p_hasta: filters.hasta,
      p_moneda: filters.moneda, p_tipo: filters.tipo, p_categoria: filters.categoria,
      p_cartera: url.searchParams.get('cartera') || null,
    })
    if (!Array.isArray(result.rows)) return jsonError('No se pudo verificar el resumen financiero', 503, request)
    return json({ resumen: summarizeRows(result.rows), corte: result.corte, versionLibro: result.versionLibro, filtros: filters }, 200, request)
  } catch (error) { return financialErrorResponse(error, request) }
}

export {
  handlePreviewReconciliacionMovimientos,
  handleReasignarCuentaMovimientos,
} from './finanzas.conciliacion.js'
