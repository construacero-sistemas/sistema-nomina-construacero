// src/services/pdf/nominaResumenPDF.impl.js
// Planilla semanal horizontal (Carta landscape): replica las columnas completas
// de la Hoja semanal (sueldo semanal, bono semanal, extras, descansos, descuentos y neto USD/Bs).
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import { WATERMARK_LOGO } from '../../../compat/services/pdf/watermarkBase64.js'
import { armarHojaSemanal, semanasDelPeriodo } from '../../../server/lib/nominaHoja.js'
import { reglasLeyDeConfig } from '../../../server/lib/nominaReglasLey.js'
import {
  MARGIN, C_DARK, C_GRAY, C_AMBER, C_EMERALD, C_RED,
  fmtBs, fmtUsd, drawPremiumHeader,
} from '../../../compat/services/pdf/pdfShared.js'

function fecha(f) {
  if (!f) return '—'
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function checkPage(doc, y, needed = 28) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  if (y + needed > pageH - 22) {
    doc.addPage()
    try {
      doc.setGState(new doc.GState({ opacity: 0.05 }))
      doc.addImage(WATERMARK_LOGO, 'PNG', (pageW - 120) / 2, (pageH - 120) / 2, 120, 120)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) { /* la marca de agua es opcional */ }
    return MARGIN + 8
  }
  return y
}

function drawFooter(doc, config) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - MARGIN * 2
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, pageH - 14, MARGIN + contentW, pageH - 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    doc.text(footName, MARGIN, pageH - 9.5)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, pageH - 5.5)
    doc.text(`Página ${p} de ${totalPages}`, pageW - MARGIN, pageH - 9.5, { align: 'right' })
  }
}

function construirFilasFallback({ periodo, lineas, config, hoja }) {
  const reglas = reglasLeyDeConfig(config)
  const semanas = hoja?.semanas || semanasDelPeriodo(periodo?.desde, periodo?.hasta)
  const bonoSemanal = hoja?.bonoSemanal ?? reglas.bonoSemanalUsd
  return armarHojaSemanal({
    lineas,
    divisor: reglas.divisorMensual,
    bonoSemanal,
    semanas,
  })
}

async function generarNominaResumenPDFImpl({
  periodo = {},
  lineas = [],
  hoja = null,
  tasaCongelada = null,
  config = {},
  action = 'download',
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - MARGIN * 2
  const logoData = await cargarLogo(config.logo_url)

  const tasaCierre = Number(tasaCongelada?.valor) || 0
  const subtituloBase = `${periodo.nombre || ''} · ${fecha(periodo.desde)} – ${fecha(periodo.hasta)}`
  const subtitulo = tasaCierre > 0
    ? `${subtituloBase} · Tasa cierre: ${fmtBs(tasaCierre)}/$ (${tasaCongelada?.fuente || 'Cierre'})`
    : subtituloBase

  let y = drawPremiumHeader({
    doc, logoData, config,
    title: 'Planilla de Nómina (Hoja Semanal)',
    subtitle: subtitulo,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
  })

  try {
    doc.setGState(new doc.GState({ opacity: 0.05 }))
    doc.addImage(WATERMARK_LOGO, 'PNG', (pageW - 120) / 2, (pageH - 120) / 2, 120, 120)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) { /* la marca de agua es opcional */ }

  const hojaCalculada = hoja?.filas?.length ? hoja : construirFilasFallback({ periodo, lineas, config, hoja })
  const filas = hojaCalculada.filas || []
  const totales = hojaCalculada.totales || {}
  const topeBono = Number(hojaCalculada.bonoSemanal || 0) * Math.max(1, Number(hojaCalculada.semanas) || 1)

  const bsDeFila = f => {
    if (f.pagado && Number(f.tasaPago) > 0 && f.totalPagadoBs != null) return Number(f.totalPagadoBs)
    return tasaCierre > 0 ? Number(f.neto || 0) * tasaCierre : 0
  }
  const totalBs = filas.reduce((s, f) => s + bsDeFila(f), 0)

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpiBoxH = 14
  const colW = contentW / 4
  const labels = ['Empleados', 'Total a cobrar', 'Descuentos', totalBs > 0 ? 'Total neto (USD / Bs)' : 'Total neto (USD)']
  const values = [
    String(filas.length),
    fmtUsd(totales.totalACobrar),
    fmtUsd(totales.descuentos),
    totalBs > 0 ? `${fmtUsd(totales.neto)} · ${fmtBs(totalBs)}` : fmtUsd(totales.neto),
  ]
  const colors = [C_DARK, C_DARK, C_RED, C_EMERALD]

  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, contentW, kpiBoxH, 2, 2, 'FD')
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
    doc.setFontSize(i === 3 && totalBs > 0 ? 8.5 : 10)
    doc.setTextColor(...colors[i])
    doc.text(values[i], MARGIN + i * colW + 3, y + 10.2)
  }
  y += kpiBoxH + 5

  // ── Tabla horizontal (251 mm <= contentW ~251.4 mm) ─────────────────────────
  const cols = [
    { label: 'EMPLEADO',     x: MARGIN + 0,   w: 48 },
    { label: 'DÍAS TRAB.',   x: MARGIN + 48,  w: 18 },
    { label: 'DESCANSO',     x: MARGIN + 66,  w: 18 },
    { label: 'SUELDO SEM.',  x: MARGIN + 84,  w: 22 },
    { label: 'BONO SEM.',    x: MARGIN + 106, w: 22 },
    { label: 'H. EXTRA',     x: MARGIN + 128, w: 19 },
    { label: 'DESC./FER.',   x: MARGIN + 147, w: 20 },
    { label: 'OTROS',        x: MARGIN + 167, w: 17 },
    { label: 'TOT. COBRAR',  x: MARGIN + 184, w: 23 },
    { label: 'DESCUENTOS',   x: MARGIN + 207, w: 20 },
    { label: 'NETO',         x: MARGIN + 227, w: 24 },
  ]

  function headers(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, contentW, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.8)
    doc.setTextColor(...C_DARK)
    cols.forEach(c => doc.text(c.label, c.x + 1.5, yPos + 4.8))
    return yPos + 8
  }

  function montoConDetalle(col, monto, detalle = null, color = C_DARK, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...(Number(monto || 0) > 0 ? color : C_GRAY))
    doc.text(Number(monto || 0) > 0 ? fmtUsd(monto) : '—', col.x + 1.5, y + 3.2)
    if (detalle) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(4.9)
      doc.setTextColor(...C_GRAY)
      doc.text(String(detalle), col.x + 1.5, y + 6.2)
    }
  }

  y = headers(y)

  filas.forEach((f, idx) => {
    y = checkPage(doc, y, 9.5)
    if (y < MARGIN + 11) y = headers(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, contentW, 8.2, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(f.nombre || '—').substring(0, 28), cols[0].x + 1.5, y + 3.2)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(4.9)
    doc.setTextColor(...C_GRAY)
    const mensualTxt = Number(f.sueldoMensual || 0) > 0 ? `${fmtUsd(f.sueldoMensual)}/mes` : ''
    doc.text(mensualTxt, cols[0].x + 1.5, y + 6.2)

    montoConDetalle(cols[1], f.valorDiasTrabajados, `${Number(f.diasTrabajados || 0)} d`)
    montoConDetalle(cols[2], f.valorDescansoPagado, `${Number(f.diasDescansoPagados || 0)} d`)
    montoConDetalle(cols[3], f.sueldoSemanal, null, C_DARK)
    const bonoIncompleto = topeBono > 0 && Number(f.bonoSemanal || 0) > 0 && Number(f.bonoSemanal) < topeBono - 0.005
    montoConDetalle(cols[4], f.bonoSemanal, bonoIncompleto ? `de ${fmtUsd(topeBono)}` : null, C_EMERALD)
    montoConDetalle(cols[5], f.totalExtras, Number(f.horasExtra || 0) > 0 ? `${Number(f.horasExtra).toFixed(1)} h` : null, C_AMBER)
    montoConDetalle(cols[6], f.valorDescansoTrabajado, Number(f.diasDescansoTrabajados || 0) > 0 ? `${f.diasDescansoTrabajados} d` : null, C_DARK)
    montoConDetalle(cols[7], f.otrosPagos, null, C_EMERALD)
    montoConDetalle(cols[8], f.totalACobrar, null, C_DARK, true)
    montoConDetalle(cols[9], f.descuentos, null, C_RED)

    const bsFila = bsDeFila(f)
    const subNeto = bsFila > 0 ? fmtBs(bsFila) : (f.pagado ? 'PAGADO' : null)
    montoConDetalle(cols[10], f.neto, subNeto, C_EMERALD, true)

    y += 8.5
  })

  // ── Fila de totales ─────────────────────────────────────────────────────────
  y = checkPage(doc, y, 14)
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, contentW, 10, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.8)
  doc.setTextColor(...C_DARK)
  doc.text(`TOTALES (${filas.length})`, cols[0].x + 1.5, y + 4.8)

  const paresTotales = [
    [cols[1], totales.valorDiasTrabajados],
    [cols[2], totales.valorDescansoPagado],
    [cols[3], totales.sueldoSemanal],
    [cols[4], totales.bonoSemanal],
    [cols[5], totales.totalExtras],
    [cols[6], totales.valorDescansoTrabajado],
    [cols[7], totales.otrosPagos],
    [cols[8], totales.totalACobrar],
    [cols[9], totales.descuentos],
  ]
  for (const [col, val] of paresTotales) {
    doc.setTextColor(...(col === cols[9] && Number(val || 0) > 0 ? C_RED : C_DARK))
    doc.text(fmtUsd(val), col.x + 1.5, y + 4.8)
  }
  doc.setTextColor(...C_EMERALD)
  doc.text(fmtUsd(totales.neto), cols[10].x + 1.5, y + 4.8)
  if (totalBs > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.2)
    doc.text(fmtBs(totalBs), cols[10].x + 1.5, y + 8.3)
  }

  y += 15

  // ── Firmas ──────────────────────────────────────────────────────────────────
  y = checkPage(doc, y, 24)
  doc.setDrawColor(...C_GRAY)
  doc.setLineWidth(0.3)
  const firmaW = (contentW - 24) / 2
  doc.line(MARGIN, y + 10, MARGIN + firmaW, y + 10)
  doc.line(MARGIN + firmaW + 24, y + 10, MARGIN + contentW, y + 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text('Elaborado por', MARGIN, y + 14)
  doc.text('Autorizado por', MARGIN + firmaW + 24, y + 14)

  drawFooter(doc, config)

  const nombreArch = `nomina-${(periodo.nombre || 'periodo').replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}

export { generarNominaResumenPDFImpl };
