import { describe, expect, it } from 'vitest'
import {
  movementResponse,
  normalizeCategory,
  normalizeMovement,
  normalizeReportQuery,
  summarizeRows,
  validateDateRange,
} from '../finanzasUtils.js'

const validMovement = {
  fecha: '2026-08-18',
  tipo: 'ingreso',
  categoria: 'Ventas',
  concepto: 'Cobro de obra',
  monto: '10.1234567',
  moneda: 'USD',
  tasaVes: '120.4567891',
  fuenteTasa: 'MANUAL',
  observacionTasa: 'Aprobada por administración',
  idempotencyKey: 'finanzas-unit-test-0001',
}

describe('finanzasUtils — validación determinista', () => {
  it('normaliza importes y tasa a la precisión contractual', () => {
    const result = normalizeMovement(validMovement)
    expect(result.monto).toBe(10.123457)
    expect(result.tasa_ves).toBe(120.456789)
    expect(result.tipo).toBe('ingreso')
    expect(result.idempotency_key).toBe(validMovement.idempotencyKey)
  })

  it('exige observación para tasas manuales', () => {
    expect(() => normalizeMovement({ ...validMovement, observacionTasa: '' })).toThrow(/tasa manual/i)
  })

  it('rechaza tipos, monedas, montos y claves inválidas', () => {
    expect(() => normalizeMovement({ ...validMovement, tipo: 'transferencia' })).toThrow(/tipo/i)
    expect(() => normalizeMovement({ ...validMovement, moneda: 'ARS' })).toThrow(/moneda/i)
    expect(() => normalizeMovement({ ...validMovement, monto: 0 })).toThrow(/monto/i)
    expect(() => normalizeMovement({ ...validMovement, monto: 1_000_000_001 })).toThrow(/monto/i)
    expect(() => normalizeMovement({ ...validMovement, tasaVes: 1_000_001 })).toThrow(/tasa VES/i)
    expect(() => normalizeMovement({ ...validMovement, idempotencyKey: 'corta' })).toThrow(/idempotency/i)
  })

  it('valida límites de fechas de reportes', () => {
    expect(validateDateRange('2026-08-01', '2026-08-31')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
    expect(() => validateDateRange('2026-08-31', '2026-08-01')).toThrow(/rango/i)
    expect(() => validateDateRange('2026-01-01', '2027-01-03')).toThrow(/366/i)
  })

  it('limita la paginación a 100 filas y conserva filtros', () => {
    const url = new URL('https://worker.test/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&limit=100&offset=50&tipo=egreso&moneda=ves')
    expect(normalizeReportQuery(url)).toMatchObject({ limit: 100, offset: 50, tipo: 'egreso', moneda: 'VES' })
    expect(() => normalizeReportQuery(new URL('https://worker.test/?desde=2026-08-01&hasta=2026-08-31&limit=101'))).toThrow(/paginación/i)
  })

  it('valida categorías y evita categorías vacías', () => {
    expect(normalizeCategory({ nombre: '  Nómina ', tipo: 'egreso' })).toEqual({ nombre: 'Nómina', tipo: 'egreso' })
    expect(() => normalizeCategory({ nombre: ' ', tipo: 'egreso' })).toThrow(/categoría/i)
  })
})

describe('finanzasUtils — agregación y exposición', () => {
  it('calcula ingresos, egresos, balance y categorías', () => {
    const result = summarizeRows([
      { tipo: 'ingreso', categoria: 'Ventas', total_ves: 500, movimientos: 2 },
      { tipo: 'egreso', categoria: 'Proveedores', total_ves: 120, movimientos: 1 },
      { tipo: 'egreso', categoria: 'Proveedores', total_ves: 30, movimientos: 1 },
    ])
    expect(result).toMatchObject({ ingresos_ves: 500, egresos_ves: 150, balance_ves: 350, movimientos: 4 })
    expect(result.categorias).toEqual(expect.arrayContaining([
      { tipo: 'egreso', categoria: 'Proveedores', total_ves: 150, movimientos: 2 },
    ]))
  })

  it('solo expone las columnas públicas de un movimiento', () => {
    const result = movementResponse({ ...validMovement, id: 'id', monto_ves: 1200, pin_hash: 'secret', cuenta_id: 'tenant' })
    expect(result).toMatchObject({ id: 'id', monto_ves: 1200 })
    expect(result).not.toHaveProperty('pin_hash')
    expect(result).not.toHaveProperty('cuenta_id')
  })
})
