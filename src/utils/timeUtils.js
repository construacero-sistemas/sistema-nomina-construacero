// src/utils/timeUtils.js
// Utilidades centralizadas para formateo de horas y rangos horarios en formato 12h (AM/PM).

/**
 * Convierte una hora en formato 24h (HH:mm o HH:mm:ss) a formato 12h con AM/PM.
 * Ejemplos:
 *   formatHora12('08:00') => '08:00 AM'
 *   formatHora12('17:00') => '05:00 PM'
 *   formatHora12('12:00') => '12:00 PM'
 *   formatHora12('00:00') => '12:00 AM'
 *   formatHora12('13:30:00') => '01:30 PM'
 *
 * @param {string} hora24 Cadena de hora en formato HH:mm o HH:mm:ss.
 * @param {object} [opciones]
 * @param {boolean} [opciones.padHour=true] Rellenar con cero a la izquierda (ej: '08:00 AM' vs '8:00 AM').
 * @param {boolean} [opciones.incluirEspacio=true] Incluir espacio antes de AM/PM.
 * @returns {string} Hora formateada o la cadena original si no es válida.
 */
export function formatHora12(hora24, { padHour = true, incluirEspacio = true } = {}) {
  if (!hora24 || typeof hora24 !== 'string') return ''
  const match = hora24.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return hora24

  let h = parseInt(match[1], 10)
  const m = match[2]
  if (Number.isNaN(h) || h < 0 || h > 23) return hora24

  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  const hStr = padHour ? String(h).padStart(2, '0') : String(h)
  const sep = incluirEspacio ? ' ' : ''

  return `${hStr}:${m}${sep}${ampm}`
}

/**
 * Formatea un rango de horas en formato 12h (AM/PM).
 * Ejemplo:
 *   formatRangoHoras12('08:00', '17:00') => '08:00 AM – 05:00 PM'
 *   formatRangoHoras12('08:00', '17:00', ' a ') => '08:00 AM a 05:00 PM'
 *
 * @param {string} hInicio Hora de inicio.
 * @param {string} hFin Hora de fin.
 * @param {string} [separador=' – '] Separador entre horas.
 * @param {object} [opciones] Opciones para formatHora12.
 * @returns {string}
 */
export function formatRangoHoras12(hInicio, hFin, separador = ' – ', opciones = {}) {
  const ini = formatHora12(hInicio, opciones)
  const fin = formatHora12(hFin, opciones)
  if (!ini && !fin) return ''
  if (!ini) return fin
  if (!fin) return ini
  return `${ini}${separador}${fin}`
}
