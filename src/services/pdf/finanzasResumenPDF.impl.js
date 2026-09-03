// src/services/pdf/finanzasResumenPDF.js
// Reporte financiero por rango de fechas: KPIs del período + desglose de
// ingresos y egresos + detalle línea por línea. Misma identidad visual que
// los demás PDFs del sistema (header premium, marca de agua, footer).
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import { WATERMARK_LOGO } from '../../../compat/services/pdf/watermarkBase64.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_AMBER, C_EMERALD, C_RED,
  fmtUsd, fmtBs, drawPremiumHeader,
} from '../../../compat/services/pdf/pdfShared.js'

function fecha(f) {
  if (!f) return '—'
  const dateStr = String(f).includes('T') ? String(f) : `${f}T12:00:00`
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    try {
      doc.setGState(new doc.GState({ opacity: 0.06 }))
      doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) { /* la marca de agua es opcional */ }
    return MARGIN + 10
  }
  return y
}

function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    doc.text(footName, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }
}

// Fila de KPIs (caja gris con 4 métricas separadas por línea)
function drawKpis(doc, y, kpis) {
  const boxH = 14
  const colW = CONTENT_W / 4
  doc.setFillColor(240, 242, 245)
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'F')
  kpis.forEach((kpi, i) => {
    if (i > 0) {
      doc.setDrawColor(220, 225, 235)
      doc.setLineWidth(0.3)
      doc.line(MARGIN + i * colW, y + 2, MARGIN + i * colW, y + boxH - 2)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(kpi.label.toUpperCase(), MARGIN + i * colW + 3, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...kpi.color)
    doc.text(kpi.value, MARGIN + i * colW + 3, y + 10)
  })
  return y + boxH + 6
}

function drawSectionTitle(doc, y, titulo) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text(titulo, MARGIN, y)
  return y + 4
}

async function generarFinanzasResumenPDFImpl({ movimientos = [], resumen = {}, rango = {}, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  const titulo = resumen.tipoFiltro === 'ingreso'
    ? 'Reporte de Ingresos'
    : resumen.tipoFiltro === 'egreso'
      ? 'Reporte de Egresos'
      : 'Reporte de Ingresos y Egresos'

  let y = drawPremiumHeader({
    doc, logoData, config,
    title: titulo,
    subtitle: `${fecha(rango.desde)} – ${fecha(rango.hasta)}`,
  })

  try {
    doc.setGState(new doc.GState({ opacity: 0.06 }))
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) { /* opcional */ }

  const nMovs = movimientos.length
  const ingresos = nMovs ? movimientos.filter(m => m.tipo === 'ingreso') : []
  const egresos = nMovs ? movimientos.filter(m => m.tipo === 'egreso') : []
  const totalIngresosUsd = Number(resumen.ingresos_usd || 0)
  const totalEgresosUsd = Number(resumen.egresos_usd || 0)
  const balanceUsd = Number(resumen.balance_usd || (totalIngresosUsd - totalEgresosUsd))

  // ── KPIs del período ────────────────────────────────────────────────────────
  y = drawKpis(doc, y, [
    { label: 'Ingresos', value: fmtUsd(totalIngresosUsd), color: C_EMERALD },
    { label: 'Egresos', value: fmtUsd(totalEgresosUsd), color: C_RED },
    { label: 'Flujo neto', value: fmtUsd(balanceUsd), color: balanceUsd >= 0 ? C_PRIMARY : C_RED },
    { label: 'Movimientos', value: String(nMovs), color: C_DARK },
  ])

  // ── Desglose por tipo (ingresos vs egresos, con contraparte en Bs) ─────────
  const contarTipo = (lista) => {
    const usd = lista.filter(m => (m.moneda || 'USD') !== 'VES').reduce((s, m) => s + (Number(m.monto) || 0), 0)
    const ves = lista.filter(m => (m.moneda || 'USD') === 'VES').reduce((s, m) => s + (Number(m.monto_ves) || Number(m.monto) || 0), 0)
    return { usd, ves, n: lista.length }
  }
  const ing = contarTipo(ingresos)
  const egr = contarTipo(egresos)

  y = drawSectionTitle(doc, y, 'DESGLOSE POR TIPO')
  const breakdownH = 22
  doc.setFillColor(250, 250, 251)
  doc.roundedRect(MARGIN, y, CONTENT_W, breakdownH, 2, 2, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_EMERALD)
  doc.text(`Ingresos (${ing.n}):   ${fmtUsd(ing.usd)}   ·   Bs ${ing.ves.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MARGIN + 4, y + 6)
  doc.setTextColor(...C_RED)
  doc.text(`Egresos (${egr.n}):     ${fmtUsd(egr.usd)}   ·   Bs ${egr.ves.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MARGIN + 4, y + 12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C_DARK)
  doc.text(`Neto:                  ${fmtUsd(balanceUsd)}`, MARGIN + 4, y + 18)
  y += breakdownH + 6

  // ── Tabla de movimientos ────────────────────────────────────────────────────
  y = drawSectionTitle(doc, y, 'DETALLE DE MOVIMIENTOS')
  const cols = [
    { label: 'FECHA',    x: MARGIN,        w: 20 },
    { label: 'TIPO',     x: MARGIN + 20,   w: 15 },
    { label: 'CATEGORÍA', x: MARGIN + 35,  w: 34 },
    { label: 'CONCEPTO', x: MARGIN + 69,   w: 60 },
    { label: 'CUENTA',   x: MARGIN + 129,  w: 32 },
    { label: 'MONTO',    x: MARGIN + 161,  w: 22 },
    { label: 'EQUIV. BS', x: MARGIN + 183, w: 19 },
  ]

  function headers(yPos) {
    doc.setFillColor(...C_PRIMARY)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...C_WHITE)
    cols.forEach(c => doc.text(c.label, c.x + 1.5, yPos + 5))
    return yPos + 8
  }

  y = headers(y)

  movimientos.forEach((m, idx) => {
    y = checkPage(doc, y, 8)
    if (y < MARGIN + 12) y = headers(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    }

    const esIngreso = m.tipo === 'ingreso'
    const anul = m.estado === 'anulado'
    const monto = Number(m.monto) || 0
    const tasa = Number(m.tasa_usd_ves || m.tasa_ves || 1)
    const montoVes = m.moneda === 'VES'
      ? (Number(m.monto_ves) || monto)
      : (Number(m.monto_ves) || (monto * tasa))

    // Fecha
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(fecha(m.fecha).replace(/\s/g, ' '), cols[0].x + 1.5, y + 3)

    // Tipo
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(anul ? C_GRAY : esIngreso ? C_EMERALD : C_RED))
    doc.text(esIngreso ? 'ING' : 'EGR', cols[1].x + 1.5, y + 3)

    // Categoría
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_DARK)
    doc.text(String(m.categoria || 'Sin categoría').substring(0, 24), cols[2].x + 1.5, y + 3)

    // Concepto
    doc.setTextColor(...(anul ? C_GRAY : C_DARK))
    doc.text(String(m.concepto || '—').substring(0, 44), cols[3].x + 1.5, y + 3)

    // Cuenta / subcuenta (método de pago si existe, si no subcuenta inferida)
    doc.setFontSize(5.5)
    doc.setTextColor(...C_GRAY)
    const cuentaTxt = String(m.cuenta_origen || m.metodo_pago || '').substring(0, 26) || '—'
    doc.text(cuentaTxt, cols[4].x + 1.5, y + 3)

    // Monto
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...(anul ? C_GRAY : esIngreso ? C_EMERALD : C_RED))
    const simbolo = m.moneda === 'VES' ? 'Bs ' : m.moneda === 'USDT' ? '₮ ' : '$ '
    doc.text(`${simbolo}${monto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cols[5].x + 1.5, y + 3)

    // Equivalente en Bs
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_GRAY)
    doc.text(fmtBs(montoVes).replace('Bs ', ''), cols[6].x + 1.5, y + 3)

    // Tachado si anulado
    if (anul) {
      doc.setDrawColor(...C_GRAY)
      doc.setLineWidth(0.2)
      doc.line(cols[3].x + 1.5, y + 2, cols[3].x + 1.5 + 58, y + 2)
    }

    y += 7
  })

  // ── Fila de totales ─────────────────────────────────────────────────────────
  y = checkPage(doc, y, 12)
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTALES', cols[0].x + 1.5, y + 5.5)
  doc.text(`${ingresos.length} ing · ${egresos.length} egr`, cols[2].x + 1.5, y + 5.5)
  doc.text(fmtUsd(totalIngresosUsd - totalEgresosUsd), cols[5].x + 1.5, y + 5.5)
  doc.text(`Bs ${Number(resumen.balance_ves || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cols[6].x + 1.5, y + 5.5)

  y += 14

  // Nota de anulados si los hay
  const anulados = movimientos.filter(m => m.estado === 'anulado')
  if (anulados.length > 0) {
    y = checkPage(doc, y, 10)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text(`Incluye ${anulados.length} movimiento(s) anulado(s) — no afectan los totales.`, MARGIN, y)
  }

  drawFooter(doc, config)

  const safeDesde = String(rango.desde || '').replace(/[^\d-]/g, '') || 'inicio'
  const safeHasta = String(rango.hasta || '').replace(/[^\d-]/g, '') || 'hoy'
  const sufijoTipo = resumen.tipoFiltro === 'ingreso' ? '-ingresos' : resumen.tipoFiltro === 'egreso' ? '-egresos' : ''
  const nombreArch = `finanzas-${safeDesde}_${safeHasta}${sufijoTipo}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}

export { generarFinanzasResumenPDFImpl };
