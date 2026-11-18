// src/utils/resumenFichaEmpleado.js
// Números que muestra la tarjeta del empleado (pestaña Empleados), con las MISMAS
// reglas que la hoja semanal y el cálculo de la nómina:
//   · mensual = diario × divisor (30)
//   · semana  = diario × 7 (laborables + descanso, D-1)
//   · sueldo semanal primero hasta (semana − bono); el bono es el resto, hasta $35 (D-3)
//   · hora extra: el monto fijo de Configuración si existe; si no, tarifa × factor
import { esDescansoSinTrabajo } from '../../server/lib/nominaDescanso.js'
import { BONO_SEMANAL_USD } from '../../server/lib/nominaHoja.js'

const r2 = n => Math.round(Number(n || 0) * 100) / 100

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
 * Cómo va la semana en curso de cada persona, desde el marcaje: días trabajados
 * (incluye la jornada abierta de hoy) y faltas registradas.
 * @returns {Map<string, { trabajados: number, faltas: number }>}
 */
export function avanceSemanaPorEmpleado(registros = []) {
  const porEmpleado = new Map()
  for (const fila of registros || []) {
    if (!fila?.empleado_id) continue
    const actual = porEmpleado.get(fila.empleado_id) || { trabajados: 0, faltas: 0 }
    if (fila.es_ausencia) actual.faltas += 1
    else if (!esDescansoSinTrabajo(fila)) actual.trabajados += 1
    porEmpleado.set(fila.empleado_id, actual)
  }
  return porEmpleado
}
