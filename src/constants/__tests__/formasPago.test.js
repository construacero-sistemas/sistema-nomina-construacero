import { describe, expect, it } from 'vitest'
import { FORMAS_PAGO_FINANZAS_OPCIONES, FORMAS_PAGO_NOMINA_OPCIONES } from '../formasPago.js'

describe('payment method options', () => {
  it('consolida los canales digitales VES en una única opción de finanzas', () => {
    const digitales = FORMAS_PAGO_FINANZAS_OPCIONES.filter(option => option.moneda === 'VES' && option.value !== 'Efectivo Bs')
    expect(digitales.map(option => option.value)).toEqual(['Bolívares digitales'])
    expect(digitales[0]).toMatchObject({
      label: 'Bolívares digitales',
      selectedLabel: 'Bolívares digitales',
      requiereReferencia: true,
      moneda: 'VES',
    })
  })

  it('no cambia las opciones históricas de nómina que aún usan los métodos específicos', () => {
    expect(FORMAS_PAGO_NOMINA_OPCIONES.map(option => option.value)).toContain('Transferencia')
    expect(FORMAS_PAGO_NOMINA_OPCIONES.map(option => option.value)).toContain('Pago Móvil')
    expect(FORMAS_PAGO_NOMINA_OPCIONES.map(option => option.value)).toContain('Punto de Venta')
  })
})
