// src/services/pdf/finanzasResumenPDF.impl.js
// Reporte financiero por rango de fechas: cabecera clara corporativa, KPIs del período,
// desglose por categorías con totales específicos y detalle agrupado por categoría.
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import { WATERMARK_LOGO } from '../../../compat/services/pdf/watermarkBase64.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY, C_EMERALD, C_RED,
  fmtUsd, fmtBs, drawWatermark, drawPremiumHeader, drawSimplifiedHeader,
} from '../../../compat/services/pdf/pdfShared.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

function fecha(f) {
  if (!f) return '—'
  const dateStr = String(f).includes('T') ? String(f) : `${f}T12:00:00`
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
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
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    const rif = (config && config.rif_negocio) || 'RIF: J-50115913-0'
    doc.text(`${footName} · ${rif}`, MARGIN, PAGE_H - 9)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 5.5)
    doc.text(`Página ${p} de ${totalPages}`, MARGIN + CONTENT_W, PAGE_H - 9, { align: 'right' })
  }
}

// Fila de KPIs con diseño claro y bordes suaves
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
    doc.setFontSize(9.5)
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

  // Sobrescribir addPage para incluir watermark y cabecera clara simplificada
  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, `${titulo} (Cont.)`, [255, 255, 255], [0, 0, 0])
  }

  // ═══ 1. CABECERA CLARA CORPORATIVA (ESTILO CONSTRUACERO) ═══════════════════
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: titulo,
    subtitle: `${fecha(rango.desde)} – ${fecha(rango.hasta)}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true,
  })

  drawWatermark(doc)

  const nMovs = movimientos.length
  const ingresos = nMovs ? movimientos.filter(m => m.tipo === 'ingreso' && m.estado !== 'anulado') : []
  const egresos = nMovs ? movimientos.filter(m => m.tipo === 'egreso' && m.estado !== 'anulado') : []

  // Totales precisos considerando movimientos en USD, USDT y VES
  const calcMontoUsd = (m) => {
    const monto = Number(m.monto) || 0
    const tasa = Number(m.tasa_usd_ves || m.tasa_ves || 1)
    return m.moneda === 'VES' ? (tasa > 0 ? monto / tasa : monto) : monto
  }
  const calcMontoVes = (m) => {
    const monto = Number(m.monto) || 0
    const tasa = Number(m.tasa_usd_ves || m.tasa_ves || 1)
    return m.moneda === 'VES' ? (Number(m.monto_ves) || monto) : (Number(m.monto_ves) || (monto * tasa))
  }

  const totalIngresosUsd = ingresos.reduce((sum, m) => sum + calcMontoUsd(m), 0)
  const totalIngresosVes = ingresos.reduce((sum, m) => sum + calcMontoVes(m), 0)
  const totalEgresosUsd = egresos.reduce((sum, m) => sum + calcMontoUsd(m), 0)
  const totalEgresosVes = egresos.reduce((sum, m) => sum + calcMontoVes(m), 0)
  const balanceUsd = totalIngresosUsd - totalEgresosUsd
  const balanceVes = totalIngresosVes - totalEgresosVes

  // ═══ 2. KPIS DEL PERÍODO ═══════════════════════════════════════════════════
  y = drawKpis(doc, y, [
    { label: 'Ingresos', value: fmtUsd(totalIngresosUsd), sub: `Bs ${totalIngresosVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: C_EMERALD },
    { label: 'Egresos', value: fmtUsd(totalEgresosUsd), sub: `Bs ${totalEgresosVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: C_RED },
    { label: 'Flujo neto', value: fmtUsd(balanceUsd), sub: `Bs ${balanceVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: balanceUsd >= 0 ? C_PRIMARY : C_RED },
    { label: 'Movimientos', value: String(ingresos.length + egresos.length), sub: `${movimientos.filter(m => m.estado === 'anulado').length} anulado(s)`, color: C_DARK },
  ])

  // ═══ 3. AGRUPACIÓN Y TOTALES POR CATEGORÍA ═════════════════════════════════
  const categoriasMap = new Map()

  movimientos.forEach(m => {
    const catNombre = capitalizarPalabras(String(m.categoria || 'Sin categoría').trim() || 'Sin categoría')
    if (!categoriasMap.has(catNombre)) {
      categoriasMap.set(catNombre, {
        nombre: catNombre,
        movimientos: [],
        totalIngresosUsd: 0,
        totalEgresosUsd: 0,
        totalIngresosVes: 0,
        totalEgresosVes: 0,
        activosCount: 0,
        anuladosCount: 0,
      })
    }
    const cat = categoriasMap.get(catNombre)
    cat.movimientos.push(m)

    if (m.estado !== 'anulado') {
      cat.activosCount++
      const mUsd = calcMontoUsd(m)
      const mVes = calcMontoVes(m)

      if (m.tipo === 'ingreso') {
        cat.totalIngresosUsd += mUsd
        cat.totalIngresosVes += mVes
      } else {
        cat.totalEgresosUsd += mUsd
        cat.totalEgresosVes += mVes
      }
    } else {
      cat.anuladosCount++
    }
  })

  // Ordenar categorías por volumen de operaciones
  const categoriasList = Array.from(categoriasMap.values()).sort((a, b) => {
    const volA = a.totalIngresosUsd + a.totalEgresosUsd
    const volB = b.totalIngresosUsd + b.totalEgresosUsd
    return volB - volA
  })

  // ═══ 4. TABLA EJECUTIVA: DESGLOSE Y TOTALES POR CATEGORÍA ══════════════════
  if (categoriasList.length > 0) {
    y = drawSectionTitle(doc, y, 'DESGLOSE Y TOTALES POR CATEGORÍA')

    const colsCat = [
      { label: 'CATEGORÍA',      x: MARGIN,        w: 64, align: 'left' },
      { label: 'TIPO',           x: MARGIN + 64,   w: 24, align: 'left' },
      { label: 'MOVIMIENTOS',    x: MARGIN + 88,   w: 22, align: 'center' },
      { label: 'TOTAL (USD)',    x: MARGIN + 110,  w: 36, align: 'right' },
      { label: 'TOTAL (VES)',    x: MARGIN + 146,  w: 42, align: 'right' },
    ]

    function catHeaders(yPos) {
      doc.setFillColor(...C_PRIMARY)
      doc.rect(MARGIN, yPos, CONTENT_W, 6.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6)
      doc.setTextColor(...C_WHITE)
      colsCat.forEach(c => {
        if (c.align === 'right') {
          doc.text(c.label, c.x + c.w - 2, yPos + 4.5, { align: 'right' })
        } else if (c.align === 'center') {
          doc.text(c.label, c.x + c.w / 2, yPos + 4.5, { align: 'center' })
        } else {
          doc.text(c.label, c.x + 2, yPos + 4.5)
        }
      })
      return yPos + 7.5
    }

    y = catHeaders(y)

    categoriasList.forEach((cat, idx) => {
      y = checkPage(doc, y, 7)
      if (y < MARGIN + 14) y = catHeaders(y)

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      const tieneIngresos = cat.totalIngresosUsd > 0
      const tieneEgresos = cat.totalEgresosUsd > 0
      const tipoLabel = tieneIngresos && tieneEgresos ? 'Mixto' : tieneIngresos ? 'Ingreso' : 'Egreso'
      const tipoColor = tieneIngresos && tieneEgresos ? C_PRIMARY : tieneIngresos ? C_EMERALD : C_RED

      // Nombre categoría
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text(cat.nombre.substring(0, 36), colsCat[0].x + 2, y + 3)

      // Tipo
      doc.setTextColor(...tipoColor)
      doc.text(tipoLabel, colsCat[1].x + 2, y + 3)

      // Movimientos
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C_GRAY)
      doc.text(`${cat.activosCount} mov(s)`, colsCat[2].x + colsCat[2].w / 2, y + 3, { align: 'center' })

      // Total USD de la categoría
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...tipoColor)
      const textoUsd = tieneIngresos && tieneEgresos
        ? `+${fmtUsd(cat.totalIngresosUsd)} / -${fmtUsd(cat.totalEgresosUsd)}`
        : fmtUsd(tieneIngresos ? cat.totalIngresosUsd : cat.totalEgresosUsd)
      doc.text(textoUsd, colsCat[3].x + colsCat[3].w - 2, y + 3, { align: 'right' })

      // Total VES de la categoría
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C_GRAY)
      const totalVes = tieneIngresos ? cat.totalIngresosVes : cat.totalEgresosVes
      doc.text(`Bs ${totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, colsCat[4].x + colsCat[4].w - 2, y + 3, { align: 'right' })

      y += 6.5
    })

    y = checkPage(doc, y, 6)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
    y += 5
  }

  // ═══ 5. DETALLE DE MOVIMIENTOS DESGLOSADO POR CATEGORÍA ════════════════════
  y = checkPage(doc, y, 22)
  y = drawSectionTitle(doc, y, 'DETALLE DE MOVIMIENTOS POR CATEGORÍA')

  // Total ancho: 22 + 14 + 68 + 32 + 24 + 28 = 188 mm (CONTENT_W)
  const cols = [
    { label: 'FECHA',           x: MARGIN,        w: 22 },
    { label: 'TIPO',            x: MARGIN + 22,   w: 14 },
    { label: 'CONCEPTO',        x: MARGIN + 36,   w: 68 },
    { label: 'CUENTA / MÉTODO', x: MARGIN + 104,  w: 32 },
    { label: 'MONTO',           x: MARGIN + 136,  w: 24 },
    { label: 'EQUIV. BS',       x: MARGIN + 160,  w: 28 },
  ]

  function movHeaders(yPos) {
    doc.setFillColor(...C_PRIMARY)
    doc.rect(MARGIN, yPos, CONTENT_W, 6.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...C_WHITE)
    cols.forEach(c => {
      if (c.label === 'MONTO' || c.label === 'EQUIV. BS') {
        doc.text(c.label, c.x + c.w - 2, yPos + 4.5, { align: 'right' })
      } else {
        doc.text(c.label, c.x + 1.5, yPos + 4.5)
      }
    })
    return yPos + 7.5
  }

  categoriasList.forEach((cat) => {
    // Espacio para banner de categoría + columnas + al menos 1 fila
    y = checkPage(doc, y, 22)

    const tieneIngresos = cat.totalIngresosUsd > 0
    const tieneEgresos = cat.totalEgresosUsd > 0
    const catColor = tieneIngresos && !tieneEgresos ? C_EMERALD : !tieneIngresos && tieneEgresos ? C_RED : C_PRIMARY

    // Banner de Categoría
    doc.setFillColor(243, 244, 246)
    doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
    doc.setFillColor(...catColor)
    doc.rect(MARGIN, y, 3, 6.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    doc.text(`CATEGORÍA: ${cat.nombre.toUpperCase()}`, MARGIN + 5, y + 4.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(`${cat.movimientos.length} movimiento(s)`, MARGIN + CONTENT_W - 3, y + 4.5, { align: 'right' })

    y += 7.5
    y = movHeaders(y)

    cat.movimientos.forEach((m, idx) => {
      y = checkPage(doc, y, 7)
      if (y < MARGIN + 14) {
        y = movHeaders(y)
      }

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      const esIngreso = m.tipo === 'ingreso'
      const anul = m.estado === 'anulado'
      const monto = Number(m.monto) || 0
      const montoVes = calcMontoVes(m)

      // Fecha
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_GRAY)
      doc.text(fecha(m.fecha).replace(/\s/g, ' '), cols[0].x + 1.5, y + 3)

      // Tipo
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...(anul ? C_GRAY : esIngreso ? C_EMERALD : C_RED))
      doc.text(esIngreso ? 'ING' : 'EGR', cols[1].x + 1.5, y + 3)

      // Concepto
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...(anul ? C_GRAY : C_DARK))
      doc.text(capitalizarPalabras(String(m.concepto || '—')).substring(0, 46), cols[2].x + 1.5, y + 3)

      // Cuenta / Método
      doc.setFontSize(5.5)
      doc.setTextColor(...C_GRAY)
      const cuentaTxt = capitalizarPalabras(String(m.cuenta_origen || m.metodo_pago || '')).substring(0, 22) || '—'
      doc.text(cuentaTxt, cols[3].x + 1.5, y + 3)

      // Monto
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...(anul ? C_GRAY : esIngreso ? C_EMERALD : C_RED))
      const montoTexto = m.moneda === 'VES' ? fmtBs(monto) : fmtUsd(monto)
      doc.text(montoTexto, cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })

      // Equivalente en Bs
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C_GRAY)
      doc.text(fmtBs(montoVes).replace('Bs ', ''), cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })

      // Tachado si anulado
      if (anul) {
        doc.setDrawColor(...C_GRAY)
        doc.setLineWidth(0.2)
        doc.line(cols[2].x + 1.5, y + 2, cols[2].x + 1.5 + 44, y + 2)
      }

      y += 6
    })

    // Fila de Total de la Categoría
    y = checkPage(doc, y, 7.5)
    doc.setFillColor(245, 247, 250)
    doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    doc.setDrawColor(220, 226, 235)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
    doc.line(MARGIN, y + 5.5, MARGIN + CONTENT_W, y + 5.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(`TOTAL ${cat.nombre.toUpperCase()}:`, cols[0].x + 2, y + 3)

    // Total USD de la categoría
    const netoCatUsd = cat.totalIngresosUsd - cat.totalEgresosUsd
    doc.setTextColor(...(netoCatUsd >= 0 ? C_EMERALD : C_RED))
    doc.text(fmtUsd(netoCatUsd), cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })

    // Total VES de la categoría
    const netoCatVes = cat.totalIngresosVes - cat.totalEgresosVes
    doc.setTextColor(...C_GRAY)
    doc.text(`Bs ${netoCatVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })

    y += 9.5
  })

  // ═══ 6. GRAN TOTAL CONSOLIDADO ═════════════════════════════════════════════
  y = checkPage(doc, y, 12)
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTALES GENERALES', cols[0].x + 1.5, y + 5.5)
  doc.text(`${ingresos.length} ing · ${egresos.length} egr`, cols[2].x + 1.5, y + 5.5)
  doc.text(fmtUsd(balanceUsd), cols[4].x + cols[4].w - 2, y + 5.5, { align: 'right' })
  doc.text(`Bs ${balanceVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cols[5].x + cols[5].w - 2, y + 5.5, { align: 'right' })

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
