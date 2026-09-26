// server/handlers/nomina.shared.js
import { jsonError } from '../lib/utils.js'
import { requireNominaTenant } from '../lib/nominaTenant.js'
import { rolesConCapacidad } from '../lib/permissions.js'

// Roles con acceso a Nómina (matriz de permissions.js): nomina y los totales
// (jefe/administracion/desarrollador). El rol finanzas NO ve nómina.
// Los arrays derivan de la matriz única: aquí nunca se escribe una lista de roles.
export const ROLES_VER = rolesConCapacidad('verNomina')
export const ROLES_NOMINA = ROLES_VER
export const ROLES_ADMIN = rolesConCapacidad('gestionarUsuarios')

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

// Nota: no existe un validador «ambas horas opcionales». Antes `horasEntradaSalidaValidas`
// aceptaba entrada y salida vacías y el registro resultante se liquidaba como día
// completo con 0 h (hallazgo F-1 del plan de flujo de nómina). El contrato vigente vive
// en los handlers: un registro de horas exige `horaNominaValida` en entrada Y salida;
// la ausencia es la única fila válida sin horas.

// ── Zona horaria operativa ─────────────────────────────────────────────────────
// El marcaje, la ausencia y los períodos se fechan en la zona de la empresa, no en
// la del runtime (Cloudflare/Vercel corren en UTC). Única fuente del nombre de zona.
export function zonaNomina(env) {
  return env?.NOMINA_TIMEZONE || 'America/Caracas'
}

/** Fecha `YYYY-MM-DD` de hoy en la zona operativa (acepta `NOMINA_NOW` en pruebas). */
export function fechaOperativaNomina(env) {
  const ahora = env?.NOMINA_NOW ? new Date(env.NOMINA_NOW) : new Date()
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaNomina(env), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora)
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]))
  return `${valores.year}-${valores.month}-${valores.day}`
}

export function svcHeaders(env, prefer = 'return=representation') {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  }
}

// Lee configuración de empleados incluyendo `controla_asistencia`, la bandera que
// llega con la migración 246. Mientras esa migración no esté aplicada PostgREST
// responde 42703 («column does not exist») y el flujo de asistencia no debe caerse
// por eso: se reintenta sin la columna y todos se comportan como antes (controlan
// asistencia). Una vez aplicada, la bandera se respeta en todos los llamadores.
export async function fetchConfigsConControl(env, headers, { filtros = '', select = 'id', orden = '', limit = 1 } = {}) {
  const url = campos => `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?${filtros}&select=${campos}${orden ? `&order=${orden}` : ''}&limit=${limit}`
  let response = await fetch(url(`${select},controla_asistencia`), { headers })
  let controlDisponible = true
  if (response.status === 400) {
    const detalle = await response.text().catch(() => '')
    if (detalle.includes('controla_asistencia')) {
      controlDisponible = false
      response = await fetch(url(select), { headers })
    }
  }
  if (!response.ok) return { ok: false, rows: [] }
  const rows = await response.json()
  return {
    ok: true,
    rows: (rows ?? []).map(row => ({
      ...row,
      controla_asistencia: controlDisponible ? row.controla_asistencia !== false : true,
    })),
  }
}

// Cuerpo de un registro de asistencia manual (horario previsto o ausencia).
// Vive aquí porque lo escriben tanto el registro individual como el marcaje de
// ausencia del panel de reloj real, y ambos deben guardar la misma forma.
export function construirPayloadAsistenciaManual({ empleadoId, fecha, horaEntrada, horaSalida, esAusencia, esFeriado, nota, descanso, operador, calculation }) {
  const { horas_descanso: _horasDescanso, ...camposCalculados } = calculation
  return {
    empleado_id: empleadoId,
    fecha,
    hora_entrada: esAusencia ? null : horaEntrada || null,
    hora_salida: esAusencia ? null : horaSalida || null,
    ...camposCalculados,
    horas_descanso: descanso,
    estado_marcaje: 'manual',
    es_feriado: !!esFeriado,
    es_ausencia: !!esAusencia,
    nota: nota || null,
    registrado_por: operador.id,
    cuenta_id: operador.cuenta_id,
  }
}

export async function fetchConfigNomina(env, headers, cuentaId) {
  const filtro = cuentaId ? `&cuenta_id=${cuentaId}` : ''
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?limit=1${filtro}` +
      '&select=nomina_factor_hora_extra,nomina_factor_sabado,nomina_factor_feriado,' +
      'nomina_monto_hora_extra_usd,nomina_monto_sabado_usd,nomina_monto_feriado_usd,nomina_feriado_modo,nomina_tipo_periodo,' +
      'nomina_horas_descanso,nomina_horas_jornada,nomina_hora_inicio,nomina_hora_fin', { headers })
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
    nomina_horas_descanso: 1.0,
    nomina_horas_jornada: 8.0,
  }
}
