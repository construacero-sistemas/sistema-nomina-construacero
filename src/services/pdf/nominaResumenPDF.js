// src/services/pdf/nominaResumenPDF.js
// Planilla de nómina de un período: todos los empleados con su desglose y totales.
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import { WATERMARK_LOGO } from '../../../compat/services/pdf/watermarkBase64.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_AMBER, C_EMERALD, C_RED,
  fmtUsd, drawPremiumHeader,
} from '../../../compat/services/pdf/pdfShared.js'

function fecha(f) {
  if (!f) return '—'
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
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

export async function generarNominaResumenPDF({ periodo = {}, lineas = [], config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawPremiumHeader({
    doc, logoData, config,
    title: 'Planilla de Nómina',
    subtitle: `${periodo.nombre || ''} · ${fecha(periodo.desde)} – ${fecha(periodo.hasta)}`,
  })

  try {
    doc.setGState(new doc.GState({ opacity: 0.06 }))
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) { /* la marca de agua es opcional */ }

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const totBruto = lineas.reduce((s, l) => s + Number(l.total_bruto_usd  || 0), 0)
  const totDeduc = lineas.reduce((s, l) => s + Number(l.deducciones_usd  || 0), 0)
  const totNeto  = lineas.reduce((s, l) => s + Number(l.total_neto_usd   || 0), 0)

  const kpiBoxH = 14
  const colW = CONTENT_W / 4
  const labels = ['Empleados', 'Total bruto', 'Deducciones', 'Total neto']
  const values = [String(lineas.length), fmtUsd(totBruto), fmtUsd(totDeduc), fmtUsd(totNeto)]
  const colors = [C_PRIMARY, C_DARK, C_RED, C_AMBER]

  doc.setFillColor(240, 242, 245)
  doc.roundedRect(MARGIN, y, CONTENT_W, kpiBoxH, 2, 2, 'F')
  for (let i = 0; i < 4; i++) {
    if (i > 0) {
      doc.setDrawColor(220, 225, 235)
      doc.setLineWidth(0.3)
      doc.line(MARGIN + i * colW, y + 2, MARGIN + i * colW, y + kpiBoxH - 2)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(labels[i].toUpperCase(), MARGIN + i * colW + 3, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...colors[i])
    doc.text(values[i], MARGIN + i * colW + 3, y + 10)
  }
  y += kpiBoxH + 6

  // ── Tabla ───────────────────────────────────────────────────────────────────
  const cols = [
    { label: 'EMPLEADO',  x: MARGIN,        w: 42 },
    { label: 'DÍAS',      x: MARGIN + 42,   w: 13 },
    { label: 'H.NORM',    x: MARGIN + 55,   w: 16 },
    { label: 'H.EXTRA',   x: MARGIN + 71,   w: 16 },
    { label: 'BASE',      x: MARGIN + 87,   w: 24 },
    { label: 'RECARGOS',  x: MARGIN + 111,  w: 24 },
    { label: 'BONOS',     x: MARGIN + 135,  w: 20 },
    { label: 'DEDUC.',    x: MARGIN + 155,  w: 20 },
    { label: 'NETO',      x: MARGIN + 175,  w: 13 },
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

  lineas.forEach((l, idx) => {
    y = checkPage(doc, y, 8)
    if (y < MARGIN + 12) y = headers(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    }

    const recargos = Number(l.monto_extra_usd || 0)
                   + Number(l.monto_sabado_usd || 0)
                   + Number(l.monto_feriado_usd || 0)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(l.empleado?.nombre || '—').substring(0, 26), cols[0].x + 1.5, y + 3)

    if (l.cargo_snap) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5)
      doc.setTextColor(...C_GRAY)
      doc.text(String(l.cargo_snap).substring(0, 30), cols[0].x + 1.5, y + 5.5)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(Number(l.dias_trabajados) || 0),          cols[1].x + 1.5, y + 3)
    doc.text(Number(l.horas_normales || 0).toFixed(1),        cols[2].x + 1.5, y + 3)

    const extras = Number(l.horas_extra || 0)
    doc.setTextColor(...(extras > 0 ? C_AMBER : C_GRAY))
    doc.text(extras > 0 ? extras.toFixed(1) : '—',            cols[3].x + 1.5, y + 3)

    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(l.monto_normal_usd),                      cols[4].x + 1.5, y + 3)
    doc.text(recargos > 0 ? fmtUsd(recargos) : '—',           cols[5].x + 1.5, y + 3)

    const bonos = Number(l.bonos_usd || 0)
    doc.setTextColor(...(bonos > 0 ? C_EMERALD : C_GRAY))
    doc.text(bonos > 0 ? fmtUsd(bonos) : '—',                 cols[6].x + 1.5, y + 3)

    const deduc = Number(l.deducciones_usd || 0)
    doc.setTextColor(...(deduc > 0 ? C_RED : C_GRAY))
    doc.text(deduc > 0 ? fmtUsd(deduc) : '—',                 cols[7].x + 1.5, y + 3)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(l.total_neto_usd),                        cols[8].x + 1.5, y + 3)

    // Marca de pagado
    if (l.pagado) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(4.5)
      doc.setTextColor(...C_EMERALD)
      doc.text('PAGADO', cols[8].x + 1.5, y + 5.5)
    }

    doc.setFont('helvetica', 'normal')
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
  doc.text(fmtUsd(lineas.reduce((s, l) => s + Number(l.monto_normal_usd || 0), 0)), cols[4].x + 1.5, y + 5.5)
  doc.text(fmtUsd(lineas.reduce((s, l) =>
    s + Number(l.monto_extra_usd || 0) + Number(l.monto_sabado_usd || 0) + Number(l.monto_feriado_usd || 0), 0)),
    cols[5].x + 1.5, y + 5.5)
  doc.text(fmtUsd(lineas.reduce((s, l) => s + Number(l.bonos_usd || 0), 0)), cols[6].x + 1.5, y + 5.5)
  doc.text(fmtUsd(totDeduc), cols[7].x + 1.5, y + 5.5)
  doc.text(fmtUsd(totNeto),  cols[8].x + 1.5, y + 5.5)

  y += 14

  // ── Firmas ──────────────────────────────────────────────────────────────────
  y = checkPage(doc, y, 30)
  doc.setDrawColor(...C_GRAY)
  doc.setLineWidth(0.3)
  const firmaW = (CONTENT_W - 20) / 2
  doc.line(MARGIN, y + 12, MARGIN + firmaW, y + 12)
  doc.line(MARGIN + firmaW + 20, y + 12, MARGIN + CONTENT_W, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text('Elaborado por', MARGIN, y + 16)
  doc.text('Autorizado por', MARGIN + firmaW + 20, y + 16)

  drawFooter(doc, config)

  const nombreArch = `nomina-${(periodo.nombre || 'periodo').replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}
