// server/lib/nominaHorarios.js
// Días laborables por empleado (tabla `nomina_horarios`, migración 215).
//
// La ficha del empleado guarda una fila por cada día que la persona trabaja, con
// su propia jornada (`semana_ciclo` NULL y `fecha_hasta` NULL = horario permanente).
// El domingo nunca es día laborable: el cálculo de nómina lo trata siempre como
// feriado, así que exigir registro ahí solo generaría ausencias falsas.
//
// Sin filas se conserva el horario histórico de la empresa (lunes a sábado), de
// modo que activar esta función no cambia la asistencia de nadie hasta que se
// configure su semana.

import { nominaTenantFilter } from './nominaTenant.js'

export const DIAS_LABORABLES_DEFAULT = Object.freeze([1, 2, 3, 4, 5, 6])
export const DIA_DOMINGO = 0
export const DIA_LABORABLE_MIN = 1
export const DIA_LABORABLE_MAX = 6

/** Día de la semana (0=domingo) de una fecha `YYYY-MM-DD`, sin depender del TZ del runtime. */
export function diaSemanaDeFecha(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const date = new Date(`${fecha}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.getUTCDay()
}

/**
 * Días laborables a partir de las filas permanentes del empleado.
 * Devuelve `{ dias, configurado }`: sin filas, el horario histórico Lun–Sáb.
 */
export function diasLaborablesResueltos(filasPropias = [], fecha = null) {
  const filas = (filasPropias || []).filter(fila => fila
    && (fila.semana_ciclo === null || fila.semana_ciclo === undefined)
    && (fila.fecha_hasta === null || fila.fecha_hasta === undefined)
    // Vigencia (F-9): un horario programado a futuro no se aplica todavía. Sin
    // fecha se resuelve la semana permanente completa (comportamiento anterior).
    && (!fecha || !fila.fecha_desde || String(fila.fecha_desde).slice(0, 10) <= fecha))
  if (!filas.length) return { dias: [...DIAS_LABORABLES_DEFAULT], configurado: false }
  const dias = [...new Set(filas
    .filter(fila => fila.trabaja !== false)
    .map(fila => Number(fila.dia_semana))
    .filter(dia => Number.isInteger(dia) && dia >= DIA_LABORABLE_MIN && dia <= DIA_LABORABLE_MAX))]
    .sort((a, b) => a - b)
  return { dias, configurado: true }
}

/** ¿Le toca trabajar ese día? Sin lista explícita se asume el horario histórico. */
export function trabajaEnFecha(dias, fecha) {
  const dow = diaSemanaDeFecha(fecha)
  if (dow === null) return true
  if (dow === DIA_DOMINGO) return false
  const lista = dias === undefined || dias === null ? DIAS_LABORABLES_DEFAULT : dias
  return lista.includes(dow)
}

/** Semana por defecto para la vista previa de la UI (mismo día → misma jornada). */
export function semanaPorDefecto({ horaInicio = '08:00', horaFin = '17:00', horasJornada = 8 } = {}) {
  return DIAS_LABORABLES_DEFAULT.map(dia => ({
    dia_semana: dia,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    horas_jornada: Number(horasJornada) || 8,
  }))
}

export const HORARIOS_POR_PAGINA = 500
// Techo duro de paginación: 20 × 500 = 10.000 filas (≈1.600 empleados con seis
// días cada uno). El guardarraíl de egress prohíbe pedir mil filas en una sola
// consulta, así que se pagina ordenado por empleado (offset estable). El techo delata datos
// anómalos: se avisa y se devuelve lo leído en vez de tumbar la asistencia.
export const HORARIOS_MAX_PAGINAS = 20

/**
 * Filas permanentes por empleado (`empleado_id → filas`).
 * `empleadoIds` acota la consulta cuando solo interesa un grupo (p. ej. la carga masiva).
 */
export async function fetchFilasHorarioPorEmpleado(env, headers, cuentaId, { empleadoIds = null, fecha = null } = {}) {
  const filtroEmpleados = empleadoIds?.length ? `&empleado_id=in.(${empleadoIds.join(',')})` : `&empleado_id=not.is.null`
  // `fecha` acota a los horarios ya vigentes ese día: uno programado a futuro no
  // debe resolver la semana de hoy (F-9).
  const filtroVigencia = fecha ? `&fecha_desde=lte.${fecha}` : ''
  const base = `${env.SUPABASE_URL}/rest/v1/nomina_horarios?semana_ciclo=is.null&fecha_hasta=is.null${filtroEmpleados}${filtroVigencia}${nominaTenantFilter(cuentaId)}&select=empleado_id,dia_semana,trabaja,fecha_desde&order=empleado_id.asc,dia_semana.asc&limit=${HORARIOS_POR_PAGINA}`
  const rows = []
  for (let pagina = 0; pagina < HORARIOS_MAX_PAGINAS; pagina += 1) {
    let response
    try {
      response = await fetch(`${base}&offset=${pagina * HORARIOS_POR_PAGINA}`, { headers })
    } catch (error) {
      console.warn('[nomina] No se pudieron leer los días laborables:', error?.message)
      return { ok: false, porEmpleado: new Map() }
    }
    if (!response.ok) return { ok: false, porEmpleado: new Map() }
    const lote = await response.json() ?? []
    rows.push(...lote)
    if (lote.length < HORARIOS_POR_PAGINA) break
    if (pagina === HORARIOS_MAX_PAGINAS - 1) {
      console.warn('[nomina] Días laborables truncados en el techo de paginación:', rows.length)
    }
  }
  const porEmpleado = new Map()
  for (const row of rows) {
    if (!row?.empleado_id) continue
    const filas = porEmpleado.get(row.empleado_id) || []
    filas.push(row)
    porEmpleado.set(row.empleado_id, filas)
  }
  return { ok: true, porEmpleado }
}

/** Mapa resuelto `empleado_id → { dias, configurado }` para pintar y validar la semana. */
export async function fetchDiasLaborablesPorEmpleado(env, headers, cuentaId, opciones = {}) {
  const { fecha = null, ...resto } = opciones
  const { ok, porEmpleado } = await fetchFilasHorarioPorEmpleado(env, headers, cuentaId, { ...resto, fecha })
  if (!ok) return { ok: false, porEmpleado: new Map() }
  const resuelto = new Map()
  for (const [empleadoId, filas] of porEmpleado) resuelto.set(empleadoId, diasLaborablesResueltos(filas, fecha))
  return { ok: true, porEmpleado: resuelto }
}

/** Días laborables resueltos de una persona: sin filas, el horario histórico. */
export async function fetchDiasLaborablesEmpleado(env, headers, cuentaId, empleadoId, fecha = null) {
  const { ok, porEmpleado } = await fetchDiasLaborablesPorEmpleado(env, headers, cuentaId, { empleadoIds: [empleadoId], fecha })
  if (!ok) return { ok: false, ...diasLaborablesResueltos([], fecha) }
  return { ok: true, ...(porEmpleado.get(empleadoId) || diasLaborablesResueltos([], fecha)) }
}

/** Empleados de la lista que no trabajan esa fecha. */
export function empleadosLibresEseDia(empleadoIds, porEmpleado, fecha) {
  return (empleadoIds || []).filter(empleadoId => {
    const resuelto = porEmpleado?.get(empleadoId)
    return !trabajaEnFecha(resuelto?.dias, fecha)
  })
}
