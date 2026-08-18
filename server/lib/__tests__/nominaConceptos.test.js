import { describe, expect, it } from 'vitest'
import { assertConceptosReconciliados, conciliarConceptos, normalizarConcepto } from '../nominaConceptos.js'

describe('conceptos de nómina', () => {
  it('normaliza código, tipo y moneda', () => {
    expect(normalizarConcepto({
      codigo: ' bono_transporte ', nombre: 'Bono transporte', tipo: 'ingreso', monedaDefault: 'ves',
      fechaDesde: '2026-01-01', imponible: false,
    })).toMatchObject({ codigo: 'BONO_TRANSPORTE', moneda_default: 'VES', imponible: false })
  })

  it('rechaza códigos y tipos inseguros', () => {
    expect(() => normalizarConcepto({ codigo: 'x', nombre: 'X', tipo: 'otro' }))
      .toThrow(/concepto inválido/i)
  })

  it('concilia ingresos, deducciones y aporte patronal sin mezclar neto', () => {
    expect(conciliarConceptos([
      { tipo: 'ingreso', monto: 100 },
      { tipo: 'deduccion', monto: 10 },
      { tipo: 'retencion', monto: 5 },
      { tipo: 'aporte_patronal', monto: 12 },
    ])).toEqual({ totalIngresos: 100, totalDeducciones: 15, totalPatronal: 12, neto: 85 })
  })

  it('falla si el neto de conceptos no coincide con la línea', () => {
    expect(() => assertConceptosReconciliados(
      [{ tipo: 'ingreso', monto: 100 }], { neto: 90 },
    )).toThrow(/no concilian/i)
  })
})
