import { describe, expect, it } from 'vitest'
import { clasificarCoincidenciasMovimiento, motivoCoincidenciaValido } from '../financialDuplicates.js'

describe('financial duplicate classification', () => {
  const existing = { id: 'existing', referencia: 'Transferencia · 1234', monto: 50, concepto: 'Pago proveedor' }

  it('classifies the same normalized reference and amount as exact duplicate', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: ' transferencia · 1234 ', monto: 50 }, [existing]))
      .toEqual({ exact: existing, similar: [] })
  })

  it('blocks exact same reference and amount even when the concept name differs', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: 'Transferencia · 1234', monto: 50, concepto: 'Nombre diferente' }, [existing]))
      .toEqual({ exact: existing, similar: [] })
  })

  it('flags same normalized reference and concept but different amount as similar', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: ' Transferencia · 1234 ', monto: 51, concepto: '  Pago   proveedor ' }, [existing]))
      .toEqual({ exact: null, similar: [existing] })
  })

  it('normalizes case and accents for concept and reference comparisons', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: 'TRANSFERENCIA · 1234', monto: 51, concepto: 'Págo Proveedor' }, [existing]))
      .toEqual({ exact: null, similar: [existing] })
  })

  it('does not warn when only the concept differs and the amount is different', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: 'Transferencia · 1234', monto: 51, concepto: 'Otro pago' }, [existing]))
      .toEqual({ exact: null, similar: [] })
  })

  it('does not warn for movements without a reference', () => {
    expect(clasificarCoincidenciasMovimiento({ referencia: '', monto: 50, concepto: 'Pago proveedor' }, [existing]))
      .toEqual({ exact: null, similar: [] })
  })

  it('requires a useful reason for an exception', () => {
    expect(motivoCoincidenciaValido('   ')).toBe(false)
    expect(motivoCoincidenciaValido('Segundo depósito confirmado')).toBe(true)
    expect(motivoCoincidenciaValido('x'.repeat(301))).toBe(false)
  })
})
