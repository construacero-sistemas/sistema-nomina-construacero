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
//   - Regla del usuario (18/11/2026), más estricta que el art. 119: cada día
//     hábil que la persona falta en el bloque le DESCUENTA un día de descanso
//     pagado de ese bloque (1 falta → pierde 1 descanso; 2 faltas → pierde 2;
//     nunca más descansos de los que tiene la semana). `faltasPierde`
//     (migración 263, por defecto 1) es desde cuántas faltas empieza a
//     descontarse; 0 = nunca se descuenta.
//   - Un día hábil cuenta como falta si ya pasó y no tiene asistencia pagada
//     (sin registro o marcado como ausencia). Los días antes del ingreso o
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

/** ¿La fila de asistencia paga el día? (no es ausencia y tiene algo trabajado o registrado). */
function asistenciaPagada(fila) {
  if (!fila || fila.es_ausencia) return false
  return true
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
 * @returns {{ diasDescanso:number, diasDescansoPerdidos:number, semanasConPerdida:number, fechasDescanso:string[] }}
 */
export function calcularDescansoRemunerado({
  desde, hasta, diasLaborables, feriados = [], asistencias = [], hoy = null, fechaIngreso = null, faltasPierde = 1,
}) {
  const umbral = Number.isInteger(Number(faltasPierde)) && Number(faltasPierde) >= 0 ? Number(faltasPierde) : 1
  const feriadosNoLaborables = new Set((feriados || [])
    .filter(f => f && f.laborable !== true && FECHA_RE.test(String(f.fecha).slice(0, 10)))
    .map(f => String(f.fecha).slice(0, 10)))
  const porFecha = new Map()
  for (const fila of asistencias || []) {
    if (fila?.fecha) porFecha.set(String(fila.fecha).slice(0, 10), fila)
  }
  const ingreso = fechaIngreso && FECHA_RE.test(String(fechaIngreso).slice(0, 10)) ? String(fechaIngreso).slice(0, 10) : null

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
  return { diasDescanso, diasDescansoPerdidos, semanasConPerdida, fechasDescanso }
}

/** ¿La fila es de un día de descanso/feriado registrado SIN trabajo? (lo cubre el descanso pagado). */
export function esDescansoSinTrabajo(fila) {
  if (!fila || fila.es_ausencia) return false
  const horas = Number(fila.horas_normales || 0) + Number(fila.horas_extra || 0) + Number(fila.horas_trabajadas || 0)
  return !fila.hora_entrada && horas <= 0
}
