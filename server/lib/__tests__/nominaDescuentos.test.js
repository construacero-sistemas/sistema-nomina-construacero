import { describe, expect, it } from 'vitest'
import {
  MAX_DESCUENTOS,
  MOTIVOS_DESCUENTO,
  componerNotaDescuentos,
  etiquetaMotivoDescuento,
  totalDescuentosNomina,
  validarDescuentosNomina,
} from '../nominaDescuentos.js'

describe('validarDescuentosNomina — motivo obligatorio', () => {
  it('acepta descuentos válidos y normaliza detalle y monto', () => {
    const r = validarDescuentosNomina([
      { motivo: 'Anticipo', detalle: '  Adelanto quincenal  ', monto: '10.5' },
      { motivo: 'prestamo', monto: 5 },
    ])
    expect(r.ok).toBe(true)
    expect(r.descuentos).toEqual([
      { motivo: 'anticipo', detalle: 'Adelanto quincenal', monto: 10.5 },
      { motivo: 'prestamo', detalle: null, monto: 5 },
    ])
  })

  it('rechaza cualquier descuento sin motivo o con motivo fuera de la lista', () => {
    expect(validarDescuentosNomina([{ monto: 10 }]).ok).toBe(false)
    expect(validarDescuentosNomina([{ motivo: '', monto: 10 }]).error).toMatch(/motivo/i)
    expect(validarDescuentosNomina([{ motivo: 'vacaciones', monto: 10 }]).ok).toBe(false)
    expect(validarDescuentosNomina(undefined).error).toMatch(/motivo/i)
  })

  it('rechaza montos no positivos o inválidos', () => {
    for (const monto of [0, -5, 'abc', null, true, NaN]) {
      const r = validarDescuentosNomina([{ motivo: 'falta', monto }])
      expect(r.ok, `monto ${String(monto)} debe rechazarse`).toBe(false)
      expect(r.error).toMatch(/mayor que 0/)
    }
  })

  it('rechaza detalle demasiado largo y listas excedidas', () => {
    expect(validarDescuentosNomina([{ motivo: 'multa', monto: 1, detalle: 'x'.repeat(181) }]).ok).toBe(false)
    const filas = Array.from({ length: MAX_DESCUENTOS + 1 }, () => ({ motivo: 'otro', monto: 1 }))
    expect(validarDescuentosNomina(filas).error).toMatch(/más de/)
  })

  it('totaliza en USD con 4 decimales', () => {
    const r = validarDescuentosNomina([
      { motivo: 'anticipo', monto: 10.005 },
      { motivo: 'prestamo', monto: 0.005 },
    ])
    expect(totalDescuentosNomina(r.descuentos)).toBe(10.01)
  })
})

describe('resumen de descuentos para el recibo', () => {
  it('etiqueta los motivos en español', () => {
    expect(MOTIVOS_DESCUENTO).toEqual(['anticipo', 'prestamo', 'falta', 'multa', 'otro'])
    expect(etiquetaMotivoDescuento('prestamo')).toBe('Préstamo')
    expect(etiquetaMotivoDescuento('desconocido')).toBe('Otro')
  })

  it('compone la nota legible con motivo y detalle', () => {
    expect(componerNotaDescuentos([
      { motivo: 'anticipo', detalle: 'adelanto quincenal', monto: 10 },
      { motivo: 'falta', detalle: null, monto: 6 },
    ])).toBe('Anticipo — adelanto quincenal · Falta')
    expect(componerNotaDescuentos([])).toBeNull()
  })
})
