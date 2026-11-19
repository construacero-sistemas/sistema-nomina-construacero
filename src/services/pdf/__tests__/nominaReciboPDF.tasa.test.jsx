// @vitest-environment jsdom
// Recibo de nómina: con tasa muestra la tasa de nómina y el cambio en bolívares de
// cada concepto y del neto; un recibo pagado usa la tasa guardada al pagar.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const docStub = {
  setFont: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(), setFillColor: vi.fn(), setDrawColor: vi.fn(),
  setLineWidth: vi.fn(), setGState: vi.fn(), rect: vi.fn(), roundedRect: vi.fn(), circle: vi.fn(), line: vi.fn(),
  triangle: vi.fn(), text: vi.fn(), addImage: vi.fn(), addPage: vi.fn(), setPage: vi.fn(), autoPrint: vi.fn(), save: vi.fn(),
  output: vi.fn(() => new Blob(['PDF'], { type: 'application/pdf' })),
  splitTextToSize: vi.fn(t => (Array.isArray(t) ? t : [String(t)])),
  getTextWidth: vi.fn(t => String(t).length * 1.5),
  internal: { getNumberOfPages: vi.fn(() => 1), pageSize: { getWidth: () => 216, getHeight: () => 279 } },
  GState: vi.fn(),
}
vi.mock('jspdf', () => ({ jsPDF: function jsPDFMock() { return docStub } }))
vi.mock('../../../../compat/services/pdf/pdfLogo.js', () => ({ cargarLogo: vi.fn(async () => null) }))
vi.mock('../../../../compat/services/pdf/watermarkBase64.js', () => ({ WATERMARK_LOGO: 'data:image/png;base64,fake' }))

import { generarNominaReciboPDFImpl } from '../nominaReciboPDF.impl.js'

// David: $240 al mes, 4 días, 1 falta, 1 descanso pagado → $40.
const LINEA = {
  empleado: { nombre: 'David Garcia' }, dias_trabajados: 4, dias_ausencia: 1, dias_descanso: 1, salario_dia_usd_snap: 8,
  monto_normal_usd: 40, total_bruto_usd: 40, deducciones_usd: 0, total_neto_usd: 40, pagado: false,
}
const textos = () => docStub.text.mock.calls.map(c => String(c[0]))

describe('recibo de nómina con tasa', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('muestra la tasa y el cambio en Bs de cada concepto y del neto', async () => {
    await generarNominaReciboPDFImpl({ periodo: { nombre: 'Semana' }, linea: LINEA, config: {}, tasa: 950, tasaOrigen: 'activa' })
    const t = textos()
    expect(t.some(x => /Tasa de nómina: 950,00 Bs por \$1 \(activa\)/.test(x))).toBe(true)
    expect(t).toContain('MONTO (Bs)')
    expect(t.some(x => /30\.400,00/.test(x))).toBe(true) // 4 días × $8 = $32 → Bs 30.400
    expect(t.some(x => /7\.600,00/.test(x))).toBe(true) // 1 descanso $8 → Bs 7.600
    expect(t.filter(x => /38\.000,00/.test(x)).length).toBeGreaterThanOrEqual(2) // bruto y neto $40
  })

  it('un recibo pagado usa la tasa y el monto guardados al pagar', async () => {
    await generarNominaReciboPDFImpl({
      periodo: { nombre: 'Semana' }, config: {}, tasa: 950,
      linea: { ...LINEA, pagado: true, tasa_pago_usd_ves: 900, total_pagado_bs: 36000 },
    })
    const t = textos()
    expect(t.some(x => /Tasa de nómina: 900,00 Bs por \$1 \(guardada al pagar\)/.test(x))).toBe(true)
    expect(t.some(x => /36\.000,00/.test(x))).toBe(true)
  })

  it('sin tasa conserva el recibo solo en dólares', async () => {
    await generarNominaReciboPDFImpl({ periodo: { nombre: 'Semana' }, linea: LINEA, config: {} })
    const t = textos()
    expect(t).not.toContain('MONTO (Bs)')
    expect(t.some(x => /Tasa de nómina/.test(x))).toBe(false)
  })
})

// Mejora del 19/11/2026: todos los recibos del período en un solo PDF.
describe('todos los recibos del período en un PDF', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('dibuja un recibo por página y descarga un solo archivo', async () => {
    const { generarNominaRecibosPeriodoPDFImpl } = await import('../nominaReciboPDF.impl.js')
    const lineas = ['Ana Perez', 'Luis Mora', 'Juan Diaz'].map(nombre => ({ ...LINEA, empleado: { nombre } }))
    await generarNominaRecibosPeriodoPDFImpl({ periodo: { nombre: 'Semana 46' }, lineas, config: {} })
    expect(docStub.addPage).toHaveBeenCalledTimes(2)
    expect(docStub.save).toHaveBeenCalledTimes(1)
    expect(docStub.save).toHaveBeenCalledWith('recibos-semana-46.pdf')
    const t = textos()
    for (const nombre of ['ANA PEREZ', 'LUIS MORA', 'JUAN DIAZ']) expect(t.some(x => x.toUpperCase().includes(nombre))).toBe(true)
  })

  it('sin recibos avisa en vez de descargar un PDF vacío', async () => {
    const { generarNominaRecibosPeriodoPDFImpl } = await import('../nominaReciboPDF.impl.js')
    await expect(generarNominaRecibosPeriodoPDFImpl({ periodo: {}, lineas: [] })).rejects.toThrow(/no tiene recibos/)
    expect(docStub.save).not.toHaveBeenCalled()
  })
})
