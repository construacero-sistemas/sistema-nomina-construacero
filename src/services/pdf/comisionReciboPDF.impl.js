// src/services/pdf/comisionReciboPDF.js
// Recibo oficial de pago de comisiones para trabajadores de Construacero Carabobo C.A.
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_AMBER, C_EMERALD,
  fmtUsd, fmtBs, drawWatermark, drawPremiumHeader,
} from '../../../compat/services/pdf/pdfShared.js'

function fmtFechaVE(f) {
  if (!f) return '—'
  const s = String(f).includes('T') ? String(f) : `${f}T12:00:00`
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function drawFooter(doc, config) {
  const ph = PAGE_H
  const pw = PAGE_W
  const hazardY = ph - 16

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, hazardY, pw - MARGIN, hazardY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  const footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
  const rif = (config && config.rif_negocio) || 'RIF: J-50115913-0'
  doc.text(`${footName} · ${rif}`, MARGIN, ph - 10)
  doc.text(`Comprobante de comisión emitido el ${new Date().toLocaleString('es-VE')}`, MARGIN, ph - 6)
  doc.text('Documento no negociable · Copia para el comisionista', pw - MARGIN, ph - 6, { align: 'right' })
}

async function generarComisionReciboPDFImpl({ comision = {}, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  const montoUsd = Number(comision.monto_usd || comision.monto || 0)
  const tasaVes = Number(comision.tasa_ves || 0)
  const montoBs = montoUsd * (tasaVes > 0 ? tasaVes : 1)
  const fecha = fmtFechaVE(comision.fecha || new Date().toISOString().slice(0, 10))

  // 1. Cabecera Corporativa Premium
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Recibo de Pago de Comisión',
    subtitle: `Comprobante Oficial de Egreso por Comisión · ${fecha}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true,
  })

  // Marca de agua
  drawWatermark(doc)

  // 2. Resumen KPI
  const kpiBoxW = CONTENT_W / 3
  const kpiBoxH = 18

  const kpis = [
    { label: 'MONTO COMISIÓN (USD)', value: fmtUsd(montoUsd), destacado: true },
    { label: 'TASA BCV APLICADA', value: tasaVes > 0 ? `Bs. ${tasaVes.toFixed(2)}` : 'Oficial BCV' },
    { label: 'EQUIVALENTE EN BS', value: `Bs. ${montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
  ]

  kpis.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW

    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')

    if (kpi.destacado) {
      doc.setFillColor(...C_PRIMARY)
      doc.rect(bx + 1, y, kpiBoxW - 2, 1.5, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(kpi.label, bx + 4, y + 6)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...(kpi.destacado ? C_PRIMARY : C_DARK))
    doc.text(kpi.value, bx + 4, y + 13)
  })

  y += kpiBoxH + 6

  // 3. Ficha del Comisionista y Datos de Pago
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, CONTENT_W, 28, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('DATOS DEL COMISIONISTA Y DEL PAGO', MARGIN + 4, y + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)

  const col1X = MARGIN + 4
  const col2X = MARGIN + CONTENT_W / 2 + 2

  doc.text(`Beneficiario: ${comision.empleado_nombre || 'Personal / Comisionista'}`, col1X, y + 12)
  doc.text(`Documento / C.I.: ${comision.empleado_documento || 'V-XXXXXXXX'}`, col1X, y + 18)
  doc.text(`Cargo / Rol: ${comision.cargo || 'Comisionista de Ventas / Obras'}`, col1X, y + 24)

  doc.text(`Fecha del Pago: ${fecha}`, col2X, y + 12)
  doc.text(`Método de Pago: ${comision.metodo_pago || 'Efectivo $'}`, col2X, y + 18)
  doc.text(`Referencia: ${comision.referencia || 'N/A (Liquidación directa)'}`, col2X, y + 24)

  y += 34

  // 4. Detalle y Concepto de la Comisión
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, CONTENT_W, 36, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('CONCEPTO Y DESCRIPCIÓN DE LA COMISIÓN', MARGIN + 4, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)

  const conceptoTexto = doc.splitTextToSize(
    comision.concepto || 'Pago de comisión por concepto de ventas, servicios o cumplimiento de metas operativas.',
    CONTENT_W - 8
  )
  doc.text(conceptoTexto, MARGIN + 4, y + 13)

  if (comision.observaciones) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.setTextColor(...C_GRAY)
    const obsTexto = doc.splitTextToSize(`Observaciones: ${comision.observaciones}`, CONTENT_W - 8)
    doc.text(obsTexto, MARGIN + 4, y + 26)
  }

  y += 42

  // 5. Total a Liquidar Destacado
  doc.setFillColor(241, 245, 249)
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, y, CONTENT_W, 16, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL LIQUIDADO AL COMISIONISTA:', MARGIN + 4, y + 10)

  doc.setFont('helvetica', 'black')
  doc.setFontSize(13)
  doc.setTextColor(...C_PRIMARY)
  doc.text(`${fmtUsd(montoUsd)} USD`, MARGIN + CONTENT_W - 4, y + 10, { align: 'right' })

  y += 26

  // 6. Firmas de Conformidad
  const sigBoxW = (CONTENT_W - 10) / 2
  const sigY = y + 10

  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.4)

  // Firma Entrega
  doc.line(MARGIN, sigY, MARGIN + sigBoxW, sigY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('ENTREGADO POR (ADMINISTRACIÓN)', MARGIN + sigBoxW / 2, sigY + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text('Construacero Carabobo C.A.', MARGIN + sigBoxW / 2, sigY + 8, { align: 'center' })

  // Firma Recibe
  const sig2X = MARGIN + sigBoxW + 10
  doc.line(sig2X, sigY, sig2X + sigBoxW, sigY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('RECIBIDO CONFORME (TRABAJADOR)', sig2X + sigBoxW / 2, sigY + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text(comision.empleado_nombre || 'Firma del Comisionista', sig2X + sigBoxW / 2, sigY + 8, { align: 'center' })

  // 7. Pie de Página
  drawFooter(doc, config)

  const cleanName = (comision.empleado_nombre || 'Comisionista').replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `Recibo_Comision_${cleanName}_${fecha.replace(/\//g, '-')}.pdf`

  if (action === 'download') {
    doc.save(fileName)
    return { ok: true, fileName }
  }

  if (action === 'blob') {
    return doc.output('blob')
  }

  const url = doc.output('bloburl')
  window.open(url, '_blank')
  return { ok: true, fileName }
}

export { generarComisionReciboPDFImpl };
