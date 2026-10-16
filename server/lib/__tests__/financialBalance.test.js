import { describe, expect, it } from 'vitest'
import { calcularSaldoCartera, evaluarSaldoEgreso, parseInsufficientFundsDetail } from '../financialBalance.js'

describe('financial balance', () => {
  it('sums active incomes minus expenses with micro precision', () => {
    expect(calcularSaldoCartera([
      { tipo: 'ingreso', monto: 0.1, estado: 'activo' },
      { tipo: 'ingreso', monto: 0.2, estado: 'activo' },
      { tipo: 'egreso', monto: 0.05, estado: 'activo' },
      { tipo: 'ingreso', monto: 999, estado: 'anulado' },
    ])).toBe(0.25)
  })

  it('allows an expense equal to balance and blocks one that exceeds it', () => {
    expect(evaluarSaldoEgreso(100, 100)).toBeNull()
    expect(evaluarSaldoEgreso(100, 100.5)).toEqual({ disponible: 100, faltante: 0.5 })
    expect(evaluarSaldoEgreso(-10, 1)).toEqual({ disponible: -10, faltante: 11 })
  })

  it('parses the database guard error', () => {
    const detail = JSON.stringify({ code: 'PT402', details: 'FINANCIAL_INSUFFICIENT_FUNDS', hint: '{"disponible" : 5, "faltante" : 2, "moneda" : "USD"}' })
    expect(parseInsufficientFundsDetail(detail)).toEqual({ disponible: 5, faltante: 2, moneda: 'USD' })
    expect(parseInsufficientFundsDetail('other')).toBeNull()
  })
})
