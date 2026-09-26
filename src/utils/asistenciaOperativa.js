// src/utils/asistenciaOperativa.js
// Reglas del marcaje real que comparten el grid semanal y el cálculo de períodos.
// Espejo del contrato del motor (server/lib/nominaUtils.js#esJornadaAbierta): una
// jornada abierta es quien marcó entrada y todavía no tiene salida. No se paga y
// NO es una ausencia: el servidor responde 409 al liquidar un período que las
// contenga hasta que el operador corrija el marcaje o confirme el cálculo.

/** ¿El registro es una jornada con entrada y sin salida? */
export function esJornadaAbierta(registro) {
  if (!registro || registro.es_ausencia) return false
  return registro.estado_marcaje === 'entrada' || (!!registro.hora_entrada && !registro.hora_salida)
}

/** Registros de la lista que quedaron con la salida pendiente. */
export function jornadasAbiertasDe(registros = []) {
  return (registros || []).filter(esJornadaAbierta)
}
