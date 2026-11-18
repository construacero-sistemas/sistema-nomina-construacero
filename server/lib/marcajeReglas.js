// server/lib/marcajeReglas.js
// Reglas operativas del marcaje real de hoy, compartidas por el Worker y la
// interfaz (una sola fuente, como nominaReglasLey.js). Decisiones D-1, D-3 y D-4
// de docs/PLAN_MARCAJE_BOTONES_UX.md, adoptadas el 17/11/2026.

/** D-1: segundos durante los que quien marcó una entrada o salida puede deshacerla. */
export const VENTANA_DESHACER_SEGUNDOS = 120

/** D-3: una salida antes de estos minutos desde la entrada pide confirmar (y se audita). */
export const UMBRAL_SALIDA_CORTA_MINUTOS = 15

/** D-4: minutos de gracia sobre la hora de inicio antes de mostrar «Retraso». */
export const TOLERANCIA_RETRASO_MINUTOS = 10

/** Minutos desde la medianoche de una hora `HH:MM` o `HH:MM:SS`; null si no es válida. */
export function minutosDelDia(hora) {
  const match = /^(\d{2}):(\d{2})/.exec(String(hora || ''))
  if (!match) return null
  const horas = Number(match[1])
  const minutos = Number(match[2])
  if (horas > 23 || minutos > 59) return null
  return horas * 60 + minutos
}

/** Minutos entre dos horas del mismo turno (cruza la medianoche si hace falta). */
export function minutosEntre(desde, hasta) {
  const a = minutosDelDia(desde)
  const b = minutosDelDia(hasta)
  if (a === null || b === null) return null
  return (b - a + 24 * 60) % (24 * 60)
}
