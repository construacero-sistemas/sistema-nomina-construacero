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

// Mes anterior (YYYY-MM-01) de un inicio de mes dado. El cierre mensual solo
// puede ejecutarse sobre el mes previo: la UI necesita su ventana real.
export function mesAnteriorIso(mesIso = monthStart()) {
  const [y, m] = String(mesIso).split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthStart()
  return getLocalIsoDate(new Date(y, m - 2, 1))
}

// Mes siguiente (YYYY-MM-01) de un inicio de mes dado.
export function mesSiguienteIso(mesIso = monthStart()) {
  const [y, m] = String(mesIso).split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthStart()
  return getLocalIsoDate(new Date(y, m, 1))
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
  { id: 'mesPasado', label: 'Mes pasado' },
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
  const pasado = rangoDeMes(mesAnteriorIso(), hoy)
  if (desde === pasado.desde && hasta === pasado.hasta) return 'mesPasado'
  return ''
}

// Aplica un rango rápido y devuelve { desde, hasta }.
export function aplicarRangoRapido(id) {
  const hoy = isoToday()
  if (id === 'hoy') return { desde: hoy, hasta: hoy }
  if (id === 'ayer') return { desde: yesterdayIso(), hasta: yesterdayIso() }
  if (id === 'semana') return { desde: weekStartIso(), hasta: hoy }
  if (id === 'mesPasado') return rangoDeMes(mesAnteriorIso(), hoy)
  return { desde: monthStart(), hasta: hoy }
}

/** ¿`hoy` (YYYY-MM-DD) es el último día del mes `mes` (YYYY-MM-01)? */
export function esUltimoDiaDelMes(hoy, mes) {
  if (!hoy || !mes || hoy.slice(0, 7) !== mes.slice(0, 7)) return false
  const [anio, numero] = mes.split('-').map(Number)
  return Number(hoy.slice(8, 10)) === new Date(anio, numero, 0).getDate()
}

// Rango completo de un mes (YYYY-MM-01): hasta su último día, o hasta hoy si es el mes en curso.
export function rangoDeMes(mesIso, hoy = isoToday()) {
  const [anio, numero] = String(mesIso).split('-').map(Number)
  const finDeMes = getLocalIsoDate(new Date(anio, numero, 0))
  return { desde: `${anio}-${String(numero).padStart(2, '0')}-01`, hasta: finDeMes > hoy ? hoy : finDeMes }
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function nombreMesRango(iso) {
  const [anio, mes] = String(iso || '').split('-')
  return `${MESES[Number(mes) - 1] || iso} ${anio || ''}`.trim()
}

/** Etiqueta del período: «Octubre 2026» si es un mes (completo o hasta hoy), si no «Del … al …». */
export function etiquetaRango(desde, hasta) {
  const inicio = String(desde || '').slice(0, 7)
  if (inicio && `${inicio}-01` === desde && hasta?.startsWith(inicio)) return nombreMesRango(inicio)
  return `Del ${desde} al ${hasta}`
}
