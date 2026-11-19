// src/components/nomina/periodoDetalleUtils.js
// Formato y reglas pequeñas del detalle del período (compartidas por el modal y sus piezas).
import { desgloseDescanso } from '../../utils/descansoRecibo.js'

export function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Días trabajados y, si los hay, los de descanso pagados (art. 119): «5 + 2 desc.».
export function textoDias(linea) {
  const trabajados = Number(linea.dias_trabajados) || 0
  const { diasDescanso } = desgloseDescanso(linea)
  return diasDescanso > 0 ? `${trabajados} + ${diasDescanso} desc.` : String(trabajados)
}

// Recibos marcados como pagados al cerrar el período (migración 269): no tienen pago
// en Finanzas que revertir; se deshacen reabriendo el período.
export const MARCA_CIERRE = 'Marcado pagado al cerrar el período'
export const revertible = linea => Boolean(linea.pagado) && linea.referencia_pago !== MARCA_CIERRE
