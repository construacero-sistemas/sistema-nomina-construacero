// server/handlers/finanzas.conciliacion.js
// Simulación de conciliación y re-asignación masiva de cuentas de custodia.
// Extraídos de finanzas.js para mantener el archivo bajo el guardrail de 600 líneas.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { callFinancialRpc, financialErrorResponse } from '../lib/financialOperations.js'
import { buildReconciliationPreview } from '../lib/reconciliation.js'
import { normalizeReportQuery, movementResponse } from '../lib/finanzasUtils.js'

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

function queryValue(value) {
  return encodeURIComponent(String(value))
}

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

async function readBody(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

// Re-asignación masiva: fija cuenta_origen (cuenta de custodia) en movimientos
// activos. La UI lo usa para clasificar los movimientos "sin cuenta asignada".
// Nunca toca movimientos anulados ni de otra cuenta_id.
export async function handlePreviewReconciliacionMovimientos(request, env) {
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
    const movements = []
    let offset = 0
    let version = url.searchParams.get('versionLibro') || null
    let total = null
    let continuar = true
    while (continuar) {
      const page = await callFinancialRpc(env, 'finanzas_movimientos_pagina', {
        p_cuenta_id: context.operador.cuenta_id,
        p_desde: filters.desde,
        p_hasta: filters.hasta,
        p_tipo: filters.tipo,
        p_categoria: filters.categoria,
        p_moneda: filters.moneda,
        p_cartera: url.searchParams.get('cartera') || null,
        p_anulados: false,
        p_limite: 100,
        p_offset: offset,
        p_version: version,
      })
      version = page.versionLibro || version
      total = page.paginacion?.total ?? total
      const batch = Array.isArray(page.movimientos) ? page.movimientos : []
      movements.push(...batch)
      const next = page.paginacion?.siguiente
      if (next == null || batch.length === 0 || movements.length >= 100000) continuar = false
      else offset = next
    }

    const accountsResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(context.operador.cuenta_id)}` +
        '&activo=eq.true&select=id,codigo,nombre,tipo,moneda,banco,numero_cuenta,subcuenta_id',
      { headers: serviceHeaders(env, 'return=minimal') },
    )
    if (!accountsResponse.ok) return jsonError('No se pudo cargar el catálogo de cuentas para simular la conciliación', 503, request)
    const accounts = await accountsResponse.json()
    const preview = buildReconciliationPreview(movements.map(movementResponse), accounts)
    return json({
      ok: true,
      modo: 'simulacion',
      filtros: filters,
      versionLibro: version,
      totalServidor: total,
      cuentasConsideradas: accounts.length,
      ...preview,
      aviso: 'Simulación de solo lectura. Ningún movimiento fue modificado.',
    }, 200, request)
  } catch (error) {
    return financialErrorResponse(error, request)
  }
}

export async function handleReasignarCuentaMovimientos(request, env) {
  const context = await operarContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const ids = parsed.body?.ids
  const custodyId = parsed.body?.cuentaCustodiaId
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(isValidUuid)) return jsonError('Selecciona entre 1 y 100 movimientos con identificadores v\u00e1lidos', 400, request)
  if (!isValidUuid(custodyId)) return jsonError('Selecciona una cuenta de custodia v\u00e1lida', 400, request)
  try {
    const result = await callFinancialRpc(env, 'finanzas_asignar_custodia', {
      p_cuenta_id: context.operador.cuenta_id, p_operador_id: context.operador.id,
      p_ids: [...new Set(ids.map(id => id.toLowerCase()))].sort(), p_custodia_id: custodyId.toLowerCase(), p_ip: context.ip || null,
    })
    if (result.ok !== true || result.cuentaCustodiaId !== custodyId.toLowerCase() || !Number.isInteger(result.actualizados)) return jsonError('No se pudo confirmar la asignaci\u00f3n. Actualiza el libro antes de repetirla.', 503, request)
    return json(result, 200, request)
  } catch (error) { return financialErrorResponse(error, request) }
}
