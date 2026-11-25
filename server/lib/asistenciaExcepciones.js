// server/lib/asistenciaExcepciones.js
// Reglas compartidas (Worker y UI) de la asistencia por excepción:
// Todo trabajador en día laborable está presente por defecto según su horario;
// solo se registran horas extras, ausencias y días de descanso/feriados trabajados.
import { diaSemanaDeFecha, trabajaEnFecha } from './nominaHorarios.js'

export const HORAS_EXTRA_MIN = 0.5
export const HORAS_EXTRA_MAX = 16
export const ATAJOS_HORAS_EXTRA = Object.freeze([0.5, 1, 1.5, 2, 3, 4])

const round4 = n => Math.round(Number(n) * 10000) / 10000
const round2 = n => Math.round(Number(n) * 100) / 100

/**
 * Valida horas extras: acepta `0` (quitar extras) o número en `[0.5, 16]`
 * (acepta coma decimal, redondeado a 2 decimales). Devuelve `null` si es inválido.
 */
export function normalizarHorasExtra(valor) {
  if (valor === undefined || valor === null || typeof valor === 'boolean') return null
  const texto = typeof valor === 'string' ? valor.trim().replace(',', '.') : String(valor)
  if (!texto) return null
  const n = Number(texto)
  if (!Number.isFinite(n)) return null
  const redondeado = round2(n)
  if (redondeado === 0) return 0
  if (redondeado < HORAS_EXTRA_MIN || redondeado > HORAS_EXTRA_MAX) return null
  return redondeado
}

function minutosDeHHMM(hora) {
  const match = /^(\d{2}):(\d{2})/.exec(String(hora || ''))
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** Suma horas decimales (ej. 0.5, 1.5, 2) a un `HH:MM`, cruzando medianoche si hace falta. */
export function sumarHorasHHMM(horaHHMM, horas) {
  const base = minutosDeHHMM(horaHHMM)
  const delta = Math.round(Number(horas) * 60)
  if (base === null || !Number.isFinite(delta)) return null
  const total = ((base + delta) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Resuelve el horario habitual del empleado para una fecha `YYYY-MM-DD`:
 * 1) Horario específico de ese día en `nomina_horarios` (`horarios_por_dia[dow]`)
 * 2) Ficha del empleado (`hora_inicio`, `hora_fin`, `horas_jornada`)
 * 3) Estándar de empresa (`08:00` – `17:00`, `8h`)
 */
export function horarioEfectivoDelDia(empleado, fecha, horasDescansoDefault = 1) {
  const dow = diaSemanaDeFecha(fecha)
  const esSabado = dow === 6
  const diaCfg = dow !== null && empleado?.horarios_por_dia ? empleado.horarios_por_dia[dow] : null

  const horaInicio = String(diaCfg?.hora_inicio || empleado?.hora_inicio || '08:00').slice(0, 5)
  const horaFin = String(diaCfg?.hora_fin || empleado?.hora_fin || (esSabado && !diaCfg ? '13:00' : '17:00')).slice(0, 5)
  const jornadaBruta = Number(diaCfg?.horas_jornada ?? empleado?.horas_jornada)
  const horasJornada = Number.isFinite(jornadaBruta) && jornadaBruta > 0 ? round2(jornadaBruta) : 8

  const ent = minutosDeHHMM(horaInicio)
  let sal = minutosDeHHMM(horaFin)
  let horasDescanso
  if (ent !== null && sal !== null) {
    if (sal <= ent) sal += 24 * 60
    const permanencia = (sal - ent) / 60
    horasDescanso = Math.max(0, round2(permanencia - horasJornada))
  } else {
    horasDescanso = esSabado ? 0 : Math.max(0, Number(horasDescansoDefault) || 0)
  }

  return { horaInicio, horaFin, horasJornada, horasDescanso }
}

/**
 * Construye los campos derivados de una fila de `registro_asistencia` para un día
 * trabajado con horario del empleado + horas extras opcionales.
 */
export function construirRegistroExcepcion({ fecha, horario, horasExtra = 0, esFeriado = false }) {
  const dow = diaSemanaDeFecha(fecha)
  const esSabado = dow === 6
  const esDomingo = dow === 0
  const extra = Math.max(0, round4(Number(horasExtra) || 0))
  const normales = Math.max(0, round4(Number(horario?.horasJornada) || 8))
  const horaEntrada = horario?.horaInicio || '08:00'
  const horaBaseFin = horario?.horaFin || '17:00'
  const horaSalida = extra > 0 ? (sumarHorasHHMM(horaBaseFin, extra) || horaBaseFin) : horaBaseFin

  return {
    hora_entrada: horaEntrada,
    hora_salida: horaSalida,
    horas_trabajadas: round4(normales + extra),
    horas_normales: normales,
    horas_extra: extra,
    horas_descanso: round4(Math.max(0, Number(horario?.horasDescanso) || 0)),
    es_sabado: esSabado,
    es_domingo: esDomingo,
    es_feriado: Boolean(esFeriado || esDomingo),
    es_ausencia: false,
    ausencia_justificada: false,
    estado_marcaje: 'manual',
  }
}

/**
 * ¿Un día sin fila en `registro_asistencia` cuenta como Presente por defecto?
 * (Opción A: días hábiles del empleado desde `fecha_ingreso`, excluyendo feriados no laborables).
 */
export function esDiaPresentePresunto({ empleado, fecha, registro = null, feriado = null }) {
  if (registro) return false
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return false
  const ingreso = empleado?.fecha_ingreso ? String(empleado.fecha_ingreso).slice(0, 10) : null
  if (ingreso && fecha < ingreso) return false
  if (!trabajaEnFecha(empleado?.dias_laborables, fecha)) return false
  if (feriado && feriado.laborable === false) return false
  return true
}
