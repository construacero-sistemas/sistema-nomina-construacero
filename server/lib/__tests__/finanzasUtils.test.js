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

  it('congela la tasa USD para movimientos en USD y respeta la provista en otras monedas', () => {
    const usd = normalizeMovement(validMovement)
    expect(usd.tasa_usd_ves).toBe(120.456789)
    expect(normalizeMovement({ ...validMovement, tasaUsdVes: '999' }).tasa_usd_ves).toBe(120.456789)

    const eur = normalizeMovement({ ...validMovement, moneda: 'EUR', fuenteTasa: 'EURO', tasaUsdVes: '121.5' })
    expect(eur.tasa_usd_ves).toBe(121.5)
  })

  it('trata VES como moneda base: tasa fija 1:1 y sin fuente externa', () => {
    const ves = normalizeMovement({ ...validMovement, moneda: 'VES', tasaVes: '999', fuenteTasa: 'BCV', tasaUsdVes: '120' })
    expect(ves.tasa_ves).toBe(1)
    expect(ves.fuente_tasa).toBe('FIJA')
    expect(ves.tasa_usd_ves).toBe(120)
  })

  it('permite tasa USD ausente (queda pendiente) pero rechaza una inválida', () => {
    const sinTasa = normalizeMovement({ ...validMovement, moneda: 'EUR', fuenteTasa: 'EURO' })
    expect(sinTasa.tasa_usd_ves).toBeNull()
    expect(() => normalizeMovement({ ...validMovement, moneda: 'EUR', fuenteTasa: 'EURO', tasaUsdVes: '-1' })).toThrow(/USD/i)
  })

  it('exige observación para tasas manuales', () => {
    expect(() => normalizeMovement({ ...validMovement, observacionTasa: '' })).toThrow(/tasa manual/i)
  })

  it('exige un motivo (concepto) descriptivo en todo movimiento', () => {
    // Sin motivo no se puede saber al final de mes de dónde provienen los ingresos/egresos.
    expect(() => normalizeMovement({ ...validMovement, concepto: '' })).toThrow(/concepto/i)
    expect(() => normalizeMovement({ ...validMovement, concepto: '  ' })).toThrow(/concepto/i)
    expect(() => normalizeMovement({ ...validMovement, concepto: 'ab' })).toThrow(/concepto/i)
    const ok = normalizeMovement({ ...validMovement, concepto: '  Pago de flete a proveedor  ' })
    expect(ok.concepto).toBe('Pago de flete a proveedor')
    expect(() => normalizeMovement({ ...validMovement, concepto: 'x'.repeat(181) })).toThrow(/concepto/i)
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

  it('normaliza método de pago y cuenta de origen (migración 226)', () => {
    const result = normalizeMovement({
      ...validMovement,
      metodoPago: 'Banco en Bolívares',
      cuentaOrigen: 'Banesco',
    })
    expect(result.metodo_pago).toBe('Banco en Bolívares')
    expect(result.cuenta_origen).toBe('Banesco')
    expect(result.partes).toBeNull()
  })

  it('normaliza tramos (partes) que suman el total, y rechaza sumas distintas', () => {
    const result = normalizeMovement({ ...validMovement, monto: '300000', metodoPago: 'Banco en Bolívares', cuentaOrigen: 'Banesco', partes: [
      { monto: 100000, referencia: 'OP-001' },
      { monto: 200000, referencia: 'OP-002' },
    ] })
    expect(result.partes).toHaveLength(2)
    expect(result.partes[1].monto).toBe(200000)
    expect(result.partes[0].referencia).toBe('OP-001')

    // Suma distinta al monto total → rechaza
    expect(() => normalizeMovement({ ...validMovement, monto: '300000', partes: [
      { monto: 100000 }, { monto: 100000 },
    ] })).toThrow(/tramos/i)
    // Tramo sin monto positivo → rechaza
    expect(() => normalizeMovement({ ...validMovement, monto: '300000', partes: [{ monto: 0 }] })).toThrow(/tramo/i)
  })
})

describe('finanzasUtils — agregación y exposición', () => {
  it('calcula ingresos, egresos, balance y categorías en VES y USD', () => {
    const result = summarizeRows([
      { tipo: 'ingreso', categoria: 'Ventas', total_ves: 500, total_usd: 40, total_usd_puro: 30, total_usdt_puro: 10, total_ves_puro: 0, movimientos: 2, movimientos_sin_usd: 1 },
      { tipo: 'egreso', categoria: 'Proveedores', total_ves: 120, total_usd: 10, total_usd_puro: 10, total_usdt_puro: 0, total_ves_puro: 0, movimientos: 1, movimientos_sin_usd: 0 },
      { tipo: 'egreso', categoria: 'Proveedores', total_ves: 30, total_usd: 2.5, total_usd_puro: 0, total_usdt_puro: 0, total_ves_puro: 2000, movimientos: 1, movimientos_sin_usd: 0 },
    ])
    expect(result).toMatchObject({
      ingresos_ves: 500, egresos_ves: 150, balance_ves: 350, movimientos: 4,
      ingresos_usd: 40, egresos_usd: 12.5, balance_usd: 27.5, movimientos_sin_usd: 1,
      ingresos_usd_puro: 30, egresos_usd_puro: 10, balance_usd_puro: 20,
      ingresos_usdt_puro: 10, egresos_usdt_puro: 0, balance_usdt_puro: 10,
      ingresos_ves_puro: 0, egresos_ves_puro: 2000, balance_ves_puro: -2000,
    })
    expect(result.categorias).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'egreso', categoria: 'Proveedores', total_ves: 150, total_usd: 12.5, movimientos: 2 }),
    ]))
  })

  it('solo expone las columnas públicas de un movimiento', () => {
    const result = movementResponse({ ...validMovement, id: 'id', monto_ves: 1200, pin_hash: 'secret', cuenta_id: 'tenant' })
    expect(result).toMatchObject({ id: 'id', monto_ves: 1200 })
    expect(result).not.toHaveProperty('pin_hash')
    expect(result).not.toHaveProperty('cuenta_id')
  })
})
