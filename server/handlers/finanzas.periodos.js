import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { callFinancialRpc, financialErrorResponse, FinancialOperationError } from '../lib/financialOperations.js'
import { isValidUuid, json, jsonError } from '../lib/utils.js'
import { tenantGuard } from './nomina.shared.js'

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

const MONTH_RE = /^\d{4}-\d{2}-01$/
const KEY_RE = /^[A-Za-z0-9._:-]{16,128}$/

function monthValue(value) {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function context(request, env) {
  const result = await validateOperator(request, env)
  if (result.error) return result
  const denied = requireCapacidad(result.operador, 'gestionarUsuarios', request)
  if (denied) return { error: denied }
  const tenantError = tenantGuard(result.operador, request)
  return tenantError ? { error: tenantError } : result
}

function positiveRate(value) {
  const rate = Number(value)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

function explicitRates(payload) {
  return { usd: positiveRate(payload?.tasaUsdVes), usdt: positiveRate(payload?.tasaUsdtVes) }
}

// 4.3: si el cliente no manda tasas, el servidor toma la última valoración
// registrada en el libro (las tasas del día que ya congeló la operación diaria)
// y las respeta como override si llegan explícitas.
async function lastRecordedRates(env, accountId) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(accountId)}` +
      '&estado=eq.activo&order=creado_en.desc&select=moneda,tasa_ves,tasa_usd_ves&limit=50',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return { usd: null, usdt: null }
  const rows = await response.json().catch(() => null)
  if (!Array.isArray(rows)) return { usd: null, usdt: null }
  const usd = rows.map(row => positiveRate(row.tasa_usd_ves)).find(rate => rate != null) || null
  const usdt = rows.filter(row => row.moneda === 'USDT').map(row => positiveRate(row.tasa_ves)).find(rate => rate != null) || null
  return { usd, usdt }
}

async function resolveRates(env, payload, accountId) {
  const explicit = explicitRates(payload)
  if (explicit.usd != null && explicit.usdt != null) return explicit
  const recorded = await lastRecordedRates(env, accountId).catch(() => ({ usd: null, usdt: null }))
  return { usd: explicit.usd ?? recorded.usd, usdt: explicit.usdt ?? recorded.usdt }
}

// El servidor arma la lista de cuentas cuando el cliente no la manda (plan de
// simplificación §5): hereda el cierre anterior o arranca del saldo del libro.
async function buildOpeningRows(env, accountId, mesInicio) {
  const state = await callFinancialRpc(env, 'finanzas_periodo_mensual_estado', {
    p_cuenta_id: accountId, p_mes_inicio: mesInicio,
  })
  const previous = new Map((state.cierreAnterior || []).map(row => [row.cuentaCustodiaId, row.saldo]))
  return (state.cuentas || []).filter(row => row.activo).map(row => {
    const anterior = previous.get(row.cuentaCustodiaId)
    return anterior != null
      ? { cuentaCustodiaId: row.cuentaCustodiaId, metodo: 'cierre_anterior' }
      : { cuentaCustodiaId: row.cuentaCustodiaId, metodo: 'saldo_real', saldoReal: String(Number(row.saldoHistorico ?? 0)), motivo: null }
  })
}

function withRates(payload, rows, rates) {
  const tasaUsdVes = String(rates.usd)
  const tasaUsdtVes = String(rates.usdt)
  return {
    ...payload,
    tasaUsdVes,
    tasaUsdtVes,
    cuentas: rows.map(row => ({
      ...row,
      tasaUsdVes: String(positiveRate(row.tasaUsdVes) ?? rates.usd),
      tasaUsdtVes: String(positiveRate(row.tasaUsdtVes) ?? rates.usdt),
    })),
  }
}

export async function handleGetFinanzasPeriodoMensual(request, env) {
  const auth = await context(request, env)
  if (auth.error) return auth.error
  const url = new URL(request.url)
  const month = url.searchParams.get('mes') || `${new Date().toISOString().slice(0, 7)}-01`
  if (!monthValue(month)) return jsonError('Mes inválido; usa YYYY-MM-01.', 400, request)
  try {
    const result = await callFinancialRpc(env, 'finanzas_periodo_mensual_estado', {
      p_cuenta_id: auth.operador.cuenta_id, p_mes_inicio: month,
    })
    if (result.schemaVersion !== 1 || !Array.isArray(result.cuentas)) {
      throw new FinancialOperationError('La respuesta del período mensual no se pudo verificar.', 503, 'FINANCIAL_UPDATE_REQUIRED')
    }
    return json(result, 200, request)
  } catch (error) { return financialErrorResponse(error, request) }
}

export async function handleOperarFinanzasPeriodoMensual(request, env) {
  const auth = await context(request, env)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido.', 400, request) }
  const { accion, mesInicio, idempotencyKey } = body || {}
  let payload = body?.payload
  if (!['aperturar', 'cerrar', 'alta_cuenta'].includes(accion) || !monthValue(mesInicio)
    || typeof idempotencyKey !== 'string' || !KEY_RE.test(idempotencyKey)
    || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('Operación mensual inválida.', 400, request)
  }
  try {
    const rates = await resolveRates(env, payload, auth.operador.cuenta_id)
    if (rates.usd == null || rates.usdt == null) {
      return jsonError('Indica las tasas USD/VES y USDT/VES vigentes: el libro aún no tiene una valoración registrada.', 400, request)
    }
    if (accion === 'aperturar') {
      // Compatibilidad: si el cliente manda su lista de cuentas se valida igual;
      // si no, la arma el servidor con el cierre anterior o el saldo del libro.
      const rows = Array.isArray(payload.cuentas) && payload.cuentas.length > 0
        ? payload.cuentas
        : await buildOpeningRows(env, auth.operador.cuenta_id, mesInicio)
      if (!Array.isArray(rows) || rows.length === 0) {
        return jsonError('No hay cuentas activas para aperturar el mes.', 400, request)
      }
      payload = withRates(payload, rows, rates)
    } else if (accion === 'cerrar') {
      if (!Array.isArray(payload.cuentas) || payload.cuentas.length === 0) {
        return jsonError('Indica el saldo contado de cada cuenta para cerrar el mes.', 400, request)
      }
      payload = withRates(payload, payload.cuentas, rates)
    } else {
      if (!isValidUuid(payload.cuentaCustodiaId) || !Number.isFinite(Number(payload.saldoReal)) || Number(payload.saldoReal) < 0) {
        return jsonError('La apertura de la cuenta requiere saldo válido.', 400, request)
      }
      payload = { ...payload, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) }
    }
    const result = await callFinancialRpc(env, 'finanzas_periodo_mensual_operar', {
      p_cuenta_id: auth.operador.cuenta_id, p_operador_id: auth.operador.id,
      p_accion: accion, p_mes_inicio: mesInicio, p_clave: idempotencyKey,
      p_payload: payload, p_ip: auth.ip || null,
    })
    if (result.ok !== true) throw new FinancialOperationError('La operación mensual no quedó confirmada.', 503, 'OPERATION_RESULT_UNKNOWN')
    return json(result, 200, request)
  } catch (error) { return financialErrorResponse(error, request) }
}

export async function handleRegistrarCuentaEnPeriodoMensual(request, env) {
  const auth = await context(request, env)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido.', 400, request) }
  const { mesInicio, idempotencyKey } = body || {}
  let payload = body?.payload
  if (!monthValue(mesInicio) || typeof idempotencyKey !== 'string' || !KEY_RE.test(idempotencyKey)
    || !isValidUuid(payload?.cuentaCustodiaId) || !Number.isFinite(Number(payload?.saldoReal))
    || Number(payload.saldoReal) < 0) {
    return jsonError('Datos de apertura inicial inválidos.', 400, request)
  }
  try {
    const rates = await resolveRates(env, payload, auth.operador.cuenta_id)
    if (rates.usd == null || rates.usdt == null) {
      return jsonError('Indica las tasas USD/VES y USDT/VES vigentes: el libro aún no tiene una valoración registrada.', 400, request)
    }
    payload = { ...payload, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) }
    const state = await callFinancialRpc(env, 'finanzas_periodo_mensual_estado', {
      p_cuenta_id: auth.operador.cuenta_id, p_mes_inicio: mesInicio,
    })
    if (state.estado !== 'abierto') return json({ ok: true, aperturaMensual: false, periodoEstado: state.estado }, 200, request)
    const result = await callFinancialRpc(env, 'finanzas_periodo_mensual_operar', {
      p_cuenta_id: auth.operador.cuenta_id, p_operador_id: auth.operador.id,
      p_accion: 'alta_cuenta', p_mes_inicio: mesInicio, p_clave: idempotencyKey,
      p_payload: payload, p_ip: auth.ip || null,
    })
    if (result.ok !== true) throw new FinancialOperationError('La apertura mensual de la cuenta no quedó confirmada.', 503, 'OPERATION_RESULT_UNKNOWN')
    return json({ ...result, aperturaMensual: true }, 200, request)
  } catch (error) { return financialErrorResponse(error, request) }
}
