// server/lib/__tests__/carterasHelper.test.js
import { describe, expect, it } from 'vitest'
import { calcularSaldosCarteras, clasificarMovimientoEnCartera, asignarMovimientoACuenta, contarMovimientosSinCuenta } from '../carterasHelper.js'

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

  it('clasifica movimientos en Cartera Bolívares consolidando canales en Banco en Bolívares y Caja en Efectivo Bs', () => {
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

  it('usa metodo_pago guardado (migración 226) como fuente de verdad sobre el texto', () => {
    // El método guardado manda aunque la referencia no lo mencione
    expect(clasificarMovimientoEnCartera({ moneda: 'VES', metodo_pago: 'Banco en Bolívares', referencia: 'Compras varias' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Banco en Bolívares',
      subcuentaNombre: 'Banco en Bolívares (Bs)',
    })
    expect(clasificarMovimientoEnCartera({ moneda: 'VES', metodo_pago: 'Efectivo Bs', referencia: 'Pago a proveedor' })).toEqual({
      carteraId: 'VES',
      subcuentaId: 'Efectivo Bs',
      subcuentaNombre: 'Efectivo en Bolívares (Bs)',
    })
    expect(clasificarMovimientoEnCartera({ moneda: 'USD', metodo_pago: 'Zelle', referencia: '' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'Zelle',
      subcuentaNombre: 'Zelle (USD)',
    })
    expect(clasificarMovimientoEnCartera({ moneda: 'USD', metodo_pago: 'USDT', referencia: '' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'USDT',
      subcuentaNombre: 'USDT (Binance / Cripto)',
    })
    // Sin metodo_pago, cae en el heurístico de texto (retrocompatibilidad)
    expect(clasificarMovimientoEnCartera({ moneda: 'USD', referencia: 'Zelle · x' })).toEqual({
      carteraId: 'USD',
      subcuentaId: 'Zelle',
      subcuentaNombre: 'Zelle (USD)',
    })
  })

  it('calcula saldos de carteras y patrimonio consolidado con precisión', () => {
    const tasa = 100 // 100 Bs/USD para prueba limpia
    const movimientos = [
      { id: '1', tipo: 'ingreso', monto: 150, moneda: 'USD', referencia: 'Efectivo $', estado: 'activo' },
      { id: '2', tipo: 'egreso',  monto: 50,  moneda: 'USD', referencia: 'Efectivo $', estado: 'activo' },
      { id: '3', tipo: 'ingreso', monto: 200, moneda: 'USD', referencia: 'Zelle', estado: 'activo' },
      { id: '4', tipo: 'ingreso', monto: 5000, moneda: 'VES', referencia: 'Punto de Venta', estado: 'activo' },
      { id: '5', tipo: 'egreso',  monto: 2000, moneda: 'VES', referencia: 'Pago Móvil', estado: 'activo' },
      { id: '6', tipo: 'ingreso', monto: 9999, moneda: 'USD', referencia: 'Zelle', estado: 'anulado' }, // Debe ser ignorado
    ]

    const saldos = calcularSaldosCarteras(movimientos, tasa)

    // Cartera USD
    expect(saldos.usd.subcuentas['Efectivo $'].saldo).toBe(100)
    expect(saldos.usd.subcuentas['Zelle'].saldo).toBe(200)
    expect(saldos.usd.totalUsd).toBe(300)
    expect(saldos.usd.totalEquivVes).toBe(30000)

    // Cartera VES (5000 ingreso punto venta - 2000 egreso pago móvil = 3000 saldo en Banco en Bolívares)
    expect(saldos.ves.subcuentas['Banco en Bolívares'].saldo).toBe(3000)
    expect(saldos.ves.totalVes).toBe(3000)
    expect(saldos.ves.totalEquivUsd).toBe(30) // 3000 / 100 = 30 USD

    // Patrimonio total
    expect(saldos.patrimonioTotalUsd).toBe(330) // 300 + 30 = 330 USD
  })

  it('asigna un movimiento a UNA sola cuenta por cuenta_origen explícita (evita doble conteo)', () => {
    const cuentas = [
      { id: 'banco-bnc-ves', nombre: 'Banco BNC (Principal)', subcuentaId: 'Banco en Bolívares' },
      { id: 'banco-mercantil-ves', nombre: 'Banco Mercantil', subcuentaId: 'Banco en Bolívares' },
    ]

    // Movimiento asignado a BNC por cuenta_origen
    const mov = { cuenta_origen: 'Banco BNC (Principal)', subcuentaId: 'Banco en Bolívares' }
    expect(asignarMovimientoACuenta(mov, cuentas)?.id).toBe('banco-bnc-ves')

    // A unique exact account name is required; a bank substring is insufficient.
    const mov2 = { cuenta_origen: 'Banco Mercantil' }
    expect(asignarMovimientoACuenta(mov2, cuentas)?.id).toBe('banco-mercantil-ves')
    expect(asignarMovimientoACuenta({ cuenta_origen: 'Mercantil' }, cuentas)).toBeNull()
  })

  it('deja SIN cuenta un movimiento que no trae cuenta_origen explícita', () => {
    const cuentas = [{ id: 'banco-bnc-ves', nombre: 'Banco BNC (Principal)', subcuentaId: 'Banco en Bolívares' }]
    // Comparte subcuentaId pero no tiene cuenta_origen -> NO se asigna (evita doble conteo)
    expect(asignarMovimientoACuenta({ subcuentaId: 'Banco en Bolívares', referencia: 'Banco BNC' }, cuentas)).toBeNull()
    // Cuenta_origen que no matchea ninguna cuenta registrada -> null
    expect(asignarMovimientoACuenta({ cuenta_origen: 'Banesco' }, cuentas)).toBeNull()
  })

  it('requires a unique exact legacy name and never selects an ambiguous bank', () => {
    const cuentas = [
      { id: '11111111-1111-4111-8111-111111111111', nombre: 'Banco BNC', subcuentaId: 'Banco en Bolívares' },
      { id: '22222222-2222-4222-8222-222222222222', nombre: 'Banco BNC', subcuentaId: 'Banco en Bolívares' },
    ]
    expect(asignarMovimientoACuenta({ cuenta_origen: 'Banco BNC' }, cuentas)).toBeNull()
    expect(asignarMovimientoACuenta({ cuenta_origen: 'BNC' }, cuentas)).toBeNull()
    expect(asignarMovimientoACuenta({ cuenta_origen: cuentas[1].id }, cuentas)).toBe(cuentas[1])
    expect(asignarMovimientoACuenta({ cuenta_origen: '  banco bnc  ' }, [cuentas[0]])).toBe(cuentas[0])
  })

  it('prioritizes an explicit custody UUID over legacy name and rejects unknown UUIDs', () => {
    const cuentas = [
      { id: '11111111-1111-4111-8111-111111111111', nombre: 'Banco BNC' },
      { id: '22222222-2222-4222-8222-222222222222', nombre: 'Banco Mercantil' },
    ]
    expect(asignarMovimientoACuenta({ cuenta_custodia_id: cuentas[1].id, cuenta_origen: cuentas[0].nombre }, cuentas)).toBe(cuentas[1])
    expect(asignarMovimientoACuenta({ cuentaCustodiaId: cuentas[1].id, cuentaOrigen: cuentas[0].nombre }, cuentas)).toBe(cuentas[1])
    expect(asignarMovimientoACuenta({ cuenta_custodia_id: '33333333-3333-4333-8333-333333333333', cuenta_origen: cuentas[0].nombre }, cuentas)).toBeNull()
    expect(asignarMovimientoACuenta({ cuenta_custodia_id: cuentas[1].id }, cuentas)).toBe(cuentas[1])
  })

  it('cuenta los movimientos sin cuenta de custodia explícita', () => {
    const cuentas = [{ id: 'banco-bnc-ves', nombre: 'Banco BNC (Principal)', subcuentaId: 'Banco en Bolívares' }]
    const movimientos = [
      { id: '1', estado: 'activo', cuenta_origen: 'Banco BNC (Principal)' },
      { id: '2', estado: 'activo' }, // sin cuenta
      { id: '3', estado: 'activo', cuenta_origen: 'Banesco' }, // banco no registrado -> sin cuenta
      { id: '4', estado: 'anulado', cuenta_origen: 'Banco BNC (Principal)' }, // anulado: se descuenta del total
    ]

    const info = contarMovimientosSinCuenta(movimientos, cuentas)
    expect(info.total).toBe(3) // 4 no anulados
    expect(info.sinCuenta).toBe(2) // #2 y #3
  })
})
