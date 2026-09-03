// src/components/finanzas/__tests__/cuentasCompatibles.test.js
// Pruebas unitarias para la separación estricta de cuentas según el método de pago
import { describe, expect, it } from 'vitest'
import { getCuentasCompatibles } from '../cuentasCompatibles.js'

const CUENTAS_TEST = [
  { id: 'c-binance', nombre: 'binance', banco: 'Binance Pay (USDT)', tipo: 'cripto_usdt', moneda: 'USDT', activo: true },
  { id: 'c-zelle', nombre: 'Zelle Corporativo', banco: 'Zelle', tipo: 'zelle', moneda: 'USD', activo: true },
  { id: 'c-bnc', nombre: 'Banco BNC (Principal)', banco: 'BNC (Banco Nacional de Crédito)', tipo: 'banco_ves', moneda: 'VES', activo: true },
  { id: 'c-caja-usd', nombre: 'Caja Efectivo $', banco: 'Caja Fuerte', tipo: 'efectivo_usd', moneda: 'USD', codigo: 'caja-efectivo-usd', activo: true },
  { id: 'c-caja-bs', nombre: 'Caja Efectivo Bs', banco: 'Caja Física', tipo: 'efectivo_ves', moneda: 'VES', codigo: 'caja-efectivo-bs', activo: true },
  { id: 'c-inactiva', nombre: 'Cuenta Vieja', tipo: 'banco_ves', moneda: 'VES', activo: false },
]

describe('getCuentasCompatibles — Separación Inteligente y Estricta', () => {
  it('USDT (Cripto) solo retorna cuentas de Binance / cripto y nunca Zelle ni bancos', () => {
    const res = getCuentasCompatibles('USDT', CUENTAS_TEST)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('c-binance')
    expect(res.some(c => c.id === 'c-zelle')).toBe(false)
    expect(res.some(c => c.id === 'c-bnc')).toBe(false)
  })

  it('Zelle solo retorna cuentas de Zelle / USD y NUNCA cuentas de Binance / USDT', () => {
    const res = getCuentasCompatibles('Zelle', CUENTAS_TEST)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('c-zelle')
    expect(res.some(c => c.id === 'c-binance')).toBe(false)
  })

  it('Métodos bancarios (Transferencia, Pago Móvil, Punto de Venta, Banco en Bolívares) solo retornan cuentas bancarias en Bs', () => {
    const metodos = ['Banco en Bolívares', 'Transferencia', 'Pago Móvil', 'Punto de Venta']
    for (const m of metodos) {
      const res = getCuentasCompatibles(m, CUENTAS_TEST)
      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('c-bnc')
      // No debe incluir la caja física en Bs
      expect(res.some(c => c.id === 'c-caja-bs')).toBe(false)
      expect(res.some(c => c.id === 'c-binance')).toBe(false)
      expect(res.some(c => c.id === 'c-zelle')).toBe(false)
    }
  })

  it('Efectivo $ solo retorna la caja fuerte en dólares', () => {
    const res = getCuentasCompatibles('Efectivo $', CUENTAS_TEST)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('c-caja-usd')
  })

  it('Efectivo Bs solo retorna la caja física en bolívares', () => {
    const res = getCuentasCompatibles('Efectivo Bs', CUENTAS_TEST)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('c-caja-bs')
  })

  it('ignora cuentas inactivas', () => {
    const res = getCuentasCompatibles('Banco en Bolívares', CUENTAS_TEST)
    expect(res.some(c => c.id === 'c-inactiva')).toBe(false)
  })
})
