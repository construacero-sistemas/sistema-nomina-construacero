// src/utils/diasLaborables.js
// Días laborables por empleado. Espejo de `server/lib/nominaHorarios.js`: el
// servidor resuelve la regla (y la hace cumplir en la carga masiva), y esta copia
// permite pintar «Libre» sin una consulta por vista. El listado de configuración
// (`/api/nomina/config-empleados`) ya entrega `dias_laborables` por persona.

import { fechaOperativaHoy } from './fechaOperativa.js'

export const DIAS_LABORABLES_DEFAULT = Object.freeze([1, 2, 3, 4, 5, 6])
export const DIA_DOMINGO = 0
export const DIA_LABORABLE_MIN = 1
export const DIA_LABORABLE_MAX = 6

export const NOMBRE_DIA = Object.freeze(['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'])
export const NOMBRE_DIA_CORTO = Object.freeze(['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'])

/** Día de la semana (0=domingo) de una fecha `YYYY-MM-DD`. */
export function diaSemanaDeFecha(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const date = new Date(`${fecha}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.getUTCDay()
}

/** Días laborables de una fila de configuración; sin dato, el horario histórico Lun–Sáb. */
export function diasLaborablesDeConfig(config) {
  const dias = config?.dias_laborables
  if (Array.isArray(dias)) return dias
  return [...DIAS_LABORABLES_DEFAULT]
}

/** ¿Le toca trabajar ese día? El domingo nunca es laborable (se paga como feriado). */
export function trabajaEnFecha(dias, fecha) {
  const dow = diaSemanaDeFecha(fecha)
  if (dow === null) return true
  if (dow === DIA_DOMINGO) return false
  const lista = dias === undefined || dias === null ? DIAS_LABORABLES_DEFAULT : dias
  return lista.includes(dow)
}

export function trabajaEseDia(config, fecha) {
  return trabajaEnFecha(diasLaborablesDeConfig(config), fecha)
}

export function diasLaborablesTexto(dias) {
  const lista = Array.isArray(dias) ? [...dias].sort((a, b) => a - b) : [...DIAS_LABORABLES_DEFAULT]
  if (!lista.length) return 'Ningún día'
  if (lista.join(',') === DIAS_LABORABLES_DEFAULT.join(',')) return 'Lun a Sáb'
  if (lista.join(',') === '1,2,3,4,5') return 'Lun a Vie'
  return lista.map(dia => NOMBRE_DIA_CORTO[dia]).join(' · ')
}

/**
 * Estado editable de la semana a partir de las filas de `nomina_horarios` de una
 * persona. Sin filas propias se parte del horario de su ficha para que el cambio
 * sea solo marcar o desmarcar días.
 *
 * `fecha` (hoy operativo por defecto) deja fuera un horario programado a futuro: si
 * aún no rige, la ficha muestra la semana que la persona tiene hoy y guardar no lo
 * borra (F-9, mismo criterio que `server/lib/nominaHorarios.js`).
 */
export function semanaEditable(horarios = [], { horaInicio = '08:00', horaFin = '17:00', horasJornada = 8, fecha = fechaOperativaHoy() } = {}) {
  const porDia = new Map()
  for (const horario of horarios || []) {
    if (!horario || horario.semana_ciclo != null || horario.fecha_hasta != null) continue
    const desde = horario.fecha_desde ? String(horario.fecha_desde).slice(0, 10) : null
    if (desde && fecha && desde > fecha) continue
    const dia = Number(horario.dia_semana)
    if (!Number.isInteger(dia) || dia < DIA_LABORABLE_MIN || dia > DIA_LABORABLE_MAX) continue
    if (horario.trabaja === false) continue
    porDia.set(dia, horario)
  }
  const inicioBase = String(horaInicio || '08:00').slice(0, 5)
  const finBase = String(horaFin || '17:00').slice(0, 5)
  const jornadaBase = Number(horasJornada) > 0 ? Number(horasJornada) : 8
  const hayHorario = porDia.size > 0
  return {
    hayHorario,
    dias: Array.from({ length: 6 }, (_, index) => {
      const dia = index + DIA_LABORABLE_MIN
      const fila = porDia.get(dia)
      const activo = hayHorario ? Boolean(fila) : true
      return {
        diaSemana: dia,
        activo,
        horaInicio: String(fila?.hora_inicio ?? inicioBase).slice(0, 5),
        horaFin: String(fila?.hora_fin ?? finBase).slice(0, 5),
        horasJornada: fila?.horas_jornada != null ? Number(fila.horas_jornada) : jornadaBase,
      }
    }),
  }
}

/** Payload de `POST /nomina/calendario/horarios/empleado`: solo los días marcados. */
export function diasActivosSemana(dias = []) {
  return dias
    .filter(dia => dia.activo)
    .map(dia => ({
      diaSemana: dia.diaSemana,
      horaInicio: String(dia.horaInicio).slice(0, 5),
      horaFin: String(dia.horaFin).slice(0, 5),
      horasJornada: Number(dia.horasJornada),
    }))
}
