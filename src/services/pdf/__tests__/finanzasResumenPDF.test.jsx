// @vitest-environment jsdom
// src/services/pdf/__tests__/finanzasResumenPDF.test.js
// Tests del generador de PDF financiero: totales, tachado de anulados,
// nombre de archivo con rango y print. jsPDF se mockea para inspeccionar
// las llamadas de dibujo sin generar un binario real.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const docStub = {
  setFont: vi.fn(),
  setFontSize: vi.fn(),
  setTextColor: vi.fn(),
  setFillColor: vi.fn(),
  setDrawColor: vi.fn(),
  setLineWidth: vi.fn(),
  setGState: vi.fn(),
  rect: vi.fn(),
  roundedRect: vi.fn(),
  circle: vi.fn(),
  line: vi.fn(),
  triangle: vi.fn(),
  text: vi.fn(),
  addImage: vi.fn(),
  addPage: vi.fn(),
  setPage: vi.fn(),
  autoPrint: vi.fn(),
  save: vi.fn(),
  output: vi.fn(() => 'blob:fake'),
  internal: { getNumberOfPages: vi.fn(() => 1), pageSize: { getWidth: () => 216, getHeight: () => 279 } },
  GState: vi.fn(),
}

vi.mock('jspdf', () => ({
  jsPDF: function jsPDFMock() { return docStub },
}))

vi.mock('../../../compat/services/pdf/pdfLogo.js', () => ({
  cargarLogo: vi.fn(async () => null),
}))

vi.mock('../../../compat/services/pdf/watermarkBase64.js', () => ({
  WATERMARK_LOGO: 'data:image/png;base64,fake',
}))

import { generarFinanzasResumenPDFImpl } from '../finanzasResumenPDF.impl.js'

const MOVIMIENTOS = [
  { id: 'm1', fecha: '2026-09-01', tipo: 'ingreso', categoria: 'Ventas', concepto: 'Cobro cliente X', moneda: 'USD', monto: 100, estado: 'activo', cuenta_origen: 'Banco BNC' },
  { id: 'm2', fecha: '2026-09-02', tipo: 'egreso', categoria: 'Servicios', concepto: 'Pago electricidad', moneda: 'VES', monto: 5000, monto_ves: 5000, estado: 'activo', cuenta_origen: 'Caja Efectivo Bs' },
  { id: 'm3', fecha: '2026-09-03', tipo: 'ingreso', categoria: 'Ventas', concepto: 'Cobro anulado', moneda: 'USD', monto: 999, estado: 'anulado' },
]

const RESUMEN = { ingresos_usd: 100, egresos_usd: 6.21, balance_usd: 93.79, balance_ves: 5000 }

beforeEach(() => {
  for (const fn of Object.values(docStub)) {
    if (vi.isMockFunction(fn)) fn.mockClear()
  }
  // jsPDF constructor recrea internal (getNumberOfPages se limpió con mockClear)
  docStub.internal.getNumberOfPages.mockReturnValue(1)
})

describe('generarFinanzasResumenPDFImpl', () => {
  it('genera el PDF, guarda con nombre de rango y dibuja los KPIs', async () => {
    await generarFinanzasResumenPDFImpl({
      movimientos: MOVIMIENTOS,
      resumen: RESUMEN,
      rango: { desde: '2026-09-01', hasta: '2026-09-30' },
      config: { nombre_negocio: 'Construacero' },
      action: 'download',
    })

    expect(docStub.save).toHaveBeenCalledTimes(1)
    expect(docStub.save).toHaveBeenCalledWith('finanzas-2026-09-01_2026-09-30.pdf')
    // El header premium dibuja el banner
    expect(docStub.rect).toHaveBeenCalled()
    // Los textos incluyen los totales formateados
    const textos = docStub.text.mock.calls.map(c => String(c[0]))
    expect(textos.some(t => t.includes('$100,00'))).toBe(true)
    expect(textos.some(t => t.includes('TOTALES'))).toBe(true)
  })

  it('marca los anulados con tachado y no los cuenta en ingresos activos', async () => {
    await generarFinanzasResumenPDFImpl({
      movimientos: MOVIMIENTOS,
      resumen: RESUMEN,
      rango: { desde: '2026-09-01', hasta: '2026-09-30' },
      action: 'download',
    })

    // Hay líneas dibujadas (el tachado usa doc.line)
    expect(docStub.line).toHaveBeenCalled()
    // El texto del anulado aparece tachado: el concepto sigue estando (histórico)
    const textos = docStub.text.mock.calls.map(c => String(c[0]))
    expect(textos.some(t => /Cobro anulado/i.test(t))).toBe(true)
  })

  it('título y nombre de archivo reflejan el filtro de tipo', async () => {
    await generarFinanzasResumenPDFImpl({
      movimientos: MOVIMIENTOS.filter(m => m.tipo === 'egreso'),
      resumen: { ...RESUMEN, tipoFiltro: 'egreso' },
      rango: { desde: '2026-09-01', hasta: '2026-09-30' },
      action: 'download',
    })

    const textos = docStub.text.mock.calls.map(c => String(c[0]))
    expect(textos.some(t => t === 'Reporte de Egresos')).toBe(true)
    expect(docStub.save).toHaveBeenCalledWith('finanzas-2026-09-01_2026-09-30-egresos.pdf')
  })

  it('action=print usa autoPrint + bloburl y no descarga', async () => {
    await generarFinanzasResumenPDFImpl({
      movimientos: MOVIMIENTOS,
      resumen: RESUMEN,
      rango: { desde: '2026-09-01', hasta: '2026-09-30' },
      action: 'print',
    })

    expect(docStub.autoPrint).toHaveBeenCalledTimes(1)
    expect(docStub.output).toHaveBeenCalledWith('bloburl')
    expect(docStub.save).not.toHaveBeenCalled()
  })

  it('desglosa por categorías y calcula el total por cada categoría', async () => {
    await generarFinanzasResumenPDFImpl({
      movimientos: MOVIMIENTOS,
      resumen: RESUMEN,
      rango: { desde: '2026-09-01', hasta: '2026-09-30' },
      action: 'download',
    })

    const textos = docStub.text.mock.calls.map(c => String(c[0]))
    // Título de la sección de categorías
    expect(textos.some(t => t.includes('DESGLOSE Y TOTALES POR CATEGORÍA'))).toBe(true)
    // Encabezados de categorías
    expect(textos.some(t => t.includes('CATEGORÍA: VENTAS'))).toBe(true)
    expect(textos.some(t => t.includes('CATEGORÍA: SERVICIOS'))).toBe(true)
    // Totales específicos por categoría
    expect(textos.some(t => t.includes('TOTAL VENTAS:'))).toBe(true)
    expect(textos.some(t => t.includes('TOTAL SERVICIOS:'))).toBe(true)
  })
})
