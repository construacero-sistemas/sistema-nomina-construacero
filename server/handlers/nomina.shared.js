// server/handlers/nomina.shared.js
import { jsonError } from '../lib/utils.js'
import { requireNominaTenant } from '../lib/nominaTenant.js'

// Un único rol operativo: administración tiene todos los permisos de Nómina.
// Los arrays conservan nombres de compatibilidad para que cada handler aplique
// una defensa local incluso cuando una prueba o un adaptador simula auth.
export const ADMIN_ROLE = 'administracion'
export const ROLES_VER = [ADMIN_ROLE]
export const ROLES_NOMINA = [ADMIN_ROLE]
export const ROLES_ADMIN = [ADMIN_ROLE]

export function tenantGuard(operador, request) {
  return requireNominaTenant(operador, request)
}

export function r4(value) {
  return Math.round(Number(value) * 10000) / 10000
}

export function fechaNominaValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function horaNominaValida(value) {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) &&
    Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59
}

export function montoNominaValido(value) {
  return value === undefined || value === null || value === '' ||
    (typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0)
}

export function ajusteNominaValido(value) {
  return value === undefined || value === null || value === '' ||
    (typeof value !== 'boolean' && Number.isFinite(Number(value)))
}

export function textoNominaValido(value, max = 500) {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length <= max)
}

export function booleanNominaValido(value) {
  return value === undefined || value === null || typeof value === 'boolean'
}

export function horasEntradaSalidaValidas(horaEntrada, horaSalida) {
  const tieneEntrada = horaEntrada !== undefined && horaEntrada !== null && horaEntrada !== ''
  const tieneSalida = horaSalida !== undefined && horaSalida !== null && horaSalida !== ''
  if (!tieneEntrada && !tieneSalida) return true
  return tieneEntrada && tieneSalida && horaNominaValida(horaEntrada) && horaNominaValida(horaSalida)
}

export function svcHeaders(env, prefer = 'return=representation') {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  }
}

export async function fetchConfigNomina(env, headers, cuentaId) {
  const filtro = cuentaId ? `&cuenta_id=${cuentaId}` : ''
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?limit=1${filtro}` +
      '&select=nomina_factor_hora_extra,nomina_factor_sabado,nomina_factor_feriado,' +
      'nomina_monto_hora_extra_usd,nomina_monto_sabado_usd,nomina_monto_feriado_usd,nomina_feriado_modo,nomina_tipo_periodo', { headers })
    if (res.ok) {
      const [cfg] = await res.json()
      if (cfg) return cfg
    }
  } catch (error) {
    console.warn('[nomina] Error leyendo config de nómina:', error?.message)
  }
  return {
    nomina_factor_hora_extra: 1.5, nomina_factor_sabado: 1.25, nomina_factor_feriado: 2.0,
    nomina_feriado_modo: 'factor',
  }
}
