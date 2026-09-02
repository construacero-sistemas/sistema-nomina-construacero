// src/utils/__tests__/carterasHelper.test.js
import { describe, expect, it } from 'vitest'
import { calcularSaldosCarteras, clasificarMovimientoEnCartera } from '../carterasHelper.js'

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
      subcuentaId: 'Transferencia',
      subcuentaNombre: 'Transferencia Bancaria (Bs)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Pago Móvil Mercantil', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Pago Móvil',
      subcuentaNombre: 'Pago Móvil (Bs)',
    })

    expect(clasificarMovimientoEnCartera({ referencia: 'Punto de Venta Lote 45', moneda: 'VES' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Punto de Venta',
      subcuentaNombre: 'Punto de Venta (Bs)',
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
    expect(saldos.ves.subcuentas['Transferencia'].saldo).toBe(5000)
    expect(saldos.ves.subcuentas['Pago Móvil'].saldo).toBe(-2000)
    expect(saldos.ves.totalVes).toBe(3000)
    expect(saldos.ves.totalEquivUsd).toBe(30) // 3000 / 100 = 30 USD

    // Patrimonio total
    expect(saldos.patrimonioTotalUsd).toBe(330) // 300 + 30 = 330 USD
  })
})
