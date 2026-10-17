// src/services/pdf/periodoMensualPDF.impl.js
// Reporte profesional de tesorería y custodia de fondos por período mensual
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_EMERALD, C_RED, C_AMBER,
  fmtUsd, drawWatermark, drawPremiumHeader, drawSimplifiedHeader,
} from '../../../compat/services/pdf/pdfShared.js'
import { formatNumber } from '../../components/finanzas/formatos.js'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function formatPeriodoMes(mesIso) {
  if (!mesIso || typeof mesIso !== 'string') return '—'
  const parts = mesIso.split('-')
  if (parts.length >= 2) {
    const monthIdx = Number(parts[1]) - 1
    const year = parts[0]
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MESES[monthIdx]} ${year}`
    }
  }
  return mesIso
}

function checkPage(doc, y, needed = 25, logoData, config, titulo) {
  if (y + needed > PAGE_H - 20) {
    doc.addPage()
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, `${titulo} (Cont.)`, [255, 255, 255], [0, 0, 0])
    return MARGIN + 12
  }
  return y
}

function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, PAGE_H - 14, MARGIN + CONTENT_W, PAGE_H - 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    let footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    const rif = (config && config.rif_negocio) || 'RIF: J-50115913-0'
    doc.text(`${footName} · ${rif}`, MARGIN, PAGE_H - 9)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 5.5)
    doc.text(`Página ${p} de ${totalPages}`, MARGIN + CONTENT_W, PAGE_H - 9, { align: 'right' })
  }
}

function drawKpis(doc, y, kpis) {
  const boxH = 15
  const colW = CONTENT_W / kpis.length
  doc.setFillColor(250, 250, 252)
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 1.5, 1.5, 'F')
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 1.5, 1.5, 'S')

  kpis.forEach((kpi, i) => {
    if (i > 0) {
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.3)
      doc.line(MARGIN + i * colW, y + 2, MARGIN + i * colW, y + boxH - 2)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.label.toUpperCase(), MARGIN + i * colW + 4, y + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...kpi.color)
    doc.text(kpi.value, MARGIN + i * colW + 4, y + 9.5)

    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(140, 150, 165)
      doc.text(kpi.sub, MARGIN + i * colW + 4, y + 13)
    }
  })
  return y + boxH + 6
}

export async function generarPeriodoMensualPDFImpl({
  periodo = {},
  rates = {},
  config = {},
  action = 'download',
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  const mesTexto = formatPeriodoMes(periodo.mes)
  const titulo = 'CONTROL MENSUAL DE TESORERÍA'
  const estadoLabel = periodo.estado === 'abierto'
    ? 'Período Abierto'
    : periodo.estado === 'cerrado'
      ? 'Período Cerrado'
      : 'Sin Apertura'

  const subtitulo = `Mes: ${mesTexto} (${periodo.mes || '—'}) · Estado: ${estadoLabel}`

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, `${titulo} (Cont.)`, [255, 255, 255], [0, 0, 0])
  }

  // 1. Cabecera Corporativa
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: titulo,
    subtitle: subtitulo,
    customBgColor: [255, 255, 255],
    customAccentColor: [0, 0, 0],
    customTextColor: [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor: [0, 0, 0],
    centerBusinessName: true,
  })

  drawWatermark(doc)

  const wallets = periodo.cuentas || []

  // Totales
  const totalAperturaUsd = wallets.reduce((sum, row) => sum + (Number(row.saldoAperturaUsd) || 0), 0)
  const rateUsd = Number(rates?.usd) > 0 ? Number(rates.usd) : 1
  const rateUsdt = Number(rates?.usdt) > 0 ? Number(rates.usdt) : 1
  const totalCalculadoUsd = wallets.reduce((sum, row) => {
    const val = Number(row.saldoCalculado) || 0
    if (row.moneda === 'USD') return sum + val
    if (row.moneda === 'VES') return sum + (val / rateUsd)
    if (row.moneda === 'USDT') return sum + (val * rateUsdt / rateUsd)
    return sum + val
  }, 0)

  // 2. Tarjetas KPI
  y = drawKpis(doc, y, [
    {
      label: 'Apertura USD',
      value: fmtUsd(totalAperturaUsd),
      sub: `${wallets.length} cuenta(s) en libro`,
      color: C_EMERALD,
    },
    {
      label: 'Saldo Actual USD',
      value: fmtUsd(totalCalculadoUsd),
      sub: 'Valoración consolidada',
      color: C_PRIMARY,
    },
    {
      label: 'Tasa Principal',
      value: `${formatNumber(rates.principal || rates.usd)} VES`,
      sub: rates.nombrePrincipal || 'BCV Dólar',
      color: C_DARK,
    },
    {
      label: 'Tasas Congeladas',
      value: `$ ${formatNumber(rates.usd)} / T ${formatNumber(rates.usdt)}`,
      sub: `Fuente: ${rates.source || 'BCV'}`,
      color: C_DARK,
    },
  ])

  // 3. Tabla de Cuentas de Custodia
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_PRIMARY)
  doc.text('DETALLE DE CUENTAS DE CUSTODIA Y SALDOS', MARGIN, y)
  y += 4

  const cols = [
    { label: 'CUENTA',          x: MARGIN,        w: 52, align: 'left' },
    { label: 'DIVISA',          x: MARGIN + 52,   w: 16, align: 'center' },
    { label: 'SALDO APERTURA',  x: MARGIN + 68,   w: 32, align: 'right' },
    { label: 'USD CONGELADO',   x: MARGIN + 100,  w: 28, align: 'right' },
    { label: 'SALDO CALCULADO', x: MARGIN + 128,  w: 32, align: 'right' },
    { label: 'DIF. CIERRE',     x: MARGIN + 160,  w: 28, align: 'right' },
  ]

  // Encabezado de tabla
  const headerH = 6.5
  doc.setFillColor(...C_PRIMARY)
  doc.roundedRect(MARGIN, y, CONTENT_W, headerH, 1, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_WHITE)

  cols.forEach(col => {
    const posX = col.align === 'right' ? col.x + col.w - 2 : col.align === 'center' ? col.x + col.w / 2 : col.x + 2
    doc.text(col.label, posX, y + 4.3, { align: col.align })
  })
  y += headerH + 1

  // Filas
  const rowH = 6.2
  wallets.forEach((row, idx) => {
    y = checkPage(doc, y, rowH + 8, logoData, config, titulo)

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(MARGIN, y - 0.5, CONTENT_W, rowH, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text(String(row.nombre || '—'), cols[0].x + 2, y + 3.8)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(String(row.moneda || 'VES'), cols[1].x + cols[1].w / 2, y + 3.8, { align: 'center' })

    const saldoAperturaTxt = row.saldoApertura != null ? `${formatNumber(row.saldoApertura)} ${row.moneda}` : '—'
    doc.text(saldoAperturaTxt, cols[2].x + cols[2].w - 2, y + 3.8, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_EMERALD)
    const usdCongeladoTxt = row.saldoAperturaUsd != null ? `$${formatNumber(row.saldoAperturaUsd)}` : '—'
    doc.text(usdCongeladoTxt, cols[3].x + cols[3].w - 2, y + 3.8, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_DARK)
    const saldoCalcTxt = row.saldoCalculado != null ? `${formatNumber(row.saldoCalculado)} ${row.moneda}` : '—'
    doc.text(saldoCalcTxt, cols[4].x + cols[4].w - 2, y + 3.8, { align: 'right' })

    const difCierre = row.diferenciaCierre != null ? Number(row.diferenciaCierre) : null
    if (difCierre != null) {
      doc.setTextColor(difCierre === 0 ? 100 : 180, difCierre === 0 ? 116 : 30, difCierre === 0 ? 139 : 30)
      doc.text(`${formatNumber(difCierre)} ${row.moneda}`, cols[5].x + cols[5].w - 2, y + 3.8, { align: 'right' })
    } else {
      doc.setTextColor(160, 174, 192)
      doc.text('—', cols[5].x + cols[5].w - 2, y + 3.8, { align: 'right' })
    }

    doc.setDrawColor(241, 245, 249)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, y + rowH - 0.5, MARGIN + CONTENT_W, y + rowH - 0.5)

    y += rowH
  })

  // Fila de Totales
  y = checkPage(doc, y, 9, logoData, config, titulo)
  y += 1
  doc.setFillColor(241, 245, 249)
  doc.roundedRect(MARGIN, y, CONTENT_W, 7, 1, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_PRIMARY)
  doc.text('TOTAL CONSOLIDADO USD', MARGIN + 4, y + 4.5)

  doc.setTextColor(...C_EMERALD)
  doc.text(fmtUsd(totalAperturaUsd), cols[3].x + cols[3].w - 2, y + 4.5, { align: 'right' })

  doc.setTextColor(...C_PRIMARY)
  doc.text(fmtUsd(totalCalculadoUsd), cols[4].x + cols[4].w - 2, y + 4.5, { align: 'right' })
  y += 12

  // 4. Auditoría y Firma
  y = checkPage(doc, y, 16, logoData, config, titulo)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(
    'Nota de Auditoría: Este reporte certifica la apertura y saldos de custodia según las tasas congeladas del período. Toda variación posterior de mercado no reescribe la contravaloración inicial.',
    MARGIN, y, { maxWidth: CONTENT_W }
  )

  // Pie de página en todas las páginas
  drawFooter(doc, config)

  const filename = `tesoreria-${periodo.mes || 'periodo'}.pdf`
  if (action === 'download') {
    doc.save(filename)
  }
  return doc
}
