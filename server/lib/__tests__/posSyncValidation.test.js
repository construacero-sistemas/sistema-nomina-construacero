// server/lib/__tests__/posSyncValidation.test.js
import { describe, expect, it } from 'vitest'
import {
  validarDistribucionMatematica,
  validarCompatibilidadMonedas,
} from '../posSyncValidation.js'

describe('posSyncValidation — guardarraíles matemáticos y de moneda', () => {
  it('aprueba distribución sin división o cuando las partes cuadran exacto', () => {
    const desglose = { pago_movil_ves: 10000 }
    const distribucion = {
      pago_movil_ves: {
        activo: true,
        dividido: true,
        partes: [
          { cuenta_origen: 'Cuenta Venezuela', monto: 6000 },
          { cuenta_origen: 'Banesco', monto: 4000 },
        ],
      },
    }

    const res = validarDistribucionMatematica(distribucion, desglose, [])
    expect(res.ok).toBe(true)
  })

  it('rechaza con error descriptivo si hay descuadre matemático (> 0.01)', () => {
    const desglose = { pago_movil_ves: 10000 }
    const distribucion = {
      pago_movil_ves: {
        activo: true,
        dividido: true,
        partes: [
          { cuenta_origen: 'Cuenta Venezuela', monto: 6000 },
          { cuenta_origen: 'Banesco', monto: 3500 }, // Descuadre de 500
        ],
      },
    }

    const res = validarDistribucionMatematica(distribucion, desglose, [])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Descuadre matemático/i)
    expect(res.error).toMatch(/Diferencia: 500/i)
  })

  it('rechaza partes con montos negativos o en 0', () => {
    const desglose = { efectivo_usd: 500 }
    const distribucion = {
      efectivo_usd: {
        activo: true,
        dividido: true,
        partes: [
          { cuenta_origen: 'Caja Efectivo $', monto: 600 },
          { cuenta_origen: 'Caja Chica', monto: -100 },
        ],
      },
    }

    const res = validarDistribucionMatematica(distribucion, desglose, [])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/monto inválido/i)
  })

  it('rechaza partes sin cuenta de custodia asignada', () => {
    const desglose = { efectivo_usd: 500 }
    const distribucion = {
      efectivo_usd: {
        activo: true,
        dividido: true,
        partes: [
          { cuenta_origen: '', monto: 500 },
        ],
      },
    }

    const res = validarDistribucionMatematica(distribucion, desglose, [])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no tiene una cuenta de custodia asignada/i)
  })

  it('detecta incompatibilidad de moneda (anti-poisoning)', () => {
    const cuentas = [
      { id: 'c-1', nombre: 'Caja Efectivo $', moneda: 'USD' },
      { id: 'c-2', nombre: 'Cuenta Venezuela', moneda: 'VES' },
    ]

    // Asignar pago móvil (VES) a cuenta USD
    const distInvalida = {
      pago_movil_ves: {
        activo: true,
        cuenta_origen: 'Caja Efectivo $',
      },
    }

    const res = validarCompatibilidadMonedas(distInvalida, cuentas)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Incompatibilidad de moneda/i)

    // Asignar efectivo USD a cuenta VES
    const distInvalidaUsd = {
      efectivo_usd: {
        activo: true,
        cuenta_origen: 'Cuenta Venezuela',
      },
    }

    const res2 = validarCompatibilidadMonedas(distInvalidaUsd, cuentas)
    expect(res2.ok).toBe(false)
    expect(res2.error).toMatch(/Incompatibilidad de moneda/i)

    // Asignación correcta
    const distValida = {
      pago_movil_ves: { activo: true, cuenta_origen: 'Cuenta Venezuela' },
      efectivo_usd: { activo: true, cuenta_origen: 'Caja Efectivo $' },
    }
    const resVal = validarCompatibilidadMonedas(distValida, cuentas)
    expect(resVal.ok).toBe(true)
  })
})
