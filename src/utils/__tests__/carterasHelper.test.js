// src/utils/__tests__/carterasHelper.test.js
import { describe, expect, it } from 'vitest'
import { calcularSaldosCarteras, clasificarMovimientoEnCartera } from '../carterasHelper.js'
import { summarizeConfirmedBalances } from '../confirmedBalances.js'

const fullBalance = () => ({ conciliacionPendiente: false, corte: '2026-09-13T12:00:00Z', versionLibro: '7', cuentas: [
  { moneda: 'USD', saldoNativo: '100', valorUsd: '100', valoracionCompleta: true },
  { moneda: 'USDT', saldoNativo: '100', valorUsd: '110', valoracionCompleta: true },
  { moneda: 'VES', saldoNativo: '4000', valorUsd: '10', valoracionCompleta: true },
] })
describe('saldos confirmados: ausencias y valoración', () => {
  it('separa la valoración histórica de la tasa de referencia', () => {
    const result = summarizeConfirmedBalances(fullBalance(), 800)
    expect(result.usd.totalUsd).toBe(210)
    expect(result.ves.totalVes).toBe(4000)
    expect(result.ves.totalEquivUsd).toBe(5)
    expect(result.patrimonioTotalUsd).toBe(220)
    expect(result.versionLibro).toBe('7')
  })
  it.each([null, undefined, '', ' ', 'NaN', Infinity, false])('no transforma saldo nativo inválido %s en cero', value => {
    const snapshot = fullBalance()
    snapshot.cuentas[2].saldoNativo = value
    expect(summarizeConfirmedBalances(snapshot, 400)).toBeNull()
  })
  it.each([null, undefined, '', ' ', 'NaN', Infinity, false])('mantiene valoración inválida %s como desconocida', value => {
    const snapshot = fullBalance()
    snapshot.cuentas[1].valorUsd = value
    const result = summarizeConfirmedBalances(snapshot, 400)
    expect(result.usd.totalUsd).toBeNull()
    expect(result.patrimonioTotalUsd).toBeNull()
    expect(result.valoracionCompleta).toBe(false)
    expect(result.ves.totalVes).toBe(4000)
  })
  it('exige conciliación explícita y admite un libro vacío confirmado', () => {
    expect(summarizeConfirmedBalances({ cuentas: [] })).toBeNull()
    expect(summarizeConfirmedBalances({ ...fullBalance(), conciliacionPendiente: true })).toBeNull()
    expect(summarizeConfirmedBalances({ conciliacionPendiente: false, cuentas: [] }).patrimonioTotalUsd).toBe(0)
  })
  it('una tasa no finita no produce equivalencias falsas', () => {
    const result = summarizeConfirmedBalances(fullBalance(), Infinity)
    expect(result.ves.totalEquivUsd).toBeNull()
    expect(result.usd.totalEquivVes).toBeNull()
    expect(result.patrimonioTotalUsd).toBe(220)
  })
})

describe('carterasHelper', () => {
  it('clasifica movimientos en Cartera USD correctamente', () => {
    expect(clasificarMovimientoEnCartera({ referencia: 'Efectivo $ · Recibo 001', moneda: 'USD' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'Efectivo $',
      subcuentaNombre: 'Efectivo en Dólares ($)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Zelle · Ref #9876', moneda: 'USD' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'Zelle',
      subcuentaNombre: 'Zelle (USD)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'USDT Binance', moneda: 'USDT' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'USDT',
      subcuentaNombre: 'USDT (Binance / Cripto)',
    })
  })

  it('clasifica movimientos en Cartera Bolívares correctamente', () => {
    expect(clasificarMovimientoEnCartera({ referencia: 'Efectivo Bs · Caja', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Efectivo Bs',
      subcuentaNombre: 'Efectivo en Bolívares (Bs)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Transferencia Bancaria BNC', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Banco en Bolívares',
      subcuentaNombre: 'Banco en Bolívares (Bs)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Pago Móvil Mercantil', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Banco en Bolívares',
      subcuentaNombre: 'Banco en Bolívares (Bs)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Punto de Venta Lote 45', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Banco en Bolívares',
      subcuentaNombre: 'Banco en Bolívares (Bs)',
    })
  })

  it('calcula saldos de carteras y patrimonio consolidado con precisión', () => {
    const tasa = 100 // 100 Bs/USD para prueba limpia
    const movimientos = [
      { id: '1', tipo: 'ingreso', monto: 150, moneda: 'USD', referencia: 'Efectivo $', estado: 'activo' },
      { id: '2', tipo: 'egreso',  monto: 50,  moneda: 'USD', referencia: 'Efectivo $', estado: 'activo' },
      { id: '3', tipo: 'ingreso', monto: 200, moneda: 'USD', referencia: 'Zelle', estado: 'activo' },
      { id: '4', tipo: 'ingreso', monto: 5000, moneda: 'VES', referencia: 'Transferencia', estado: 'activo' },
      { id: '5', tipo: 'egreso',  monto: 2000, moneda: 'VES', referencia: 'Pago Móvil', estado: 'activo' },
      { id: '6', tipo: 'ingreso', monto: 9999, moneda: 'USD', referencia: 'Zelle', estado: 'anulado' }, // Debe ser ignorado
    ]

    const saldos = calcularSaldosCarteras(movimientos, tasa)

    // Cartera USD
    expect(saldos.usd.subcuentas['Efectivo $'].saldo).toBe(100)
    expect(saldos.usd.subcuentas['Zelle'].saldo).toBe(200)
    expect(saldos.usd.totalUsd).toBe(300)
    expect(saldos.usd.totalEquivVes).toBe(30000)

    // Cartera VES
    expect(saldos.ves.subcuentas['Banco en Bolívares'].saldo).toBe(3000)
    expect(saldos.ves.subcuentas['Banco en Bolívares'].ingresos).toBe(5000)
    expect(saldos.ves.subcuentas['Banco en Bolívares'].egresos).toBe(2000)
    expect(saldos.ves.subcuentas).not.toHaveProperty('Transferencia')
    expect(saldos.ves.subcuentas).not.toHaveProperty('Pago Móvil')
    expect(saldos.ves.totalVes).toBe(3000)
    expect(saldos.ves.totalEquivUsd).toBe(30) // 3000 / 100 = 30 USD

    // Patrimonio total
    expect(saldos.patrimonioTotalUsd).toBe(330) // 300 + 30 = 330 USD
  })
})
