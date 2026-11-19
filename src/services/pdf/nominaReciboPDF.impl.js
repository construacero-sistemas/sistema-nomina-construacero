// src/services/pdf/nominaReciboPDF.js
// Recibo de pago individual de nómina para los trabajadores de Construacero Carabobo C.A.
// Formato profesional homologado con el reporte corporativo de la empresa.
import { jsPDF } from 'jspdf'
import { cargarLogo } from '../../../compat/services/pdf/pdfLogo.js'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_GRAY, C_AMBER, C_EMERALD, C_RED,
  fmtUsd, fmtBs, fmtFecha, drawWatermark, drawPremiumHeader,
} from '../../../compat/services/pdf/pdfShared.js'
import { formatHora12 } from '../../utils/timeUtils.js'
import { desgloseDescanso, desgloseSemana } from '../../utils/descansoRecibo.js'
import { etiquetaMotivoDescuento } from '../../../server/lib/nominaDescuentos.js'

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

  // Línea divisoria superior del footer
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, hazardY, pw - MARGIN, hazardY)

  // Datos fiscales y legales
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  const footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
  const rif = (config && config.rif_negocio) || 'RIF: J-50115913-0'
  doc.text(`${footName} · ${rif}`, MARGIN, ph - 10)
  doc.text(`Comprobante de pago emitido el ${new Date().toLocaleString('es-VE')}`, MARGIN, ph - 6)
  doc.text('Documento no negociable · Copia para el trabajador', pw - MARGIN, ph - 6, { align: 'right' })
}

// Tasa con la que se muestran los bolívares del recibo: la guardada al pagar manda;
// si no está pagado, la que manda el detalle del período (cierre o activa).
function tasaDelRecibo(linea, tasa, tasaOrigen) {
  const pago = Number(linea.tasa_pago_usd_ves)
  if (linea.pagado && pago > 0) return { valor: pago, origen: 'guardada al pagar' }
  const valor = Number(tasa)
  if (valor > 0) return { valor, origen: tasaOrigen === 'cierre' ? 'del cierre del período' : 'activa' }
  return null
}

// Dibuja un recibo completo en la página actual del documento (una página por recibo).
function dibujarRecibo(doc, { periodo = {}, linea = {}, config = {}, tasa = null, tasaOrigen = 'activa', logoData = null }) {
  const tasaBs = tasaDelRecibo(linea, tasa, tasaOrigen)
  const aBs = usd => fmtBs((Number(usd) || 0) * (tasaBs?.valor || 0))

  // ═══ 1. CABECERA PREMIUM CORPORATIVA (ESTILO CONSTRUACERO) ═════════════════
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Recibo de Pago de Nómina',
    subtitle: `${periodo.nombre || 'Período'} · ${fmtFechaVE(periodo.desde)} — ${fmtFechaVE(periodo.hasta)}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true,
  })

  // Marca de agua centralizada
  drawWatermark(doc)

  // ═══ 2. KPIs RESUMEN SUPERIOR ══════════════════════════════════════════════
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 20

  const kpis = [
    { label: 'DÍAS LABORADOS', value: `${Number(linea.dias_trabajados || 0)} días`, sub: `${Number(linea.dias_ausencia || 0)} falta(s)` },
    { label: 'HORAS TOTALES', value: `${Number(linea.horas_trabajadas || 0).toFixed(1)} h`, sub: `${Number(linea.horas_extra || 0).toFixed(1)}h extra` },
    { label: 'SALARIO BASE / DÍA', value: fmtUsd(linea.salario_dia_usd_snap), sub: `Jornada: ${Number(linea.horas_jornada_snap || 8)}h` },
    { label: 'NETO A COBRAR', value: fmtUsd(linea.total_neto_usd), destacado: true, sub: 'USD Neto' },
  ]

  kpis.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW

    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')

    // Destacado: solo un borde fino más oscuro, sin relleno de color (ahorra tinta).
    if (kpi.destacado) {
      doc.setDrawColor(148, 163, 184)
      doc.setLineWidth(0.3)
      doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'S')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.label, bx + 3.5, y + 5.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...(kpi.destacado ? C_EMERALD : C_DARK))
    doc.text(kpi.value, bx + 3.5, y + 12.5)

    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(148, 163, 184)
      doc.text(kpi.sub, bx + 3.5, y + 17)
    }
  })

  y += kpiBoxH + 6

  // ═══ 3. DATOS DEL TRABAJADOR ═══════════════════════════════════════════════
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, CONTENT_W, 22, 2, 2, 'FD')

  // Fila 1 de datos
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text('TRABAJADOR / EMPLEADO', MARGIN + 4, y + 5)
  doc.text('CÉDULA / DOCUMENTO', MARGIN + 75, y + 5)
  doc.text('CARGO U OCUPACIÓN', MARGIN + 130, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_DARK)
  doc.text(String(linea.empleado?.nombre || '—').toUpperCase(), MARGIN + 4, y + 10)
  doc.text(String(linea.empleado?.documento || linea.empleado?.rif || '—'), MARGIN + 75, y + 10)
  doc.text(String(linea.cargo_snap || 'Personal General').toUpperCase(), MARGIN + 130, y + 10)

  // Fila 2 de datos
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text('DÍAS TRABAJADOS', MARGIN + 4, y + 16)
  doc.text('HORARIO ASIGNADO', MARGIN + 75, y + 16)
  doc.text('ESTADO DE CUENTA', MARGIN + 130, y + 16)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text(String(Number(linea.dias_trabajados || 0)), MARGIN + 4, y + 20)
  doc.text(`${formatHora12(linea.hora_inicio_snap || '08:00')} a ${formatHora12(linea.hora_fin_snap || '17:00')} (${Number(linea.horas_jornada_snap || 8)}h efectivas)`, MARGIN + 75, y + 20)
  doc.text(linea.pagado ? 'LIQUIDADO / PAGADO' : 'PENDIENTE DE PAGO', MARGIN + 130, y + 20)

  y += 28

  // ═══ 4. TABLA DE ASIGNACIONES Y DEDUCCIONES ═══════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Detalle de Asignaciones y Deducciones', MARGIN, y + 2)
  if (tasaBs) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_EMERALD)
    doc.text(`Tasa de nómina: ${Number(tasaBs.valor).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs por $1 (${tasaBs.origen})`, MARGIN + CONTENT_W, y + 2, { align: 'right' })
  }
  y += 5
  // Con tasa, el monto en dólares se corre a la izquierda y se agrega la columna en Bs.
  const xUsd = tasaBs ? MARGIN + CONTENT_W - 40 : MARGIN + CONTENT_W - 3
  const xCant = tasaBs ? MARGIN + 78 : MARGIN + 95
  const xTarifa = tasaBs ? MARGIN + 100 : MARGIN + 135

  // Header de la tabla (Gris corporate)
  doc.setFillColor(240, 242, 245)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(80, 90, 110)
  doc.text('CONCEPTO LABORAL', MARGIN + 3, y + 4.5)
  doc.text('CANTIDAD', xCant, y + 4.5)
  doc.text('TARIFA BASE', xTarifa, y + 4.5)
  doc.text('MONTO (USD)', xUsd, y + 4.5, { align: 'right' })
  if (tasaBs) doc.text('MONTO (Bs)', MARGIN + CONTENT_W - 3, y + 4.5, { align: 'right' })
  y += 8.5

  const diasTrab = Number(linea.dias_trabajados || 0)
  const salarioDia = Number(linea.salario_dia_usd_snap || 0)
  const tarifaHora = salarioDia > 0 && Number(linea.horas_jornada_snap || 8) > 0
    ? salarioDia / Number(linea.horas_jornada_snap || 8)
    : 0

  const descanso = desgloseDescanso(linea)
  // Regla del usuario (19/11/2026): el recibo separa sueldo semanal y bono semanal
  // (el bono sale de la semana, no se suma). Recibos anteriores a la migración 268
  // conservan los conceptos de días laborados y descanso.
  const semana = desgloseSemana(linea)
  // Días de la semana: trabajados en días laborables + pagados sin trabajar.
  const diasSemana = semana && salarioDia > 0 ? Math.round(((semana.sueldo + semana.bono) / salarioDia) * 10) / 10 : 0
  const conceptos = semana ? [
    {
      label: 'Sueldo Semanal (semana menos el bono)',
      cant: `${diasSemana} día(s)`,
      tarifa: `${fmtUsd(salarioDia)} / día`,
      monto: semana.sueldo,
      tipo: 'ingreso',
    },
    {
      label: 'Bono Semanal',
      cant: '—',
      tarifa: '—',
      monto: semana.bono,
      tipo: 'ingreso',
    },
  ] : [
    {
      label: 'Salario Base por Días Laborados',
      cant: `${diasTrab} días`,
      tarifa: `${fmtUsd(salarioDia)} / día`,
      monto: descanso.montoTrabajado,
      tipo: 'ingreso',
    },
  ]

  if (semana && semana.resto > 0) {
    conceptos.push({
      label: 'Descanso o Feriado Trabajado',
      cant: '—',
      tarifa: `${fmtUsd(salarioDia)} / día`,
      monto: semana.resto,
      tipo: 'ingreso',
    })
  }

  if (!semana && descanso.diasDescanso > 0) {
    conceptos.push({
      label: 'Descanso, feriados y faltas justificadas pagados',
      cant: `${descanso.diasDescanso} día(s)`,
      tarifa: `${fmtUsd(salarioDia)} / día`,
      monto: descanso.montoDescanso,
      tipo: 'ingreso',
    })
  }

  if (Number(linea.horas_extra || 0) > 0) {
    conceptos.push({
      label: 'Horas Extraordinarias (Recargo según ley)',
      cant: `${Number(linea.horas_extra).toFixed(1)} h`,
      tarifa: `${fmtUsd(tarifaHora * 1.5)} / h`,
      monto: Number(linea.monto_extra_usd || 0),
      tipo: 'ingreso',
    })
  }

  if (Number(linea.dias_sabado || 0) > 0) {
    conceptos.push({
      label: 'Recargo por Trabajo en Día Sábado',
      cant: `${Number(linea.dias_sabado)} día(s)`,
      tarifa: `${fmtUsd(salarioDia * 1.5)} / día`,
      monto: Number(linea.monto_sabado_usd || 0),
      tipo: 'ingreso',
    })
  }

  if (Number(linea.dias_feriado || 0) > 0) {
    conceptos.push({
      label: 'Recargo por Trabajo en Día Feriado / Festivo',
      cant: `${Number(linea.dias_feriado)} día(s)`,
      tarifa: `${fmtUsd(salarioDia * 1.5)} / día`,
      monto: Number(linea.monto_feriado_usd || 0),
      tipo: 'ingreso',
    })
  }

  if (Number(linea.bonos_usd || 0) > 0) {
    conceptos.push({
      label: linea.nota_bonos ? `Bonificaciones / Extras — ${linea.nota_bonos}` : 'Bonificación Especial / Asignación Adicional',
      cant: '1 global',
      tarifa: '—',
      monto: Number(linea.bonos_usd || 0),
      tipo: 'bono',
    })
  }

  if (Number(linea.comisiones_pos_usd || 0) > 0) {
    const despachosCount = Array.isArray(linea.comisiones_despachos_ids)
      ? linea.comisiones_despachos_ids.length
      : 0
    conceptos.push({
      label: despachosCount > 0
        ? `Comisiones por Ventas (POS) — ${despachosCount} despacho(s) liquidado(s)`
        : 'Comisiones por Ventas (POS)',
      cant: despachosCount > 0 ? `${despachosCount} desp.` : '1 global',
      tarifa: '—',
      monto: Number(linea.comisiones_pos_usd || 0),
      tipo: 'bono',
    })
  }

  // Cada descuento se imprime con su motivo obligatorio. Los recibos
  // anteriores al desglose conservan su deducción global con el resumen histórico.
  const descuentosDetalle = (Array.isArray(linea.descuentos) ? linea.descuentos : [])
    .filter(d => Number(d.monto_usd) > 0)
  if (descuentosDetalle.length) {
    for (const d of descuentosDetalle) {
      conceptos.push({
        label: `Descuento — ${etiquetaMotivoDescuento(d.motivo)}${d.detalle ? ` · ${d.detalle}` : ''}`,
        cant: '1 global',
        tarifa: '—',
        monto: Number(d.monto_usd),
        tipo: 'deduccion',
      })
    }
  } else if (Number(linea.deducciones_usd || 0) > 0) {
    conceptos.push({
      label: linea.nota_deducciones ? `Deducciones / Préstamos — ${linea.nota_deducciones}` : 'Deducciones de Nómina / Anticipos',
      cant: '1 global',
      tarifa: '—',
      monto: Number(linea.deducciones_usd || 0),
      tipo: 'deduccion',
    })
  }

  conceptos.forEach((c, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 7, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...(c.tipo === 'deduccion' ? C_RED : C_DARK))
    doc.text(c.label, MARGIN + 3, y + 3.5)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(c.cant, xCant, y + 3.5)
    doc.text(c.tarifa, xTarifa, y + 3.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(c.tipo === 'deduccion' ? C_RED : c.tipo === 'bono' ? C_EMERALD : C_DARK))
    const montoText = c.tipo === 'deduccion' ? `- ${fmtUsd(c.monto)}` : fmtUsd(c.monto)
    doc.text(montoText, xUsd, y + 3.5, { align: 'right' })
    if (tasaBs) {
      doc.setFont('helvetica', 'normal')
      doc.text(c.tipo === 'deduccion' ? `- ${aBs(c.monto)}` : aBs(c.monto), MARGIN + CONTENT_W - 3, y + 3.5, { align: 'right' })
    }

    y += 7.5
  })

  // ═══ 5. CUADRO DE TOTALES Y NETO ═══════════════════════════════════════════
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 4

  const totalBruto = Number(linea.total_bruto_usd || 0)
  const totalDeduc = Number(linea.deducciones_usd || 0)
  const totalNeto  = Number(linea.total_neto_usd || 0)

  // Subtotales
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text('TOTAL ASIGNACIONES BRUTAS (USD):', MARGIN + 85, y + 3)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C_DARK)
  doc.text(fmtUsd(totalBruto), xUsd, y + 3, { align: 'right' })
  if (tasaBs) doc.text(aBs(totalBruto), MARGIN + CONTENT_W - 3, y + 3, { align: 'right' })
  y += 5.5

  if (totalDeduc > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text('TOTAL RETENCIONES / DEDUCCIONES (USD):', MARGIN + 85, y + 3)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_RED)
    doc.text(`- ${fmtUsd(totalDeduc)}`, xUsd, y + 3, { align: 'right' })
    if (tasaBs) doc.text(`- ${aBs(totalDeduc)}`, MARGIN + CONTENT_W - 3, y + 3, { align: 'right' })
    y += 5.5
  }

  // Cuadro destacado de Total Neto
  y += 2
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, CONTENT_W, 14, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL NETO A PAGAR AL TRABAJADOR', MARGIN + 8, y + 8.5)

  doc.setFontSize(13)
  doc.setTextColor(...C_EMERALD)
  if (tasaBs) {
    // Neto en dólares y, al lado, su cambio en bolívares (el congelado al pagar si existe).
    const netoBs = linea.pagado && Number(linea.total_pagado_bs) > 0 ? fmtBs(linea.total_pagado_bs) : aBs(totalNeto)
    doc.text(fmtUsd(totalNeto), xUsd, y + 9.5, { align: 'right' })
    doc.setFontSize(11)
    doc.text(netoBs, MARGIN + CONTENT_W - 3, y + 9.5, { align: 'right' })
  } else {
    doc.text(fmtUsd(totalNeto), MARGIN + CONTENT_W - 5, y + 9.5, { align: 'right' })
  }

  y += 19

  // ═══ 6. COMPROBANTE DE PAGO (SI APLICA) ═════════════════════════════════════
  if (linea.pagado) {
    // Caja clara con borde fino verde: el estado se lee sin gastar tinta en relleno.
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(16, 185, 129)
    doc.setLineWidth(0.3)
    doc.roundedRect(MARGIN, y, CONTENT_W, 11, 2, 2, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_EMERALD)
    doc.text('COMPROBANTE DE PAGO EFECTUADO', MARGIN + 5, y + 4.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    const fechaPago = linea.pagado_en ? fmtFechaVE(linea.pagado_en) : '—'
    const ref = linea.referencia_pago ? `Ref: ${linea.referencia_pago}` : 'Ref: N/A'
    // Tasa y monto en Bs congelados en el recibo al momento del pago (migración 241).
    // Recibos pagados antes de la 241 no tienen tasa congelada: se omiten ambas líneas
    // para no inventar una conversión retroactiva.
    const tasa = linea.tasa_pago_usd_ves > 0
      ? `Tasa de pago: ${Number(linea.tasa_pago_usd_ves).toLocaleString('es-VE', { maximumFractionDigits: 2 })} Bs/$`
      : null
    const montoBs = linea.total_pagado_bs > 0
      ? `Total: ${fmtBs(linea.total_pagado_bs)}`
      : null
    const pagoInfo = [fechaPago, ref, tasa, montoBs].filter(Boolean).join('   ·   ')
    doc.text(pagoInfo, MARGIN + 5, y + 8.5)

    y += 16
  }

  // ═══ 7. FIRMAS DE CONFORMIDAD ═══════════════════════════════════════════════
  const firmaY = PAGE_H - 42
  const firmaW = (CONTENT_W - 25) / 2

  // Firma del Trabajador
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, firmaY, MARGIN + firmaW, firmaY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('RECIBÍ CONFORME (TRABAJADOR)', MARGIN, firmaY + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Nombre: ${String(linea.empleado?.nombre || '—').toUpperCase()}`, MARGIN, firmaY + 8)
  doc.text(`C.I. / Documento: ${linea.empleado?.documento || linea.empleado?.rif || '—'}`, MARGIN, firmaY + 11.5)

  // Firma y Sello de la Empresa
  const firmaEmpresaX = MARGIN + firmaW + 25
  doc.line(firmaEmpresaX, firmaY, firmaEmpresaX + firmaW, firmaY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO C.A.', firmaEmpresaX, firmaY + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text('Firma y Sello Autorizado', firmaEmpresaX, firmaY + 8)
  doc.text('Administración / Gerencia', firmaEmpresaX, firmaY + 11.5)

  // Pie de página corporativo
  drawFooter(doc, config)
}

async function generarNominaReciboPDFImpl({ periodo = {}, linea = {}, config = {}, action = 'download', tasa = null, tasaOrigen = 'activa' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  dibujarRecibo(doc, { periodo, linea, config, tasa, tasaOrigen, logoData })

  const slug = String(linea.empleado?.nombre || 'empleado').replace(/[^\w]+/g, '-').toLowerCase()
  const nombreArch = `recibo-${slug}-${(periodo.nombre || '').replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}

// Mejora del 19/11/2026: todos los recibos de un período en un solo PDF, uno por
// página, generado en el navegador (no gasta consultas de Supabase).
async function generarNominaRecibosPeriodoPDFImpl({ periodo = {}, lineas = [], config = {}, tasa = null, tasaOrigen = 'activa', action = 'download' }) {
  if (!lineas.length) throw new Error('El período no tiene recibos')
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  lineas.forEach((linea, i) => {
    if (i > 0) doc.addPage()
    dibujarRecibo(doc, { periodo, linea, config, tasa, tasaOrigen, logoData })
  })
  const nombreArch = `recibos-${(periodo.nombre || 'periodo').replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombreArch)
  }
}

export { generarNominaReciboPDFImpl, generarNominaRecibosPeriodoPDFImpl };
