// src/utils/resumenFichaEmpleado.js
// Números que muestra la tarjeta del empleado (pestaña Empleados), con las MISMAS
// reglas que la hoja semanal y el cálculo de la nómina:
//   · mensual = diario × divisor (30)
//   · semana  = diario × 7 (laborables + descanso, D-1)
//   · bono semanal fijo de $35 que sale de la semana; el sueldo semanal es el resto (nunca negativo)
//   · hora extra: el monto fijo de Configuración si existe; si no, tarifa × factor
import { esDescansoSinTrabajo, esFaltaJustificada } from '../../server/lib/nominaDescanso.js'
import { BONO_SEMANAL_USD } from '../../server/lib/nominaHoja.js'
import { trabajaEnFecha } from '../../server/lib/nominaHorarios.js'
import { esDiaPresentePresunto } from '../../server/lib/asistenciaExcepciones.js'

const r2 = n => Math.round(Number(n || 0) * 100) / 100
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_DIA = 24 * 60 * 60 * 1000

function rangoFechasHasta(desde, hasta) {
  if (!FECHA_RE.test(String(desde)) || !FECHA_RE.test(String(hasta)) || hasta < desde) return []
  const inicio = Date.parse(`${desde}T00:00:00Z`)
  const fin = Date.parse(`${hasta}T00:00:00Z`)
  const out = []
  for (let t = inicio, i = 0; t <= fin && i < 31; t += MS_DIA, i += 1) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export function resumenSalario({ salarioDia, horasJornada = 8, divisorMensual = 30, configNomina = null, bono = BONO_SEMANAL_USD }) {
  const dia = Math.max(0, Number(salarioDia) || 0)
  const semana = r2(dia * 7)
  const sueldoSemanal = r2(Math.min(semana, Math.max(0, semana - bono)))
  let horaExtra = null
  if (configNomina) {
    const fijo = Number(configNomina.nomina_monto_hora_extra_usd)
    if (Number.isFinite(fijo) && fijo > 0) {
      horaExtra = { monto: r2(fijo), fijo: true }
    } else {
      const factor = Math.max(1, Number(configNomina.nomina_factor_hora_extra) || 1.5)
      horaExtra = { monto: r2((dia / (Number(horasJornada) || 8)) * factor), fijo: false, factor }
    }
  }
  return {
    dia,
    mensual: r2(dia * (Number(divisorMensual) || 30)),
    semana,
    sueldoSemanal,
    bonoSemanal: r2(semana - sueldoSemanal),
    horaExtra,
  }
}

/**
 * Cómo va la semana en curso de cada persona trabajando por exclusión (Opción A):
 * cuenta días hábiles transcurridos hasta `hoy` como presentes por defecto
 * (desde `fecha_ingreso`, excluyendo feriados no laborables), descontando faltas
 * sin justificativo y sumando días de descanso/feriados trabajados.
 * Acepta un `Map` de días laborables (modo legado de pruebas) o `{ empleados, desde, hasta, hoy, feriados }`.
 */
export function avanceSemanaPorEmpleado(registros = [], diasOOpciones = new Map()) {
  const porEmpleado = new Map()
  if (diasOOpciones instanceof Map) {
    for (const fila of registros || []) {
      if (!fila?.empleado_id) continue
      const actual = porEmpleado.get(fila.empleado_id) || { trabajados: 0, descansoTrabajados: 0, faltas: 0 }
      if (fila.es_ausencia) {
        if (!esFaltaJustificada(fila)) actual.faltas += 1
      } else if (!esDescansoSinTrabajo(fila)) {
        const fecha = fila.fecha ? String(fila.fecha).slice(0, 10) : null
        const esDescanso = fila.es_domingo || fila.es_feriado || (fecha && !trabajaEnFecha(diasOOpciones.get(fila.empleado_id), fecha))
        if (esDescanso) actual.descansoTrabajados += 1
        else actual.trabajados += 1
      }
      porEmpleado.set(fila.empleado_id, actual)
    }
    return porEmpleado
  }

  const { empleados = [], desde, hasta, hoy, feriados = [] } = diasOOpciones || {}
  const tope = hoy && hoy < hasta ? hoy : hasta
  const fechas = rangoFechasHasta(desde, tope)
  const feriadosPorFecha = new Map((feriados || []).map(f => [String(f.fecha).slice(0, 10), f]))
  const registrosPorClave = new Map()
  for (const fila of registros || []) {
    if (fila?.empleado_id && fila?.fecha) {
      registrosPorClave.set(`${fila.empleado_id}|${String(fila.fecha).slice(0, 10)}`, fila)
    }
  }

  for (const emp of empleados) {
    if (!emp?.empleado_id) continue
    const actual = { trabajados: 0, descansoTrabajados: 0, faltas: 0 }
    for (const fecha of fechas) {
      const reg = registrosPorClave.get(`${emp.empleado_id}|${fecha}`) || null
      const feriado = feriadosPorFecha.get(fecha) || null
      if (reg) {
        if (reg.es_ausencia) {
          if (!esFaltaJustificada(reg)) actual.faltas += 1
          continue
        }
        if (esDescansoSinTrabajo(reg)) continue
        const esDescanso = Boolean(reg.es_domingo || (feriado ? feriado.laborable !== true : reg.es_feriado) || !trabajaEnFecha(emp.dias_laborables, fecha))
        if (esDescanso) actual.descansoTrabajados += 1
        else actual.trabajados += 1
      } else if (esDiaPresentePresunto({ empleado: emp, fecha, registro: null, feriado })) {
        actual.trabajados += 1
      }
    }
    porEmpleado.set(emp.empleado_id, actual)
  }
  return porEmpleado
}
