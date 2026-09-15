import { validateOperator } from '../lib/auth.js'
import { json, jsonError } from '../lib/utils.js'
import { ROLES_ADMIN, tenantGuard } from './nomina.shared.js'
import {
  callFinancialRpc,
  executeFinancialOperation,
  financialErrorResponse,
  FinancialOperationError,
  normalizeFinancialOperation,
  operationKey,
  OPERATION_TYPES,
} from '../lib/financialOperations.js'

export async function handleFinancialMutation(request, env, tipo) {
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { operador, ip } = validation
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado: se requiere permiso de administración', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  try {
    const operation = normalizeFinancialOperation(tipo, body)
    return json(await executeFinancialOperation(env, operador, operation, ip), 200, request)
  } catch (error) {
    return financialErrorResponse(error, request)
  }
}

export function handleCrearTransferencia(request, env) {
  return handleFinancialMutation(request, env, 'traspaso')
}

export async function handleGetSaldos(request, env) {
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { operador } = validation
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado: se requiere permiso de administración', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  try {
    // Ledger aggregation is deliberately independent from history filters and pages.
    const balances = await callFinancialRpc(env, 'finanzas_saldos', { p_cuenta_id: operador.cuenta_id })
    if (balances.schemaVersion !== 1 || !Array.isArray(balances.cuentas) || !Array.isArray(balances.noAsignados)) {
      throw new FinancialOperationError('Es necesario actualizar el contrato de saldos de la base.', 503, 'FINANCIAL_UPDATE_REQUIRED')
    }
    return json(balances, 200, request)
  } catch (error) {
    return financialErrorResponse(error, request)
  }
}

export async function handleGetOperacionEstado(request, env) {
  const validation = await validateOperator(request, env)
  if (validation.error) return validation.error
  const { operador } = validation
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado: se requiere permiso de administración', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  try {
    const query = new URL(request.url).searchParams
    const tipo = query.get('tipo')
    if (!OPERATION_TYPES.includes(tipo)) throw new FinancialOperationError('Invalid operation type')
    const clave = operationKey({ operationId: query.get('operationId'), idempotencyKey: query.get('idempotencyKey') })
    return json(await callFinancialRpc(env, 'finanzas_operacion_estado', {
      p_cuenta_id: operador.cuenta_id, p_tipo: tipo, p_clave: clave,
    }), 200, request)
  } catch (error) {
    return financialErrorResponse(error, request)
  }
}
