// src/components/finanzas/fechasRapidas.js
// Utilidades de fechas y rangos rápidos del libro financiero (funciones puras).

export function getLocalIsoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isoToday() {
  return getLocalIsoDate()
}

export function monthStart() {
  const date = new Date()
  return getLocalIsoDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

// Lunes de la semana en curso (la semana empieza en lunes).
export function weekStartIso() {
  const date = new Date()
  const dow = (date.getDay() + 6) % 7 // lunes=0 … domingo=6
  date.setDate(date.getDate() - dow)
  return getLocalIsoDate(date)
}

export function yesterdayIso() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return getLocalIsoDate(date)
}

// Rangos rápidos para móvil: un toque en vez de navegar dos calendarios.
export const RANGOS_RAPIDOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Este mes' },
]

// Devuelve el id del rango rápido activo ('' si el rango es personalizado).
export function rangoRapidoActivo(desde, hasta) {
  const hoy = isoToday()
  if (desde === hoy && hasta === hoy) return 'hoy'
  if (desde === hasta && desde === yesterdayIso()) return 'ayer'
  // 'mes' antes que 'semana': si el mes empieza en lunes ambos coinciden y
  // conservamos el chip del rango que el usuario eligió por defecto.
  if (desde === monthStart() && hasta === hoy) return 'mes'
  if (desde === weekStartIso() && hasta === hoy) return 'semana'
  return ''
}

// Aplica un rango rápido y devuelve { desde, hasta }.
export function aplicarRangoRapido(id) {
  const hoy = isoToday()
  if (id === 'hoy') return { desde: hoy, hasta: hoy }
  if (id === 'ayer') return { desde: yesterdayIso(), hasta: yesterdayIso() }
  if (id === 'semana') return { desde: weekStartIso(), hasta: hoy }
  return { desde: monthStart(), hasta: hoy }
}
