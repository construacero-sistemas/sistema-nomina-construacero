// src/components/nomina/holidayUtils.js
// Utilidades de cálculo de fechas de feriados (incluyendo Pascua de Meeus/Jones/Butcher) y festivos de Venezuela.

export const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

export const TIPO_COLORS = {
  nacional: { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-700', dot: 'bg-rose-500', label: 'Nacional' },
  regional: { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Regional' },
  empresa:  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Empresa' },
}

export function easterDate(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

export function addDays(date, days) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export function toISO(d) {
  return d.toISOString().slice(0, 10)
}

export function getVenezuelanHolidays(year) {
  const easter = easterDate(year)
  return [
    { fecha: `${year}-01-01`, nombre: 'Año Nuevo', tipo: 'nacional', laborable: true },
    { fecha: toISO(addDays(easter, -48)), nombre: 'Carnaval (lunes)', tipo: 'nacional', laborable: true },
    { fecha: toISO(addDays(easter, -47)), nombre: 'Carnaval (martes)', tipo: 'nacional', laborable: true },
    { fecha: toISO(addDays(easter, -2)), nombre: 'Viernes Santo', tipo: 'nacional', laborable: true },
    { fecha: `${year}-04-19`, nombre: 'Declaración de Independencia', tipo: 'nacional', laborable: true },
    { fecha: `${year}-05-01`, nombre: 'Día del Trabajador', tipo: 'nacional', laborable: true },
    { fecha: `${year}-06-24`, nombre: 'Batalla de Carabobo', tipo: 'nacional', laborable: true },
    { fecha: `${year}-07-05`, nombre: 'Independencia Nacional', tipo: 'nacional', laborable: true },
    { fecha: `${year}-07-24`, nombre: 'Natalicio de Bolívar', tipo: 'nacional', laborable: true },
    { fecha: `${year}-10-12`, nombre: 'Día de la Resistencia Indígena', tipo: 'nacional', laborable: true },
    { fecha: `${year}-12-24`, nombre: 'Nochebuena', tipo: 'nacional', laborable: true },
    { fecha: `${year}-12-25`, nombre: 'Navidad', tipo: 'nacional', laborable: true },
    { fecha: `${year}-12-31`, nombre: 'Fin de Año', tipo: 'nacional', laborable: true },
  ]
}
