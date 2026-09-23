import { isValidUuid, json } from './utils.js'
import { tieneCapacidad } from './permissions.js'

export const OPERATION_TYPES = ['pagar_nomina', 'revertir_nomina', 'traspaso']

// Cada operación atómica pertenece a un módulo, así que exige su capacidad de
// la matriz única: los pagos de nómina requieren administrar nómina y los
// traspasos requieren operar finanzas. El rol finanzas NUNCA paga nómina y el
// rol nomina NUNCA hace traspasos, aunque ambos operen el libro.
const CAPACIDAD_POR_TIPO = Object.freeze({
  pagar_nomina: 'administrarNomina',
  revertir_nomina: 'administrarNomina',
  traspaso: 'operarFinanzas',
})
export class FinancialOperationError extends Error {
  constructor(message, status = 400, code = 'INVALID_OPERATION') {
    super(message)
    this.status = status
    this.code = code
  }
}
function text(value, field, max, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new FinancialOperationError(`${field}: valor inválido`)
  }
  return value.trim() || null
}
function uuid(value, field) {
  if (!isValidUuid(value)) throw new FinancialOperationError(`${field}: se requiere un UUID válido`)
  return value.toLowerCase()
}
// Contrato decimal: transporte en strings, redondeo entero, sin aritmética binaria.
export function normalizeFinancialDecimal(value, field, scale = 8, max = 1000000) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new FinancialOperationError(`${field}: debe ser un decimal positivo`)
  }
  const input = String(value).trim().replace(',', '.')
  if (input.length > 80 || !/^\d+(\.\d+)?$/.test(input)) throw new FinancialOperationError(`${field}: debe ser un decimal positivo`)
  const [whole, fraction = ''] = input.split('.')
  const factor = 10n ** BigInt(scale)
  let scaled = BigInt(whole) * factor + BigInt(fraction.slice(0, scale).padEnd(scale, '0'))
  if (fraction.length > scale && fraction[scale] >= '5') scaled += 1n
  if (scaled <= 0n || scaled > BigInt(max) * factor) throw new FinancialOperationError(`${field}: fuera del rango permitido`)
  const decimals = String(scaled % factor).padStart(scale, '0').replace(/0+$/, '')
  return `${scaled / factor}${decimals ? `.${decimals}` : ''}`
}
export function operationKey(body = {}) {
  if (body.operationId != null) {
    const key = uuid(body.operationId, 'operationId')
    if (body.idempotencyKey != null && body.idempotencyKey !== key) throw new FinancialOperationError('Usa una sola clave estable para la operación')
    return key
  }
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(body.idempotencyKey)) {
    throw new FinancialOperationError('Se requiere una clave estable operationId o idempotencyKey', 400, 'OPERATION_KEY_REQUIRED')
  }
  return body.idempotencyKey
}
export function normalizeFinancialOperation(tipo, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FinancialOperationError('Body inválido')
  if (!OPERATION_TYPES.includes(tipo)) throw new FinancialOperationError('Tipo de operación inválido')
  const clave = operationKey(body)
  let payload
  if (tipo === 'pagar_nomina') {
    if (!Array.isArray(body.lineaIds) || !body.lineaIds.length || body.lineaIds.length > 500) {
      throw new FinancialOperationError('Selecciona entre 1 y 500 recibos')
    }
    const lineaIds = [...new Set(body.lineaIds.map(id => uuid(id, 'lineaIds')))].sort()
    const fuenteTasa = text(body.fuenteTasa, 'fuenteTasa', 10, true)
    if (!['BCV', 'EURO', 'USDT', 'MANUAL'].includes(fuenteTasa)) throw new FinancialOperationError('Fuente de tasa inválida')
    payload = {
      lineaIds,
      referencia: text(body.referencia, 'referencia', 160),
      tasaBcv: normalizeFinancialDecimal(body.tasaBcv, 'tasaBcv'),
      tasaUsdVes: body.tasaUsdVes == null ? null : normalizeFinancialDecimal(body.tasaUsdVes, 'tasaUsdVes'),
      fuenteTasa,
      observacionTasa: text(body.observacionTasa, 'observacionTasa', 1000, fuenteTasa === 'MANUAL'),
      metodoPago: text(body.metodoPago, 'metodoPago', 60, true),
      cuentaCustodiaId: uuid(body.cuentaCustodiaId, 'cuentaCustodiaId'),
    }
  } else if (tipo === 'revertir_nomina') {
    payload = { lineaId: uuid(body.lineaId, 'lineaId'), motivo: text(body.motivo, 'motivo', 300, true) }
  } else {
    const fecha = text(body.fecha, 'fecha', 10, true)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) || new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) !== fecha) {
      throw new FinancialOperationError('Fecha de traspaso inválida')
    }
    payload = {
      origenCuentaId: uuid(body.origenCuentaId, 'origenCuentaId'),
      destinoCuentaId: uuid(body.destinoCuentaId, 'destinoCuentaId'),
      montoOrigen: normalizeFinancialDecimal(body.montoOrigen, 'montoOrigen', 6, 1000000000),
      tasaCambio: normalizeFinancialDecimal(body.tasaCambio, 'tasaCambio'),
      tasaUsdVes: normalizeFinancialDecimal(body.tasaUsdVes, 'tasaUsdVes'),
      tasaUsdtVes: body.tasaUsdtVes == null ? null : normalizeFinancialDecimal(body.tasaUsdtVes, 'tasaUsdtVes'),
      referencia: text(body.referencia, 'referencia', 160), fecha,
      observaciones: text(body.observaciones, 'observaciones', 1000, true),
    }
    if (payload.origenCuentaId === payload.destinoCuentaId) throw new FinancialOperationError('Las cuentas de origen y destino deben ser diferentes')
  }
  return { tipo, clave, payload }
}
export async function callFinancialRpc(env, rpc, params) {
  let response, data
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    data = await response.json()
  } catch {
    throw new FinancialOperationError('No se confirmó el resultado. Conserva la misma clave y comprueba el estado de la operación.', 503, 'OPERATION_RESULT_UNKNOWN')
  } finally { clearTimeout(timer) }
  if (!response.ok) {
    if (['PGRST202', 'PGRST204', '42883', '42P01', '42703'].includes(data?.code)) {
      throw new FinancialOperationError('Es necesario actualizar la base antes de usar esta función financiera.', 503, 'FINANCIAL_UPDATE_REQUIRED')
    }
    const messages = {
      PT400: [400, 'Operación inválida. Revisa cuentas, importes, tasas y estado de los recibos.'],
      PT403: [403, 'Acceso denegado: el operador no tiene permiso en esta cuenta.'],
      PT404: [404, 'No se encontró algún recibo o cuenta de custodia en esta cuenta.'],
      PT409: [409, 'El estado o la clave de la operación cambió. Actualiza y conserva la clave original al reintentar.'],
      PT422: [422, 'Hay partidas pendientes de conciliación. No se puede continuar esta operación.'],
      PT402: [409, 'Fondos confirmados insuficientes en la cuenta de origen.'],
    }
    const known = Object.hasOwn(messages, data?.code)
    const [status, message] = known ? messages[data.code] : [503, 'No se confirmó la operación. Conserva la clave y consulta su estado.']
    throw new FinancialOperationError(message, status, known ? data.code : 'OPERATION_RESULT_UNKNOWN')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FinancialOperationError('Respuesta financiera no verificable.', 503, 'OPERATION_RESULT_UNKNOWN')
  return data
}
export async function executeFinancialOperation(env, operador, operation, ip = null) {
  const capacidad = CAPACIDAD_POR_TIPO[operation?.tipo]
  if (!isValidUuid(operador?.cuenta_id) || !isValidUuid(operador?.id) || !capacidad || !tieneCapacidad(operador, capacidad)) {
    throw new FinancialOperationError('Se requiere una cuenta y un operador con permiso para esta operación.', 403, 'OPERATOR_REQUIRED')
  }
  const result = await callFinancialRpc(env, 'finanzas_operar', {
    p_cuenta_id: operador.cuenta_id, p_operador_id: operador.id,
    p_tipo: operation.tipo, p_clave: operation.clave,
    p_payload: { ...operation.payload, zonaHoraria: env.NOMINA_TIMEZONE || 'America/Caracas' }, p_ip: ip || null,
  })
  if (result.ok !== true || result.estado !== 'confirmada' || !isValidUuid(result.operationId) || result.idempotencyKey !== operation.clave || result.tipo !== operation.tipo || !result.resultado) {
    throw new FinancialOperationError('No se confirmó el resultado. Conserva la misma clave.', 503, 'OPERATION_RESULT_UNKNOWN')
  }
  return result
}
export function financialErrorResponse(error, request) {
  if (!(error instanceof FinancialOperationError)) throw error
  return json({ error: error.message, code: error.code }, error.status, request)
}
