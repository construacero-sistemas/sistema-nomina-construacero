// server/lib/nominaHoja.js
// «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): la vista de la planilla Excel de la
// contadora, armada con los recibos que YA calculó el motor. No recalcula la nómina:
// reparte cada recibo en las columnas de la planilla, de forma que
//   sueldo semanal + bono semanal + total extras + valor descanso trabajado + otros pagos
//   = total a cobrar (bruto del recibo)
// en cada fila. Si el motor cambia, la hoja lo refleja sola.
import { esJornadaAbierta } from './nominaUtils.js'
import { esDescansoSinTrabajo } from './nominaDescanso.js'
import { trabajaEnFecha } from './nominaHorarios.js'

import { REGLAS_LEY_DEFAULT } from './nominaReglasLey.js'

/** Bono semanal por defecto ($35). El vigente se edita en Configuración (migración 268). */
export const BONO_SEMANAL_USD = REGLAS_LEY_DEFAULT.bonoSemanalUsd

const r2 = n => Math.round(Number(n || 0) * 100) / 100
const num = n => (Number.isFinite(Number(n)) ? Number(n) : 0)
const MS_DIA = 24 * 60 * 60 * 1000

/** Semanas del período (bloques de 7 días, mínimo 1): una quincena lleva dos bonos. */
export function semanasDelPeriodo(desde, hasta) {
  const inicio = Date.parse(`${String(desde).slice(0, 10)}T00:00:00Z`)
  const fin = Date.parse(`${String(hasta).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio) return 1
  return Math.max(1, Math.ceil((Math.round((fin - inicio) / MS_DIA) + 1) / 7))
}

/**
 * Reparto de la semana de un recibo entre sueldo y bono (regla del usuario,
 * 19/11/2026): la semana son los días laborables trabajados más los días pagados
 * sin trabajar (descansos, feriados y faltas justificadas). El bono sale de ahí,
 * nunca de las horas extra ni del descanso trabajado, y no se suma: el sueldo es
 * lo que queda. Si la semana no alcanza, el bono es la semana y el sueldo 0.
 */
export function repartoSemana({ linea, diasDescansoTrabajados = 0, bonoSemanal = BONO_SEMANAL_USD, semanas = 1 }) {
  const sueldoDia = num(linea?.salario_dia_usd_snap)
  const diasTrabajados = Math.max(0, num(linea?.dias_trabajados) - diasDescansoTrabajados)
  const semana = r2((diasTrabajados + num(linea?.dias_descanso)) * sueldoDia)
  const bonoTope = r2(Math.max(0, num(bonoSemanal)) * Math.max(1, semanas))
  const bono = semana > 0 ? r2(Math.min(bonoTope, semana)) : 0
  return { diasTrabajados, semana, bono, sueldo: r2(semana - bono) }
}

/** Cuántos días de descanso o feriado trabajó cada persona (mapa empleado → días). */
export function contarDescansosTrabajados(asistencias = [], diasPorEmpleado = new Map()) {
  const conteo = new Map()
  for (const fila of asistencias) {
    if (esDescansoTrabajado(fila, diasPorEmpleado.get(fila.empleado_id))) {
      conteo.set(fila.empleado_id, (conteo.get(fila.empleado_id) || 0) + 1)
    }
  }
  return conteo
}

/**
 * ¿Es un día de descanso o feriado que la persona SÍ trabajó? Misma regla que el
 * motor (`esDiaDeDescanso` en calcularLineaNomina): domingo, feriado o un día fuera
 * de su semana laboral, con trabajo real (ni ausencia, ni jornada abierta, ni fila vacía).
 */
export function esDescansoTrabajado(fila, diasLaborables) {
  if (!fila || fila.es_ausencia || esJornadaAbierta(fila) || esDescansoSinTrabajo(fila)) return false
  const fecha = fila.fecha ? String(fila.fecha).slice(0, 10) : null
  return Boolean(fila.es_domingo || fila.es_feriado || (fecha && !trabajaEnFecha(diasLaborables, fecha)))
}

/**
 * @param {object} p
 * @param {object[]} p.lineas          recibos del período (`nomina_lineas` con `empleado.nombre`)
 * @param {object[]} p.asistencias     filas de `registro_asistencia` del período
 * @param {Map<string, number[]>} p.diasPorEmpleado  semana laboral de cada persona
 * @param {number} [p.divisor=30]      divisor del sueldo mensual (art. 113)
 * @param {number} [p.bonoSemanal]     bono semanal vigente (para recibos sin bono guardado)
 * @param {number} [p.semanas=1]       semanas del período (el bono se aplica por semana)
 */
export function armarHojaSemanal({ lineas = [], asistencias = [], diasPorEmpleado = new Map(), divisor = 30, bonoSemanal = BONO_SEMANAL_USD, semanas = 1 }) {
  const descansosTrabajados = contarDescansosTrabajados(asistencias, diasPorEmpleado)

  const filas = lineas.map(linea => {
    const sueldoDia = num(linea.salario_dia_usd_snap)
    const diasDescansoTrabajados = descansosTrabajados.get(linea.empleado_id) || 0
    const diasDescansoPagados = num(linea.dias_descanso)
    // D-1: la semana son los días laborables trabajados más los días pagados sin trabajar.
    const reparto = repartoSemana({ linea, diasDescansoTrabajados, bonoSemanal, semanas })
    const { diasTrabajados, semana } = reparto
    // Desglose informativo de la semana (usuario, 18/11/2026): con $240 al mes y
    // 5 días trabajados, «5 días = $40» y «2 días de descanso = $16». El descanso
    // se saca por diferencia para que ambos sumen exactamente la semana.
    const valorDiasTrabajados = r2(diasTrabajados * sueldoDia)
    const valorDescansoPagado = r2(semana - valorDiasTrabajados)
    // Bono semanal (regla del usuario, 19/11/2026): sale de la semana y no se suma.
    // El recibo guarda el bono que le tocó al calcular el período (migración 268);
    // los recibos anteriores lo calculan con el bono vigente × semanas del período.
    const bonoGuardado = linea.bono_semanal_usd != null && Number.isFinite(Number(linea.bono_semanal_usd))
    const bono = bonoGuardado ? r2(Math.min(num(linea.bono_semanal_usd), semana)) : reparto.bono
    const totalExtras = r2(linea.monto_extra_usd)
    const otrosPagos = r2(num(linea.bonos_usd) + num(linea.comisiones_pos_usd))
    const totalACobrar = r2(linea.total_bruto_usd)
    // Lo que paga el descanso trabajado es el resto del bruto: el día adicional más
    // recargos o montos fijos. Por construcción la fila cuadra con el recibo.
    const valorDescansoTrabajado = r2(totalACobrar - semana - totalExtras - otrosPagos)
    return {
      lineaId: linea.id,
      empleadoId: linea.empleado_id,
      nombre: linea.empleado?.nombre || 'Sin nombre',
      sueldoMensual: r2(sueldoDia * divisor),
      diasTrabajados,
      valorDiasTrabajados,
      diasDescansoPagados,
      valorDescansoPagado,
      semana,
      sueldoSemanal: r2(semana - bono),
      bonoSemanal: bono,
      horasExtra: num(linea.horas_extra),
      totalExtras,
      diasDescansoTrabajados,
      valorDescansoTrabajado,
      otrosPagos,
      totalACobrar,
      descuentos: r2(linea.deducciones_usd),
      neto: r2(linea.total_neto_usd),
      pagado: Boolean(linea.pagado),
      tasaPago: num(linea.tasa_pago_usd_ves) || null,
      totalPagadoBs: linea.total_pagado_bs != null ? num(linea.total_pagado_bs) : null,
    }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))

  const sumar = campo => r2(filas.reduce((total, fila) => total + fila[campo], 0))
  const totales = {
    empleados: filas.length,
    horasExtra: sumar('horasExtra'),
    diasDescansoTrabajados: sumar('diasDescansoTrabajados'),
    ...Object.fromEntries(['valorDiasTrabajados', 'valorDescansoPagado', 'sueldoSemanal', 'bonoSemanal', 'totalExtras', 'valorDescansoTrabajado', 'otrosPagos', 'totalACobrar', 'descuentos', 'neto']
      .map(campo => [campo, sumar(campo)])),
  }
  return { filas, totales }
}
