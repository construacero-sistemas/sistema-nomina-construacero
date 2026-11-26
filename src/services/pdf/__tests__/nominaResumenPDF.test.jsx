// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'

const textos = []
const ctorCalls = []
const docStub = {
  internal: {
    pageSize: { getWidth: () => 279.4, getHeight: () => 215.9 },
    getNumberOfPages: () => 1,
  },
  setPage: vi.fn(),
  addPage: vi.fn(),
  setGState: vi.fn(),
  GState: function GState() {},
  addImage: vi.fn(),
  setFillColor: vi.fn(),
  setDrawColor: vi.fn(),
  setLineWidth: vi.fn(),
  rect: vi.fn(),
  roundedRect: vi.fn(),
  line: vi.fn(),
  triangle: vi.fn(),
  circle: vi.fn(),
  setFont: vi.fn(),
  setFontSize: vi.fn(),
  setTextColor: vi.fn(),
  text: vi.fn((txt) => textos.push(String(txt))),
  autoPrint: vi.fn(),
  output: vi.fn(() => 'blob:mock'),
  save: vi.fn(),
}

vi.mock('jspdf', () => ({
  jsPDF: function MockJsPDF(opts) {
    ctorCalls.push(opts)
    return docStub
  },
}))
vi.mock('../../../../compat/services/pdf/pdfLogo.js', () => ({ cargarLogo: vi.fn(async () => null) }))

describe('nominaResumenPDF — hoja semanal horizontal', () => {
  beforeEach(() => {
    textos.length = 0
    ctorCalls.length = 0
    vi.clearAllMocks()
  })

  it('genera PDF horizontal con sueldo semanal, bono semanal, descuentos y tasa congelada si cerró', async () => {
    const { generarNominaResumenPDFImpl } = await import('../nominaResumenPDF.impl.js')
    await generarNominaResumenPDFImpl({
      periodo: { nombre: 'Semana 48', desde: '2026-11-19', hasta: '2026-11-25', estado: 'pagado' },
      lineas: [{
        id: 'l1',
        empleado: { nombre: 'alejandra hidalgo' },
        salario_dia_usd_snap: 9.3333,
        dias_trabajados: 5,
        dias_descanso: 2,
        horas_extra: 2,
        monto_extra_usd: 5,
        bonos_usd: 0,
        comisiones_pos_usd: 0,
        deducciones_usd: 10,
        total_bruto_usd: 70.33,
        total_neto_usd: 60.33,
        pagado: true,
        tasa_pago_usd_ves: 924.35,
        total_pagado_bs: 55766.04,
      }],
      tasaCongelada: { valor: 924.35, fuente: 'BCV', fecha: '2026-11-25' },
      config: {},
    })

    expect(ctorCalls[0]).toEqual({ unit: 'mm', format: 'letter', orientation: 'landscape' })
    expect(textos).toContain('SUELDO SEM.')
    expect(textos).toContain('BONO SEM.')
    expect(textos).toContain('DESCUENTOS')
    expect(textos.some(t => t.includes('Tasa cierre:'))).toBe(true)
    expect(textos.some(t => t.includes('$30,33'))).toBe(true)
    expect(textos.some(t => t.includes('$35,00'))).toBe(true)
    expect(textos.some(t => t.includes('$10,00'))).toBe(true)
    expect(textos.some(t => t.includes('55.766,04'))).toBe(true)
    expect(docStub.save).toHaveBeenCalledWith('nomina-semana-48.pdf')
  })
})
