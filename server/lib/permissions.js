import { jsonError } from './utils.js'

export const ADMIN_ROLE = 'administracion'

export function isAdminOperator(operator) {
  return operator?.rol === ADMIN_ROLE
}

export function requireAdmin(operator, request) {
  return isAdminOperator(operator)
    ? null
    : jsonError('Acceso denegado: se requiere rol administración', 403, request)
}

export function assertAdminRole(role) {
  return role === ADMIN_ROLE
}
