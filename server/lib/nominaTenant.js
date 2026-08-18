import { isValidUuid, jsonError } from './utils.js'

/** Service-key queries must carry the caller tenant explicitly. */
export function requireNominaTenant(operador, request) {
  if (!operador?.cuenta_id || !isValidUuid(operador.cuenta_id)) {
    return jsonError('Cuenta no configurada para el operador', 403, request)
  }
  return null
}

export function nominaTenantFilter(cuentaId) {
  return `&cuenta_id=eq.${cuentaId}`
}
