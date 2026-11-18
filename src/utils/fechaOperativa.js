// src/utils/fechaOperativa.js
// Fecha del día en la zona operativa (America/Caracas): la misma que usa el servidor
// (`nowInNominaZone`) para decidir qué fecha se marca y a qué período pertenece.
// El navegador puede estar en otra zona horaria, así que `new Date()` local pintaba
// «hoy» en el día equivocado (F-13 del plan de flujo de nómina).
export const ZONA_OPERATIVA = 'America/Caracas'

/** Fecha `YYYY-MM-DD` de hoy en la zona operativa. */
export function fechaOperativaHoy(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_OPERATIVA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora)
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]))
  return `${valores.year}-${valores.month}-${valores.day}`
}

/** Hora `HH:MM` de ahora en la zona operativa (la misma con la que el servidor marca). */
export function horaOperativaAhora(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_OPERATIVA, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(ahora)
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]))
  return `${valores.hour === '24' ? '00' : valores.hour}:${valores.minute}`
}
