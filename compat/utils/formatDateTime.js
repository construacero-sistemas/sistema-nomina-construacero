// compat/utils/formatDateTime.js
// Formato canónico de fecha y hora del proyecto (regla de AGENT.md):
// "Lun, 24 ago. · 1:59:30 p. m." — siempre en hora de Caracas.
const formatter = new Intl.DateTimeFormat('es-VE', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZone: 'America/Caracas',
})

export function formatFechaHora(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatter.format(date).replace(',', ' ·')
}
