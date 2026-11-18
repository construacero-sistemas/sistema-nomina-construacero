// src/components/nomina/hojaSemanalCsv.js
// Columnas de la «Hoja semanal» (orden de la planilla) y su exportación a Excel.
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

export const usd = n => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const cantidad = n => Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })

// Columnas en el orden de la planilla. `total`: se suma en el pie.
export const COLUMNAS = [
  { id: 'sueldoMensual', titulo: 'Sueldo mensual', formato: usd },
  { id: 'diasTrabajados', titulo: 'Días trab.', formato: cantidad },
  { id: 'valorDiasTrabajados', titulo: 'Valor días trab. $', formato: usd, total: true },
  { id: 'diasDescansoPagados', titulo: 'Días descanso', formato: cantidad },
  { id: 'valorDescansoPagado', titulo: 'Valor descanso $', formato: usd, total: true },
  { id: 'sueldoSemanal', titulo: 'Sueldo semanal', formato: usd, total: true },
  { id: 'bonoSemanal', titulo: 'Bono semanal', formato: usd, total: true },
  { id: 'horasExtra', titulo: 'Horas extra', formato: cantidad, total: true },
  { id: 'totalExtras', titulo: 'Total extras $', formato: usd, total: true },
  { id: 'diasDescansoTrabajados', titulo: 'Desc. o feriado trab.', formato: cantidad, total: true },
  { id: 'valorDescansoTrabajado', titulo: 'Valor $', formato: usd, total: true },
  { id: 'otrosPagos', titulo: 'Otros pagos', formato: usd, total: true },
  { id: 'totalACobrar', titulo: 'Total a cobrar', formato: usd, total: true, fuerte: true },
]

const dias = n => `${cantidad(n)} ${Number(n) === 1 ? 'día' : 'días'}`
const horas = n => `${cantidad(n)} h`

// Columnas de PANTALLA (tabla y fichas): más compactas que las del Excel. Cada
// cantidad va debajo de su monto en la misma celda («$40,00 / 5 días») y las
// columnas se agrupan como la planilla de la contadora. `opcional`: se oculta
// si todas las filas están en cero. El Excel conserva todas las columnas.
export const GRUPOS_PANTALLA = [
  { id: 'semana', titulo: 'Semana' },
  { id: 'pago', titulo: 'Pago' },
  { id: 'adicionales', titulo: 'Adicionales' },
]
export const COLUMNAS_PANTALLA = [
  { id: 'valorDiasTrabajados', grupo: 'semana', titulo: 'Días trab.', detalle: f => dias(f.diasTrabajados) },
  { id: 'valorDescansoPagado', grupo: 'semana', titulo: 'Descanso', detalle: f => dias(f.diasDescansoPagados) },
  { id: 'sueldoSemanal', grupo: 'pago', titulo: 'Sueldo semanal' },
  { id: 'bonoSemanal', grupo: 'pago', titulo: 'Bono semanal' },
  { id: 'totalExtras', grupo: 'adicionales', titulo: 'Horas extra', detalle: f => horas(f.horasExtra), detalleTotal: t => horas(t.horasExtra) },
  { id: 'valorDescansoTrabajado', grupo: 'adicionales', titulo: 'Desc. o feriado trab.', detalle: f => dias(f.diasDescansoTrabajados), detalleTotal: t => dias(t.diasDescansoTrabajados) },
  { id: 'otrosPagos', grupo: 'adicionales', titulo: 'Otros pagos', opcional: true },
  { id: 'totalACobrar', titulo: 'Total a cobrar', fuerte: true },
]

/** Columnas de pantalla visibles: las opcionales solo si alguna fila tiene monto. */
export function columnasVisibles(filas) {
  return COLUMNAS_PANTALLA.filter(c => !c.opcional || filas.some(f => Number(f[c.id]) !== 0))
}

function csvNumero(n) {
  return Number(n || 0).toFixed(2).replace('.', ',')
}

// Excel en español abre directo un CSV con «;» y coma decimal; el BOM evita que
// rompa los acentos.
export function hojaACsv({ periodo, filas, totales, bsDe }) {
  const encabezado = ['Nombre', ...COLUMNAS.map(c => c.titulo), 'Descuentos', 'Neto $', 'Neto Bs']
  const lineas = filas.map(fila => [
    capitalizarPalabras(fila.nombre),
    ...COLUMNAS.map(c => csvNumero(fila[c.id])),
    csvNumero(fila.descuentos), csvNumero(fila.neto), csvNumero(bsDe(fila)),
  ])
  const pie = ['TOTALES', ...COLUMNAS.map(c => (c.total ? csvNumero(totales[c.id]) : '')),
    csvNumero(totales.descuentos), csvNumero(totales.neto), csvNumero(filas.reduce((s, f) => s + bsDe(f), 0))]
  const titulo = [`${periodo.nombre} (${periodo.desde} a ${periodo.hasta})`]
  return '﻿' + [titulo, encabezado, ...lineas, pie].map(fila => fila.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
}
