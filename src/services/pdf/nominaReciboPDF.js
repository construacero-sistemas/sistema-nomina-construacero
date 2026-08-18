// src/services/pdf/nominaReciboPDF.js
// Recibo de pago individual de un empleado para un período de nómina.
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

function drawFooter(doc, config) {
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
}

export async function generarNominaReciboPDF({ periodo = {}, linea = {}, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawPremiumHeader({
    doc, logoData, config,
    title: 'Recibo de Pago',
    subtitle: `${periodo.nombre || ''} · ${fecha(periodo.desde)} – ${fecha(periodo.hasta)}`,
  })

  try {
    doc.setGState(new doc.GState({ opacity: 0.06 }))
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) { /* la marca de agua es opcional */ }

  // ── Datos del empleado ──────────────────────────────────────────────────────
  doc.setFillColor(245, 247, 250)
  doc.roundedRect(MARGIN, y, CONTENT_W, 20, 2, 2, 'F')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text('EMPLEADO', MARGIN + 4, y + 5)
  doc.text('CARGO', MARGIN + 90, y + 5)
  doc.text('CÉDULA / RIF', MARGIN + 145, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text(String(linea.empleado?.nombre || '—').substring(0, 40), MARGIN + 4, y + 11)

  doc.setFontSize(7.5)
  doc.text(String(linea.cargo_snap || '—').substring(0, 26), MARGIN + 90, y + 11)
  doc.text(String(linea.empleado?.rif || '—'), MARGIN + 145, y + 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...C_GRAY)
  doc.text(
    `Salario base: ${fmtUsd(linea.salario_dia_usd_snap)} / día · Jornada: ${Number(linea.horas_jornada_snap) || 8}h`,
    MARGIN + 4, y + 16.5
  )

  y += 26

  // ── Resumen de asistencia ───────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('RESUMEN DEL PERÍODO', MARGIN, y)
  y += 4

  const resumen = [
    ['Días trabajados',   String(Number(linea.dias_trabajados) || 0)],
    ['Horas normales',    `${Number(linea.horas_normales || 0).toFixed(1)} h`],
    ['Horas extra',       `${Number(linea.horas_extra || 0).toFixed(1)} h`],
    ['Sábados',           String(linea.dias_sabado  || 0)],
    ['Feriados',          String(linea.dias_feriado || 0)],
    ['Ausencias',         String(linea.dias_ausencia || 0)],
  ]

  const colResW = CONTENT_W / 3
  resumen.forEach((r, i) => {
    const col = i % 3
    const fila = Math.floor(i / 3)
    const rx = MARGIN + col * colResW
    const ry = y + fila * 11

    doc.setFillColor(250, 251, 252)
    doc.roundedRect(rx, ry, colResW - 3, 9, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.setTextColor(...C_GRAY)
    doc.text(r[0].toUpperCase(), rx + 3, ry + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...(r[0] === 'Ausencias' && Number(r[1]) > 0 ? C_RED : C_DARK))
    doc.text(r[1], rx + 3, ry + 7.5)
  })

  y += 11 * Math.ceil(resumen.length / 3) + 6

  // ── Desglose de montos ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('DETALLE DE PAGO', MARGIN, y)
  y += 4

  const conceptos = [
    { label: `Días trabajados (${Number(linea.dias_trabajados) || 0} × ${fmtUsd(linea.salario_dia_usd_snap)})`, monto: Number(linea.monto_normal_usd  || 0), color: C_DARK },
    { label: `Horas extra (${Number(linea.horas_extra || 0).toFixed(1)} h)`,        monto: Number(linea.monto_extra_usd   || 0), color: C_DARK },
    { label: `Recargo sábados (${linea.dias_sabado  || 0} día/s)`,                  monto: Number(linea.monto_sabado_usd  || 0), color: C_DARK },
    { label: `Recargo feriados (${linea.dias_feriado || 0} día/s)`,                 monto: Number(linea.monto_feriado_usd || 0), color: C_DARK },
    { label: linea.nota_bonos ? `Bonos — ${linea.nota_bonos}` : 'Bonos / adicionales', monto: Number(linea.bonos_usd || 0), color: C_EMERALD },
  ].filter(c => c.monto > 0)

  // Cabecera de tabla
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_WHITE)
  doc.text('CONCEPTO', MARGIN + 3, y + 5)
  doc.text('MONTO', MARGIN + CONTENT_W - 3, y + 5, { align: 'right' })
  y += 8

  conceptos.forEach((c, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text(String(c.label).substring(0, 60), MARGIN + 3, y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...c.color)
    doc.text(fmtUsd(c.monto), MARGIN + CONTENT_W - 3, y + 3.5, { align: 'right' })
    y += 7
  })

  // Subtotal bruto
  doc.setDrawColor(220, 225, 235)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL BRUTO', MARGIN + 3, y)
  doc.text(fmtUsd(linea.total_bruto_usd), MARGIN + CONTENT_W - 3, y, { align: 'right' })
  y += 7

  // Deducciones
  const deduc = Number(linea.deducciones_usd || 0)
  if (deduc > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_RED)
    const labelDeduc = linea.nota_deducciones
      ? `Deducciones — ${linea.nota_deducciones}`
      : 'Deducciones'
    doc.text(String(labelDeduc).substring(0, 60), MARGIN + 3, y)
    doc.setFont('helvetica', 'bold')
    doc.text(`- ${fmtUsd(deduc)}`, MARGIN + CONTENT_W - 3, y, { align: 'right' })
    y += 7
  }

  // ── Total neto destacado ────────────────────────────────────────────────────
  y += 2
  doc.setFillColor(...C_AMBER)
  doc.roundedRect(MARGIN, y, CONTENT_W, 14, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL NETO A PAGAR', MARGIN + 5, y + 9)
  doc.setFontSize(13)
  doc.text(fmtUsd(linea.total_neto_usd), MARGIN + CONTENT_W - 5, y + 9.5, { align: 'right' })
  y += 20

  // ── Estado de pago ──────────────────────────────────────────────────────────
  if (linea.pagado) {
    doc.setFillColor(236, 253, 245)
    doc.setDrawColor(...C_EMERALD)
    doc.setLineWidth(0.4)
    doc.roundedRect(MARGIN, y, CONTENT_W, 12, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_EMERALD)
    doc.text('PAGADO', MARGIN + 5, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    const detalles = [
      linea.pagado_en ? new Date(linea.pagado_en).toLocaleDateString('es-VE') : null,
      linea.referencia_pago ? `Ref: ${linea.referencia_pago}` : null,
      linea.pagado_por_nombre ? `Por: ${linea.pagado_por_nombre}` : null,
    ].filter(Boolean).join('  ·  ')
    doc.text(detalles, MARGIN + 5, y + 9)
    y += 18
  } else {
    y += 4
  }

  // ── Firmas ──────────────────────────────────────────────────────────────────
  doc.setDrawColor(...C_GRAY)
  doc.setLineWidth(0.3)
  const firmaW = (CONTENT_W - 20) / 2
  doc.line(MARGIN, y + 14, MARGIN + firmaW, y + 14)
  doc.line(MARGIN + firmaW + 20, y + 14, MARGIN + CONTENT_W, y + 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text('Firma del empleado', MARGIN, y + 18)
  doc.text('Firma autorizada', MARGIN + firmaW + 20, y + 18)

  drawFooter(doc, config)

  const slug = String(linea.empleado?.nombre || 'empleado').replace(/[^\w]+/g, '-').toLowerCase()
  const nombreArch = `recibo-${slug}-${(periodo.nombre || '').replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}
