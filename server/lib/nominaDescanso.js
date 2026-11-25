// server/lib/nominaDescanso.js
// Descanso semanal y feriados remunerados (LOTTT, art. 119).
//
//   «El trabajador o trabajadora tiene derecho a que se le pague el salario
//   correspondiente a los días feriados o de descanso cuando haya prestado
//   servicio durante los días hábiles de la jornada semanal de trabajo. […]
//   no perderá ese derecho si durante la jornada semanal […] faltare un día.»
//
// Regla aplicada, por cada bloque de 7 días contados desde el inicio del período:
//   - Son días de descanso los que la persona no trabaja según su semana
//     («Días que trabaja»; el domingo nunca es laborable) y los feriados no
//     laborables registrados en el calendario.
//   - Cada uno se paga con el salario diario aunque no se haya trabajado.
//   - Regla del usuario (19/11/2026): una falta sin justificativo descuenta SOLO
//     el día faltado; el descanso de la semana se paga completo. Por eso
//     `faltasPierde` (migración 263) vale 0 por defecto (migración 267). Si se
//     configura otro número, desde esa falta cada día hábil faltado descuenta
//     además un día de descanso pagado del bloque (nunca más de los que tiene).
//   - Un día hábil cuenta como falta si ya pasó y no tiene asistencia pagada
//     (sin registro o marcado como ausencia SIN justificativo). Una falta
//     justificada (`ausencia_justificada`) se paga y nunca cuenta como falta. Los días antes del ingreso o
//     posteriores a hoy no cuentan como falta ni como descanso pagado… salvo los
//     descansos futuros del período, que se pagan: el período se liquida completo.
// Pagar el TRABAJO hecho en un día de descanso o feriado (art. 120) lo sigue
// haciendo el motor con su recargo o monto fijo; esto es solo el descanso.

import { diaSemanaDeFecha, trabajaEnFecha } from './nominaHorarios.js'

const MS_DIA = 24 * 60 * 60 * 1000
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function fechasDelRango(desde, hasta) {
  if (!FECHA_RE.test(String(desde)) || !FECHA_RE.test(String(hasta))) return []
  const inicio = Date.parse(`${desde}T00:00:00Z`)
  const fin = Date.parse(`${hasta}T00:00:00Z`)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio) return []
  const fechas = []
  // Tope defensivo: un período nunca debería pasar de un año.
  for (let t = inicio, i = 0; t <= fin && i < 370; t += MS_DIA, i += 1) {
    fechas.push(new Date(t).toISOString().slice(0, 10))
  }
  return fechas
}

/** ¿La falta tiene justificativo? (se paga el día y no cuenta como falta). */
export function esFaltaJustificada(fila) {
  return Boolean(fila && fila.es_ausencia && fila.ausencia_justificada === true)
}

/** ¿La fila de asistencia paga el día? Con asistencia por defecto, sin fila = presente (pagado). */
function asistenciaPagada(fila) {
  if (!fila) return true
  if (fila.es_ausencia) return esFaltaJustificada(fila)
  return true
}

/**
 * Días hábiles del período `desde..hasta` sin fila en `registro_asistencia` que
 * cuentan como presentes por defecto (Opción A: todo el período desde `fechaIngreso`).
 * Devuelve `{ fecha, esSabado, esFeriadoLaborable }` para sumar días, horas y recargos.
 */
export function diasHabilesPresuntos({
  desde, hasta, diasLaborables, feriados = [], asistencias = [], fechaIngreso = null,
}) {
  const feriadosNoLaborables = new Set((feriados || [])
    .filter(f => f && f.laborable !== true && FECHA_RE.test(String(f.fecha).slice(0, 10)))
    .map(f => String(f.fecha).slice(0, 10)))
  const feriadosLaborables = new Set((feriados || [])
    .filter(f => f && f.laborable === true && FECHA_RE.test(String(f.fecha).slice(0, 10)))
    .map(f => String(f.fecha).slice(0, 10)))
  const registrados = new Set((asistencias || [])
    .filter(f => f?.fecha)
    .map(f => String(f.fecha).slice(0, 10)))
  const ingreso = fechaIngreso && FECHA_RE.test(String(fechaIngreso).slice(0, 10)) ? String(fechaIngreso).slice(0, 10) : null

  const presuntos = []
  for (const fecha of fechasDelRango(desde, hasta)) {
    if (ingreso && fecha < ingreso) continue
    const dow = diaSemanaDeFecha(fecha)
    if (dow === 0 || !trabajaEnFecha(diasLaborables, fecha) || feriadosNoLaborables.has(fecha)) continue
    if (registrados.has(fecha)) continue
    presuntos.push({
      fecha,
      esSabado: dow === 6,
      esFeriadoLaborable: feriadosLaborables.has(fecha),
    })
  }
  return presuntos
}

/**
 * @param {object} p
 * @param {string} p.desde              inicio del período (YYYY-MM-DD)
 * @param {string} p.hasta              fin del período (YYYY-MM-DD)
 * @param {number[]} p.diasLaborables   días que trabaja (1=lun … 6=sáb)
 * @param {{fecha:string, laborable?:boolean}[]} [p.feriados]
 * @param {object[]} [p.asistencias]    filas de registro_asistencia de la persona
 * @param {string|null} [p.hoy]         fecha operativa; los días hábiles futuros no son falta
 * @param {string|null} [p.fechaIngreso]
 * @param {number} [p.faltasPierde]    faltas en la semana desde las que se descuenta un descanso por falta (0 = nunca)
 * @returns {{ diasDescanso:number, diasDescansoPerdidos:number, semanasConPerdida:number, fechasDescanso:string[], diasSinRegistro:number }}
 *   `diasSinRegistro`: días hábiles ya pasados, desde el ingreso, sin ninguna fila de asistencia
 *   (regla del usuario, 19/11/2026: cuentan como falta sin justificativo en el recibo).
 */
export function calcularDescansoRemunerado({
  desde, hasta, diasLaborables, feriados = [], asistencias = [], hoy = null, fechaIngreso = null, faltasPierde = 0,
}) {
  const umbral = Number.isInteger(Number(faltasPierde)) && Number(faltasPierde) >= 0 ? Number(faltasPierde) : 0
  const feriadosNoLaborables = new Set((feriados || [])
    .filter(f => f && f.laborable !== true && FECHA_RE.test(String(f.fecha).slice(0, 10)))
    .map(f => String(f.fecha).slice(0, 10)))
  const porFecha = new Map()
  for (const fila of asistencias || []) {
    if (fila?.fecha) porFecha.set(String(fila.fecha).slice(0, 10), fila)
  }
  const ingreso = fechaIngreso && FECHA_RE.test(String(fechaIngreso).slice(0, 10)) ? String(fechaIngreso).slice(0, 10) : null

  let diasSinRegistro = 0
  const semanas = new Map() // índice → { descansos: [], faltas: 0 }
  const fechas = fechasDelRango(desde, hasta)
  fechas.forEach((fecha, i) => {
    if (ingreso && fecha < ingreso) return
    const indice = Math.floor(i / 7)
    if (!semanas.has(indice)) semanas.set(indice, { descansos: [], faltas: 0 })
    const semana = semanas.get(indice)
    const esDescanso = diaSemanaDeFecha(fecha) === 0 || !trabajaEnFecha(diasLaborables, fecha) || feriadosNoLaborables.has(fecha)
    if (esDescanso) {
      semana.descansos.push(fecha)
      return
    }
    if (hoy && fecha > hoy) return
    if (!asistenciaPagada(porFecha.get(fecha))) semana.faltas += 1
  })

  let diasDescanso = 0
  let diasDescansoPerdidos = 0
  let semanasConPerdida = 0
  const fechasDescanso = []
  for (const semana of semanas.values()) {
    const perdidos = umbral > 0 && semana.faltas >= umbral ? Math.min(semana.faltas, semana.descansos.length) : 0
    if (perdidos > 0) {
      diasDescansoPerdidos += perdidos
      semanasConPerdida += 1
    }
    // Se descuentan los últimos descansos del bloque (el domingo antes que el sábado).
    const pagados = semana.descansos.slice(0, semana.descansos.length - perdidos)
    diasDescanso += pagados.length
    fechasDescanso.push(...pagados)
  }
  return { diasDescanso, diasDescansoPerdidos, semanasConPerdida, fechasDescanso, diasSinRegistro }
}

/** ¿La fila es de un día de descanso/feriado registrado SIN trabajo? (lo cubre el descanso pagado). */
export function esDescansoSinTrabajo(fila) {
  if (!fila || fila.es_ausencia) return false
  const horas = Number(fila.horas_normales || 0) + Number(fila.horas_extra || 0) + Number(fila.horas_trabajadas || 0)
  return !fila.hora_entrada && horas <= 0
}
