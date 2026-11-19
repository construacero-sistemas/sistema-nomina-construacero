// Reparto del recibo en sueldo semanal y bono semanal (migración 268).
import { describe, expect, it } from 'vitest'

// Regla del usuario (19/11/2026): el recibo separa sueldo semanal y bono semanal.
describe('desgloseSemana', () => {
  it('reparte el monto normal en sueldo, bono y descanso trabajado', async () => {
    const { desgloseSemana } = await import('../descansoRecibo.js')
    expect(desgloseSemana({ monto_normal_usd: 64, sueldo_semanal_usd: 21, bono_semanal_usd: 35 })).toEqual({ sueldo: 21, bono: 35, resto: 8 })
  })
  it('recibos sin reparto guardado (anteriores a la 268) devuelven null', async () => {
    const { desgloseSemana } = await import('../descansoRecibo.js')
    expect(desgloseSemana({ monto_normal_usd: 56 })).toBeNull()
  })
  it('si no cuadra con el monto normal, devuelve null y se usan los conceptos de siempre', async () => {
    const { desgloseSemana } = await import('../descansoRecibo.js')
    expect(desgloseSemana({ monto_normal_usd: 40, sueldo_semanal_usd: 21, bono_semanal_usd: 35 })).toBeNull()
  })
})
