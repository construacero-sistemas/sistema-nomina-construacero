// src/services/pdf/cierreSaldosSeccion.js
// Sección «Saldos del mes por cuenta» de los PDF de cierre mensual: con cuánto abrió
// cada cuenta, cuánto entró y salió, y con cuánto cerró (contado vs. libro).
import { PAGE_H, MARGIN, CONTENT_W, C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_EMERALD, C_RED, fmtUsd } from '../../../compat/services/pdf/pdfShared.js'
import { formatNumber } from '../../components/finanzas/formatos.js'

const COLS = [
  { label: 'CUENTA', x: MARGIN, w: 38, align: 'left' },
  { label: 'SALDO DE APERTURA', x: MARGIN + 38, w: 32, align: 'right' },
  { label: 'INGRESOS', x: MARGIN + 70, w: 28, align: 'right' },
  { label: 'EGRESOS', x: MARGIN + 98, w: 28, align: 'right' },
  { label: 'SALDO DE CIERRE', x: MARGIN + 126, w: 34, align: 'right' },
  { label: 'DIFERENCIA', x: MARGIN + 160, w: 28, align: 'right' },
]

// Flujo de cada cuenta en su moneda nativa. Incluye traspasos: mueven saldo entre
// cuentas aunque no sean ingreso/egreso operativo, y así la tabla cuadra con el libro.
export function flujoPorCuenta(movimientos, cuentaId) {
  return movimientos.reduce((acc, mov) => {
    if (mov.estado === 'anulado' || mov.cuenta_custodia_id !== cuentaId) return acc
    acc[mov.tipo === 'ingreso' ? 'ingresos' : 'egresos'] += Number(mov.monto) || 0
    return acc
  }, { ingresos: 0, egresos: 0 })
}

function cabecera(doc, y) {
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => doc.text(col.label, col.align === 'right' ? col.x + col.w - 2 : col.x + 2, y + 4.5, { align: col.align }))
  return y + 7.5
}

export function drawSaldosCierre(doc, y, periodo, movimientos) {
  const cuentas = periodo?.cuentas || []
  if (cuentas.length === 0) return y
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('SALDOS DEL MES POR CUENTA', MARGIN, y)
  y = cabecera(doc, y + 4)

  cuentas.forEach((cuenta, idx) => {
    if (y + 12 > PAGE_H - 25) { doc.addPage(); y = cabecera(doc, MARGIN + 12) }
    if (idx % 2 === 0) { doc.setFillColor(252, 252, 253); doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F') }
    const flujo = flujoPorCuenta(movimientos, cuenta.cuentaCustodiaId)
    const moneda = cuenta.moneda || ''
    const diferencia = Number(cuenta.diferenciaCierre) || 0
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(`${String(cuenta.nombre || '—').substring(0, 20)} · ${moneda}`, COLS[0].x + 2, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.text(`${formatNumber(cuenta.saldoApertura ?? 0)}`, COLS[1].x + COLS[1].w - 2, y + 3, { align: 'right' })
    doc.setTextColor(...C_EMERALD)
    doc.text(`+${formatNumber(flujo.ingresos)}`, COLS[2].x + COLS[2].w - 2, y + 3, { align: 'right' })
    doc.setTextColor(...C_RED)
    doc.text(`-${formatNumber(flujo.egresos)}`, COLS[3].x + COLS[3].w - 2, y + 3, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(`${formatNumber(cuenta.saldoCierreReal ?? 0)}`, COLS[4].x + COLS[4].w - 2, y + 3, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...(diferencia === 0 ? C_GRAY : C_RED))
    doc.text(diferencia === 0 ? 'Sin diferencia' : formatNumber(diferencia), COLS[5].x + COLS[5].w - 2, y + 3, { align: 'right' })
    y += 6.5
    if (diferencia !== 0 && cuenta.motivoCierre) {
      doc.setFontSize(5.5)
      doc.setTextColor(...C_GRAY)
      doc.text(`Motivo: ${String(cuenta.motivoCierre).substring(0, 120)}`, COLS[0].x + 2, y + 1)
      y += 4
    }
  })

  const sumar = campo => cuentas.reduce((total, cuenta) => total + (Number(cuenta[campo]) || 0), 0)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_PRIMARY)
  doc.text(`CONSOLIDADO EN USD (tasas congeladas): apertura ${fmtUsd(sumar('saldoAperturaUsd'))} → cierre ${fmtUsd(sumar('saldoCierreUsd'))}`, MARGIN, y + 5)
  return y + 12
}
