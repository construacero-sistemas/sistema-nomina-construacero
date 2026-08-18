import { afterEach, describe, expect, it } from 'vitest'
import { cachearTasa, limpiarCacheTasas, normalizarTasa, obtenerTasaCache } from '../tasasCambio.js'

afterEach(() => limpiarCacheTasas())

describe('tasas de cambio para snapshots', () => {
  it('normaliza moneda, destino y fuente', () => {
    expect(normalizarTasa({ monedaOrigen: 'usd', valor: 100, fuente: 'BCV' }))
      .toEqual({ moneda_origen: 'USD', moneda_destino: 'VES', valor: 100, fuente: 'BCV' })
  })

  it('cachea con TTL y no devuelve tasa vencida', () => {
    cachearTasa({ monedaOrigen: 'USD', valor: 100, fuente: 'manual' }, 100, 1000)
    expect(obtenerTasaCache('USD', 1050).valor).toBe(100)
    expect(obtenerTasaCache('USD', 1100)).toBeNull()
  })

  it('rechaza valor no positivo o moneda VES como origen', () => {
    expect(() => normalizarTasa({ monedaOrigen: 'VES', valor: 1, fuente: 'x' })).toThrow(/moneda/i)
    expect(() => normalizarTasa({ monedaOrigen: 'USD', valor: 0, fuente: 'x' })).toThrow(/valor/i)
  })
})
